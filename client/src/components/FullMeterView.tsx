import { useMemo } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import type { PlayerSnapshot } from '../types'
import {
  computeUnitRows,
  computeDeathRows,
  hasMatchingData,
  type UnitRow,
  type DeathRow,
} from '../utils/filters'
import { formatNum, shortName } from '../utils/format'
import { specIconUrl } from '../utils/icons'
import { getClassColor } from './PlayerRow'
import { FilterEmptyState } from './FilterEmptyState'

// Per-player table grid: rank | player | bar+% | active% | stat1 | stat2 | stat3.
const PLAYER_GRID_COLUMNS = '32px 180px minmax(140px, 1fr) 70px 90px 90px 80px'

// Deaths grid — per-death rows, different shape. Mirrors staging mock:
// rank | time | player | killing blow | source | overkill.
const DEATHS_GRID_COLUMNS = '32px 60px 180px minmax(140px, 1fr) 160px 90px'

type StatFormat = 'shorthand' | 'integer'
type NumericStat = { label: string; value: number; format: StatFormat; bold?: boolean }

interface MetricConfig {
  labels: [string, string, string]
  stats: (row: UnitRow) => [NumericStat, NumericStat, NumericStat]
}

const DAMAGE_CONFIG: MetricConfig = {
  labels: ['Total', 'DPS', 'Casts'],
  stats: r => [
    { label: 'Total', value: r.total, format: 'shorthand' },
    { label: 'DPS', value: r.value, format: 'shorthand', bold: true },
    { label: 'Casts', value: r.casts ?? 0, format: 'integer' },
  ],
}

const HEALING_CONFIG: MetricConfig = {
  labels: ['Total', 'HPS', 'Overheal'],
  stats: r => [
    { label: 'Total', value: r.total, format: 'shorthand' },
    { label: 'HPS', value: r.value, format: 'shorthand', bold: true },
    { label: 'Overheal', value: r.overheal ?? 0, format: 'shorthand' },
  ],
}

const INTERRUPTS_CONFIG: MetricConfig = {
  labels: ['Count', 'Spells', '—'],
  stats: r => [
    { label: 'Count', value: r.value, format: 'integer', bold: true },
    { label: 'Spells', value: r.distinctAbilities ?? 0, format: 'integer' },
    { label: '—', value: 0, format: 'integer' },
  ],
}

const METRIC_CONFIG: Record<'damage' | 'healing' | 'interrupts', MetricConfig> = {
  damage: DAMAGE_CONFIG,
  healing: HEALING_CONFIG,
  interrupts: INTERRUPTS_CONFIG,
}

function formatStat(stat: NumericStat): string {
  if (stat.format === 'integer') return stat.value > 0 ? stat.value.toLocaleString() : '—'
  return formatNum(stat.value)
}

export function FullMeterView() {
  const currentView = useStore(selectCurrentView)
  const perspective = useStore(s => s.perspective)
  const filters = useStore(s => s.filters)
  const metric = useStore(s => s.metric)

  if (!currentView) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="animate-pulse-dot" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          No encounter data
        </span>
      </div>
    )
  }

  const events = currentView.events ?? []
  const allies = currentView.players

  const duration =
    'duration' in currentView ? currentView.duration
    : 'activeDurationSec' in currentView ? currentView.activeDurationSec
    : 0

  const matches = hasMatchingData(events, perspective, filters, metric, allies)
  if (!matches) return <FilterEmptyState />

  if (metric === 'deaths') {
    return <FilteredDeathsTable events={events} perspective={perspective} filters={filters} allies={allies} />
  }

  return (
    <FilteredPlayerTable
      events={events}
      perspective={perspective}
      filters={filters}
      category={metric}
      allies={allies}
      duration={duration}
    />
  )
}

