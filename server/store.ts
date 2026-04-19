import type { PlayerDeathRecord, PlayerInterruptRecord, ClientEvent, AuraWindow, AuraOpen, AuraWindowWire, BuffSection } from './types.js'
import type { IconResolver } from './iconResolver.js'
export type { PlayerDeathRecord, PlayerInterruptRecord, ClientEvent, AuraWindow, AuraOpen, AuraWindowWire, BuffSection }

export interface SpellDamageStats {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  critCount: number
  normalTotal: number
  normalMin: number
  normalMax: number
  critTotal: number
  critMin: number
  critMax: number
  absorbed: number
  resisted: number
  blocked: number
}

export interface SpellHealStats {
  spellId: string
  spellName: string
  total: number
  overheal: number
  absorbed: number
  hitCount: number
  critCount: number
}

export interface TargetDamageStats {
  targetName: string
  total: number
}

export interface TargetHealStats {
  targetName: string
  total: number      // effective heal
  overheal: number
}

export interface SourceDamageStats {
  sourceName: string
  total: number
}

export interface TargetDamageTaken {
  total: number
  sources: Record<string, SourceDamageStats>
}

export interface SourceHealStats {
  sourceName: string
  total: number     // effective heal from this source
}

export interface TargetHealingReceived {
  total: number     // effective heal received
  sources: Record<string, SourceHealStats>
}

export interface DamageData {
  total: number
  spells: Record<string, SpellDamageStats>
  targets: Record<string, TargetDamageStats>
}

export interface HealData {
  total: number
  overheal: number
  spells: Record<string, SpellHealStats>
  targets: Record<string, TargetHealStats>
}

export interface InterruptSpellStats {
  spellId: string
  spellName: string
  count: number
  // Attempts (cast-success events) for this kicker spell. Only meaningful on
  // `byKicker` entries — `byKicked` counts interrupted spells, which don't
  // have a meaningful attempts value. Optional so legacy snapshots without
  // attempt tracking read as undefined and the client lens can show "-".
  casts?: number
}

export interface InterruptData {
  total: number
  // Total SPELL_CAST_SUCCESS events for known interrupt spells — the "pressed
  // the button" count regardless of whether each press landed. Always ≥ total.
  // The difference (attempts - total) is interrupts that missed because the
  // target wasn't casting, another kicker won the race, or the cast was on
  // CD. See server/interrupts.ts for the known-interrupt list.
  attempts: number
  // Kicker's own abilities (e.g. Pummel, Kick, Mind Freeze)
  byKicker: Record<string, InterruptSpellStats>
  // Enemy spells that got interrupted
  byKicked: Record<string, InterruptSpellStats>
  // Per-event records for time-series views (graph tooltips, timeline).
  // Parallels PlayerData.deaths — aggregates above stay as the fast path for
  // breakdown panels that only need counts.
  records: PlayerInterruptRecord[]
}

export interface PlayerData {
  name: string
  specId?: number
  damage: DamageData
  healing: HealData
  deaths: PlayerDeathRecord[]
  interrupts: InterruptData
  // Per-player "active time" bookkeeping — sum of damage/heal event intervals,
  // with gaps >10s excluded (matches WCL's view-specific activeTime byte-perfect
  // as empirically verified against fight dpyDWNGb84zFrn3H). Updated incrementally
  // in applyDamage/applyHeal, and stitched across segments in _mergeSegments so
  // a key run rolls up the same way.
  damageActiveMs: number
  healActiveMs: number
  firstDamageTime: number | null
  lastDamageTime: number | null
  firstHealTime: number | null
  lastHealTime: number | null
}

// Gap-stitching threshold — WCL excludes idle gaps longer than this from per-player
// activeTime. Confirmed byte-perfect against WCL report dpyDWNGb84zFrn3H fight 1.
export const ACTIVE_TIME_GAP_MS = 10_000

