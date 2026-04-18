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
import { TargetTable, type TargetRowStyle } from './TargetTable'
import { selectPlayerBreakdown } from '../utils/filters'
import { specIconUrl } from '../utils/icons'
import { formatNum, shortName } from '../utils/format'
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

  const player = currentView.players[selectedPlayer]
  if (!player) return null

  const color = getClassColor(resolveSpecId(playerSpecs, selectedPlayer, player.specId))
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

  const value = breakdown ? breakdown.rate : player.interrupts.total
  const total = breakdown ? breakdown.total : player.interrupts.total

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
      return (
        <>
          <InterruptSpellTable spells={player.interrupts.byKicker} heading="Interrupt Ability" classColor={color} />
          <InterruptSpellTable spells={player.interrupts.byKicked} heading="Spell Interrupted" classColor={color} />
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
    // Player-aware row decorator: resolves healing sources/targets to their own
    // class color, spec icon, and short name. Reused by the targets list and
    // the drill-down heading so the whole healing flow reads consistently.
    const playerRowStyle = (name: string): TargetRowStyle | null => {
      const specId = resolveSpecId(playerSpecs, name)
      if (specId === undefined) return null
      return { displayName: shortName(name), color: getClassColor(specId), specId }
    }

    if (drillValue) {
      // The breakdown's spells[] is already scoped to this attacker/target
      // (the drill filter pinned it). The drill view is just the regular
      // Full-mode spell table inside a back-button frame.
      const headingStyle = isHealing ? playerRowStyle(drillValue) : null
      return (
        <TargetScopedView
          targetName={drillValue}
          headingStyle={headingStyle}
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
      const resolveRow = isHealing ? playerRowStyle : undefined
      return (
        <TargetTable
          targets={breakdown.targets}
          totalAmount={breakdown.total}
          duration={duration}
          rateLabel={rateLabel}
          columnLabel={isDamageTaken ? 'Attacker' : 'Target'}
          classColor={color}
          resolveRow={resolveRow}
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
            <span style={{ fontWeight: 600, fontSize: 15, color }}>{shortName(player.name)}</span>
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

function SegmentedControl<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}) {
  return (
    <div
      className="inline-flex"
      style={{ border: '1px solid var(--border-default)' }}
    >
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            padding: '3px 12px',
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            border: 'none',
            borderRight: '1px solid var(--border-default)',
            background: active === opt.key ? 'var(--bg-active)' : 'transparent',
            color: active === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            if (active !== opt.key) {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }
          }}
          onMouseLeave={e => {
            if (active !== opt.key) {
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

// Target-drill wrapper: back button + heading, shared across Summary and Full.
// Body (the scoped ability list) is passed in as children so the frame stays
// identical while the layout varies per mode.
function TargetScopedView({
  targetName,
  headingStyle,
  backLabel = 'Targets',
  onBack,
  children,
}: {
  targetName: string
  headingStyle: TargetRowStyle | null
  backLabel?: string
  onBack: () => void
  children: React.ReactNode
}) {
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
