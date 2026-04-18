import { memo, useCallback } from 'react'
import { useStore, selectCurrentView, selectIsLoading, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import { formatNum, shortName } from '../utils/format'
import { specIconUrl } from '../utils/icons'
import type { PlayerSnapshot, PlayerDeathRecord } from '../types'

function SpecIcon({ specId }: { specId: number | undefined }) {
  const src = specIconUrl(specId)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      width={18}
      height={18}
      style={{
        flexShrink: 0,
        border: '1px solid rgba(0, 0, 0, 0.7)',
        borderRadius: 2,
      }}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  )
}

const MODULE_ORDER = ['damage', 'healing', 'deaths', 'interrupts'] as const
type ModuleKey = (typeof MODULE_ORDER)[number]

const MODULE_CONFIG: Record<ModuleKey, {
  title: string
  valFn: ((p: PlayerSnapshot) => number) | null
  fmtFn: ((p: PlayerSnapshot) => string) | null
  totalFn: ((p: PlayerSnapshot) => string) | null
  rateLabel: string | null
}> = {
  damage:     { title: 'Damage',     valFn: p => p.dps,             fmtFn: p => formatNum(p.dps),             totalFn: p => formatNum(p.damage.total), rateLabel: 'DPS' },
  healing:    { title: 'Healing',    valFn: p => p.hps,             fmtFn: p => formatNum(p.hps),             totalFn: p => formatNum(p.healing.total), rateLabel: 'HPS' },
  deaths:     { title: 'Deaths',     valFn: null,                   fmtFn: null,                              totalFn: null, rateLabel: null },
  interrupts: { title: 'Interrupts', valFn: p => p.interrupts.total, fmtFn: p => String(p.interrupts.total),  totalFn: null, rateLabel: null },
}

export function SummaryView() {
  const currentView = useStore(selectCurrentView)
  const isLoading = useStore(selectIsLoading)
  const metric = useStore(s => s.metric)
  const setMetric = useStore(s => s.setMetric)
  const playerSpecs = useStore(s => s.playerSpecs)

  if (!currentView) {
    if (isLoading) return <SummaryLoadingSkeleton />
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="animate-pulse-dot" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          No encounter data
        </span>
      </div>
    )
  }

  const playerList = Object.values(currentView.players)
  const allDeaths: PlayerDeathRecord[] = playerList
    .flatMap(p => p.deaths)
    .sort((a, b) => a.timeOfDeath - b.timeOfDeath)

  // Buffs is a Full-only metric, but defend against a stale metric value
  // lingering when Summary mounts (e.g. during mode-flip state hydration).
  const focused: ModuleKey = metric === 'buffs' ? 'damage' : (metric as ModuleKey)
  const sidebarKeys = MODULE_ORDER.filter(k => k !== focused)

  return (
    <div style={{ display: 'flex', gap: 8, padding: 8, flex: 1, minHeight: 0 }}>
      {/* Focus pane */}
      <div style={{ flex: 3, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <OverviewModule
          moduleKey={focused}
          isFocused
          isActive
          playerList={playerList}
          allDeaths={allDeaths}
          playerSpecs={playerSpecs}
          onSelect={undefined}
        />
      </div>

      {/* Sidebar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180, minHeight: 0 }}>
        {sidebarKeys.map(key => (
          <OverviewModule
            key={key}
            moduleKey={key}
            isFocused={false}
            isActive={false}
            playerList={playerList}
            allDeaths={allDeaths}
            playerSpecs={playerSpecs}
            onSelect={() => setMetric(key)}
          />
        ))}
      </div>
    </div>
  )
}

function OverviewModule({
  moduleKey,
  isFocused,
  isActive,
  playerList,
  allDeaths,
  playerSpecs,
  onSelect,
}: {
  moduleKey: ModuleKey
  isFocused: boolean
  isActive: boolean
  playerList: PlayerSnapshot[]
  allDeaths: PlayerDeathRecord[]
  playerSpecs: Record<string, number>
  onSelect: (() => void) | undefined
}) {
  const cfg = MODULE_CONFIG[moduleKey]
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const setSelectedDeath = useStore(s => s.setSelectedDeath)

  // Stable handlers so memoized row components don't re-render when the
  // parent re-renders for unrelated reasons. moduleKey is the only varying
  // dep; the store setters are included for correctness but are themselves
  // reference-stable across renders.
  const onPlayerClick = useCallback(
    (name: string) => setSelectedPlayer(name, moduleKey),
    [setSelectedPlayer, moduleKey]
  )
  const onDeathClick = useCallback(
    (record: PlayerDeathRecord) => setSelectedDeath(record),
    [setSelectedDeath]
  )

  return (
    <div style={{
      background: 'var(--bg-root)',
      border: `1px solid ${isActive ? 'var(--border-default)' : 'var(--border-subtle)'}`,
      borderRadius: 2,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      flex: 1,
    }}>
      {/* Header */}
      <div
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: onSelect ? 'pointer' : 'default',
          flexShrink: 0,
          background: isActive ? 'var(--bg-hover)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={onSelect ? e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)' } : undefined}
        onMouseLeave={onSelect ? e => { if (!isActive) e.currentTarget.style.background = 'transparent' } : undefined}
      >
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--header-accent)',
        }}>
          {cfg.title}
        </div>
        {/* Expand arrow — hidden until Full view is built */}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {moduleKey === 'deaths' ? (
          <DeathsModuleBody
            deaths={allDeaths}
            playerSpecs={playerSpecs}
            playerList={playerList}
            onDeathClick={onDeathClick}
            isFocused={isFocused}
          />
        ) : (
          <RankedModuleBody
            moduleKey={moduleKey}
            playerList={playerList}
            playerSpecs={playerSpecs}
            isFocused={isFocused}
            onPlayerClick={onPlayerClick}
          />
        )}
      </div>
    </div>
  )
}