export interface Segment {
  id: string
  keyRunId: string | null           // null for non-M+ segments
  bossSectionId: string | null      // container id for contiguous pulls of the same raid boss (null inside M+ or trash)
  encounterID: number               // 0 for trash segments
  encounterName: string
  startTime: number                 // ENCOUNTER_START timestamp (or first event for open segments)
  endTime: number | null            // ENCOUNTER_END timestamp, null while in progress
  firstEventTime: number | null     // timestamp of first damage/heal event
  lastEventTime: number | null      // timestamp of last damage/heal event
  success: boolean | null
  players: Record<string, PlayerData>
  guidToSpec: Record<string, number>   // playerGuid → specId, populated by COMBATANT_INFO
  guidToName: Record<string, string>   // playerGuid → playerName
  petToOwner: Record<string, string>   // petGuid → ownerGuid, populated by SPELL_SUMMON and SWING_DAMAGE advanced-log
  petBatchToOwner: Record<string, string>  // batch-key (shard|npcId|spawnSuffix) → ownerGuid, for sibling-suffix bootstrap of un-swung batched pets (e.g. Hunter Stampede)
  supportOwnedSpellIds: Set<string>    // spellIds that have fired as *_DAMAGE_SUPPORT; their plain variants are not real source damage
  targetDamageTaken: Record<string, TargetDamageTaken>
  healingReceived: Record<string, TargetHealingReceived>  // dest → effective heal + source breakdown
  // Pared-down event log for client-side filtering. Populated by aggregator on
  // every damage/heal/interrupt/death that makes it to a player. Shipped wholesale
  // in the snapshot so the Full-mode filter bar can re-aggregate under arbitrary
  // Source/Target/Ability combos without server round-trips.
  events: ClientEvent[]
  // Boss HP tracker, populated incrementally as damage events on non-player
  // units arrive with advanced-log HP fields. We lock onto the unit with the
  // highest maxHP seen in the segment (switches if a bigger unit appears —
  // e.g. a phase-2 boss spawns) and keep lastHP fresh on every hit. Stripped
  // at the snapshot boundary; only bossHpPctAtWipe crosses the wire.
  bossHpTracker?: { guid: string; maxHP: number; lastHP: number }
  // Rounded boss HP percentage at the moment of a wipe. Only populated on
  // ENCOUNTER_END where success === false AND the tracker has data (advanced
  // logging was on). Absent on kills, in-progress segments, and wipes logged
  // without advanced-log HP fields.
  bossHpPctAtWipe?: number
  // Closed aura windows — pairs APPLIED/REMOVED for BUFFs on player targets.
  // Serialized onto snapshots as `auras` for the client's buffs metric.
  auraWindows: AuraWindow[]
  // In-flight aura bookkeeping keyed by `${casterGuid}|${targetGuid}|${spellId}`.
  // A matching REMOVED moves the entry into auraWindows; still-open entries at
  // snapshot time are materialized with `end = segEnd`. Implicit REFRESHes
  // (APPLIED when already open) are dropped in v1.
  openAuras: Map<string, AuraOpen>
}

// Derived values computed at read time, not stored.
// firstDamageTime/lastDamageTime/firstHealTime/lastHealTime are internal
// bookkeeping for the gap-stitched activeTime merge — not useful to clients,
// so they're stripped at the snapshot boundary (see toSnapshot / toKeyRunSnapshot).
// damageActiveMs / healActiveMs are kept on the wire for potential future
// "Active %" display — they are NOT used as the DPS/HPS divisor (WCL uses
// shared fight duration for that).
export interface PlayerSnapshot extends Omit<PlayerData, 'firstDamageTime' | 'lastDamageTime' | 'firstHealTime' | 'lastHealTime'> {
  dps: number
  hps: number
  // Seconds the player was alive-and-contributing, summed per segment so each
  // pull "reactivates" them. Within a segment: if they acted (damage/heal) after
  // their last death they must have rezzed, so we credit the full segment; if
  // not, we credit up to their last death. Drives the Active % column.
  activeSec: number
}

// Materialize an AuraWindow list for a segment at a given cutoff time —
// all closed windows plus the still-open entries in openAuras rendered with
// `end = cutoffMs` and `stillOpen = true`. Does NOT mutate segment state, so
// a running segment can be re-snapshotted with later cutoffs correctly.
export function materializeAuras(segment: Segment, cutoffMs: number): AuraWindow[] {
  const out: AuraWindow[] = []
  for (const w of segment.auraWindows) out.push(w)
  for (const open of segment.openAuras.values()) {
    if (open.start >= cutoffMs) continue  // pathological; should not happen
    out.push({
      spellId: open.spellId,
      spellName: open.spellName,
      caster: open.caster,
      target: open.target,
      start: open.start,
      end: cutoffMs,
      preExisting: false,
      stillOpen: true,
      refreshCount: open.refreshCount,
      targetHostile: open.targetHostile,
      kind: open.kind,
    })
  }
  return out
}

// Short-key wire shape — see AuraWindowWire comment in types.ts for the
// size rationale. `r` is omitted when zero to shave bytes off the common case
// (personal procs, fire-and-forget raid buffs) where refresh never happens.
export function auraWindowsToWire(windows: AuraWindow[]): AuraWindowWire[] {
  const out: AuraWindowWire[] = new Array(windows.length)
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const wire: AuraWindowWire = { id: w.spellId, n: w.spellName, c: w.caster, d: w.target, s: w.start, e: w.end }
    if (w.refreshCount > 0) wire.r = w.refreshCount
    if (w.targetHostile) wire.h = 1
    if (w.kind === 'DEBUFF') wire.k = 1
    out[i] = wire
  }
  return out
}

