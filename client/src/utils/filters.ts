import type { ClientEvent, PlayerSnapshot, AuraWindowWire, BuffSection } from '../types'
import type { FilterState, Metric, Perspective } from '../store'

// Shape returned for damage/healing/interrupts/damageTaken row lists. `value`
// is the sorted metric (DPS/HPS/DTPS/count); `total` is the raw sum before
// dividing by duration. Secondary stats are populated per-category — fields
// kept optional so the row renderer can stay metric-agnostic.
export interface UnitRow {
  name: string
  specId?: number
  value: number
  total: number
  casts?: number
  overheal?: number
  // interrupts: total SPELL_CAST_SUCCESS presses of known interrupt spells
  // (landed or not). Used by the Attempts lens to re-rank and as the "Total"
  // column; row.value stays as the lands count so the Lands lens doesn't
  // have to special-case.
  attempts?: number
  // damageTaken: total mitigated amount (absorbed + blocked) across all hits on
  // this unit. Used by the Mitigated lens to re-rank and rescale the bar.
  // Absent for other metrics.
  mitigated?: number
}

// One row per death event in the Deaths view. Carries just enough for display;
// the rich PlayerDeathRecord (with recap) is still reachable via the player
// snapshot when a drill-in is needed. `overkill` reuses the ClientEvent.amount
// field — death events encode overkill there rather than a damage amount.
export interface DeathRow {
  t: number
  killerName: string
  victimName: string
  ability: string
  spellId?: string
  victimSpecId?: number
  overkill?: number
}

// Entry in the Ability picker. pct is the share of filtered impact for this
// ability across the visible unit set.
export interface AbilityEntry {
  name: string
  pct: number
  sources: string[]
  sourceCount: number
}

// One row in the Full-mode Buffs or Debuffs table. `uptimeMs` is the UNION
// of windows across all targets (any target has the aura at time t → group
// is counted as up), matching WCL's "Uptime" column. `count` follows WCL's
// convention: per-recipient application count (one Heroism fan-out of 20
// = 20). `section` is present only for BUFFs — debuffs render flat because
// the personal/raid/external taxonomy doesn't map to them.
export interface AuraRow {
  spellId: string
  spellName: string
  section?: BuffSection
  uptimeMs: number
  uptimePct: number       // uptimeMs / scopeDurationMs * 100
  count: number
  windows: AuraWindowWire[]                      // post-filter, all targets
  windowsByTarget: Record<string, AuraWindowWire[]>
}

// Maps a metric category to the event.kind that feeds it. Damage and
// damageTaken both feed from the 'damage' event kind — they diverge only in
// the row subject (see rowSubject). Buffs and debuffs don't use the events
// stream — they have their own aura-window feed — so callers walking events
// must not reach this function with them. FullMeterView branches on metric
// before calling event-based aggregators.
function kindFor(category: Metric): ClientEvent['kind'] {
  switch (category) {
    case 'damage':      return 'damage'
    case 'damageTaken': return 'damage'
    case 'healing':     return 'heal'
    case 'interrupts':  return 'interrupt'
    case 'deaths':      return 'death'
    case 'buffs':       throw new Error('kindFor(buffs) — aura metric has no ClientEvent kind')
    case 'debuffs':     throw new Error('kindFor(debuffs) — aura metric has no ClientEvent kind')
  }
}

// Membership oracle for "is this name on our side of the view?" Built once
// per call so downstream checks are O(1). Empty string sources/targets are
// defensive against sparse events.
function makeAllySet(allies: Record<string, PlayerSnapshot>): Set<string> {
  return new Set(Object.keys(allies))
}

// The row subject for each category — who the row represents.
// damage/healing/interrupts: source of the action (who dealt / healed / kicked)
// deaths + damageTaken: destination (the victim / the unit taking damage) —
// UX wants "who died" / "who was hit," not "who killed" / "who hit them."
function rowSubject(e: ClientEvent, category: Metric): string {
  if (e.kind === 'death') return e.dst
  if (category === 'damageTaken') return e.dst
  return e.src
}

// Shared AND-composition predicate. Matches the spec's includeEvent() exactly:
// an event contributes only if it passes every active filter.
// `t0` is the absolute-ms timestamp of the first event in the scope; required
// when TimeWindow is set so we can translate its segment-relative seconds into
// the event's absolute-ms basis. Callers that never set TimeWindow can pass 0.
function passesFilters(e: ClientEvent, filters: FilterState, t0: number): boolean {
  if (filters.Source  && !filters.Source.includes(e.src)) return false
  if (filters.Target  && !filters.Target.includes(e.dst)) return false
  if (filters.Ability && !filters.Ability.includes(e.ability)) return false
  if (filters.InterruptedAbility) {
    // Only landed interrupts carry an interrupted-spell name. Drop 'interrupt'
    // events whose extraAbility isn't in the allowed set, and drop every
    // 'interruptAttempt' event whenever this filter is active — a press that
    // didn't land can't be attributed to a specific interrupted spell, so
    // including attempts would leak rows the user didn't ask for. For all
    // non-interrupt event kinds the filter is a no-op: the chip is metric-
    // specific (only rendered on the interrupts picker) but it can persist
    // in state across metric switches, and those metrics' events have no
    // extraAbility to match against.
    if (e.kind === 'interrupt') {
      if (!e.extraAbility || !filters.InterruptedAbility.includes(e.extraAbility)) return false
    } else if (e.kind === 'interruptAttempt') {
      return false
    }
  }
  if (filters.TimeWindow) {
    const elapsedSec = (e.t - t0) / 1000
    if (elapsedSec < filters.TimeWindow.startSec) return false
    if (elapsedSec > filters.TimeWindow.endSec) return false
  }
  return true
}

function passesPerspective(e: ClientEvent, category: Metric, perspective: Perspective, allySet: Set<string>): boolean {
  const subject = rowSubject(e, category)
  const isAlly = allySet.has(subject)
  return perspective === 'allies' ? isAlly : !isAlly
}

// True when the filter state carries at least one axis that could narrow
// the given category's event walk. `InterruptedAbility` is a no-op on every
// kind except 'interrupt'/'interruptAttempt' (see passesFilters) — so when
// it's the only axis set and we're looking at damage/healing/deaths/aura
// rows, the fast-path caches should still fire. Category-less calls (e.g.
// the FilterBar's "Clear all" visibility) treat every axis as potentially
// relevant, which is what the button's semantics require.
export function hasAnyFilter(filters: FilterState, category?: Metric): boolean {
  const interruptedRelevant = category === undefined || category === 'interrupts'
    ? filters.InterruptedAbility
    : undefined
  return !!(filters.Source || filters.Target || filters.Ability || interruptedRelevant || filters.TimeWindow)
}

