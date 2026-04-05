import { useEffect } from 'react'
import { useStore, selectCurrentView } from '../store'
import { getClassColor } from './PlayerRow'
import type { DeathRecapEvent, PlayerDeathRecord } from '../types'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatOffset(delta: number): string {
  return `${(delta / 1000).toFixed(1)}s`
}

function formatElapsedFull(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Compute HP-before-event for each entry in the full recap, returned as a
// parallel array. Values are 0–1 (fraction of estimated max HP).
// Strategy: find the killing blow, derive absolute HP before it from overkill,
// then walk backwards through the sorted event list adjusting for each hit/heal.
// Normalize the whole sequence against the highest reconstructed HP value.
function computeHpFractions(recap: DeathRecapEvent[]): number[] {
  const n = recap.length
  if (n === 0) return []

  // recap is already sorted chronologically (guaranteed by pushRecentEvent order)
  const kbIdx = [...recap].map((e, i) => ({ e, i }))
    .reverse()
    .find(({ e }) => e.kind === 'damage' && e.overkill > 0)?.i ?? -1

  if (kbIdx === -1) return new Array(n).fill(0)

  // hp[i] = estimated HP just BEFORE event i is applied
  const hp = new Array(n).fill(0)
  const kb = recap[kbIdx]
  hp[kbIdx] = Math.max(0, kb.amount - kb.overkill)

  // Walk backwards from killing blow
  for (let i = kbIdx - 1; i >= 0; i--) {
    const next = recap[i + 1]
    const hpAfterNext = hp[i + 1]  // HP just before event i+1 = HP after event i
    if (next.kind === 'damage') {
      hp[i] = hpAfterNext + next.amount  // reverse the damage: HP was higher before
    } else {
      hp[i] = Math.max(0, hpAfterNext - next.amount)  // reverse the heal: HP was lower before
    }
  }

  // Events after the killing blow (shouldn't exist, but cap them at 0)
  for (let i = kbIdx + 1; i < n; i++) hp[i] = 0

  const maxHp = hp.reduce((a, b) => Math.max(a, b), 1)
  return hp.map(v => Math.min(1, Math.max(0, v / maxHp)))
}

function hpColor(fraction: number): string {
  if (fraction > 0.5) return '#22c55e'   // green-500
  if (fraction > 0.25) return '#eab308'  // yellow-500
  return '#ef4444'                        // red-500
}

export function DeathRecapPanel() {
  const selectedDeath = useStore(s => s.selectedDeath)
  const setSelectedDeath = useStore(s => s.setSelectedDeath)
  const currentView = useStore(selectCurrentView)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedDeath(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedDeath])

  if (!selectedDeath || !currentView) return null

  const specId = currentView.players[selectedDeath.playerName]?.specId
  const color = getClassColor(specId)

  // Use the full recap sorted chronologically (already in order from server)
  const events = selectedDeath.recap
  const hpFractions = computeHpFractions(events)
  const kb = selectedDeath.killingBlow

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setSelectedDeath(null)}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#1a1c24] border-l border-white/10 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <div className="font-semibold" style={{ color }}>{selectedDeath.playerName}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Died at {formatElapsedFull(selectedDeath.combatElapsed)}
              {kb && (
                <span className="ml-2 text-slate-500">
                  · {kb.spellName} by {kb.sourceName}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setSelectedDeath(null)}
            className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Column headers */}
        <div className="flex items-center px-4 pt-3 pb-1 text-xs text-slate-500 gap-2">
          <span className="w-12 shrink-0">Time</span>
          <span className="flex-1">Spell</span>
          <span className="w-28 text-right shrink-0">Source</span>
          <span className="w-16 text-right shrink-0">Amount</span>
        </div>

        {/* Event rows */}
        <div className="flex-1 overflow-y-auto pb-3">
          {events.length === 0 ? (
            <div className="text-center text-slate-600 text-sm py-8">No events in recap window</div>
          ) : (
            events.map((e, i) => (
              <RecapRow
                key={`${e.timestamp}-${e.spellId}-${e.kind}`}
                event={e}
                death={selectedDeath}
                hpFraction={hpFractions[i]}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

function RecapRow({
  event,
  death,
  hpFraction,
}: {
  event: DeathRecapEvent
  death: PlayerDeathRecord
  hpFraction: number
}) {
  const isKillingBlow = event.kind === 'damage' && event.overkill > 0
  const isDamage = event.kind === 'damage'
  const delta = event.timestamp - death.timeOfDeath
  const barColor = hpColor(hpFraction)

  return (
    <div className={`relative flex items-center gap-2 px-4 py-1 border-b border-white/5 text-xs overflow-hidden ${
      isKillingBlow ? 'bg-red-900/20' : ''
    }`}>
      {/* HP bar fill — behind content */}
      <div
        className="absolute inset-y-0 left-0 opacity-15 pointer-events-none"
        style={{ width: `${hpFraction * 100}%`, backgroundColor: barColor }}
      />

      {/* Time offset */}
      <span className="relative w-12 shrink-0 tabular-nums text-slate-500">
        {formatOffset(delta)}
      </span>

      {/* Spell name */}
      <span className={`relative flex-1 truncate ${isKillingBlow ? 'text-red-300 font-medium' : 'text-slate-200'}`}>
        {event.spellName}
        {isKillingBlow && (
          <span className="ml-1.5 text-red-400 text-[10px] uppercase tracking-wide">killing blow</span>
        )}
      </span>

      {/* Source */}
      <span className={`relative w-28 text-right truncate shrink-0 ${
        event.sourceIsPlayer ? 'text-slate-300' : 'text-slate-500'
      }`}>
        {event.sourceName}
      </span>

      {/* Amount */}
      <span className={`relative w-16 text-right shrink-0 font-semibold tabular-nums ${
        isDamage ? 'text-red-400' : 'text-green-400'
      }`}>
        {isDamage ? '' : '+'}{formatNum(event.amount)}
      </span>
    </div>
  )
}
