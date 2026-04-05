import { useStore, selectCurrentView } from '../store'
import { getClassColor } from './PlayerRow'
import type { PlayerDeathRecord } from '../types'

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DeathsView() {
  const currentView = useStore(selectCurrentView)
  const setSelectedDeath = useStore(s => s.setSelectedDeath)

  if (!currentView) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
        No encounter data
      </div>
    )
  }

  // Flatten all deaths from all players and sort by time of death
  const allDeaths: PlayerDeathRecord[] = Object.values(currentView.players)
    .flatMap(p => p.deaths)
    .sort((a, b) => a.timeOfDeath - b.timeOfDeath)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex px-3 pb-1 text-xs text-slate-500">
        <span className="w-5" />
        <span className="w-24">Player</span>
        <span className="w-12 text-right">Time</span>
        <span className="flex-1 pl-4">Killing Blow</span>
        <span className="w-20 text-right pr-3">Overkill</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {allDeaths.length === 0 ? (
          <div className="text-center text-slate-600 text-sm py-8">No deaths recorded</div>
        ) : (
          allDeaths.map((record, i) => (
            <DeathRow
              key={`${record.playerGuid}-${record.timeOfDeath}`}
              record={record}
              rank={i + 1}
              specId={currentView.players[record.playerName]?.specId}
              onClick={() => setSelectedDeath(record)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DeathRow({
  record,
  rank,
  specId,
  onClick,
}: {
  record: PlayerDeathRecord
  rank: number
  specId?: number
  onClick: () => void
}) {
  const color = getClassColor(specId)

  const kb = record.killingBlow

  return (
    <div
      className="flex items-center px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
      onClick={onClick}
    >
      <span className="w-5 text-xs text-slate-500 shrink-0">{rank}</span>
      <span className="w-24 text-sm font-medium truncate" style={{ color }}>
        {record.playerName}
      </span>
      <span className="w-12 text-right text-xs text-slate-400 tabular-nums">
        {formatElapsed(record.combatElapsed)}
      </span>
      <span className="flex-1 pl-4 text-xs text-slate-300 truncate">
        {kb ? `${kb.spellName} (${kb.sourceName})` : '—'}
      </span>
      <span className="w-20 text-right text-xs pr-3">
        {kb && kb.overkill > 0 ? (
          <span className="text-red-400">{kb.overkill.toLocaleString()}</span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </span>
    </div>
  )
}