// Classify each observed spellId into a display bucket for the buffs table.
//   personal — every window has caster === target (Soul Leech, Flurry Charge,
//              Metamorphosis). Player self-casts only, no external beneficiary.
//   raid     — at least one cast fan-out produced `minFanout` distinct ally
//              targets within a 100ms window. Captures Heroism, Battle Shout,
//              Devotion Aura, Stampeding Roar, Mark of the Wild, etc.
//   external — remainder: cross-target single-target casts (Power Infusion,
//              Ironbark, Innervate, Pain Suppression) and debuff-adjacent
//              buffs that don't fan out.
// Retroactively-seeded windows (preExisting) are excluded from the fan-out
// check — their start timestamps are synthesized to segStart and would
// collapse into a fake fan-out cluster.
//
// The fan-out threshold scales with party size. A fixed 5-target rule would
// require ALL five M+ party members to be hit by a single cast in the same
// 100ms bucket — achievable in theory but fragile (missed applications,
// pet-flag weirdness, clustered fan-out across two buckets). The formula
// gives 5 for raid (20+ allies), 4 for a full 5-player M+ party, and a
// floor of 3 so the heuristic stays meaningful in smaller groups.
export function classifyAuras(windows: AuraWindow[], allyNames: Set<string>): Record<string, BuffSection> {
  const minFanout = Math.min(5, Math.max(3, allyNames.size - 1))
  const bySpell = new Map<string, AuraWindow[]>()
  for (const w of windows) {
    // Debuffs don't fit the personal/raid/external taxonomy (no caster==target
    // self-cast semantics, no fan-out to allies). Skip them so their spellIds
    // don't collide with buff classifications under the same ID (can happen
    // when a spell has both buff and debuff components).
    if (w.kind === 'DEBUFF') continue
    let arr = bySpell.get(w.spellId)
    if (!arr) { arr = []; bySpell.set(w.spellId, arr) }
    arr.push(w)
  }

  const result: Record<string, BuffSection> = {}
  for (const [spellId, ws] of bySpell) {
    if (ws.every(w => w.caster === w.target)) {
      result[spellId] = 'personal'
      continue
    }

    // Fan-out: group by (caster, 100ms bucket of start). If any bucket has
    // minFanout+ distinct ally targets, this is a raid-wide cast. Personal
    // components of a shared cast (e.g. the shaman included in their own
    // Heroism) count too because the caster is in the ally set.
    const buckets = new Map<string, Set<string>>()
    for (const w of ws) {
      if (w.preExisting) continue
      const key = `${w.caster}|${Math.floor(w.start / 100)}`
      let set = buckets.get(key)
      if (!set) { set = new Set(); buckets.set(key, set) }
      if (allyNames.has(w.target)) set.add(w.target)
    }
    let isRaid = false
    for (const set of buckets.values()) {
      if (set.size >= minFanout) { isRaid = true; break }
    }
    result[spellId] = isRaid ? 'raid' : 'external'
  }
  return result
}

// Per-segment contribution to a player's activeSec. See PlayerSnapshot.activeSec
// for the model. `segStartMs` is seg.firstEventTime ?? seg.startTime; `segDurSec`
// is (segEnd - segStart)/1000. PlayerData `lastDamageTime`/`lastHealTime` give us
// "did they act after their last death?" without needing to walk events.
// Collect every spellId the client could render an icon for — ally
// ability maps, aura windows, AND every damage event's spellId. The events
// sweep is what picks up enemy-cast abilities (e.g. boss casts on allies);
// without it, the Damage Taken breakdown shows empty icon slots for every
// enemy ability. Cheap — a single pass over events, one Set insert per hit.
function collectIconSpellIds(
  players: Record<string, PlayerSnapshot>,
  auras: AuraWindow[],
  events: ClientEvent[],
): Set<string> {
  const ids = new Set<string>()
  for (const p of Object.values(players)) {
    for (const sid of Object.keys(p.damage.spells)) ids.add(sid)
    for (const sid of Object.keys(p.healing.spells)) ids.add(sid)
    for (const sid of Object.keys(p.interrupts.byKicker)) ids.add(sid)
    for (const sid of Object.keys(p.interrupts.byKicked)) ids.add(sid)
  }
  for (const w of auras) ids.add(w.spellId)
  for (const e of events) {
    if (e.spellId) ids.add(e.spellId)
  }
  return ids
}