function FilteredPlayerTable({
  events,
  perspective,
  filters,
  category,
  allies,
  duration,
}: {
  events: Parameters<typeof computeUnitRows>[0]
  perspective: Parameters<typeof computeUnitRows>[1]
  filters: Parameters<typeof computeUnitRows>[2]
  category: 'damage' | 'healing' | 'interrupts'
  allies: Record<string, PlayerSnapshot>
  duration: number
}) {
  const playerSpecs = useStore(s => s.playerSpecs)

  const rows = useMemo(
    () => computeUnitRows(events, perspective, filters, category, allies, duration),
    [events, perspective, filters, category, allies, duration]
  )

  const config = METRIC_CONFIG[category]
  const topValue = rows[0]?.value ?? 0
  const totalValue = rows.reduce((sum, r) => sum + r.value, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PlayerColumnHeader labels={config.labels} showActive={perspective === 'allies'} />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState text="No player data yet" />
        ) : (
          rows.map((row, i) => (
            <FullPlayerRow
              key={row.name}
              row={row}
              rank={i + 1}
              topValue={topValue}
              totalValue={totalValue}
              activePct={perspective === 'allies' ? computeActivePct(allies[row.name], duration) : null}
              config={config}
              specId={resolveSpecId(playerSpecs, row.name, row.specId)}
              showActive={perspective === 'allies'}
            />
          ))
        )}
      </div>
    </div>
  )
}

// Percentage of the fight the player was contributing. Without resurrect data,
// we treat the latest death as the moment they stopped helping — accurate for
// single-segment views and a conservative lower bound for aggregated key runs
// where `combatElapsed` is relative to an individual segment.
function computeActivePct(player: PlayerSnapshot | undefined, duration: number): number | null {
  if (!player || duration <= 0) return null
  if (player.deaths.length === 0) return 100
  const last = player.deaths.reduce((a, b) => (a.timeOfDeath > b.timeOfDeath ? a : b))
  const pct = (last.combatElapsed / duration) * 100
  return Math.max(0, Math.min(100, pct))
}

function PlayerColumnHeader({ labels, showActive }: { labels: [string, string, string]; showActive: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: PLAYER_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <HeaderCell align="center">#</HeaderCell>
      <HeaderCell>Unit</HeaderCell>
      <HeaderCell />
      <HeaderCell align="right">{showActive ? 'Active' : ''}</HeaderCell>
      <HeaderCell align="right">{labels[0]}</HeaderCell>
      <HeaderCell align="right">{labels[1]}</HeaderCell>
      <HeaderCell align="right">{labels[2]}</HeaderCell>
    </div>
  )
}

function FullPlayerRow({
  row,
  rank,
  topValue,
  totalValue,
  activePct,
  config,
  specId,
  showActive,
}: {
  row: UnitRow
  rank: number
  topValue: number
  totalValue: number
  activePct: number | null
  config: MetricConfig
  specId: number | undefined
  showActive: boolean
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)

  const fillPct = topValue > 0 ? (row.value / topValue) * 100 : 0
  const shareOfTotal = totalValue > 0 ? (row.value / totalValue) * 100 : 0
  const stats = config.stats(row)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: PLAYER_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        minHeight: 36,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <RankCell rank={rank} />
      <PlayerNameCell name={row.name} color={color} specIcon={specIcon} />
      <BarCell color={color} fillPct={fillPct} shareOfTotal={shareOfTotal} />
      {showActive ? <ActiveCell pct={activePct} /> : <span />}
      {stats.map((s, i) => (
        <StatCell key={i} stat={s} />
      ))}
    </div>
  )
}

