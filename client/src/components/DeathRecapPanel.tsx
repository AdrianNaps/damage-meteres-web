import { useEffect } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import { shortName } from '../utils/format'
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

function computeHpFractions(recap: DeathRecapEvent[]): number[] {
  const n = recap.length
  if (n === 0) return []

  const kbIdx = [...recap].map((e, i) => ({ e, i }))
    .reverse()
    .find(({ e }) => e.kind === 'damage' && e.overkill > 0)?.i ?? -1

  if (kbIdx === -1) return new Array(n).fill(0)

  const hp = new Array(n).fill(0)
  const kb = recap[kbIdx]
  hp[kbIdx] = Math.max(0, kb.amount - kb.overkill)

  for (let i = kbIdx - 1; i >= 0; i--) {
    const next = recap[i + 1]
    const hpAfterNext = hp[i + 1]
    if (next.kind === 'damage') {
      hp[i] = hpAfterNext + next.amount
    } else {
      hp[i] = Math.max(0, hpAfterNext - next.amount)
    }
  }

  for (let i = kbIdx + 1; i < n; i++) hp[i] = 0

  const maxHp = hp.reduce((a: number, b: number) => Math.max(a, b), 1)
  return hp.map((v: number) => Math.min(1, Math.max(0, v / maxHp)))
}

function hpColor(fraction: number): string {
  if (fraction > 0.5) return 'var(--health-high)'
  if (fraction > 0.25) return 'var(--health-medium)'
  return 'var(--health-low)'
}

export function DeathRecapPanel() {
  const selectedDeath = useStore(s => s.selectedDeath)
  const setSelectedDeath = useStore(s => s.setSelectedDeath)
  const currentView = useStore(selectCurrentView)
  const playerSpecs = useStore(s => s.playerSpecs)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedDeath(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedDeath])

  if (!selectedDeath || !currentView) return null

  const specId = resolveSpecId(
    playerSpecs,
    selectedDeath.playerName,
    currentView.players[selectedDeath.playerName]?.specId,
  )
  const color = getClassColor(specId)

  const events = [...selectedDeath.recap].reverse()
  const hpFractions = computeHpFractions(selectedDeath.recap).reverse()
  const kb = selectedDeath.killingBlow

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border-default)',
          borderLeft: `4px solid ${color}`,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color }}>{shortName(selectedDeath.playerName)}</span>
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: 2,
              background: 'var(--bg-active)', color: 'var(--header-accent)',
            }}>
              Deaths
            </span>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Died at {formatElapsedFull(selectedDeath.combatElapsed)}
            {kb && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                &middot; {kb.spellName} by {kb.sourceName}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setSelectedDeath(null)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            padding: '4px 8px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          &times;
        </button>
      </div>

      {/* Column headers */}
      <div
        className="flex items-center px-4 pt-3 pb-1.5 gap-2"
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ width: 48, flexShrink: 0 }}>Time</span>
        <span className="flex-1">Spell</span>
        <span style={{ width: 112, textAlign: 'right', flexShrink: 0 }}>Source</span>
        <span style={{ width: 64, textAlign: 'right', flexShrink: 0 }}>Amount</span>
      </div>

      {/* Event rows */}
      <div className="flex-1 overflow-y-auto pb-3">
        {events.length === 0 ? (
          <div className="text-center py-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No events in recap window
          </div>
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
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 16px',
        fontSize: 12,
        overflow: 'hidden',
        borderBottom: '1px solid var(--border-subtle)',
        borderLeft: isKillingBlow ? '3px solid var(--status-wipe)' : '3px solid transparent',
        background: isKillingBlow ? 'rgba(239, 68, 68, 0.06)' : 'transparent',
      }}
    >
      {/* HP bar fill */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: `${hpFraction * 100}%`,
          backgroundColor: barColor,
          opacity: 0.18,
          pointerEvents: 'none',
        }}
      />

      {/* Time offset */}
      <span style={{
        position: 'relative',
        width: 48,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
      }}>
        {formatOffset(delta)}
      </span>

      {/* Spell name */}
      <span
        className="truncate"
        style={{
          position: 'relative',
          flex: 1,
          color: isKillingBlow ? 'var(--data-killing-blow)' : 'var(--text-primary)',
          fontWeight: isKillingBlow ? 500 : 400,
        }}
      >
        {event.spellName}
        {isKillingBlow && (
          <span style={{
            marginLeft: 6,
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--status-wipe)',
          }}>
            KILLING BLOW
          </span>
        )}
      </span>

      {/* Source */}
      <span
        className="truncate"
        style={{
          position: 'relative',
          width: 112,
          textAlign: 'right',
          flexShrink: 0,
          color: event.sourceIsPlayer ? 'var(--text-secondary)' : 'var(--text-muted)',
        }}
      >
        {event.sourceIsPlayer ? shortName(event.sourceName) : event.sourceName}
      </span>

      {/* Amount */}
      <span style={{
        position: 'relative',
        width: 64,
        textAlign: 'right',
        flexShrink: 0,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        color: isDamage ? 'var(--data-damage)' : 'var(--data-healing)',
      }}>
        {isDamage ? '' : '+'}{formatNum(event.amount)}
      </span>
    </div>
  )
}