export function segmentActiveSec(sp: PlayerData, segStartMs: number, segDurSec: number): number {
  if (sp.deaths.length === 0) return segDurSec
  const lastDeathMs = sp.deaths.reduce((m, d) => Math.max(m, d.timeOfDeath), 0)
  const lastActionMs = Math.max(sp.lastDamageTime ?? 0, sp.lastHealTime ?? 0)
  if (lastActionMs > lastDeathMs) return segDurSec  // rezzed and kept going
  const lastDeathElapsed = (lastDeathMs - segStartMs) / 1000
  return Math.max(0, Math.min(segDurSec, lastDeathElapsed))
}

export interface SegmentSnapshot extends Omit<Segment, 'players' | 'supportOwnedSpellIds' | 'bossHpTracker' | 'auraWindows' | 'openAuras'> {
  type: 'segment'
  duration: number
  players: Record<string, PlayerSnapshot>
  spellIcons: Record<string, string>   // spellId → Wowhead icon filename
  // events is inherited from Segment via the intersection with Omit; declared
  // explicitly here so the type is self-documenting at the snapshot boundary.
  events: ClientEvent[]
  // Aura windows flattened to wire shape. Materialized from segment.auraWindows
  // plus any still-open entries closed at segment end. Undefined when the
  // segment has no aura activity (e.g. pre-aura-tracking legacy segments).
  auras?: AuraWindowWire[]
  // Per-spellId classification bucket for the table's Personal/Raid/External
  // grouping. Present iff auras is present.
  buffClassification?: Record<string, BuffSection>
}

export interface SegmentSummary {
  type: 'segment'
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
  duration: number
  // Rounded boss HP % at the moment of a wipe. Carried onto the summary so the
  // segment-tab renderer can show "Pull N - 47%" without fetching the full
  // snapshot. Only set on wipes where advanced-log HP was available.
  bossHpPctAtWipe?: number
}

// Internal — not exported over the wire
interface BossSectionMeta {
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
}

export interface BossSectionSummary {
  type: 'boss_section'
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
  endTime: number | null
  segments: SegmentSummary[]
}

export interface BossSectionSnapshot {
  type: 'boss_section'
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
  endTime: number | null
  activeDurationSec: number
  pullCount: number
  kills: number
  players: Record<string, PlayerSnapshot>
  spellIcons: Record<string, string>
  events: ClientEvent[]
  auras?: AuraWindowWire[]
  buffClassification?: Record<string, BuffSection>
}

// Internal — not exported over the wire
interface KeyRunMeta {
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
}

export interface KeyRunSummary {
  type: 'key_run'
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
  segments: SegmentSummary[]
}

export interface KeyRunSnapshot {
  type: 'key_run'
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
  activeDurationSec: number          // sum of individual segment combat durations
  players: Record<string, PlayerSnapshot>
  spellIcons: Record<string, string> // spellId → Wowhead icon filename
  events: ClientEvent[]
  auras?: AuraWindowWire[]
  buffClassification?: Record<string, BuffSection>
}

export type HistoryItem = KeyRunSummary | BossSectionSummary | SegmentSummary

export class SegmentStore {
  private segments: Segment[] = []
  private maxSegments: number        // max history items (key runs + boss sections + standalone segments)
  private keyRunMeta: Map<string, KeyRunMeta> = new Map()
  private bossSectionMeta: Map<string, BossSectionMeta> = new Map()
  private iconResolver: IconResolver

  constructor(maxSegments: number, iconResolver: IconResolver) {
    this.maxSegments = maxSegments
    this.iconResolver = iconResolver
  }

  registerKeyRun(keyRunId: string, dungeonName: string, keystoneLevel: number, startTime: number) {
    this.keyRunMeta.set(keyRunId, {
      keyRunId,
      dungeonName,
      keystoneLevel,
      startTime,
      endTime: null,
      success: null,
      durationMs: null,
    })
  }

  registerBossSection(bossSectionId: string, encounterID: number, encounterName: string, difficultyID: number, startTime: number) {
    this.bossSectionMeta.set(bossSectionId, {
      bossSectionId,
      encounterID,
      encounterName,
      difficultyID,
      startTime,
    })
  }

  finalizeKeyRun(keyRunId: string, endTime: number, success: boolean | null, durationMs: number | null) {
    const meta = this.keyRunMeta.get(keyRunId)
    if (meta) {
      meta.endTime = endTime
      meta.success = success
      meta.durationMs = durationMs
    }
  }

  push(segment: Segment) {
    this.segments.push(segment)
    // Evict at key-run level: count distinct key runs + standalone segments
    while (this._historyItemCount() > this.maxSegments) {
      this._evictOldest()
    }
  }

  // Drops a segment that was pushed but turned out to be noise (e.g. a trash pack
  // opened by a stray DoT tick that never produced a kill). Caller is responsible
  // for cleaning up any references (activeTrashSegment, carryoverSeg) on their end.
  removeById(id: string): boolean {
    const idx = this.segments.findIndex(s => s.id === id)
    if (idx === -1) return false
    this.segments.splice(idx, 1)
    return true
  }

