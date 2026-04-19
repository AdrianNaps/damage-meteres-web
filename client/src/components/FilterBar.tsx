import { forwardRef, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useStore, selectCurrentView, type FilterAxis, type FilterState, type Metric, type Perspective, type TimeWindow, resolveSpecId } from '../store'
import {
  computeAbilityUniverse,
  computeUnitUniverse,
  computeBuffAbilityUniverse,
  computeBuffUnitUniverse,
} from '../utils/filters'
import type { ClientEvent, PlayerSnapshot, AuraWindowWire } from '../types'
import { FilterPicker, type PickerOption } from './FilterPicker'
import { getClassColor } from './PlayerRow'
import { formatTime } from '../utils/format'

// Single-select state for the active popover. Only one picker is open at a
// time — clicking a different picker button swaps which is open; clicking the
// same button again closes it.
type OpenPicker = FilterAxis | null

// Stable references used when currentView has no events/players yet. Prevents
// useMemo deps from flipping every render as `?? []` / `?? {}` would.
const EMPTY_EVENTS: ClientEvent[] = []
const EMPTY_PLAYERS: Record<string, PlayerSnapshot> = {}
const EMPTY_AURAS: AuraWindowWire[] = []

// Picker label overrides for metrics with non-default axis semantics. The
// underlying filter state shape doesn't change (Source/Target/Ability) but the
// semantics do — e.g. under buffs "Source" means the buff caster, under
// damageTaken "Source" means the attacker — so the chip labels read as what
// they *do*.
interface AxisLabels { label: string; defaultLabel: string }
function axisLabels(metric: Metric, axis: FilterAxis): AxisLabels {
  if (metric === 'buffs') {
    switch (axis) {
      case 'Source':  return { label: 'Caster',    defaultLabel: 'Any caster' }
      case 'Target':  return { label: 'Recipient', defaultLabel: 'Any recipient' }
      case 'Ability': return { label: 'Buff',      defaultLabel: 'All buffs' }
    }
  }
  if (metric === 'damageTaken') {
    switch (axis) {
      case 'Source':  return { label: 'Attacker', defaultLabel: 'Any attacker' }
      case 'Target':  return { label: 'Victim',   defaultLabel: 'Any victim' }
      case 'Ability': return { label: 'Ability',  defaultLabel: 'All abilities' }
    }
  }
  switch (axis) {
    case 'Source':  return { label: 'Source',   defaultLabel: 'Any source' }
    case 'Target':  return { label: 'Target',   defaultLabel: 'Any target' }
    case 'Ability': return { label: 'Ability',  defaultLabel: 'All Abilities' }
  }
}

