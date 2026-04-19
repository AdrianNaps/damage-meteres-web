import { useDeferredValue, useEffect, useState } from 'react'
import { useStore, selectCurrentView, resolveSpecId, type FilterAxis } from '../store'
import { getClassColor } from './PlayerRow'
import {
  DamageSpellTable,
  HealSpellTable,
  InterruptSpellTable,
  FullDamageSpellTable,
  FullHealSpellTable,
} from './SpellTable'
import { TargetTable } from './TargetTable'
import { SegmentedControl } from './SegmentedControl'
import { selectPlayerBreakdown } from '../utils/filters'
import { specIconUrl } from '../utils/icons'
import { formatNum, shortName } from '../utils/format'
import { usePlayerRowStyle } from '../utils/usePlayerRowStyle'
import type { ClientEvent, PlayerSnapshot } from '../types'

const METRIC_LABELS: Record<string, string> = {
  damage: 'Damage',
  damageTaken: 'Damage Taken',
  healing: 'Healing',
  deaths: 'Deaths',
  interrupts: 'Interrupts',
}

// Stable references when currentView lacks events/players, so the breakdown
// cache (WeakMap-keyed on the events array) doesn't miss every render.
const EMPTY_EVENTS: ClientEvent[] = []
const EMPTY_PLAYERS: Record<string, PlayerSnapshot> = {}

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.drillMetric ?? s.metric)
  const mode = useStore(s => s.mode)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const filters = useStore(s => s.filters)
  const setFilter = useStore(s => s.setFilter)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const playerSpecs = useStore(s => s.playerSpecs)
  // Defer the filter input so a chip toggle yields two renders (old rows stay
  // visible while new rows compute at lower priority). Mirrors FullMeterView.
  // Must sit above any early return — hooks rules.
  const deferredFilters = useDeferredValue(filters)

  // The "other side" axis — what the drilled tab is scoped against. For damage
  // and healing the other side is Target (who was hit / healed). For damage
  // taken the row subject IS the victim, so the other side flips to Source
  // (the attacker). All "open drill / close drill / Escape" plumbing keys off
  // this axis so the drill frame and the global filter chip stay in sync.
  const otherSideAxis: FilterAxis = metric === 'damageTaken' ? 'Source' : 'Target'
  const drillFilter = filters[otherSideAxis]
  const drillValue = drillFilter && drillFilter.length === 1 ? drillFilter[0] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillValue) {
          setFilter(otherSideAxis, undefined)
        } else {
          setSelectedPlayer(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drillValue, otherSideAxis, setFilter, setSelectedPlayer])

  if (!selectedPlayer || !currentView) return null

  // Under damageTaken + enemies perspective the drilled subject is an enemy
  // victim with no entry in `currentView.players`. Allow that only for
  // damageTaken; for every other metric an ally snapshot is required (the
  // interrupts path below reads from it directly, and damage/heal without a
  // snapshot means we shouldn't be rendering a drill panel).
  const player: PlayerSnapshot | undefined = currentView.players[selectedPlayer]
  if (!player && metric !== 'damageTaken') return null

  const enemySubject = !player
  const specId = player ? resolveSpecId(playerSpecs, selectedPlayer, player.specId) : undefined
  const color = enemySubject ? 'var(--text-secondary)' : getClassColor(specId)
  // Duration shape varies by view: segments carry `duration`, while key-run
  // and boss-section aggregates carry `activeDurationSec`. Per-spell DPS/HPS
  // cells come out as 0 on aggregate views if we don't handle both.
  const duration =
    'duration' in currentView ? currentView.duration
    : 'activeDurationSec' in currentView ? currentView.activeDurationSec
    : 0

  // Pull the unified breakdown for damage/healing. selectPlayerBreakdown picks
  // the cheap pre-aggregated path when no filter is active, and walks events
  // (with shared per-events caching) when any filter is active. The returned
  // shape feeds every surface — header total/rate, spell list, targets list,
  // and the drilled target view — so they all agree by construction.
  const events = currentView.events ?? EMPTY_EVENTS
  const allies = currentView.players ?? EMPTY_PLAYERS
  const breakdownCategory =
    metric === 'damage' ? 'damage' as const
    : metric === 'damageTaken' ? 'damageTaken' as const
    : metric === 'healing' ? 'heal' as const
    : null
  const breakdown = breakdownCategory
    ? selectPlayerBreakdown(events, selectedPlayer, breakdownCategory, deferredFilters, duration, player, allies)
    : null

  const value = breakdown ? breakdown.rate : player?.interrupts.total ?? 0
  const total = breakdown ? breakdown.total : player?.interrupts.total ?? 0

  function handleModeChange(nextViewMode: 'spells' | 'targets') {
    setViewMode(nextViewMode)
    // Switching to "Spells" implies "all <other-side>" — clear a single-value
    // drill filter (the open-drill state). Multi-value filters on that axis
    // are user-set from the FilterBar; leave them alone.
    if (nextViewMode !== 'targets' && drillFilter && drillFilter.length === 1) {
      setFilter(otherSideAxis, undefined)
    }
  }

  function renderContent() {
    if (metric === 'interrupts') {
      // Interrupts is ally-only; enemy subjects are gated out upstream. Guard
      // anyway so TS narrows player to PlayerSnapshot below.
      if (!player) return null
      return (
        <>
          <InterruptSpellTable spells={player.interrupts.byKicker} heading="Interrupt Ability" classColor={color} filterAxis="Ability" />
          <InterruptSpellTable spells={player.interrupts.byKicked} heading="Spell Interrupted" classColor={color} filterAxis="InterruptedAbility" />
        </>
      )
    }
    if (!breakdown) return null

    // Empty state covers two cases: filters narrow this player to nothing, or
    // the player has no data of this kind to begin with (e.g. healer drilled
    // into damage). One inline message handles both — the FilterBar chips
    // make the cause obvious.
    if (breakdown.spells.length === 0 && breakdown.targets.length === 0) {
      return <BreakdownEmptyState />
    }

    const isHealing = metric === 'healing'
    const isDamageTaken = metric === 'damageTaken'
    const rateLabel = isHealing ? 'HPS' : isDamageTaken ? 'DTPS' : 'DPS'

    if (drillValue) {
      // The breakdown's spells[] is already scoped to this attacker/target
      // (the drill filter pinned it). The drill view is just the regular
      // Full-mode spell table inside a back-button frame.
      return (
        <TargetScopedView
          targetName={drillValue}
          backLabel={isDamageTaken ? 'Attackers' : 'Targets'}
          onBack={() => setFilter(otherSideAxis, undefined)}
        >
          {mode === 'full' ? (
            isHealing
              ? <FullHealSpellTable spells={breakdown.spells} classColor={color} duration={duration} playerTotal={breakdown.total} />
              : <FullDamageSpellTable spells={breakdown.spells} classColor={color} duration={duration} playerTotal={breakdown.total} rateLabel={isDamageTaken ? 'DTPS' : 'DPS'} />
          ) : (
            isHealing
              ? <HealSpellTable spells={breakdown.spells} classColor={color} />
              : <DamageSpellTable spells={breakdown.spells} classColor={color} />
          )}
        </TargetScopedView>
      )
    }
    if (viewMode === 'targets') {
      return (
        <TargetTable
          targets={breakdown.targets}
          totalAmount={breakdown.total}
          duration={duration}
          rateLabel={rateLabel}
          columnLabel={isDamageTaken ? 'Attacker' : 'Target'}
          classColor={color}
          onSelect={(name) => setFilter(otherSideAxis, [name])}
        />
      )
    }
    if (mode === 'full') {
      return isHealing
        ? <FullHealSpellTable spells={breakdown.spells} classColor={color} duration={duration} playerTotal={breakdown.total} />
        : <FullDamageSpellTable spells={breakdown.spells} classColor={color} duration={duration} playerTotal={breakdown.total} rateLabel={isDamageTaken ? 'DTPS' : 'DPS'} />
    }
    return isHealing
      ? <HealSpellTable spells={breakdown.spells} classColor={color} />
      : <DamageSpellTable spells={breakdown.spells} classColor={color} />
  }

  return (
    <>
      {/* Header with class color accent */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border-default)',
          borderLeft: `4px solid ${color}`,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color }}>{shortName(selectedPlayer)}</span>
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: 2,
              background: 'var(--bg-active)', color: 'var(--header-accent)',
            }}>
              {METRIC_LABELS[metric]}
            </span>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {metric === 'interrupts'
              ? `${total} interrupts`
              : `${formatNum(total)} total \u00b7 ${formatNum(value)} ${metric === 'damage' ? 'DPS' : metric === 'damageTaken' ? 'DTPS' : 'HPS'}`}
          </div>
        </div>
        <button
          onClick={() => setSelectedPlayer(null)}
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

      {/* View mode toggle */}
      {(metric === 'damage' || metric === 'healing' || metric === 'damageTaken') && (
        <div className="px-4 pt-2.5">
          <SegmentedControl
            options={[
              { key: 'spells', label: 'Spells' },
              // "Attackers" for damageTaken — the list under this tab is
              // enemy sources rather than friendly targets.
              { key: 'targets', label: metric === 'damageTaken' ? 'Attackers' : 'Targets' },
            ]}
            active={viewMode}
            onChange={handleModeChange}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {renderContent()}
      </div>
    </>
  )
}