// Scope-relative time basis for TimeWindow translation. events[0].t is the
// convention elsewhere in this file (see computeEnemyPlayers' combatElapsed
// derivation). Returns 0 for an empty events array — harmless because no
// events will loop anyway.
function scopeT0(events: ClientEvent[]): number {
  return events.length > 0 ? events[0].t : 0
}

// Per-events-array caches for derived rows/universes under default filters.
// Keyed by the events array reference so entries auto-evict when the snapshot
// leaves snapshotCache (nothing holds the array anymore → GC'd → WeakMap
// entry cleared). Filtered compositions fall through to a fresh compute —
// the filter space is too large to cache exhaustively, and filtered views
// are interactive so users expect each compute to run anyway.
const unitRowsCache = new WeakMap<ClientEvent[], Map<string, UnitRow[]>>()
const deathRowsCache = new WeakMap<ClientEvent[], Map<string, DeathRow[]>>()
const abilityUniverseCache = new WeakMap<ClientEvent[], Map<string, AbilityEntry[]>>()
const interruptedAbilityUniverseCache = new WeakMap<ClientEvent[], Map<string, AbilityEntry[]>>()
const unitUniverseCache = new WeakMap<ClientEvent[], Map<string, { sources: string[]; targets: string[] }>>()

function getOrInit<K extends object, V>(cache: WeakMap<K, Map<string, V>>, key: K): Map<string, V> {
  let sub = cache.get(key)
  if (!sub) { sub = new Map(); cache.set(key, sub) }
  return sub
}

type UnitRowsCategory = 'damage' | 'damageTaken' | 'healing' | 'interrupts'

export function computeUnitRows(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: UnitRowsCategory,
  allies: Record<string, PlayerSnapshot>,
  durationSec: number,
): UnitRow[] {
  if (!hasAnyFilter(filters, category)) {
    const sub = getOrInit(unitRowsCache, events)
    const key = `${perspective}:${category}`
    const cached = sub.get(key)
    if (cached) return cached
    const rows = computeUnitRowsImpl(events, perspective, filters, category, allies, durationSec)
    sub.set(key, rows)
    return rows
  }
  return computeUnitRowsImpl(events, perspective, filters, category, allies, durationSec)
}

function computeUnitRowsImpl(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: UnitRowsCategory,
  allies: Record<string, PlayerSnapshot>,
  durationSec: number,
): UnitRow[] {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  const t0 = scopeT0(events)
  type Bucket = { total: number; count: number; attempts: number; overheal: number; mitigated: number }
  const agg = new Map<string, Bucket>()

  for (const e of events) {
    // Interrupts straddle two event kinds: 'interrupt' (land) and
    // 'interruptAttempt' (press). Other categories stay single-kind. A landing
    // interrupt produces one of each at the same timestamp, so counting them
    // independently gives lands=count(interrupt), attempts=count(interruptAttempt).
    if (category === 'interrupts') {
      if (e.kind !== 'interrupt' && e.kind !== 'interruptAttempt') continue
    } else if (e.kind !== kind) continue
    if (!passesPerspective(e, category, perspective, allySet)) continue
    if (!passesFilters(e, filters, t0)) continue

    const subject = rowSubject(e, category)
    if (!subject) continue

    let bucket = agg.get(subject)
    if (!bucket) {
      bucket = { total: 0, count: 0, attempts: 0, overheal: 0, mitigated: 0 }
      agg.set(subject, bucket)
    }
    if (category === 'damageTaken') {
      // Fully-absorbed hits arrive on the wire with `amount === absorbed` — the
      // server emits the absorbed amount as `amount` so Damage Done totals
      // include shield-eaten hits (WCL parity), and flags the event with
      // `fullAbsorb`. For damage-taken we want `effective = landed` (post-
      // absorb), so strip the fully-absorbed portion back out here. Partial
      // absorbs (even heavy-shield cases where absorbed > landed) keep
      // `amount` as the landed portion.
      const rawAmount = e.amount ?? 0
      const absorbed = e.absorbed ?? 0
      const blocked = e.blocked ?? 0
      const effective = e.fullAbsorb ? 0 : rawAmount
      bucket.total += effective
      bucket.mitigated += absorbed + blocked
      bucket.count += 1
    } else if (category === 'interrupts') {
      if (e.kind === 'interrupt') bucket.count += 1
      else /* interruptAttempt */ bucket.attempts += 1
    } else {
      bucket.total += e.amount ?? 0
      bucket.count += 1
    }
    if (category === 'healing') bucket.overheal += e.overheal ?? 0
  }

  const rows: UnitRow[] = []
  for (const [name, bucket] of agg) {
    // Drop zero-contribution units — spec: "so a warrior with no healing
    // doesn't show in the Healing view when Ability filters them out." The
    // drop test is category-specific: damageTaken keeps rows that only have
    // mitigation (meaningful under the Mitigated/Incoming lens); interrupts
    // keeps rows with any press (attempts or lands) so the Attempts lens
    // still surfaces a player who missed every kick; everything else drops
    // on total.
    const shouldDrop =
      category === 'interrupts'  ? (bucket.count === 0 && bucket.attempts === 0)
      : category === 'damageTaken' ? (bucket.total === 0 && bucket.mitigated === 0)
      : bucket.total === 0
    if (shouldDrop) continue

    // value is the "default" ranking dimension a caller-provided lens falls
    // back to. Interrupts default lens ranks by lands; the Attempts lens in
    // FullMeterView re-ranks by row.attempts.
    const value = category === 'interrupts'
      ? bucket.count
      : (durationSec > 0 ? bucket.total / durationSec : 0)

    const specId = allies[name]?.specId
    const row: UnitRow = { name, specId, value, total: bucket.total }
    if (category === 'damage')      row.casts = bucket.count
    if (category === 'healing')     row.overheal = bucket.overheal
    if (category === 'interrupts')  row.attempts = bucket.attempts
    if (category === 'damageTaken') row.mitigated = bucket.mitigated
    rows.push(row)
  }

  rows.sort((a, b) => b.value - a.value)
  return rows
}

export function computeDeathRows(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  allies: Record<string, PlayerSnapshot>,
): DeathRow[] {
  if (!hasAnyFilter(filters, 'deaths')) {
    const sub = getOrInit(deathRowsCache, events)
    const key = perspective
    const cached = sub.get(key)
    if (cached) return cached
    const rows = computeDeathRowsImpl(events, perspective, filters, allies)
    sub.set(key, rows)
    return rows
  }
  return computeDeathRowsImpl(events, perspective, filters, allies)
}

