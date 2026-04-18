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
//     preserving critCount/normalMax that ClientEvent doesn't yet carry.
//   - Any filter active → walk events through `passesFilters`, lose those
//     fields (until the wire enrichment lands).
// The renderer treats critCount/normalMax as optional; absent values render
// "—" rather than 0.

export interface BreakdownSpellRow {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  // Only populated on the no-filter path until ClientEvent grows a `crit` flag.
  critCount?: number
  normalMax?: number
  // Healing only.
  overheal?: number
}

export interface BreakdownTargetRow {
  targetName: string
  total: number
  // Healing only.
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

function filterCacheKey(filters: FilterState): string {
  // Canonical: sort each axis' values so chip order doesn't churn the key.
  const parts: string[] = []
  for (const axis of ['Source', 'Target', 'Ability'] as const) {
    const v = filters[axis]
    if (!v || v.length === 0) continue
    parts.push(`${axis}:${[...v].sort().join('|')}`)
  }
  return parts.join(';')
}

// Project a PlayerSnapshot's pre-aggregated damage/heal stats into the
// unified breakdown shape. Only valid in the no-filter case — the snapshot's
// totals are over the entire segment.
function projectSnapshot(
  snapshot: PlayerSnapshot,
  kind: 'damage' | 'heal',
  durationSec: number,
): PlayerBreakdown {
  const dur = durationSec > 0 ? durationSec : 1
  if (kind === 'damage') {
    const spells: BreakdownSpellRow[] = Object.values(snapshot.damage.spells).map(s => ({
      spellId: s.spellId,
      spellName: s.spellName,
      total: s.total,
      hitCount: s.hitCount,
      critCount: s.critCount,
      normalMax: s.normalMax,
    }))
    spells.sort((a, b) => b.total - a.total)
    const targets: BreakdownTargetRow[] = Object.values(snapshot.damage.targets).map(t => ({
      targetName: t.targetName,
      total: t.total,
    }))
    targets.sort((a, b) => b.total - a.total)
    return { total: snapshot.damage.total, rate: snapshot.damage.total / dur, spells, targets }
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
  return { total: snapshot.healing.total, rate: snapshot.healing.total / dur, spells, targets }
}

function computeAllPlayerBreakdowns(
  events: ClientEvent[],
  kind: 'damage' | 'heal',
  filters: FilterState,
  durationSec: number,
): Map<string, PlayerBreakdown> {
  type SpellAcc = { spellId: string; spellName: string; total: number; hitCount: number; overheal: number }
  type TargetAcc = { targetName: string; total: number; overheal: number }
  type PlayerAcc = { total: number; spells: Map<string, SpellAcc>; targets: Map<string, TargetAcc> }
  const byPlayer = new Map<string, PlayerAcc>()

  const sourceFilter = filters.Source
  const targetFilter = filters.Target
  const abilityFilter = filters.Ability

  for (const e of events) {
    if (e.kind !== kind) continue
    if (sourceFilter && !sourceFilter.includes(e.src)) continue
    if (targetFilter && !targetFilter.includes(e.dst)) continue
    if (abilityFilter && !abilityFilter.includes(e.ability)) continue
    const amount = e.amount ?? 0
    if (amount <= 0) continue

    let player = byPlayer.get(e.src)
    if (!player) {
      player = { total: 0, spells: new Map(), targets: new Map() }
      byPlayer.set(e.src, player)
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
    if (kind === 'heal') spell.overheal += e.overheal ?? 0

    let target = player.targets.get(e.dst)
    if (!target) {
      target = { targetName: e.dst, total: 0, overheal: 0 }
      player.targets.set(e.dst, target)
    }
    target.total += amount
    if (kind === 'heal') target.overheal += e.overheal ?? 0
  }

  const dur = durationSec > 0 ? durationSec : 1
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
      if (kind === 'heal') row.overheal = s.overheal
      spells.push(row)
    }
    spells.sort((a, b) => b.total - a.total)

    const targets: BreakdownTargetRow[] = []
    for (const t of acc.targets.values()) {
      const row: BreakdownTargetRow = { targetName: t.targetName, total: t.total }
      if (kind === 'heal') row.overheal = t.overheal
      targets.push(row)
    }
    targets.sort((a, b) => b.total - a.total)

    out.set(name, { total: acc.total, rate: acc.total / dur, spells, targets })
  }
  return out
}

// Pick the cheaper, richer path when no filter is active; fall through to
// event aggregation otherwise. Returning EMPTY_BREAKDOWN for unknown players
// keeps the renderer trivially safe — empty rows + zero total render "no data."
export function selectPlayerBreakdown(
  events: ClientEvent[],
  playerName: string,
  kind: 'damage' | 'heal',
  filters: FilterState,
  durationSec: number,
  snapshot: PlayerSnapshot | undefined,
): PlayerBreakdown {
  if (snapshot && !hasAnyFilter(filters)) {
    return projectSnapshot(snapshot, kind, durationSec)
  }
  const cacheKey = `${kind}:${durationSec}:${filterCacheKey(filters)}`
  let perEvents = breakdownCache.get(events)
  if (!perEvents) {
    perEvents = new Map()
    breakdownCache.set(events, perEvents)
  }
  let perKey = perEvents.get(cacheKey)
  if (!perKey) {
    perKey = computeAllPlayerBreakdowns(events, kind, filters, durationSec)
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