export function FilterBar() {
  const perspective = useStore(s => s.perspective)
  const filters = useStore(s => s.filters)
  const metric = useStore(s => s.metric)
  const currentView = useStore(selectCurrentView)
  const playerSpecs = useStore(s => s.playerSpecs)
  const setPerspective = useStore(s => s.setPerspective)
  const toggleFilterValue = useStore(s => s.toggleFilterValue)
  const setFilter = useStore(s => s.setFilter)
  const setTimeWindowFilter = useStore(s => s.setTimeWindowFilter)
  const clearAllFilters = useStore(s => s.clearAllFilters)

  const [open, setOpen] = useState<OpenPicker>(null)
  const sourceRef = useRef<HTMLButtonElement>(null)
  const targetRef = useRef<HTMLButtonElement>(null)
  const abilityRef = useRef<HTMLButtonElement>(null)
  const activeRef = open === 'Source' ? sourceRef : open === 'Target' ? targetRef : open === 'Ability' ? abilityRef : null

  const events: ClientEvent[] = currentView?.events ?? EMPTY_EVENTS
  const allies: Record<string, PlayerSnapshot> = currentView?.players ?? EMPTY_PLAYERS
  const auras: AuraWindowWire[] = currentView?.auras ?? EMPTY_AURAS

  // Defer the inputs to the event-scanning universes so a filter/perspective/
  // metric change re-renders the chips and picker count immediately while the
  // heavier recompute (computeAbilityUniverse iterates every event) runs at
  // lower priority. Chips/counts above keep using raw state.
  const deferredPerspective = useDeferredValue(perspective)
  const deferredMetric = useDeferredValue(metric)
  const deferredFilterSource = useDeferredValue(filters.Source)
  const deferredFilterTarget = useDeferredValue(filters.Target)
  const isBuffsMetric = deferredMetric === 'buffs'

  // Picker options are derived on render. Cheap for a few hundred units / a
  // few hundred abilities; if this ever becomes a bottleneck, memoize on
  // (events, perspective, filters, metric). Buffs takes a separate path
  // that walks aura windows instead of the event stream.
  const { sources, targets } = useMemo(
    () => isBuffsMetric
      ? computeBuffUnitUniverse(auras, allies, deferredPerspective)
      : computeUnitUniverse(events, deferredPerspective, deferredMetric, allies),
    [isBuffsMetric, auras, allies, events, deferredPerspective, deferredMetric]
  )
  const abilityUniverse = useMemo(
    () => isBuffsMetric
      ? computeBuffAbilityUniverse(auras, { Source: deferredFilterSource, Target: deferredFilterTarget }, allies, deferredPerspective)
      : computeAbilityUniverse(events, deferredPerspective, { Source: deferredFilterSource, Target: deferredFilterTarget }, deferredMetric, allies),
    [isBuffsMetric, auras, events, deferredPerspective, deferredFilterSource, deferredFilterTarget, deferredMetric, allies]
  )

  const sourceOptions = useMemo(
    () => namesToOptions(sources, allies, playerSpecs),
    [sources, allies, playerSpecs]
  )
  const targetOptions = useMemo(
    () => namesToOptions(targets, allies, playerSpecs),
    [targets, allies, playerSpecs]
  )
  const abilityOptions: PickerOption[] = useMemo(
    () => abilityUniverse.map(a => ({
      name: a.name,
      pct: a.pct,
      subtitle: a.sourceCount === 1
        ? `by ${a.sources[0]}`
        : `by ${a.sourceCount} sources · ${a.sources.slice(0, 2).join(', ')}${a.sourceCount > 2 ? '…' : ''}`,
    })),
    [abilityUniverse]
  )

  function togglePicker(axis: FilterAxis) {
    setOpen(prev => prev === axis ? null : axis)
  }

  const hasAnyFilter = !!(filters.Source || filters.Target || filters.Ability || filters.TimeWindow)

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        flexWrap: 'wrap',
        background: 'var(--bg-root)',
      }}>
        <PerspectiveToggle perspective={perspective} onChange={setPerspective} />
        <Divider />
        <PickerButton
          ref={sourceRef}
          {...axisLabels(metric, 'Source')}
          values={filters.Source}
          open={open === 'Source'}
          onClick={() => togglePicker('Source')}
        />
        <PickerButton
          ref={targetRef}
          {...axisLabels(metric, 'Target')}
          values={filters.Target}
          open={open === 'Target'}
          onClick={() => togglePicker('Target')}
        />
        <PickerButton
          ref={abilityRef}
          {...axisLabels(metric, 'Ability')}
          values={filters.Ability}
          open={open === 'Ability'}
          onClick={() => togglePicker('Ability')}
        />
        <div style={{ flex: 1 }} />
        <ActiveFilterChips
          metric={metric}
          filters={filters}
          onRemove={(axis, value) => toggleFilterValue(axis, value)}
          onClearAxis={axis => setFilter(axis, undefined)}
          onClearTimeWindow={() => setTimeWindowFilter(undefined)}
        />
        {hasAnyFilter && (
          <button
            onClick={clearAllFilters}
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            Clear all
          </button>
        )}
      </div>

      {open && activeRef && (
        <FilterPicker
          anchorRef={activeRef}
          options={open === 'Ability' ? abilityOptions : (open === 'Source' ? sourceOptions : targetOptions)}
          selected={filters[open] ?? []}
          onToggle={name => toggleFilterValue(open, name)}
          onClose={() => setOpen(null)}
          placeholder={buildPickerPlaceholder(metric, open)}
        />
      )}
    </>
  )
}

// Resolves a list of unit names to PickerOption[] grouped by "Allies" vs
// "Enemies". Grouping is by identity (is this name an ally?), not by the
// current perspective — a Deaths view with perspective=allies still wants
// enemy killers in the Source picker, so perspective-based filtering here
// would incorrectly drop them.
function namesToOptions(
  names: string[],
  allies: Record<string, PlayerSnapshot>,
  playerSpecs: Record<string, number>,
): PickerOption[] {
  const allyOptions: PickerOption[] = []
  const enemyOptions: PickerOption[] = []
  for (const n of names) {
    if (allies[n]) {
      const specId = resolveSpecId(playerSpecs, n, allies[n]?.specId)
      allyOptions.push({
        name: n,
        group: 'Allies',
        color: specId !== undefined ? getClassColor(specId) : undefined,
      })
    } else {
      enemyOptions.push({ name: n, group: 'Enemies' })
    }
  }
  return [...allyOptions, ...enemyOptions]
}