function computeDeathRowsImpl(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  allies: Record<string, PlayerSnapshot>,
): DeathRow[] {
  const allySet = makeAllySet(allies)
  const t0 = scopeT0(events)
  const rows: DeathRow[] = []

  for (const e of events) {
    if (e.kind !== 'death') continue
    if (!passesPerspective(e, 'deaths', perspective, allySet)) continue
    if (!passesFilters(e, filters, t0)) continue

    rows.push({
      t: e.t,
      killerName: e.src,
      victimName: e.dst,
      ability: e.ability,
      spellId: e.spellId,
      victimSpecId: allies[e.dst]?.specId,
      overkill: e.amount,
    })
  }

  rows.sort((a, b) => a.t - b.t)
  return rows
}

export function computeAbilityUniverse(
  events: ClientEvent[],
  perspective: Perspective,
  filters: Pick<FilterState, 'Source' | 'Target' | 'InterruptedAbility'>,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  // InterruptedAbility only narrows this universe for the interrupts metric
  // (the impl below gates on category); for any other metric a stale chip
  // shouldn't disable the cache fast-path.
  const interruptedNarrows = category === 'interrupts' && !!filters.InterruptedAbility
  if (!filters.Source && !filters.Target && !interruptedNarrows) {
    const sub = getOrInit(abilityUniverseCache, events)
    const key = `${perspective}:${category}`
    const cached = sub.get(key)
    if (cached) return cached
    const entries = computeAbilityUniverseImpl(events, perspective, filters, category, allies)
    sub.set(key, entries)
    return entries
  }
  return computeAbilityUniverseImpl(events, perspective, filters, category, allies)
}

function computeAbilityUniverseImpl(
  events: ClientEvent[],
  perspective: Perspective,
  filters: Pick<FilterState, 'Source' | 'Target' | 'InterruptedAbility'>,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  type Agg = { total: number; count: number; sources: Map<string, number> }
  const byAbility = new Map<string, Agg>()

  // Walk once, applying Source+Target (and, for interrupts, the companion
  // InterruptedAbility) filters but NOT the Ability filter — the picker must
  // show options it would hide if self-applied.
  const sourceFilter = filters.Source
  const targetFilter = filters.Target
  const interruptedAbilityFilter = category === 'interrupts' ? filters.InterruptedAbility : undefined

  for (const e of events) {
    if (e.kind !== kind) continue
    if (!passesPerspective(e, category, perspective, allySet)) continue
    if (sourceFilter && !sourceFilter.includes(e.src)) continue
    if (targetFilter && !targetFilter.includes(e.dst)) continue
    if (interruptedAbilityFilter) {
      if (!e.extraAbility || !interruptedAbilityFilter.includes(e.extraAbility)) continue
    }

    let bucket = byAbility.get(e.ability)
    if (!bucket) {
      bucket = { total: 0, count: 0, sources: new Map() }
      byAbility.set(e.ability, bucket)
    }
    // Impact for the ability picker's %/ranking column. For damageTaken we
    // rank by gross (landed + mitigated) to match the Incoming lens default —
    // otherwise a heavy-shield ability that mostly hits into absorbs would
    // rank below minor abilities that all landed. Full absorbs have
    // `amount === absorbed`, so we'd double-count without the fullAbsorb
    // strip. Other categories keep amount-as-landed ranking.
    const abilityImpact = category === 'damageTaken'
      ? (e.fullAbsorb ? 0 : (e.amount ?? 0)) + (e.absorbed ?? 0) + (e.blocked ?? 0)
      : (e.amount ?? 0)
    bucket.total += abilityImpact
    bucket.count += 1
    bucket.sources.set(e.src, (bucket.sources.get(e.src) ?? 0) + (abilityImpact || 1))
  }

  // Impact metric: amount for damage/healing; count for interrupts/deaths.
  const useCount = category === 'interrupts' || category === 'deaths'
  let grand = 0
  for (const b of byAbility.values()) grand += useCount ? b.count : b.total

  const entries: AbilityEntry[] = []
  for (const [name, b] of byAbility) {
    const impact = useCount ? b.count : b.total
    const pct = grand > 0 ? (impact / grand) * 100 : 0
    const sortedSources = [...b.sources.entries()].sort((a, c) => c[1] - a[1])
    entries.push({
      name,
      pct,
      sources: sortedSources.slice(0, 3).map(([n]) => n),
      sourceCount: b.sources.size,
    })
  }

  entries.sort((a, b) => b.pct - a.pct)
  return entries
}

// Interrupts-only: universe of spells that got interrupted (the victim's
// cast). Mirrors computeAbilityUniverse but buckets on `extraAbility` instead
// of `ability`, and only looks at landed interrupt events — a missed press
// (`interruptAttempt`) has no extraAbility to attribute. Ranking is by land
// count; "sources" list the kicker abilities (not the kicker players) that
// cut this spell the most, which is the mirror of the kicker-ability picker
// whose sources are players.
export function computeInterruptedAbilityUniverse(
  events: ClientEvent[],
  perspective: Perspective,
  filters: Pick<FilterState, 'Source' | 'Target' | 'Ability'>,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  if (!filters.Source && !filters.Target && !filters.Ability) {
    const sub = getOrInit(interruptedAbilityUniverseCache, events)
    const key = perspective
    const cached = sub.get(key)
    if (cached) return cached
    const entries = computeInterruptedAbilityUniverseImpl(events, perspective, filters, allies)
    sub.set(key, entries)
    return entries
  }
  return computeInterruptedAbilityUniverseImpl(events, perspective, filters, allies)
}

function computeInterruptedAbilityUniverseImpl(
  events: ClientEvent[],
  perspective: Perspective,
  filters: Pick<FilterState, 'Source' | 'Target' | 'Ability'>,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  const allySet = makeAllySet(allies)
  type Agg = { count: number; kickerAbilities: Map<string, number> }
  const byInterrupted = new Map<string, Agg>()

  const sourceFilter = filters.Source
  const targetFilter = filters.Target
  const abilityFilter = filters.Ability

  for (const e of events) {
    if (e.kind !== 'interrupt') continue
    if (!e.extraAbility) continue
    if (!passesPerspective(e, 'interrupts', perspective, allySet)) continue
    if (sourceFilter && !sourceFilter.includes(e.src)) continue
    if (targetFilter && !targetFilter.includes(e.dst)) continue
    if (abilityFilter && !abilityFilter.includes(e.ability)) continue

    let bucket = byInterrupted.get(e.extraAbility)
    if (!bucket) {
      bucket = { count: 0, kickerAbilities: new Map() }
      byInterrupted.set(e.extraAbility, bucket)
    }
    bucket.count += 1
    bucket.kickerAbilities.set(e.ability, (bucket.kickerAbilities.get(e.ability) ?? 0) + 1)
  }

  let grand = 0
  for (const b of byInterrupted.values()) grand += b.count

  const entries: AbilityEntry[] = []
  for (const [name, b] of byInterrupted) {
    const pct = grand > 0 ? (b.count / grand) * 100 : 0
    const sortedKickers = [...b.kickerAbilities.entries()].sort((a, c) => c[1] - a[1])
    entries.push({
      name,
      pct,
      sources: sortedKickers.slice(0, 3).map(([n]) => n),
      sourceCount: b.kickerAbilities.size,
    })
  }

  entries.sort((a, b) => b.pct - a.pct)
  return entries
}