function FilteredDeathsTable({
  events,
  perspective,
  filters,
  allies,
}: {
  events: Parameters<typeof computeDeathRows>[0]
  perspective: Parameters<typeof computeDeathRows>[1]
  filters: Parameters<typeof computeDeathRows>[2]
  allies: Record<string, PlayerSnapshot>
}) {
  const playerSpecs = useStore(s => s.playerSpecs)

  const rows = useMemo(
    () => computeDeathRows(events, perspective, filters, allies),
    [events, perspective, filters, allies]
  )

  // Elapsed reference: for the first death, firstEventTime is unknown to the
  // engine, so compute it here from the earliest known event instead.
  const firstEventT = events.length > 0 ? events[0].t : rows[0]?.t ?? 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DeathsColumnHeader />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState text="No deaths recorded" />
        ) : (
          rows.map((row, i) => (
            <FullDeathRow
              key={`${row.victimName}-${row.t}-${i}`}
              row={row}
              rank={i + 1}
              specId={resolveSpecId(playerSpecs, row.victimName, row.victimSpecId)}
              killerSpecId={allies[row.killerName] ? resolveSpecId(playerSpecs, row.killerName, allies[row.killerName]?.specId) : undefined}
              elapsedSec={(row.t - firstEventT) / 1000}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DeathsColumnHeader() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: DEATHS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <HeaderCell align="center">#</HeaderCell>
      <HeaderCell align="right">Time</HeaderCell>
      <HeaderCell>Victim</HeaderCell>
      <HeaderCell>Killing Blow</HeaderCell>
      <HeaderCell>Source</HeaderCell>
      <HeaderCell align="right">Overkill</HeaderCell>
    </div>
  )
}

function FullDeathRow({
  row,
  rank,
  specId,
  killerSpecId,
  elapsedSec,
}: {
  row: DeathRow
  rank: number
  specId: number | undefined
  killerSpecId: number | undefined
  elapsedSec: number
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)
  const killerIsPlayer = killerSpecId !== undefined
  const killerColor = killerIsPlayer ? getClassColor(killerSpecId) : 'var(--text-secondary)'
  const killerIcon = killerIsPlayer ? specIconUrl(killerSpecId) : null

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: DEATHS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        minHeight: 36,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <RankCell rank={rank} />
      <span style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--status-wipe)',
        textAlign: 'right',
      }}>
        {formatElapsed(elapsedSec)}
      </span>
      <PlayerNameCell name={row.victimName} color={color} specIcon={specIcon} />
      <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
        {row.ability || '—'}
      </span>
      {killerIsPlayer ? (
        <PlayerNameCell name={row.killerName} color={killerColor} specIcon={killerIcon} />
      ) : (
        <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
          {row.killerName || '—'}
        </span>
      )}
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        textAlign: 'right',
        color: row.overkill && row.overkill > 0 ? 'var(--status-wipe)' : 'var(--text-muted)',
      }}>
        {row.overkill && row.overkill > 0 ? row.overkill.toLocaleString() : '—'}
      </span>
    </div>
  )
}

// ——— Shared cells ———

function HeaderCell({
  children,
  align = 'left',
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)',
      textAlign: align,
    }}>
      {children}
    </span>
  )
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span style={{
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      color: 'var(--text-muted)',
      textAlign: 'center',
    }}>
      {rank}
    </span>
  )
}

function PlayerNameCell({
  name,
  color,
  specIcon,
}: {
  name: string
  color: string
  specIcon: string | null
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {specIcon && (
        <img
          src={specIcon}
          alt=""
          width={18}
          height={18}
          style={{
            border: '1px solid rgba(0, 0, 0, 0.7)',
            borderRadius: 2,
            flexShrink: 0,
          }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color, minWidth: 0 }}>
        {shortName(name)}
      </span>
    </div>
  )
}

function BarCell({
  color,
  fillPct,
  shareOfTotal,
}: {
  color: string
  fillPct: number
  shareOfTotal: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{
        flex: 1,
        height: 14,
        background: 'var(--bg-hover)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          width: `${fillPct}%`,
          height: '100%',
          background: color,
          opacity: 0.85,
          borderRadius: 2,
        }} />
      </div>
      <span style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        minWidth: 40,
        flexShrink: 0,
        textAlign: 'right',
      }}>
        {shareOfTotal.toFixed(1)}%
      </span>
    </div>
  )
}

function ActiveCell({ pct }: { pct: number | null }) {
  return (
    <span style={{
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      textAlign: 'right',
      color: 'var(--text-secondary)',
    }}>
      {pct === null ? '—' : `${Math.round(pct)}%`}
    </span>
  )
}

function StatCell({ stat }: { stat: NumericStat }) {
  return (
    <span style={{
      fontSize: stat.bold ? 13 : 12,
      fontFamily: 'var(--font-mono)',
      fontWeight: stat.bold ? 600 : 400,
      color: stat.bold ? 'var(--text-primary)' : 'var(--text-secondary)',
      textAlign: 'right',
    }}>
      {formatStat(stat)}
    </span>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

function formatElapsed(sec: number): string {
  const safe = Math.max(0, sec)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
