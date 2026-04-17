import type { ClientEvent, PlayerSnapshot } from '../types'
import type { FilterState, Metric, Perspective } from '../store'

// Shape returned for damage/healing/interrupts row lists. `value` is the sorted
// metric (DPS/HPS/count); `total` is the raw sum before dividing by duration.
// Secondary stats are populated per-category — fields kept optional so the
// row renderer can stay metric-agnostic.
export interface UnitRow {
  name: string
  specId?: number
  value: number
  total: number
  casts?: number
  overheal?: number
  distinctAbilities?: number   // interrupts: # distinct abilities kicked (pre-filter: byKicked)
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

// Maps a metric category to the event.kind that feeds it. Damage/healing are
// 1:1; interrupts and deaths use their own event kinds.
function kindFor(category: Metric): ClientEvent['kind'] {
  switch (category) {
    case 'damage':     return 'damage'
    case 'healing':    return 'heal'
    case 'interrupts': return 'interrupt'
    case 'deaths':     return 'death'
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
// deaths: destination (the victim) — UX wants "who died," not "who killed"
function rowSubject(e: ClientEvent): string {
  return e.kind === 'death' ? e.dst : e.src
}

// Shared AND-composition predicate. Matches the spec's includeEvent() exactly:
// an event contributes only if it passes every active filter.
function passesFilters(e: ClientEvent, filters: FilterState): boolean {
  if (filters.Source  && !filters.Source.includes(e.src)) return false
  if (filters.Target  && !filters.Target.includes(e.dst)) return false
  if (filters.Ability && !filters.Ability.includes(e.ability)) return false
  return true
}

function passesPerspective(e: ClientEvent, perspective: Perspective, allySet: Set<string>): boolean {
  const subject = rowSubject(e)
  const isAlly = allySet.has(subject)
  return perspective === 'allies' ? isAlly : !isAlly
}

function hasAnyFilter(filters: FilterState): boolean {
  return !!(filters.Source || filters.Target || filters.Ability)
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
const unitUniverseCache = new WeakMap<ClientEvent[], Map<string, { sources: string[]; targets: string[] }>>()

function getOrInit<K extends object, V>(cache: WeakMap<K, Map<string, V>>, key: K): Map<string, V> {
  let sub = cache.get(key)
  if (!sub) { sub = new Map(); cache.set(key, sub) }
  return sub
}

export function computeUnitRows(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: 'damage' | 'healing' | 'interrupts',
  allies: Record<string, PlayerSnapshot>,
  durationSec: number,
): UnitRow[] {
  if (!hasAnyFilter(filters)) {
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
  category: 'damage' | 'healing' | 'interrupts',
  allies: Record<string, PlayerSnapshot>,
  durationSec: number,
): UnitRow[] {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  type Bucket = { total: number; count: number; overheal: number; abilities: Set<string> }
  const agg = new Map<string, Bucket>()

  for (const e of events) {
    if (e.kind !== kind) continue
    if (!passesPerspective(e, perspective, allySet)) continue
    if (!passesFilters(e, filters)) continue

    const subject = rowSubject(e)
    if (!subject) continue

    let bucket = agg.get(subject)
    if (!bucket) {
      bucket = { total: 0, count: 0, overheal: 0, abilities: new Set() }
      agg.set(subject, bucket)
    }
    bucket.total += e.amount ?? 0
    bucket.count += 1
    bucket.overheal += e.overheal ?? 0
    if (category === 'interrupts') bucket.abilities.add(e.ability)
  }

  const rows: UnitRow[] = []
  for (const [name, bucket] of agg) {
    // Drop zero-contribution units — spec: "so a warrior with no healing
    // doesn't show in the Healing view when Ability filters them out."
    if (category === 'interrupts' ? bucket.count === 0 : bucket.total === 0) continue

    const value = category === 'interrupts'
      ? bucket.count
      : (durationSec > 0 ? bucket.total / durationSec : 0)

    const specId = allies[name]?.specId
    const row: UnitRow = { name, specId, value, total: bucket.total }
    if (category === 'damage')     row.casts = bucket.count
    if (category === 'healing')    row.overheal = bucket.overheal
    if (category === 'interrupts') row.distinctAbilities = bucket.abilities.size
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
  if (!hasAnyFilter(filters)) {
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
  const rows: DeathRow[] = []

  for (const e of events) {
    if (e.kind !== 'death') continue
    if (!passesPerspective(e, perspective, allySet)) continue
    if (!passesFilters(e, filters)) continue

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
  filters: Pick<FilterState, 'Source' | 'Target'>,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  if (!filters.Source && !filters.Target) {
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
  filters: Pick<FilterState, 'Source' | 'Target'>,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): AbilityEntry[] {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  type Agg = { total: number; count: number; sources: Map<string, number> }
  const byAbility = new Map<string, Agg>()

  // Walk once, applying Source+Target filters but NOT the Ability filter (the
  // picker must show options it would hide if self-applied).
  const sourceFilter = filters.Source
  const targetFilter = filters.Target

  for (const e of events) {
    if (e.kind !== kind) continue
    if (!passesPerspective(e, perspective, allySet)) continue
    if (sourceFilter && !sourceFilter.includes(e.src)) continue
    if (targetFilter && !targetFilter.includes(e.dst)) continue

    let bucket = byAbility.get(e.ability)
    if (!bucket) {
      bucket = { total: 0, count: 0, sources: new Map() }
      byAbility.set(e.ability, bucket)
    }
    bucket.total += e.amount ?? 0
    bucket.count += 1
    bucket.sources.set(e.src, (bucket.sources.get(e.src) ?? 0) + (e.amount ?? 1))
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

export function hasMatchingData(
  events: ClientEvent[],
  perspective: Perspective,
  filters: FilterState,
  category: Metric,
  allies: Record<string, PlayerSnapshot>,
): boolean {
  const kind = kindFor(category)
  const allySet = makeAllySet(allies)
  for (const e of events) {
    if (e.kind !== kind) continue
    if (!passesPerspective(e, perspective, allySet)) continue
    if (!passesFilters(e, filters)) continue
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
    if (!passesPerspective(e, perspective, allySet)) continue
    if (e.src) sources.add(e.src)
    if (e.dst) targets.add(e.dst)
  }

  return { sources: [...sources].sort(), targets: [...targets].sort() }
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
    } else if (e.kind === 'death' && !allySet.has(dst)) {
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
        kickedSpellName: e.ability,
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
    }
  }

  sub.set(cacheKey, result)
  return result
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
  const axes: (keyof FilterState)[] = ['Ability', 'Target', 'Source']
  for (const axis of axes) {
    if (!filters[axis]) continue
    const stripped: FilterState = { ...filters }
    delete stripped[axis]
    if (hasMatchingData(events, perspective, stripped, category, allies)) {
      const values = filters[axis] ?? []
      const label = values.length === 1 ? `${axis}: ${values[0]}` : `${axis} filter`
      return { axis, label }
    }
  }
  return null
}