export function hasMatchingData(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): boolean {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  const t0 = scopeT0(events)
  for (const e of events) {
    // Interrupts surface either a land or a press — a pull where no kick
    // landed but some were pressed still has data for the Attempts lens.
    if (category === 'interrupts') {
      if (e.kind !== 'interrupt' && e.kind !== 'interruptAttempt') continue
    } else if (e.kind !== kind) continue
    if (!passesPerspective(e, category, perspective, allySet)) continue
    if (!passesFilters(e, filters, t0)) continue
    return true
  }
  return false
}

// Returns the unique set of unit names available as Source/Target options for
// the current perspective + category. The Source axis and Target axis both need
// the same universe in practice — a unit that appears on either side of any
// event should be pickable on either axis. We return them separately anyway so
// callers can wire them to the right pickers.
export function computeUnitUniverse(
  events: ClientEvent[],
  perspective: Perspective,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): { sources: string[]; targets: string[] } {
  // No filter input — always cacheable per (events, perspective, category).
  const sub = getOrInit(unitUniverseCache, events)
  const key = `${perspective}:${category}`
  const cached = sub.get(key)
  if (cached) return cached
  const result = computeUnitUniverseImpl(events, perspective, category, allies)
  sub.set(key, result)
  return result
}

function computeUnitUniverseImpl(
  events: ClientEvent[],
  perspective: Perspective,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): { sources: string[]; targets: string[] } {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  const sources = new Set<string>()
  const targets = new Set<string>()

  for (const e of events) {
    if (e.kind !== kind) continue
    if (!passesPerspective(e, category, perspective, allySet)) continue
    if (e.src) sources.add(e.src)
    if (e.dst) targets.add(e.dst)
  }

  return { sources: [...sources].sort(), targets: [...targets].sort() }
}

// Aura-metric row builder (Buffs or Debuffs). Groups auras by spellId, unions
// their windows per spell to compute group uptime ("any target has it at t"),
// and — for buffs — tags each row with its classification section. Debuff
// rows carry no section and render flat.
//
// Filter semantics (same store state as damage/healing, different meaning):
//   Source (Caster)    → filter windows by `c`
//   Target (Recipient) → filter windows by `d`
//   Ability (Aura)     → filter rows by spell name (one spell can match)
//   TimeWindow         → clip windows to the selected [start,end] sub-range
//                        before union; a window that doesn't intersect the
//                        sub-range drops out entirely.
//
// Scope window: [t0Ms, tEndMs] is the segment/keyrun/bosssection time span.
// Windows that extend beyond are clamped to the scope before union; the
// union is what drives uptime%. When TimeWindow is active, the effective
// scope shrinks to the intersection, so uptime% is computed relative to the
// window width — matching the way damage/healing re-aggregate under filters.
const auraRowsCache = new WeakMap<AuraWindowWire[], Map<string, AuraRow[]>>()

export type AuraKind = 'BUFF' | 'DEBUFF'

// Wire flag test: windows without `k` are BUFFs (legacy + common case); k===1
// marks DEBUFFs. Kept as a helper so the filter is consistent across callers.
function matchesKind(w: AuraWindowWire, kind: AuraKind): boolean {
  return kind === 'DEBUFF' ? w.k === 1 : w.k !== 1
}

export function computeAuraRows(
  auras: AuraWindowWire[],
  classification: Record<string, BuffSection>,
  filters: FilterState,
  t0Ms: number,
  tEndMs: number,
  allies: Record<string, PlayerSnapshot>,
  perspective: Perspective,
  kind: AuraKind,
): AuraRow[] {
  if (!hasAnyFilter(filters, kind === 'BUFF' ? 'buffs' : 'debuffs')) {
    const sub = getOrInit(auraRowsCache, auras)
    // The WeakMap is keyed on the auras array so it's already scoped to one
    // snapshot; kind + perspective distinguish the tab + partition within
    // that snapshot.
    const cacheKey = `${kind}:${perspective}:${t0Ms}:${tEndMs}`
    const cached = sub.get(cacheKey)
    if (cached) return cached
    const rows = computeAuraRowsImpl(auras, classification, filters, t0Ms, tEndMs, allies, perspective, kind)
    sub.set(cacheKey, rows)
    return rows
  }
  return computeAuraRowsImpl(auras, classification, filters, t0Ms, tEndMs, allies, perspective, kind)
}