function RankedModuleBody({
  moduleKey,
  playerList,
  playerSpecs,
  isFocused,
  onPlayerClick,
}: {
  moduleKey: Exclude<ModuleKey, 'deaths'>
  playerList: PlayerSnapshot[]
  playerSpecs: Record<string, number>
  isFocused: boolean
  onPlayerClick: (name: string) => void
}) {
  const cfg = MODULE_CONFIG[moduleKey]
  const valFn = cfg.valFn!
  const fmtFn = cfg.fmtFn!

  const sorted = [...playerList].sort((a, b) => valFn(b) - valFn(a))
  const list = isFocused ? sorted : sorted.slice(0, 5)
  const maxVal = sorted[0] ? valFn(sorted[0]) : 1
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const drillMetric = useStore(s => s.drillMetric)

  const showSplitColumns = isFocused && !!cfg.totalFn

  return (
    <>
      {isFocused && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 10,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg-root)',
          zIndex: 1,
        }}>
          <div style={{ width: 20 }}>#</div>
          <div style={{ width: 100 }}>Player</div>
          <div style={{ flex: 1 }} />
          {showSplitColumns ? (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 48, textAlign: 'right' }}>Total</span>
              <span style={{ width: 48, textAlign: 'right' }}>{cfg.rateLabel}</span>
            </div>
          ) : (
            <span style={{ width: 55, textAlign: 'right' }}>
              {moduleKey === 'interrupts' ? 'Count' : ''}
            </span>
          )}
        </div>
      )}
      {list.map((p, i) => {
        const specId = resolveSpecId(playerSpecs, p.name, p.specId)
        const pct = maxVal > 0 ? (valFn(p) / maxVal) * 100 : 0
        const isSelected = selectedPlayer === p.name && drillMetric === moduleKey
        const total = cfg.totalFn?.(p) ?? null
        const value = fmtFn(p)

        return (
          <RankedModuleRow
            key={p.name}
            name={p.name}
            specId={specId}
            rank={i + 1}
            pct={pct}
            total={total}
            value={value}
            isSelected={isSelected}
            isFocused={isFocused}
            showSplitColumns={showSplitColumns}
            onClick={onPlayerClick}
          />
        )
      })}
    </>
  )
}

// Memoized: re-renders only when the row's visible props change. The onClick
// prop is stable via the parent's useCallback, and all other props are
// primitives or primitives-by-value. This stops Zustand updates unrelated to
// the row (e.g. graph focus, WS status) from reconciling 10-20 rows per metric.
const RankedModuleRow = memo(RankedModuleRowImpl)

