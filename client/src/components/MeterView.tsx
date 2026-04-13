import { useStore, selectCurrentView } from '../store'
import { PlayerRow } from './PlayerRow'
import { DeathsView } from './DeathsView'
import type { PlayerSnapshot } from '../types'

export function MeterView() {
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.metric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)

  if (!currentView) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
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