  private _historyItemCount(): number {
    const keyRunIds = new Set<string>()
    const bossSectionIds = new Set<string>()
    let standalone = 0
    for (const s of this.segments) {
      if (s.keyRunId) keyRunIds.add(s.keyRunId)
      else if (s.bossSectionId) bossSectionIds.add(s.bossSectionId)
      else standalone++
    }
    return keyRunIds.size + bossSectionIds.size + standalone
  }

  private _evictOldest() {
    if (this.segments.length === 0) return
    const oldest = this.segments[0]
    if (oldest.keyRunId) {
      const id = oldest.keyRunId
      this.segments = this.segments.filter(s => s.keyRunId !== id)
      this.keyRunMeta.delete(id)
    } else if (oldest.bossSectionId) {
      const id = oldest.bossSectionId
      this.segments = this.segments.filter(s => s.bossSectionId !== id)
      this.bossSectionMeta.delete(id)
    } else {
      this.segments.shift()
    }
  }

  getById(id: string): Segment | undefined {
    return this.segments.find(s => s.id === id)
  }

  getAll(): Segment[] {
    return [...this.segments]
  }

  getHistoryItems(): HistoryItem[] {
    // Single O(n) pass: group segments by container id, preserving insertion order
    const keySegments = new Map<string, SegmentSummary[]>()
    const bossSegments = new Map<string, SegmentSummary[]>()
    const order: Array<
      | { kind: 'key_run'; keyRunId: string }
      | { kind: 'boss_section'; bossSectionId: string }
      | { kind: 'segment'; summary: SegmentSummary }
    > = []

    for (const seg of this.segments) {
      if (seg.keyRunId) {
        if (!keySegments.has(seg.keyRunId)) {
          keySegments.set(seg.keyRunId, [])
          order.push({ kind: 'key_run', keyRunId: seg.keyRunId })
        }
        keySegments.get(seg.keyRunId)!.push(this.toSummary(seg))
      } else if (seg.bossSectionId) {
        if (!bossSegments.has(seg.bossSectionId)) {
          bossSegments.set(seg.bossSectionId, [])
          order.push({ kind: 'boss_section', bossSectionId: seg.bossSectionId })
        }
        bossSegments.get(seg.bossSectionId)!.push(this.toSummary(seg))
      } else {
        order.push({ kind: 'segment', summary: this.toSummary(seg) })
      }
    }

    return order.map<HistoryItem>(entry => {
      if (entry.kind === 'key_run') {
        const meta = this.keyRunMeta.get(entry.keyRunId)!
        return { type: 'key_run' as const, ...meta, segments: keySegments.get(entry.keyRunId)! }
      }
      if (entry.kind === 'boss_section') {
        const meta = this.bossSectionMeta.get(entry.bossSectionId)!
        const segs = bossSegments.get(entry.bossSectionId)!
        const lastEnd = segs.length > 0 ? segs[segs.length - 1].endTime : null
        return {
          type: 'boss_section' as const,
          bossSectionId: meta.bossSectionId,
          encounterID: meta.encounterID,
          encounterName: meta.encounterName,
          difficultyID: meta.difficultyID,
          startTime: meta.startTime,
          endTime: lastEnd,
          segments: segs,
        }
      }
      return entry.summary
    })
  }

  toBossSectionSnapshot(bossSectionId: string): BossSectionSnapshot | null {
    const meta = this.bossSectionMeta.get(bossSectionId)
    if (!meta) return null
    const segs = this.segments.filter(s => s.bossSectionId === bossSectionId)
    if (segs.length === 0) return null

    // Boss section DPS divisor: use the wall-clock span from first segment start
    // to last segment end, matching WCL's shared fight-duration approach.
    const lastEnd = segs[segs.length - 1].endTime ?? segs[segs.length - 1].lastEventTime
    const bossSectionSpanSec = lastEnd
      ? (lastEnd - meta.startTime) / 1000
      : undefined   // still in progress — fall back to activeDurationSec
    const { players, activeDurationSec } = this._mergeSegments(segs, bossSectionSpanSec)

    // Concat aura windows across segments and classify over the whole set so
    // fan-out detection works even if Heroism was cast in only one pull of
    // the section. Per-segment materialization uses each segment's own end
    // cutoff to correctly close still-open windows at segment boundaries.
    const allAuras = segs.flatMap(s => materializeAuras(s, s.endTime ?? s.lastEventTime ?? s.startTime))
    const auras = allAuras.length > 0 ? auraWindowsToWire(allAuras) : undefined
    const buffClassification = allAuras.length > 0
      ? classifyAuras(allAuras, new Set(Object.keys(players)))
      : undefined

    const events = segs.flatMap(s => s.events)
    this.iconResolver.requestMany(collectIconSpellIds(players, allAuras, events))
    return {
      type: 'boss_section',
      bossSectionId: meta.bossSectionId,
      encounterID: meta.encounterID,
      encounterName: meta.encounterName,
      difficultyID: meta.difficultyID,
      startTime: meta.startTime,
      endTime: lastEnd,
      activeDurationSec,
      pullCount: segs.length,
      kills: segs.filter(s => s.success === true).length,
      players,
      spellIcons: this.iconResolver.getAll(),
      events,
      auras,
      buffClassification,
    }
  }