function computeAuraRowsImpl(
  auras: AuraWindowWire[],
  classification: Record<string, BuffSection>,
  filters: FilterState,
  t0Ms: number,
  tEndMs: number,
  allies: Record<string, PlayerSnapshot>,
  perspective: Perspective,
  kind: AuraKind,
): AuraRow[] {
  if (auras.length === 0 || tEndMs <= t0Ms) return []

  const { effStart, effEnd } = resolveBuffScope(t0Ms, tEndMs, filters.TimeWindow)
  const scopeMs = effEnd - effStart
  if (scopeMs <= 0) return []

  const casterFilter = filters.Source
  const recipientFilter = filters.Target
  const auraFilter = filters.Ability
  const allySet = makeAllySet(allies)

  // Group by spellId. Keep per-target window lists for the drill panel so
  // a row already has them memoized — avoids a second pass.
  type Agg = {
    spellName: string
    windows: AuraWindowWire[]
    byTarget: Record<string, AuraWindowWire[]>
    count: number
  }
  const bySpell = new Map<string, Agg>()

  for (const w of auras) {
    if (!matchesKind(w, kind)) continue
    // Allies view: target is a known ally (by name).
    // Enemies view: target was REACTION_HOSTILE at APPLIED — a name-only
    // check would leak player pets / totems / guardians into the enemy list
    // since they're non-ally but friendly.
    if (perspective === 'allies' ? !allySet.has(w.d) : w.h !== 1) continue
    if (casterFilter && !casterFilter.includes(w.c)) continue
    if (recipientFilter && !recipientFilter.includes(w.d)) continue
    if (auraFilter && !auraFilter.includes(w.n)) continue
    // Must have a non-zero intersection with the effective scope window.
    if (w.e <= effStart || w.s >= effEnd) continue

    let agg = bySpell.get(w.id)
    if (!agg) {
      agg = { spellName: w.n, windows: [], byTarget: {}, count: 0 }
      bySpell.set(w.id, agg)
    }
    agg.windows.push(w)
    if (!agg.byTarget[w.d]) agg.byTarget[w.d] = []
    agg.byTarget[w.d].push(w)
    // Per-recipient applications = 1 fresh APPLIED + folded-in refreshes.
    // Matches WCL's Count column: refreshing Ironfur 15 times inside a
    // continuous uptime block reads as 16 (initial + 15 refreshes), not 1.
    agg.count += 1 + (w.r ?? 0)
  }

  const rows: AuraRow[] = []
  for (const [spellId, agg] of bySpell) {
    const uptimeMs = unionUptimeMs(agg.windows, effStart, effEnd)
    const row: AuraRow = {
      spellId,
      spellName: agg.spellName,
      uptimeMs,
      uptimePct: (uptimeMs / scopeMs) * 100,
      count: agg.count,
      windows: agg.windows,
      windowsByTarget: agg.byTarget,
    }
    if (kind === 'BUFF') row.section = classification[spellId] ?? 'external'
    rows.push(row)
  }

  if (kind === 'BUFF') {
    // Buffs: section order (personal → raid → external), then uptime% desc
    // within the section. Matches the plan's default display order.
    const sectionRank: Record<BuffSection, number> = { personal: 0, raid: 1, external: 2 }
    rows.sort((a, b) => {
      const sr = sectionRank[a.section ?? 'external'] - sectionRank[b.section ?? 'external']
      if (sr !== 0) return sr
      return b.uptimePct - a.uptimePct
    })
  } else {
    // Debuffs: flat uptime% desc sort. No section grouping.
    rows.sort((a, b) => b.uptimePct - a.uptimePct)
  }
  return rows
}

// Resolve the effective scope to union over, intersecting the scope's
// [t0Ms, tEndMs] with any active TimeWindow filter (which is expressed in
// seconds-from-scope-start).
function resolveBuffScope(
  t0Ms: number,
  tEndMs: number,
  tw: FilterState['TimeWindow'],
): { effStart: number; effEnd: number } {
  if (!tw) return { effStart: t0Ms, effEnd: tEndMs }
  const effStart = Math.max(t0Ms, t0Ms + tw.startSec * 1000)
  const effEnd = Math.min(tEndMs, t0Ms + tw.endSec * 1000)
  return { effStart, effEnd }
}

// Unit universe for the aura metrics — casters + targets that appear in the
// aura windows for the given kind. Partitioned by perspective so the allies
// view picker lists only ally recipients (and their casters) and the enemies
// view lists only non-ally recipients.
const auraUnitUniverseCache = new WeakMap<AuraWindowWire[], Map<string, { sources: string[]; targets: string[] }>>()

export function computeAuraUnitUniverse(
  auras: AuraWindowWire[],
  allies: Record<string, PlayerSnapshot>,
  perspective: Perspective,
  kind: AuraKind,
): { sources: string[]; targets: string[] } {
  const sub = getOrInit(auraUnitUniverseCache, auras)
  const cacheKey = `${kind}:${perspective}`
  const cached = sub.get(cacheKey)
  if (cached) return cached
  const allySet = makeAllySet(allies)
  const sources = new Set<string>()
  const targets = new Set<string>()
  for (const w of auras) {
    if (!matchesKind(w, kind)) continue
    if (perspective === 'allies' ? !allySet.has(w.d) : w.h !== 1) continue
    sources.add(w.c)
    targets.add(w.d)
  }
  if (perspective === 'allies') {
    // Include allies as fallback recipients even if they never gained/lost an
    // aura in this scope — the picker should still list them so a user can
    // filter to "auras on <X>" and get an empty state, not a missing option.
    // (Mirrors how the damage/healing picker lists allies with zero activity.)
    // No equivalent fallback for enemies — we don't have a canonical enemy
    // roster outside the aura stream itself.
    for (const name of Object.keys(allies)) targets.add(name)
  }
  const result = { sources: [...sources].sort(), targets: [...targets].sort() }
  sub.set(cacheKey, result)
  return result
}

// Ability (aura) universe for the aura-metric picker. Filters by
// Caster/Recipient before tallying so the picker list reflects what's
// currently in view.
export function computeAuraAbilityUniverse(
  auras: AuraWindowWire[],
  filters: Pick<FilterState, 'Source' | 'Target'>,
  allies: Record<string, PlayerSnapshot>,
  perspective: Perspective,
  kind: AuraKind,
): AbilityEntry[] {
  type Agg = { count: number; sources: Map<string, number> }
  const byAura = new Map<string, Agg>()

  const srcFilter = filters.Source
  const tgtFilter = filters.Target
  const allySet = makeAllySet(allies)

  for (const w of auras) {
    if (!matchesKind(w, kind)) continue
    if (perspective === 'allies' ? !allySet.has(w.d) : w.h !== 1) continue
    if (srcFilter && !srcFilter.includes(w.c)) continue
    if (tgtFilter && !tgtFilter.includes(w.d)) continue
    let agg = byAura.get(w.n)
    if (!agg) {
      agg = { count: 0, sources: new Map() }
      byAura.set(w.n, agg)
    }
    // Same refresh-aware count as computeAuraRows.
    const applications = 1 + (w.r ?? 0)
    agg.count += applications
    agg.sources.set(w.c, (agg.sources.get(w.c) ?? 0) + applications)
  }

  let grand = 0
  for (const a of byAura.values()) grand += a.count

  const entries: AbilityEntry[] = []
  for (const [name, agg] of byAura) {
    const pct = grand > 0 ? (agg.count / grand) * 100 : 0
    const sortedSources = [...agg.sources.entries()].sort((a, c) => c[1] - a[1])
    entries.push({
      name,
      pct,
      sources: sortedSources.slice(0, 3).map(([n]) => n),
      sourceCount: agg.sources.size,
    })
  }
  entries.sort((a, b) => b.pct - a.pct)
  return entries
}

