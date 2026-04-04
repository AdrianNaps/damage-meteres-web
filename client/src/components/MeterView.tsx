import { useStore } from '../store'
import { PlayerRow } from './PlayerRow'
import type { PlayerSnapshot } from '../types'

export function MeterView() {
  const selectedId = useStore(s => s.selectedSegmentId)
  const liveSegment = useStore(s => s.liveSegment)
  const selectedSegment = useStore(s => s.selectedSegment)
  const currentSegment = selectedId === null ? liveSegment : selectedSegment
  const metric = useStore(s => s.metric)
  const setMetric = useStore(s => s.setMetric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)

  if (!currentSegment) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
        No encounter data
      </div>
    )
  }

  const players: PlayerSnapshot[] = Object.values(currentSegment.players)
  const sorted = [...players].sort((a, b) =>
    metric === 'damage' ? b.dps - a.dps : b.hps - a.hps
  )
  const topValue = sorted[0] ? (metric === 'damage' ? sorted[0].dps : sorted[0].hps) : 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toggle */}
      <div className="flex gap-1 px-4 py-2">
        <button
          onClick={() => setMetric('damage')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            metric === 'damage' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Damage
        </button>
        <button
          onClick={() => setMetric('healing')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            metric === 'healing' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Healing
        </button>
      </div>

      {/* Header */}
      <div className="flex px-3 pb-1 text-xs text-slate-500">
        <span className="w-5" />
        <span className="flex-1">Player</span>
        <span className="w-16 text-right">Total</span>
        <span className="w-20 text-right">{metric === 'damage' ? 'DPS' : 'HPS'}</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="text-center text-slate-600 text-sm py-8">No player data yet</div>
        ) : (
          sorted.map((player, i) => (
            <PlayerRow
              key={player.name}
              player={player}
              rank={i + 1}
              topValue={topValue}
              metric={metric}
              onClick={() => setSelectedPlayer(player.name)}
            />
          ))
        )}
      </div>
    </div>
  )
}