  private _mergeSegments(segs: Segment[], overrideDurationSec?: number): { players: Record<string, PlayerSnapshot>; activeDurationSec: number } {
    const merged: Record<string, PlayerData> = {}
    // Per-player active seconds accumulator — reset-per-segment so a player who
    // dies in pull 1 still earns full credit for pull 2 where they rezzed.
    const activeSecByName: Record<string, number> = {}
    let activeDurationSec = 0

    for (const seg of segs) {
      const start = seg.firstEventTime ?? seg.startTime
      const end   = seg.endTime ?? seg.lastEventTime ?? start
      const segDurSec = (end - start) / 1000
      activeDurationSec += segDurSec

      for (const [name, sp] of Object.entries(seg.players)) {
        activeSecByName[name] = (activeSecByName[name] ?? 0) + segmentActiveSec(sp, start, segDurSec)
      }

      for (const [name, player] of Object.entries(seg.players)) {
        if (!merged[name]) {
          merged[name] = {
            name: player.name,
            specId: player.specId,
            damage: {
              total: player.damage.total,
              spells: Object.fromEntries(
                Object.entries(player.damage.spells).map(([k, v]) => [k, { ...v }])
              ),
              targets: Object.fromEntries(
                Object.entries(player.damage.targets).map(([k, v]) => [k, { ...v }])
              ),
            },
            healing: {
              total: player.healing.total,
              overheal: player.healing.overheal,
              spells: Object.fromEntries(
                Object.entries(player.healing.spells).map(([k, v]) => [k, { ...v }])
              ),
              targets: Object.fromEntries(
                Object.entries(player.healing.targets).map(([k, v]) => [k, { ...v }])
              ),
            },
            deaths: [...player.deaths],
            interrupts: {
              total: player.interrupts.total,
              attempts: player.interrupts.attempts,
              byKicker: Object.fromEntries(
                Object.entries(player.interrupts.byKicker).map(([k, v]) => [k, { ...v }])
              ),
              byKicked: Object.fromEntries(
                Object.entries(player.interrupts.byKicked).map(([k, v]) => [k, { ...v }])
              ),
              records: [...player.interrupts.records],
            },
            damageActiveMs: player.damageActiveMs,
            healActiveMs: player.healActiveMs,
            firstDamageTime: player.firstDamageTime,
            lastDamageTime: player.lastDamageTime,
            firstHealTime: player.firstHealTime,
            lastHealTime: player.lastHealTime,
          }
        } else {
          const mp = merged[name]
          if (mp.specId === undefined && player.specId !== undefined) {
            mp.specId = player.specId
          }
          mp.damage.total += player.damage.total
          mp.healing.total += player.healing.total
          mp.healing.overheal += player.healing.overheal

          // Merge per-player activeTime: sum the two segments' contributions, then
          // patch the cross-segment boundary — if (this segment's first event) -
          // (previous segment's last event) is within the gap threshold, WCL counts
          // that idle window as "active" too. For a key run, consecutive pulls (trash
          // → trash) are typically <10s apart; big boss gaps naturally exceed the
          // threshold and are correctly excluded.
          if (mp.lastDamageTime !== null && player.firstDamageTime !== null) {
            const crossGap = player.firstDamageTime - mp.lastDamageTime
            if (crossGap > 0 && crossGap <= ACTIVE_TIME_GAP_MS) {
              mp.damageActiveMs += crossGap
            }
          }
          mp.damageActiveMs += player.damageActiveMs
          if (player.firstDamageTime !== null) {
            if (mp.firstDamageTime === null) mp.firstDamageTime = player.firstDamageTime
            mp.lastDamageTime = player.lastDamageTime
          }

          if (mp.lastHealTime !== null && player.firstHealTime !== null) {
            const crossGap = player.firstHealTime - mp.lastHealTime
            if (crossGap > 0 && crossGap <= ACTIVE_TIME_GAP_MS) {
              mp.healActiveMs += crossGap
            }
          }
          mp.healActiveMs += player.healActiveMs
          if (player.firstHealTime !== null) {
            if (mp.firstHealTime === null) mp.firstHealTime = player.firstHealTime
            mp.lastHealTime = player.lastHealTime
          }

          for (const [sid, spell] of Object.entries(player.damage.spells)) {
            const ms = mp.damage.spells[sid]
            if (!ms) {
              mp.damage.spells[sid] = { ...spell }
            } else {
              ms.total += spell.total
              ms.hitCount += spell.hitCount
              ms.critCount += spell.critCount
              ms.normalTotal += spell.normalTotal
              ms.normalMin = Math.min(ms.normalMin, spell.normalMin)
              ms.normalMax = Math.max(ms.normalMax, spell.normalMax)
              ms.critTotal += spell.critTotal
              ms.critMin = Math.min(ms.critMin, spell.critMin)
              ms.critMax = Math.max(ms.critMax, spell.critMax)
              ms.absorbed += spell.absorbed
              ms.resisted += spell.resisted
              ms.blocked += spell.blocked
            }
          }

          for (const [sid, spell] of Object.entries(player.healing.spells)) {
            const ms = mp.healing.spells[sid]
            if (!ms) {
              mp.healing.spells[sid] = { ...spell }
            } else {
              ms.total += spell.total
              ms.overheal += spell.overheal
              ms.absorbed += spell.absorbed
              ms.hitCount += spell.hitCount
              ms.critCount += spell.critCount
            }
          }

          for (const [tname, target] of Object.entries(player.healing.targets)) {
            const mt = mp.healing.targets[tname]
            if (!mt) {
              mp.healing.targets[tname] = { ...target }
            } else {
              mt.total += target.total
              mt.overheal += target.overheal
            }
          }

          for (const [tname, target] of Object.entries(player.damage.targets)) {
            const mt = mp.damage.targets[tname]
            if (!mt) {
              mp.damage.targets[tname] = { ...target }
            } else {
              mt.total += target.total
            }
          }

          mp.deaths.push(...player.deaths)

          mp.interrupts.total += player.interrupts.total
          mp.interrupts.attempts += player.interrupts.attempts
          for (const [sid, s] of Object.entries(player.interrupts.byKicker)) {
            const existing = mp.interrupts.byKicker[sid]
            if (!existing) {
              mp.interrupts.byKicker[sid] = { ...s }
            } else {
              existing.count += s.count
              if (s.casts !== undefined) existing.casts = (existing.casts ?? 0) + s.casts
            }
          }
          for (const [sid, s] of Object.entries(player.interrupts.byKicked)) {
            const existing = mp.interrupts.byKicked[sid]
            if (!existing) mp.interrupts.byKicked[sid] = { ...s }
            else existing.count += s.count
          }
          mp.interrupts.records.push(...player.interrupts.records)
        }
      }
    }

    // Backfill specId from guidToSpec/guidToName for any players still missing it.
    // This covers the case where a player's damage events arrived before COMBATANT_INFO
    // in every segment they appeared in, but guidToSpec was populated later in that
    // segment (or in a different segment entirely).
    for (const seg of segs) {
      for (const [guid, specId] of Object.entries(seg.guidToSpec)) {
        const name = seg.guidToName[guid]
        if (name && merged[name] && merged[name].specId === undefined) {
          merged[name].specId = specId
        }
      }
    }

    for (const mp of Object.values(merged)) {
      mp.deaths.sort((a, b) => a.timeOfDeath - b.timeOfDeath)
      mp.interrupts.records.sort((a, b) => a.timeOfInterrupt - b.timeOfInterrupt)
    }

    // DPS/HPS divisor: WCL's table uses the shared fight/key-run duration for all
    // players, NOT per-player activeTime. The per-player activeTime is accurate
    // (verified byte-perfect against WCL API) but WCL uses it only for "Active %"
    // display, not the main DPS column. Callers pass overrideDurationSec when they
    // have a container-level span (key run duration, boss section span); otherwise
    // we fall back to the sum-of-segments activeDurationSec.
    //
    // NOTE: We previously used per-player activeTime here (commit daaedab) and DPS
    // was ~20% higher than WCL's table (e.g. 122K vs 102.9K for Adrianw on
    // dpyDWNGb84zFrn3H). WCL's API *does* return per-player activeTime, so it's
    // unclear why the website table uses fight duration instead — it may be a
    // deliberate UX choice, or WCL may do post-processing that changes the divisor
    // after initial upload. If DPS drifts from WCL again in the future, check
    // whether WCL has started using activeTime as the divisor.
    const durationSec = overrideDurationSec ?? activeDurationSec

    const players: Record<string, PlayerSnapshot> = {}
    for (const [name, player] of Object.entries(merged)) {
      // Strip the internal first*/last* timestamps — they're bookkeeping for the
      // gap-stitched merge above and don't belong on the wire.
      const { firstDamageTime: _fdt, lastDamageTime: _ldt, firstHealTime: _fht, lastHealTime: _lht, ...rest } = player
      players[name] = {
        ...rest,
        dps: durationSec > 0 ? player.damage.total / durationSec : 0,
        hps: durationSec > 0 ? player.healing.total / durationSec : 0,
        activeSec: activeSecByName[name] ?? 0,
      }
    }
    return { players, activeDurationSec }
  }