// True when at least one aura window of the given kind passes the current
// filter set — drives the FilterEmptyState fallback for aura metrics the
// same way hasMatchingData does for damage/healing.
export function hasMatchingAuraData(
  auras: AuraWindowWire[],
  filters: FilterState,
  t0Ms: number,
  tEndMs: number,
  allies: Record<string, PlayerSnapshot>,
  perspective: Perspective,
  kind: AuraKind,
): boolean {
  const { effStart, effEnd } = resolveBuffScope(t0Ms, tEndMs, filters.TimeWindow)
  if (effEnd <= effStart) return false
  const casterFilter = filters.Source
  const recipientFilter = filters.Target
  const auraFilter = filters.Ability
  const allySet = makeAllySet(allies)
  for (const w of auras) {
    if (!matchesKind(w, kind)) continue
    if (perspective === 'allies' ? !allySet.has(w.d) : w.h !== 1) continue
    if (casterFilter && !casterFilter.includes(w.c)) continue
    if (recipientFilter && !recipientFilter.includes(w.d)) continue
    if (auraFilter && !auraFilter.includes(w.n)) continue
    if (w.e <= effStart || w.s >= effEnd) continue
    return true
  }
  return false
}

// Clip to [t0, tEnd] and union overlapping intervals. O(n log n) sort + sweep.
// Touching intervals (end === nextStart) are merged — a contiguous buff that
// refreshed exactly at falloff counts as one uptime block, not zero-gap two.
function unionUptimeMs(windows: AuraWindowWire[], t0Ms: number, tEndMs: number): number {
  if (windows.length === 0) return 0
  const intervals: [number, number][] = []
  for (const w of windows) {
    const s = Math.max(w.s, t0Ms)
    const e = Math.min(w.e, tEndMs)
    if (e > s) intervals.push([s, e])
  }
  if (intervals.length === 0) return 0
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let curStart = intervals[0][0]
  let curEnd = intervals[0][1]
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i]
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e
    } else {
      total += curEnd - curStart
      curStart = s
      curEnd = e
    }
  }
  total += curEnd - curStart
  return total
}

// Build pseudo-PlayerSnapshots for enemy units from raw events. Used by the
// graph when perspective is 'enemies' — the server only ships ally snapshots,
// so we derive enemy rate values and event records from the events array.
const enemyPlayersCache = new WeakMap<ClientEvent[], Map<string, Record<string, PlayerSnapshot>>>()

export function computeEnemyPlayers(
  events: ClientEvent[],
  allies: Record<string, PlayerSnapshot>,
  durationSec: number,
): Record<string, PlayerSnapshot> {
  const sub = getOrInit(enemyPlayersCache, events)
  const cacheKey = `d:${durationSec}`
  const cached = sub.get(cacheKey)
  if (cached) return cached

  const allySet = makeAllySet(allies)
  type Acc = {
    damage: number; healing: number; overheal: number
    deaths: PlayerSnapshot['deaths']
    interrupts: PlayerSnapshot['interrupts']['records']
  }
  const agg = new Map<string, Acc>()

  const ensure = (name: string): Acc => {
    let a = agg.get(name)
    if (!a) {
      a = { damage: 0, healing: 0, overheal: 0, deaths: [], interrupts: [] }
      agg.set(name, a)
    }
    return a
  }

  for (const e of events) {
    const src = e.src
    const dst = e.dst

    if (e.kind === 'damage' && !allySet.has(src)) {
      ensure(src).damage += e.amount ?? 0
    } else if (e.kind === 'heal' && !allySet.has(src)) {
      const a = ensure(src)
      a.healing += e.amount ?? 0
      a.overheal += e.overheal ?? 0
    } else if (e.kind === 'death' && !allySet.has(dst)) { // attribute to victim (dst), not killer
      ensure(dst).deaths.push({
        playerName: dst,
        timeOfDeath: e.t,
        combatElapsed: 0, // filled below
        killingBlow: { spellName: e.ability, sourceName: src, spellId: e.spellId ?? '' },
      } as PlayerSnapshot['deaths'][number])
    } else if (e.kind === 'interrupt' && !allySet.has(src)) {
      ensure(src).interrupts.push({
        kickerName: src,
        kickerGuid: '',
        timeOfInterrupt: e.t,
        combatElapsed: 0,
        kickerSpellId: e.spellId ?? '',
        kickerSpellName: e.ability,
        kickedSpellId: '',
        kickedSpellName: '',
        targetName: dst,
        targetGuid: '',
      })
    }
  }

  // Compute combatElapsed relative to the first event timestamp.
  const t0 = events.length > 0 ? events[0].t : 0
  for (const a of agg.values()) {
    for (const d of a.deaths) d.combatElapsed = (d.timeOfDeath - t0) / 1000
    for (const r of a.interrupts) r.combatElapsed = (r.timeOfInterrupt - t0) / 1000
  }

  const dur = Math.max(1, durationSec)
  const result: Record<string, PlayerSnapshot> = {}
  for (const [name, a] of agg) {
    result[name] = {
      name,
      dps: a.damage / dur,
      hps: a.healing / dur,
      damage: { total: a.damage, spells: {}, targets: {} },
      healing: { total: a.healing, overheal: a.overheal, spells: {}, targets: {} },
      deaths: a.deaths,
      interrupts: {
        total: a.interrupts.length,
        byKicker: {},
        byKicked: {},
        records: a.interrupts,
      },
      // Enemy perspective doesn't render the Active column, but the field is
      // required by PlayerSnapshot — fill with 0.
      activeSec: 0,
    }
  }

  sub.set(cacheKey, result)
  return result
}

// ─── Per-player breakdown aggregation ──────────────────────────────────────
// The breakdown panel projects all of its surfaces (header total/rate, spells
// list, targets list, drill view) from one shape so they always agree under
// any filter combination. Two paths produce that shape:
//   - No filter active → project the server's pre-aggregated PlayerSnapshot,
//     preserving critCount/maxHit that ClientEvent doesn't yet carry.
//   - Any filter active → walk events through `passesFilters`, lose those
//     fields (until the wire enrichment lands).
// The renderer treats critCount/maxHit as optional; absent values render
// "—" rather than 0.
//
// Path-divergence trade-off: snapshot.{damage,healing}.total is server-authored
// and may include events the client-side walk drops (e.g. amount === 0 from
// fully-absorbed hits). So toggling a filter that *should* be a no-op (e.g.
// Source = [the only player]) can make the header total tick down by the
// dropped contribution. Acceptable today because (a) Full mode requires
// completed segments so the divergence is stable, not flickering, and (b) the
// drill view has always behaved this way pre-refactor. Revisit if the
// divergence becomes user-visible enough to confuse.
//
// hitCount semantics: the events path counts each `kind === 'damage' | 'heal'`
// event as one hit. The snapshot's hitCount is server-authored — if those
// definitions diverge (e.g. server excludes periodic ticks), the no-filter and
// filtered values won't match. Server convention should mirror "one event =
// one hit"; verify if a parity bug shows up.

