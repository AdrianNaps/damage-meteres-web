import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import { shortName } from '../utils/format'
import type { PlayerDeathRecord } from '../types'

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DeathsView() {
  const currentView = useStore(selectCurrentView)
  const setSelectedDeath = useStore(s => s.setSelectedDeath)
  const playerSpecs = useStore(s => s.playerSpecs)

  if (!currentView) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No encounter data</span>
      </div>
    )
  }

  const allDeaths: PlayerDeathRecord[] = Object.values(currentView.players)
    .flatMap(p => p.deaths)
    .sort((a, b) => a.timeOfDeath - b.timeOfDeath)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Column headers */}
      <div
        className="flex items-center px-3 pb-1.5"
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ width: 24, flexShrink: 0 }}>#</span>
        <span style={{ width: 96 }}>Player</span>
        <span style={{ width: 48, textAlign: 'right' }}>Time</span>
        <span className="flex-1" style={{ paddingLeft: 16 }}>Killing Blow</span>
        <span style={{ width: 64, textAlign: 'right', paddingRight: 8 }}>Overkill</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {allDeaths.length === 0 ? (
          <div className="text-center py-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No deaths recorded
          </div>
        ) : (
          allDeaths.map((record, i) => (
            <DeathRow
              key={`${record.playerGuid}-${record.timeOfDeath}`}
              record={record}
              rank={i + 1}
              specId={resolveSpecId(playerSpecs, record.playerName, currentView.players[record.playerName]?.specId)}
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
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        paddingRight: 12,
        cursor: 'pointer',
        borderLeft: `3px solid ${color}`,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ width: 24, flexShrink: 0, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'center', paddingLeft: 6 }}>
        {rank}
      </span>
      <span className="truncate" style={{ width: 96, fontSize: 13, fontWeight: 500, color }}>
        {shortName(record.playerName)}
      </span>
      <span style={{ width: 48, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
        {formatElapsed(record.combatElapsed)}
      </span>
      <span className="truncate" style={{ flex: 1, paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
        {kb ? `${kb.spellName} (${kb.sourceName})` : '—'}
      </span>
      <span style={{ width: 64, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)', paddingRight: 8 }}>
        {kb && kb.overkill > 0 ? (
          <span style={{ color: 'var(--status-wipe)' }}>{kb.overkill.toLocaleString()}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </span>
    </div>
  )
}
