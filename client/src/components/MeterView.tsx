import { useStore, selectCurrentView } from '../store'
import { PlayerRow } from './PlayerRow'
import { DeathsView } from './DeathsView'
import type { PlayerSnapshot } from '../types'

export function MeterView() {
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.metric)
  const setMetric = useStore(s => s.setMetric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)

  if (!currentView) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2">
          <MetricToggle metric={metric} setMetric={setMetric} />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="animate-pulse-dot" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No encounter data
          </span>
        </div>
      </div>
    )
  }

  if (metric === 'deaths') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2">
          <MetricToggle metric={metric} setMetric={setMetric} />
        </div>
        <DeathsView />
      </div>
    )
  }

  const valueOf = (p: PlayerSnapshot): number =>
    metric === 'damage' ? p.dps
    : metric === 'healing' ? p.hps
    : p.interrupts.total
  const players: PlayerSnapshot[] = Object.values(currentView.players)
  const sorted = [...players].sort((a, b) => valueOf(b) - valueOf(a))
  const topValue = sorted[0] ? valueOf(sorted[0]) : 0
  const totalValue = sorted.reduce((sum, p) => sum + valueOf(p), 0)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toggle */}
      <div className="px-4 py-2">
        <MetricToggle metric={metric} setMetric={setMetric} />
      </div>

      {/* Column headers */}
      <div
        className="flex items-center px-3 pb-1.5"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ width: 24, flexShrink: 0 }}>#</span>
        <span className="flex-1">Player</span>
        <span style={{ width: 64, textAlign: 'right' }}>Total</span>
        <span style={{ width: 72, textAlign: 'right' }}>
          {metric === 'damage' ? 'DPS' : metric === 'healing' ? 'HPS' : 'Count'}
        </span>
        <span style={{ width: 52, textAlign: 'right' }}>%</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="text-center py-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No player data yet
          </div>
        ) : (
          sorted.map((player, i) => (
            <PlayerRow
              key={player.name}
              player={player}
              rank={i + 1}
              topValue={topValue}
              totalValue={totalValue}
              metric={metric as 'damage' | 'healing' | 'interrupts'}
              onClick={() => setSelectedPlayer(player.name)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function MetricToggle({
  metric,
  setMetric,
}: {
  metric: 'damage' | 'healing' | 'deaths' | 'interrupts'
  setMetric: (m: 'damage' | 'healing' | 'deaths' | 'interrupts') => void
}) {
  const options: { key: 'damage' | 'healing' | 'deaths' | 'interrupts'; label: string }[] = [
    { key: 'damage', label: 'Damage' },
    { key: 'healing', label: 'Healing' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'interrupts', label: 'Interrupts' },
  ]

  return (
    <div
      className="inline-flex"
      style={{
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
      }}
    >
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => setMetric(opt.key)}
          style={{
            padding: '4px 14px',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            borderRight: '1px solid var(--border-default)',
            background: metric === opt.key ? 'var(--bg-active)' : 'transparent',
            color: metric === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            if (metric !== opt.key) {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }
          }}
          onMouseLeave={e => {
            if (metric !== opt.key) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
