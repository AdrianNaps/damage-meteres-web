import { useStore, selectCurrentView, resolveSpecId } from '../store'
import type { PlayerSnapshot, PlayerDeathRecord } from '../types'
import { formatNum, shortName } from '../utils/format'
import { specIconUrl } from '../utils/icons'
import { SPEC_NAMES } from '../data/specIcons'
import { getClassColor } from './PlayerRow'

// Per-player table grid (damage/healing/interrupts). Mirrors staging mock
// ordering: rank | player | bar+% | spec | stat1 | stat2 | stat3.
const PLAYER_GRID_COLUMNS = '32px 180px minmax(140px, 1fr) 110px 90px 90px 80px'

// Deaths grid — per-death rows, different shape. Mirrors staging mock:
// rank | time | player | killing blow | source | overkill.
const DEATHS_GRID_COLUMNS = '32px 60px 180px minmax(140px, 1fr) 160px 90px'

type StatFormat = 'shorthand' | 'integer'
type NumericStat = { label: string; value: number; format: StatFormat; bold?: boolean }

interface MetricConfig {
  // Drives sort order, the bar fill, and the % of total cell.
  sortValue: (p: PlayerSnapshot) => number
  labels: [string, string, string]
  // Three right-aligned numeric columns.
  stats: (p: PlayerSnapshot) => [NumericStat, NumericStat, NumericStat]
}

const DAMAGE_CONFIG: MetricConfig = {
  sortValue: p => p.dps,
  labels: ['Total', 'DPS', 'Casts'],
  stats: p => [
    { label: 'Total', value: p.damage.total, format: 'shorthand' },
    { label: 'DPS', value: p.dps, format: 'shorthand', bold: true },
    { label: 'Casts', value: Object.values(p.damage.spells).reduce((n, s) => n + s.hitCount, 0), format: 'integer' },
  ],
}

const HEALING_CONFIG: MetricConfig = {
  sortValue: p => p.hps,
  labels: ['Total', 'HPS', 'Overheal'],
  stats: p => [
    { label: 'Total', value: p.healing.total, format: 'shorthand' },
    { label: 'HPS', value: p.hps, format: 'shorthand', bold: true },
    { label: 'Overheal', value: p.healing.overheal, format: 'shorthand' },
  ],
}

const INTERRUPTS_CONFIG: MetricConfig = {
  sortValue: p => p.interrupts.total,
  labels: ['Count', 'Spells', 'Records'],
  stats: p => [
    { label: 'Count', value: p.interrupts.total, format: 'integer', bold: true },
    { label: 'Spells', value: Object.keys(p.interrupts.byKicked).length, format: 'integer' },
    { label: 'Records', value: p.interrupts.records.length, format: 'integer' },
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

  if (metric === 'deaths') {
    return <FullDeathsTable players={currentView.players} />
  }

  return <FullPlayerTable players={Object.values(currentView.players)} config={METRIC_CONFIG[metric]} />
}

function FullPlayerTable({ players, config }: { players: PlayerSnapshot[]; config: MetricConfig }) {
  const playerSpecs = useStore(s => s.playerSpecs)

  const sorted = [...players].sort((a, b) => config.sortValue(b) - config.sortValue(a))
  const topValue = sorted[0] ? config.sortValue(sorted[0]) : 0
  const totalValue = sorted.reduce((sum, p) => sum + config.sortValue(p), 0)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PlayerColumnHeader labels={config.labels} />
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyState text="No player data yet" />
        ) : (
          sorted.map((player, i) => (
            <FullPlayerRow
              key={player.name}
              player={player}
              rank={i + 1}
              topValue={topValue}
              totalValue={totalValue}
              config={config}
              specId={resolveSpecId(playerSpecs, player.name, player.specId)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PlayerColumnHeader({ labels }: { labels: [string, string, string] }) {
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
      <HeaderCell>Player</HeaderCell>
      <HeaderCell />
      <HeaderCell>Spec</HeaderCell>
      <HeaderCell align="right">{labels[0]}</HeaderCell>
      <HeaderCell align="right">{labels[1]}</HeaderCell>
      <HeaderCell align="right">{labels[2]}</HeaderCell>
    </div>
  )
}

function FullPlayerRow({
  player,
  rank,
  topValue,
  totalValue,
  config,
  specId,
}: {
  player: PlayerSnapshot
  rank: number
  topValue: number
  totalValue: number
  config: MetricConfig
  specId: number | undefined
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)
  const specLabel = specId !== undefined ? SPEC_NAMES[specId] ?? '—' : '—'

  const value = config.sortValue(player)
  const fillPct = topValue > 0 ? (value / topValue) * 100 : 0
  const shareOfTotal = totalValue > 0 ? (value / totalValue) * 100 : 0
  const stats = config.stats(player)

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
      <PlayerNameCell name={player.name} color={color} specIcon={specIcon} />
      <BarCell color={color} fillPct={fillPct} shareOfTotal={shareOfTotal} />
      <SpecCell label={specLabel} />
      {stats.map((s, i) => (
        <StatCell key={i} stat={s} />
      ))}
    </div>
  )
}

function FullDeathsTable({ players }: { players: Record<string, PlayerSnapshot> }) {
  const playerSpecs = useStore(s => s.playerSpecs)

  const allDeaths = Object.values(players)
    .flatMap(p => p.deaths)
    .sort((a, b) => a.timeOfDeath - b.timeOfDeath)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DeathsColumnHeader />
      <div className="flex-1 overflow-y-auto">
        {allDeaths.length === 0 ? (
          <EmptyState text="No deaths recorded" />
        ) : (
          allDeaths.map((record, i) => (
            <FullDeathRow
              key={`${record.playerGuid}-${record.timeOfDeath}`}
              record={record}
              rank={i + 1}
              specId={resolveSpecId(playerSpecs, record.playerName, players[record.playerName]?.specId)}
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
      <HeaderCell>Player</HeaderCell>
      <HeaderCell>Killing Blow</HeaderCell>
      <HeaderCell>Source</HeaderCell>
      <HeaderCell align="right">Overkill</HeaderCell>
    </div>
  )
}

function FullDeathRow({
  record,
  rank,
  specId,
}: {
  record: PlayerDeathRecord
  rank: number
  specId: number | undefined
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)
  const kb = record.killingBlow

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
        {formatElapsed(record.combatElapsed)}
      </span>
      <PlayerNameCell name={record.playerName} color={color} specIcon={specIcon} />
      <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
        {kb?.spellName ?? '—'}
      </span>
      <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
        {kb?.sourceName ?? '—'}
      </span>
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        textAlign: 'right',
        color: kb && kb.overkill > 0 ? 'var(--status-wipe)' : 'var(--text-muted)',
      }}>
        {kb && kb.overkill > 0 ? kb.overkill.toLocaleString() : '—'}
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

function SpecCell({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 11,
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {label}
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
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