function RankedModuleRowImpl({
  name,
  specId,
  rank,
  pct,
  total,
  value,
  isSelected,
  isFocused,
  showSplitColumns,
  onClick,
}: {
  name: string
  specId: number | undefined
  rank: number
  pct: number
  total: string | null
  value: string
  isSelected: boolean
  isFocused: boolean
  showSplitColumns: boolean
  onClick: (name: string) => void
}) {
  const color = getClassColor(specId)
  return (
    <div
      onClick={() => onClick(name)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '3px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        fontSize: 12,
        transition: 'background 0.1s',
        background: isSelected ? 'var(--bg-active)' : 'transparent',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--bg-active)' : 'transparent' }}
    >
      <div style={{ width: 20, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {rank}
      </div>
      <div style={{
        width: 100, display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, color, minWidth: 0,
      }}>
        <SpecIcon specId={specId} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shortName(name)}
        </span>
      </div>
      <div style={{ flex: 1, padding: '0 8px' }}>
        <div style={{
          height: 14, background: 'var(--bg-hover)', borderRadius: 2,
          overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            height: '100%', borderRadius: 2, opacity: 0.85,
            width: `${pct}%`, background: color,
          }} />
        </div>
      </div>
      {isFocused && showSplitColumns && total !== null ? (
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ color: 'var(--text-secondary)', width: 48, textAlign: 'right' }}>{total}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, width: 48, textAlign: 'right' }}>{value}</span>
        </div>
      ) : (
        <div style={{
          width: 55, textAlign: 'right', fontFamily: 'var(--font-mono)',
          fontSize: 11, color: 'var(--text-secondary)',
        }}>
          {value}
        </div>
      )}
    </div>
  )
}

function DeathsModuleBody({
  deaths,
  playerSpecs,
  playerList,
  onDeathClick,
  isFocused,
}: {
  deaths: PlayerDeathRecord[]
  playerSpecs: Record<string, number>
  playerList: PlayerSnapshot[]
  onDeathClick: (record: PlayerDeathRecord) => void
  isFocused: boolean
}) {
  if (deaths.length === 0) {
    return (
      <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
        No deaths
      </div>
    )
  }

  // Build a name → player lookup once so each death row is O(1) instead of O(players).
  const playerByName = new Map(playerList.map(p => [p.name, p]))

  return (
    <>
      {deaths.map((d, i) => {
        const player = playerByName.get(d.playerName)
        const specId = resolveSpecId(playerSpecs, d.playerName, player?.specId)
        return (
          <DeathModuleRow
            key={`${d.playerGuid}-${d.timeOfDeath}-${i}`}
            death={d}
            specId={specId}
            isFocused={isFocused}
            onClick={onDeathClick}
          />
        )
      })}
    </>
  )
}

// Memoized like RankedModuleRow above. `death` refs are stable across renders
// for a given snapshot (they live inside currentView.players[…].deaths), so
// the memo only re-runs when the parent hands it a genuinely different record.
const DeathModuleRow = memo(DeathModuleRowImpl)

function DeathModuleRowImpl({
  death,
  specId,
  isFocused,
  onClick,
}: {
  death: PlayerDeathRecord
  specId: number | undefined
  isFocused: boolean
  onClick: (record: PlayerDeathRecord) => void
}) {
  const color = getClassColor(specId)
  const elapsed = `${Math.floor(death.combatElapsed / 60)}:${String(Math.floor(death.combatElapsed % 60)).padStart(2, '0')}`
  const spellName = death.killingBlow?.spellName ?? 'Unknown'
  const sourceName = death.killingBlow?.sourceName ?? 'Unknown'

  return (
    <div
      onClick={() => onClick(death)}
      style={{
        padding: '4px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 12,
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--status-wipe)', fontSize: 11 }}>
          {elapsed}
        </span>
        <SpecIcon specId={specId} />
        <span style={{ fontWeight: 500, color }}>
          {shortName(death.playerName)}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isFocused ? <>killed by <span style={{ color: 'var(--text-primary)' }}>{spellName}</span> from {sourceName}</> : <>to {spellName}</>}
        </span>
      </div>
    </div>
  )
}

// Placeholder rendered while an aggregate snapshot is in flight. Mirrors the
// Summary layout (focus pane + sidebar) so the swap doesn't shift UI. Bars
// pulse subtly via the existing animate-pulse-dot keyframe.
function SummaryLoadingSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 8, padding: 8, flex: 1, minHeight: 0 }}>
      <div style={{ flex: 3, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <SkeletonModule rows={6} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
        <SkeletonModule rows={3} />
        <SkeletonModule rows={3} />
        <SkeletonModule rows={3} />
      </div>
    </div>
  )
}

function SkeletonModule({ rows }: { rows: number }) {
  return (
    <div
      className="animate-pulse-dot"
      style={{
        background: 'var(--bg-root)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 2,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        height: 28,
      }} />
      <div style={{ flex: 1, padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 14,
              background: 'var(--bg-hover)',
              borderRadius: 2,
              width: `${90 - i * 8}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