  toKeyRunSnapshot(keyRunId: string): KeyRunSnapshot | null {
    const meta = this.keyRunMeta.get(keyRunId)
    if (!meta) return null
    const segs = this.segments.filter(s => s.keyRunId === keyRunId)
    if (segs.length === 0) return null

    // Key run DPS divisor: use the wall-clock key run span (CHALLENGE_MODE_START
    // to CHALLENGE_MODE_END) — this matches WCL's "Total Active" / fight duration
    // shown in the damage table (e.g. 1,126.4s for dpyDWNGb84zFrn3H fight 1).
    const keyRunSpanSec = meta.endTime
      ? (meta.endTime - meta.startTime) / 1000
      : undefined   // key still in progress — fall back to activeDurationSec
    const { players, activeDurationSec } = this._mergeSegments(segs, keyRunSpanSec)

    const allAuras = segs.flatMap(s => materializeAuras(s, s.endTime ?? s.lastEventTime ?? s.startTime))
    const auras = allAuras.length > 0 ? auraWindowsToWire(allAuras) : undefined
    const buffClassification = allAuras.length > 0
      ? classifyAuras(allAuras, new Set(Object.keys(players)))
      : undefined

    const events = segs.flatMap(s => s.events)
    this.iconResolver.requestMany(collectIconSpellIds(players, allAuras, events))

    return {
      type: 'key_run',
      ...meta,
      activeDurationSec,
      players,
      spellIcons: this.iconResolver.getAll(),
      events,
      auras,
      buffClassification,
    }
  }