function BreakdownEmptyState() {
  return (
    <div style={{
      padding: '32px 16px',
      textAlign: 'center',
      color: 'var(--text-muted)',
      fontSize: 12,
    }}>
      No data for the current filters.
    </div>
  )
}

// Target-drill wrapper: back button + heading, shared across Summary and Full.
// Body (the scoped ability list) is passed in as children so the frame stays
// identical while the layout varies per mode.
function TargetScopedView({
  targetName,
  backLabel = 'Targets',
  onBack,
  children,
}: {
  targetName: string
  backLabel?: string
  onBack: () => void
  children: React.ReactNode
}) {
  // Auto-resolve the heading when targetName is a known ally — same convention
  // as TargetTable rows. Enemies / unknown names fall through to plain name.
  const resolveStyle = usePlayerRowStyle()
  const headingStyle = resolveStyle(targetName)
  const headingName = headingStyle?.displayName ?? targetName
  const headingColor = headingStyle?.color ?? 'var(--text-primary)'
  const headingIcon = specIconUrl(headingStyle?.specId)
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          padding: '0 16px',
          marginBottom: 12,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        &larr; {backLabel}
      </button>
      <div style={{ marginBottom: 8, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {headingIcon && (
          <img
            src={headingIcon}
            alt=""
            width={20}
            height={20}
            style={{ flexShrink: 0, border: '1px solid rgba(0, 0, 0, 0.7)', borderRadius: 2 }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: headingColor }}>
          {headingName}
        </span>
      </div>
      {children}
    </div>
  )
}