export interface BreakdownSpellRow {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  // critCount / maxHit: only populated on the snapshot (no-filter) path
  // until ClientEvent grows a `crit` flag. Renderer shows "—" when absent.
  // maxHit is the largest single hit regardless of crit status (max of the
  // server's normalMax and critMax) so a 100%-crit spell still shows a value.
  critCount?: number
  maxHit?: number
  // overheal: healing rows only. Populated on BOTH paths for heal kind (events
  // carry e.overheal); damage rows leave it undefined.
  overheal?: number
}

export interface BreakdownTargetRow {
  targetName: string
  total: number
  // Healing only; populated on both paths.
  overheal?: number
}

export interface PlayerBreakdown {
  total: number
  rate: number       // total / durationSec
  spells: BreakdownSpellRow[]   // sorted by total desc
  targets: BreakdownTargetRow[] // sorted by total desc
}

const EMPTY_BREAKDOWN: PlayerBreakdown = {
  total: 0,
  rate: 0,
  spells: [],
  targets: [],
}

// Cache layout: events → (cacheKey → (playerName → breakdown)). One walk over
// events fills the inner Map for every player at once; subsequent breakdown
// lookups for other players are O(1). WeakMap-keyed on the events array so
// entries auto-evict when the snapshot leaves snapshotCache.
const breakdownCache = new WeakMap<ClientEvent[], Map<string, Map<string, PlayerBreakdown>>>()

function filterCacheKey(filters: FilterState, category?: Metric): string {
  // JSON shape sidesteps separator collisions (e.g. a unit name containing
  // `|` or `;`). Per-axis values are sorted for canonicality so chip order
  // doesn't churn the key. Cost is negligible — small object, microseconds.
  // InterruptedAbility is only included when the category actually reads it
  // (interrupts) — otherwise a stale chip from a prior interrupts view would
  // split the cache across otherwise-identical filter states.
  const canonical: Record<string, string[] | { startSec: number; endSec: number }> = {}
  const includeInterrupted = category === undefined || category === 'interrupts'
  const axes = includeInterrupted
    ? ['Source', 'Target', 'Ability', 'InterruptedAbility'] as const
    : ['Source', 'Target', 'Ability'] as const
  for (const axis of axes) {
    const v = filters[axis]
    if (!v || v.length === 0) continue
    canonical[axis] = [...v].sort()
  }
  if (filters.TimeWindow) canonical.TimeWindow = filters.TimeWindow
  return JSON.stringify(canonical)
}

// Project a PlayerSnapshot's pre-aggregated damage/heal stats into the
// unified breakdown shape. Only valid in the no-filter case — the snapshot's
// totals are over the entire segment.
function projectSnapshot(
  snapshot: PlayerSnapshot,
  kind: 'damage' | 'heal',
  durationSec: number,
): PlayerBreakdown {
  // rate=0 (rather than total/1) when duration is zero/unknown — avoids
  // surfacing nonsense like "1.2M DPS" for a zero-length fight.
  const rateOf = (total: number) => durationSec > 0 ? total / durationSec : 0
  if (kind === 'damage') {
    const spells: BreakdownSpellRow[] = Object.values(snapshot.damage.spells).map(s => ({
      spellId: s.spellId,
      spellName: s.spellName,
      total: s.total,
      hitCount: s.hitCount,
      critCount: s.critCount,
      maxHit: Math.max(s.normalMax, s.critMax),
    }))
    spells.sort((a, b) => b.total - a.total)
    const targets: BreakdownTargetRow[] = Object.values(snapshot.damage.targets).map(t => ({
      targetName: t.targetName,
      total: t.total,
    }))
    targets.sort((a, b) => b.total - a.total)
    return { total: snapshot.damage.total, rate: rateOf(snapshot.damage.total), spells, targets }
  }
  const spells: BreakdownSpellRow[] = Object.values(snapshot.healing.spells).map(s => ({
    spellId: s.spellId,
    spellName: s.spellName,
    total: s.total,
    hitCount: s.hitCount,
    critCount: s.critCount,
    overheal: s.overheal,
  }))
  spells.sort((a, b) => b.total - a.total)
  const targets: BreakdownTargetRow[] = Object.values(snapshot.healing.targets).map(t => ({
    targetName: t.targetName,
    total: t.total,
    overheal: t.overheal,
  }))
  targets.sort((a, b) => b.total - a.total)
  return { total: snapshot.healing.total, rate: rateOf(snapshot.healing.total), spells, targets }
}

// Category accepted by the breakdown path. 'damage' = dealt by the subject;
// 'damageTaken' = taken by the subject (subject is `e.dst`, "Targets" tab
// shows attackers = `e.src`); 'heal' = healed by the subject.
type BreakdownCategory = 'damage' | 'damageTaken' | 'heal'