  toSnapshot(segment: Segment): SegmentSnapshot {
    // Duration spans only actual combat events — stable when idle, accurate when fighting
    const start = segment.firstEventTime ?? segment.startTime
    const end   = segment.endTime ?? segment.lastEventTime ?? start
    const duration = (end - start) / 1000
    const players: Record<string, PlayerSnapshot> = {}

    // Resolve specId from guidToSpec for any players still missing it
    // (e.g. damage events arrived before COMBATANT_INFO in this segment).
    for (const [guid, specId] of Object.entries(segment.guidToSpec)) {
      const name = segment.guidToName[guid]
      if (name && segment.players[name] && segment.players[name].specId === undefined) {
        segment.players[name].specId = specId
      }
    }

    for (const [name, player] of Object.entries(segment.players)) {
      // Strip internal first*/last* timestamps (see _mergeSegments for the same spread).
      const { firstDamageTime: _fdt, lastDamageTime: _ldt, firstHealTime: _fht, lastHealTime: _lht, ...rest } = player
      players[name] = {
        ...rest,
        dps: duration > 0 ? player.damage.total / duration : 0,
        hps: duration > 0 ? player.healing.total / duration : 0,
        activeSec: segmentActiveSec(player, start, duration),
      }
    }

    const segEnd = segment.endTime ?? segment.lastEventTime ?? start
    const materialAuras = materializeAuras(segment, segEnd)
    const auras = materialAuras.length > 0 ? auraWindowsToWire(materialAuras) : undefined
    const buffClassification = materialAuras.length > 0
      ? classifyAuras(materialAuras, new Set(Object.keys(players)))
      : undefined

    this.iconResolver.requestMany(collectIconSpellIds(players, materialAuras, segment.events))

    const {
      supportOwnedSpellIds: _supportOwned,
      bossHpTracker: _bossHp,
      auraWindows: _auraWindows,
      openAuras: _openAuras,
      ...segmentRest
    } = segment
    return {
      type: 'segment' as const,
      ...segmentRest,
      duration,
      players,
      spellIcons: this.iconResolver.getAll(),
      auras,
      buffClassification,
    }
  }

  toSummary(segment: Segment): SegmentSummary {
    const start = segment.firstEventTime ?? segment.startTime
    const end   = segment.endTime ?? segment.lastEventTime ?? start
    const summary: SegmentSummary = {
      type: 'segment',
      id: segment.id,
      encounterName: segment.encounterName,
      startTime: segment.startTime,
      endTime: segment.endTime,
      success: segment.success,
      duration: (end - start) / 1000,
    }
    if (segment.bossHpPctAtWipe !== undefined) summary.bossHpPctAtWipe = segment.bossHpPctAtWipe
    return summary
  }
}