function PerspectiveToggle({ perspective, onChange }: { perspective: Perspective; onChange: (p: Perspective) => void }) {
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-default)',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      {(['allies', 'enemies'] as const).map((p, i) => {
        const active = perspective === p
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            style={{
              padding: '3px 12px',
              height: 24,
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              background: active ? 'var(--bg-active)' : 'transparent',
              border: 'none',
              borderLeft: i === 0 ? 'none' : '1px solid var(--border-default)',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              textTransform: 'capitalize',
            }}
            onMouseEnter={e => {
              if (!active) {
                e.currentTarget.style.background = 'var(--bg-hover)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }
            }}
          >
            {p}
          </button>
        )
      })}
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--border-default)', margin: '0 4px' }} />
}

const PickerButton = forwardRef<HTMLButtonElement, {
  label: string
  defaultLabel: string
  values: string[] | undefined
  open: boolean
  onClick: () => void
}>(function PickerButton({ label, defaultLabel, values, open, onClick }, ref) {
  const count = values?.length ?? 0
  const displayLabel = count === 0
    ? defaultLabel
    : count === 1
      ? values![0]
      : `${count} selected`

  return (
    <button
      ref={ref}
      data-picker-button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
        height: 24,
        padding: '3px 8px',
        background: open ? 'var(--bg-hover)' : 'transparent',
        border: `1px solid ${open ? 'var(--text-secondary)' : 'var(--border-default)'}`,
        borderRadius: 3,
        color: 'var(--text-primary)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        fontSize: 9,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--text-muted)',
      }}>
        {label}
      </span>
      <span style={{ color: count === 0 ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
        {displayLabel}
      </span>
      {count > 1 && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          padding: '0 4px',
          background: 'var(--bg-active)',
          borderRadius: 2,
          color: 'var(--text-primary)',
        }}>
          {count}
        </span>
      )}
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▾</span>
    </button>
  )
})

function ActiveFilterChips({
  metric,
  filters,
  onRemove,
  onClearAxis,
  onClearTimeWindow,
}: {
  metric: Metric
  filters: FilterState
  onRemove: (axis: FilterAxis, value: string) => void
  onClearAxis: (axis: FilterAxis) => void
  onClearTimeWindow: () => void
}) {
  const chips: { axis: FilterAxis; values: string[] }[] = []
  for (const axis of ['Source', 'Target', 'Ability'] as const) {
    const values = filters[axis]
    if (values && values.length > 0) chips.push({ axis, values })
  }
  const tw = filters.TimeWindow
  if (chips.length === 0 && !tw) return null

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {chips.map(({ axis, values }) => {
        const chipLabel = axisLabels(metric, axis).label
        // Single value: show the value with a × to remove just it.
        // Multi-value: show "axis: first +N" with × to clear the whole axis.
        if (values.length === 1) {
          return (
            <Chip key={axis} label={chipLabel} value={values[0]} onRemove={() => onRemove(axis, values[0])} />
          )
        }
        return (
          <Chip
            key={axis}
            label={chipLabel}
            value={`${values[0]} +${values.length - 1}`}
            onRemove={() => onClearAxis(axis)}
          />
        )
      })}
      {tw && <Chip label="Time" value={formatTimeWindow(tw)} onRemove={onClearTimeWindow} />}
    </div>
  )
}

function buildPickerPlaceholder(metric: Metric, axis: FilterAxis): string {
  if (metric === 'buffs') {
    switch (axis) {
      case 'Source':  return 'Search casters…'
      case 'Target':  return 'Search recipients…'
      case 'Ability': return 'Search buffs…'
    }
  }
  if (metric === 'damageTaken') {
    switch (axis) {
      case 'Source':  return 'Search attackers…'
      case 'Target':  return 'Search victims…'
      case 'Ability': return 'Search abilities…'
    }
  }
  if (axis === 'Ability') return 'Search abilities…'
  return `Search ${axis.toLowerCase()}s…`
}

// "0:12–0:45" with an en-dash so the range reads cleanly in the filter bar.
function formatTimeWindow(tw: TimeWindow): string {
  return `${formatTime(tw.startSec)}–${formatTime(tw.endSec)}`
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '2px 8px',
      fontSize: 11,
      color: 'var(--text-primary)',
      background: 'var(--bg-active)',
      border: '1px solid var(--border-default)',
      borderRadius: 3,
    }}>
      <span style={{
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        fontSize: 9,
        letterSpacing: '0.06em',
      }}>
        {label}
      </span>
      {value}
      <span
        onClick={onRemove}
        style={{
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 13,
          lineHeight: 1,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        ×
      </span>
    </span>
  )
}