function computeAllPlayerBreakdowns(
  events: ClientEvent[],
  category: BreakdownCategory,
  filters: FilterState,
  durationSec: number,
  allies: Record<string, PlayerSnapshot>,
): Map<string, PlayerBreakdown> {
  type SpellAcc = { spellId: string; spellName: string; total: number; hitCount: number; overheal: number }
  type TargetAcc = { targetName: string; total: number; overheal: number }
  type PlayerAcc = { total: number; spells: Map<string, SpellAcc>; targets: Map<string, TargetAcc> }
  const byPlayer = new Map<string, PlayerAcc>()

  const sourceFilter = filters.Source
  const targetFilter = filters.Target
  const abilityFilter = filters.Ability
  const timeWindow = filters.TimeWindow
  const t0 = scopeT0(events)

  const kind: ClientEvent['kind'] = category === 'heal' ? 'heal' : 'damage'
  // For damageTaken the row subject is the victim (dst), and the "Targets" tab
  // of the drill panel shows the OTHER side of the hit — attackers (src).
  const byTarget = category === 'damageTaken'

  for (const e of events) {
    if (e.kind !== kind) continue
    // For damage and heal, only ally subjects are drillable (no enemy-side
    // snapshot exists), so skip bucketing enemies — wasted work that grows
    // with trash count on M+ aggregates. For damageTaken, both sides are
    // drillable (enemy victims under the enemies perspective), so let all
    // subjects through.
    const subject = byTarget ? e.dst : e.src
    if (!byTarget && !allies[subject]) continue
    if (sourceFilter && !sourceFilter.includes(e.src)) continue
    if (targetFilter && !targetFilter.includes(e.dst)) continue
    if (abilityFilter && !abilityFilter.includes(e.ability)) continue
    if (timeWindow) {
      const elapsedSec = (e.t - t0) / 1000
      if (elapsedSec < timeWindow.startSec || elapsedSec > timeWindow.endSec) continue
    }

    // Effective-amount reinterpretation for damageTaken: the server's full-
    // absorb re-emit path sets `fullAbsorb: true` and stuffs the absorb amount
    // into both `amount` and `absorbed`. Strip it back out so a shield-eaten
    // hit counts as 0 landed in the breakdown. Partial absorbs already have
    // `amount` as the post-absorb landed portion — leave them.
    let amount = e.amount ?? 0
    if (byTarget && e.fullAbsorb) amount = 0
    // For damage-dealt and heal we skip zero-amount events (noise). For
    // damageTaken we keep them so the ability and attacker still surface in
    // the drill panel with hitCount > 0 — otherwise a tank whose top-level
    // row shows non-zero Mitigated (only fully-absorbed hits) would open an
    // empty drill. The spell's Total stays 0 in that case; the row reads as
    // "Ability X (N hits, 0 damage)" which still points the user at where
    // the mitigation came from.
    if (!byTarget && amount <= 0) continue
    if (byTarget && amount < 0) continue

    let player = byPlayer.get(subject)
    if (!player) {
      player = { total: 0, spells: new Map(), targets: new Map() }
      byPlayer.set(subject, player)
    }
    player.total += amount

    // Spell key: prefer spellId; fall back to ability name so melee swings
    // (no spellId on the wire) still bucket per-ability instead of collapsing.
    const spellKey = e.spellId || `name:${e.ability}`
    let spell = player.spells.get(spellKey)
    if (!spell) {
      spell = { spellId: e.spellId ?? '', spellName: e.ability, total: 0, hitCount: 0, overheal: 0 }
      player.spells.set(spellKey, spell)
    }
    spell.total += amount
    spell.hitCount += 1
    if (category === 'heal') spell.overheal += e.overheal ?? 0

    // "Targets" tab name: the other side of the event. For damageTaken this is
    // the attacker; for damage/heal it's the original target/recipient.
    const otherName = byTarget ? e.src : e.dst
    let target = player.targets.get(otherName)
    if (!target) {
      target = { targetName: otherName, total: 0, overheal: 0 }
      player.targets.set(otherName, target)
    }
    target.total += amount
    if (category === 'heal') target.overheal += e.overheal ?? 0
  }

  const out = new Map<string, PlayerBreakdown>()
  for (const [name, acc] of byPlayer) {
    const spells: BreakdownSpellRow[] = []
    for (const s of acc.spells.values()) {
      const row: BreakdownSpellRow = {
        spellId: s.spellId,
        spellName: s.spellName,
        total: s.total,
        hitCount: s.hitCount,
      }
      if (category === 'heal') row.overheal = s.overheal
      spells.push(row)
    }
    spells.sort((a, b) => b.total - a.total)

    const targets: BreakdownTargetRow[] = []
    for (const t of acc.targets.values()) {
      const row: BreakdownTargetRow = { targetName: t.targetName, total: t.total }
      if (category === 'heal') row.overheal = t.overheal
      targets.push(row)
    }
    targets.sort((a, b) => b.total - a.total)

    out.set(name, {
      total: acc.total,
      rate: durationSec > 0 ? acc.total / durationSec : 0,
      spells,
      targets,
    })
  }
  return out
}

// Pick the cheaper, richer path when no filter is active; fall through to
// event aggregation otherwise. Returning EMPTY_BREAKDOWN for unknown players
// keeps the renderer trivially safe — empty rows + zero total render "no data."
//
// Duration in the cache key is OK because Full mode (the only mode where
// filters are exposed) requires a completed scope — duration is stable across
// renders for any cached entry.
export function selectPlayerBreakdown(
  events: ClientEvent[],
  playerName: string,
  category: BreakdownCategory,
  filters: FilterState,
  durationSec: number,
  snapshot: PlayerSnapshot | undefined,
  allies: Record<string, PlayerSnapshot>,
): PlayerBreakdown {
  // Snapshot fast-path: only valid for damage-dealt and healing-done, since
  // PlayerSnapshot carries no damage-taken aggregation. damageTaken always
  // walks events (still fast — one pass over ~20k events).
  // Breakdown categories (damage/damageTaken/heal) never consult
  // InterruptedAbility — map to a non-interrupts metric so a stale chip from
  // the interrupts view doesn't disable the fast path or balloon cache keys.
  const breakdownMetric: Metric = category === 'heal' ? 'healing' : category
  if (snapshot && !hasAnyFilter(filters, breakdownMetric) && category !== 'damageTaken') {
    return projectSnapshot(snapshot, category === 'heal' ? 'heal' : 'damage', durationSec)
  }
  const cacheKey = `${category}:${durationSec}:${filterCacheKey(filters, breakdownMetric)}`
  let perEvents = breakdownCache.get(events)
  if (!perEvents) {
    perEvents = new Map()
    breakdownCache.set(events, perEvents)
  }
  let perKey = perEvents.get(cacheKey)
  if (!perKey) {
    perKey = computeAllPlayerBreakdowns(events, category, filters, durationSec, allies)
    perEvents.set(cacheKey, perKey)
  }
  return perKey.get(playerName) ?? EMPTY_BREAKDOWN
}

// Heuristic for the empty-state "most-restrictive filter" hint. Rebuilds the
// check once per axis with that axis removed; first axis whose removal yields
// data is the one we name. Returns null if removing any single axis isn't
// enough (caller should show generic copy).
export function mostRestrictiveFilter(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): { axis: keyof FilterState; label: string } | null {
  // Order matters: check the narrower, more deliberately-set filters first.
  // TimeWindow is typically the most specific (drag-selected range), so it
  // leads. Falls back to chip filters otherwise.
  const axes: (keyof FilterState)[] = ['TimeWindow', 'InterruptedAbility', 'Ability', 'Target', 'Source']
  for (const axis of axes) {
    if (!filters[axis]) continue
    const stripped: FilterState = { ...filters }
    delete stripped[axis]
    if (hasMatchingData(events, perspective, stripped, category, allies)) {
      if (axis === 'TimeWindow') {
        return { axis, label: 'Time window' }
      }
      const values = (filters[axis] as string[] | undefined) ?? []
      const axisDisplay = axis === 'InterruptedAbility' ? 'Interrupted Spell' : axis
      const label = values.length === 1 ? `${axisDisplay}: ${values[0]}` : `${axisDisplay} filter`
      return { axis, label }
    }
  }
  return null
}
