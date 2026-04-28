import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ParsedEvent, EncounterPayload, ChallengeModePayload, DamagePayload, UnitRef } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'
import { SegmentStore, type Segment } from './store.js'
import { applyEvent, resetRecentEvents } from './aggregator.js'

type Mode = 'idle' | 'in_key' | 'in_boss'

const PLAYER_FLAG       = 0x400     // COMBATLOG_OBJECT_TYPE_PLAYER
const REACTION_HOSTILE  = 0x40      // COMBATLOG_OBJECT_REACTION_HOSTILE
const OWNED_UNIT_FLAGS  = PET_FLAG | GUARDIAN_FLAG | PLAYER_FLAG

// Per-mob state kept only while a trash pack is open. Reset to empty between packs.
interface TrashMobInfo {
  name: string
  maxHP: number          // highest observed max HP (never decreases)
  lastHPpct: number      // most recent currentHP/maxHP ratio; 1.0 if unknown
  lastEventTime: number  // timestamp (ms) of the most recent event involving this mob
}

// If a tracked mob has had no events for this long, assume it despawned, leashed,
// or was skipped without firing UNIT_DIED, and evict it. Needed for NPX-style mobs
// (e.g. Lingering Image) that dissipate silently — without this, a single ghost
// entry keeps activeMobs non-empty for the rest of the key and prevents new packs
// from opening.
const MOB_INACTIVITY_TIMEOUT_MS = 15_000

// A unit is a hostile NPC if it carries the hostile reaction flag and isn't itself a
// player/pet/guardian. Vehicle- GUIDs (boss-controlled mounts like Ick) also qualify.
function isHostileMob(unit: UnitRef): boolean {
  if (!(unit.flags & REACTION_HOSTILE)) return false
  if (unit.flags & OWNED_UNIT_FLAGS) return false
  return unit.guid.startsWith('Creature-') || unit.guid.startsWith('Vehicle-')
}

export class EncounterStateMachine extends EventEmitter {
  private store: SegmentStore
  private mode: Mode = 'idle'
  // Most recently created trash segment in the current key — kept alive across boss
  // fights (boss ENCOUNTER_* doesn't clear it) so challenge_end can emit it to
  // listeners. Reset to null only at CHALLENGE_MODE_END.
  private activeTrashSegment: Segment | null = null
  // Snapshot of activeTrashSegment immediately before the current pack opened.
  // Used to revert when a pack is discarded (stray-event open with no real combat),
  // so currentSegment / activeTrashSegment stay pointed at a real in-store pack
  // for transit-event routing after boss/pack closes.
  private priorActiveTrashSegment: Segment | null = null
  private dungeonName: string | null = null
  private packCount = 0                              // sequential pack number within the current key
  private currentKeyRunId: string | null = null
  private activeBossSectionId: string | null = null      // contiguous raid-boss grouping (outside M+)
  private activeBossSectionEncounterID: number | null = null
  // Per-pack mob tracking — cleared when a pack opens, populated as mobs appear,
  // drained as mobs die. Empty set while a pack is open → pack just ended.
  private activeMobs: Map<string, TrashMobInfo> = new Map()
  // Highest-max-HP mob observed in the current pack, used to name the segment at finalize.
  private currentPackHighestHpMob: { name: string; maxHP: number } | null = null
  // Whether any tracked mob died inside the current pack. Packs that close via
  // inactivity prune with no kills are treated as noise (stray DoT tick on a
  // distant mob, etc.) and discarded rather than shown as empty segments.
  private currentPackHadKill = false
  // Most recent segment (trash OR boss) in the current key — seeds guidToSpec /
  // guidToName / petToOwner on the next trash pack. Decoupled from currentSegment
  // because currentSegment may be a closed prior pack between pulls, and we want
  // the metadata chain to follow segment-creation order.
  private carryoverSeg: Segment | null = null
  // Segment receiving events right now. Between pulls inside an M+ key this points
  // at the just-closed prior trash pack (endTime set) so transit events — heals,
  // pre-pots, off-cooldown casts — accumulate against that pack instead of being
  // silently dropped. _trackTrashMobs uses endTime !== null to detect "stale" and
  // open a fresh pack on the next damage event.
  currentSegment: Segment | null = null

  constructor(store: SegmentStore) {
    super()
    this.store = store
  }

  handle(event: ParsedEvent) {
    switch (event.type) {
      case 'CHALLENGE_MODE_START': {
        if (this.mode !== 'idle') break
        // Entering a dungeon closes any open raid boss section
        this.activeBossSectionId = null
        this.activeBossSectionEncounterID = null
        const p = event.payload as ChallengeModePayload
        this.dungeonName = p.dungeonName ?? null
        this.packCount = 1

        const keyRunId = randomUUID()
        this.currentKeyRunId = keyRunId
        this.store.registerKeyRun(
          keyRunId,
          p.dungeonName ?? 'Unknown',
          p.keystoneLevel ?? 0,
          event.timestamp,
        )

        // Open an initial pack segment so early events (COMBATANT_INFO, pre-pull buffs)
        // have somewhere to land. It'll be renamed from the placeholder to
        // "Pack 1: <highest-HP mob>" when finalized — see _applyFinalPackName.
        const segment = this._makeSegment(this._packPlaceholderName(this.packCount), event.timestamp)
        this.store.push(segment)
        this.activeTrashSegment = segment
        this.currentSegment = segment
        this.carryoverSeg = segment
        this.activeMobs.clear()
        this.currentPackHighestHpMob = null
        this.currentPackHadKill = false
        this.mode = 'in_key'
        console.log(`[key] START — ${p.dungeonName} +${p.keystoneLevel}`)
        this.emit('challenge_start', segment)
        break
      }

      case 'CHALLENGE_MODE_END': {
        if (this.mode === 'idle') break  // orphaned END from a previous aborted key — ignore
        const p = event.payload as ChallengeModePayload
        // Key ended mid-boss (timer expired or force-restart) — close the boss segment first
        if (this.mode === 'in_boss' && this.currentSegment) {
          this.currentSegment.endTime = event.timestamp
          this.currentSegment.success = false
          this.emit('encounter_end', this.currentSegment)
        }
        if (this.activeTrashSegment) {
          // Only finalize the trash segment if it's still live — i.e. it never got
          // an endTime from a prior UNIT_DIED, reset, or ENCOUNTER_START. A closed
          // pack may still be referenced by currentSegment (transit-events routing),
          // but we don't want to bump its endTime out to CHALLENGE_MODE_END time —
          // that would inflate its duration by all the post-kill / post-boss gap.
          if (this.currentSegment === this.activeTrashSegment && this.activeTrashSegment.endTime === null) {
            this.activeTrashSegment.endTime = event.timestamp
            this.activeTrashSegment.success = p.success ?? false
            this._applyFinalPackName(this.activeTrashSegment)
          }
          console.log(`[key] END (${p.success ? 'timed' : 'depleted'}, ${((p.durationMs ?? 0) / 60000).toFixed(1)}m)`)
        }
        // Finalize key run metadata now that we have end time and outcome
        if (this.currentKeyRunId) {
          this.store.finalizeKeyRun(
            this.currentKeyRunId,
            event.timestamp,
            p.success ?? null,
            p.durationMs ?? null,
          )
        }
        // Emit challenge_end with last trash segment for wsServer to broadcast updated list
        // TODO: handle key abandon / disconnect — endTime and success will be null in those cases.
        //       Revisit when we have a sample log from an abandoned key.
        this.emit('challenge_end', this.activeTrashSegment)
        this.activeTrashSegment = null
        this.dungeonName = null
        this.packCount = 0
        this.currentKeyRunId = null
        this.currentSegment = null
        this.carryoverSeg = null
        this.activeMobs.clear()
        this.currentPackHighestHpMob = null
        this.mode = 'idle'
        break
      }

      case 'ENCOUNTER_START': {
        if (this.mode === 'in_boss') break  // shouldn't happen, but guard against nested events
        const p = event.payload as EncounterPayload

        // Close any open trash pack before entering the boss fight. Keep the
        // activeTrashSegment reference intact (it's the "most recent trash" used
        // by challenge_end); the pack is marked closed via endTime + success.
        // An unnamed pack (no HP-bearing damage ever landed on a tracked mob)
        // opened by _openTrashPack is noise and gets discarded here too —
        // happens when e.g. a stray pre-pull tick opens a pack just before boss.
        // The initial Pack 1 from CHALLENGE_MODE_START (packCount===1) is always
        // kept as the placeholder.
        // Only act on the trash pack if it's still live (no prior UNIT_DIED has
        // closed it). A closed pack is still referenced by currentSegment for
        // transit events, but we must not re-evaluate it here — currentPackHighestHpMob
        // was already cleared at the prior close, so the discard branch would
        // wrongly fire and erase a perfectly good named pack.
        if (this.activeTrashSegment && this.currentSegment === this.activeTrashSegment && this.activeTrashSegment.endTime === null) {
          if (this.currentPackHighestHpMob || this.packCount === 1) {
            this.activeTrashSegment.endTime = event.timestamp
            this.activeTrashSegment.success = true
            this._applyFinalPackName(this.activeTrashSegment)
          } else {
            console.log(`[pack] DISCARD (unnamed, boss pull) — was "${this.activeTrashSegment.encounterName}"`)
            this.store.removeById(this.activeTrashSegment.id)
            this.packCount--
            this.activeTrashSegment = this.priorActiveTrashSegment
            this.priorActiveTrashSegment = null
          }
        }
        this.activeMobs.clear()
        this.currentPackHighestHpMob = null

        // For standalone raid pulls (no active M+ run), group contiguous same-encounter pulls
        // into a boss section. A different encounterID closes the prior section and opens a new one.
        if (!this.currentKeyRunId) {
          if (this.activeBossSectionId === null || this.activeBossSectionEncounterID !== p.encounterID) {
            const sectionId = randomUUID()
            this.store.registerBossSection(sectionId, p.encounterID, p.encounterName, p.difficultyID, event.timestamp)
            this.activeBossSectionId = sectionId
            this.activeBossSectionEncounterID = p.encounterID
          }
        }

        const segment = this._makeSegment(p.encounterName, event.timestamp, p.encounterID)
        // Carry over spec/name/pet info from the most recently closed segment (trash
        // or prior boss). Falls back to currentSegment if the carryover ref is stale
        // (e.g. first boss in a raid context with no prior trash).
        const src = this.carryoverSeg ?? this.currentSegment
        if (src) {
          segment.guidToSpec = { ...src.guidToSpec }
          segment.guidToName = { ...src.guidToName }
          segment.petToOwner = { ...src.petToOwner }
        }
        this.store.push(segment)
        this.currentSegment = segment
        this.carryoverSeg = segment
        this.mode = 'in_boss'
        console.log(`[boss] START — ${p.encounterName}`)
        this.emit('encounter_start', segment)
        break
      }

      case 'ENCOUNTER_END': {
        if (this.mode !== 'in_boss') break
        const p = event.payload as EncounterPayload
        if (this.currentSegment) {
          this.currentSegment.endTime = event.timestamp
          this.currentSegment.success = p.success ?? false
          // Snapshot boss HP at wipe. Only emitted on wipes; kills are at 0%
          // by definition and in-progress segments don't get a summary here.
          // Missing tracker (no advanced log) leaves the field undefined and
          // the tab falls back to the plain "Pull N" label.
          if (this.currentSegment.success === false && this.currentSegment.bossHpTracker) {
            const t = this.currentSegment.bossHpTracker
            if (t.maxHP > 0) {
              this.currentSegment.bossHpPctAtWipe = Math.max(0, Math.min(100, Math.round((t.lastHP / t.maxHP) * 100)))
            }
          }
          console.log(`[boss] END — ${this.currentSegment.encounterName} (${p.success ? 'kill' : 'wipe'})`)
          this.emit('encounter_end', this.currentSegment)
        }
        // Return to key with no active pack (next hostile event will open one),
        // or go idle for standalone raid bosses. activeTrashSegment stays pointing
        // at the prior trash (for challenge_end) until a new pack replaces it.
        if (this.dungeonName) {
          // Spec/name/pet info from the boss fight seeds the NEXT trash pack when
          // the first hostile mob event opens it — see _openTrashPack.
          // Route transit events (between boss-end and next pull) to the prior
          // trash pack instead of dropping them. The pack stays closed (endTime
          // already set); _trackTrashMobs detects the closed state to know when
          // to open a new one.
          this.currentSegment = this.activeTrashSegment
          this.activeMobs.clear()
          this.currentPackHighestHpMob = null
          this.mode = 'in_key'
        } else {
          this.currentSegment = null
          this.mode = 'idle'
        }
        break
      }

      default: {
        if (this.mode === 'in_key') {
          this._trackTrashMobs(event)
        }
        if (this.currentSegment) {
          applyEvent(this.currentSegment, event)
          if (this.mode === 'in_boss') {
            this._trackBossHp(this.currentSegment, event)
          }
        }
        break
      }
    }
  }

  // Per-mob HP tracking for M+ trash pack detection. A pack opens when the first
  // hostile mob event arrives in 'in_key' mode with no active pack, and closes when
  // either all tracked mobs die (success) or a tracked mob's HP jumps back to ~full
  // without dying (wipe/reset — the group died and the mob leashed back).
  //
  // Only runs inside M+ keys (currentKeyRunId set). Raid trash is left as a single
  // blob under the boss section as before.
  //
  // Invariant: activeMobs is empty whenever currentSegment is null OR closed
  // (endTime set). Violating this would cause reset detection to fire against
  // stale pre-pack state. All paths that null/close currentSegment also clear
  // activeMobs (or leave it already empty).
  private _trackTrashMobs(event: ParsedEvent): void {
    if (!this.currentKeyRunId) return

    // UNIT_DIED on a tracked hostile mob → remove from active set. If the set
    // empties, the pack is finished (kill). activeTrashSegment keeps pointing at
    // the just-closed pack and currentSegment stays pointed at it too — transit
    // events accumulate against that pack until the next hostile event opens a
    // new one (detected via endTime !== null in _openTrashPack's trigger below).
    if (event.type === 'UNIT_DIED') {
      if (!this.activeMobs.has(event.dest.guid)) return
      this.activeMobs.delete(event.dest.guid)
      this.currentPackHadKill = true
      if (this.activeMobs.size === 0 && this.activeTrashSegment && this.currentSegment === this.activeTrashSegment) {
        if (this.currentPackHighestHpMob || this.packCount === 1) {
          // Named pack, or the initial CHALLENGE_MODE_START placeholder Pack 1
          // (always kept even when it only sees mob-source events, to hold early
          // key metadata like COMBATANT_INFO).
          this.activeTrashSegment.endTime = event.timestamp
          this.activeTrashSegment.success = true
          this._applyFinalPackName(this.activeTrashSegment)
          console.log(`[pack] CLOSE (kill) — ${this.activeTrashSegment.encounterName}`)
          this.emit('pack_changed', this.activeTrashSegment)
        } else {
          // No HP-bearing damage ever landed on a tracked mob — the whole "pack"
          // was mob-source-only events (e.g. a stray swing on a player from a
          // distant mob that then died). Treat as noise, same as the inactivity-
          // with-no-kill path.
          console.log(`[pack] DISCARD (unnamed) — was "${this.activeTrashSegment.encounterName}"`)
          this.store.removeById(this.activeTrashSegment.id)
          this.packCount--
          this.emit('pack_changed', this.activeTrashSegment)
          this.activeTrashSegment = this.priorActiveTrashSegment
          this.priorActiveTrashSegment = null
          this.currentSegment = this.activeTrashSegment
        }
        this.currentPackHighestHpMob = null
      }
      return
    }

    // Only damage-family events identify a hostile mob reliably enough for tracking.
    // Deaths are handled above; auras/casts can land on tricky unit types and aren't
    // needed to bound the pack.
    if (event.type !== 'SPELL_DAMAGE'
     && event.type !== 'SPELL_PERIODIC_DAMAGE'
     && event.type !== 'RANGE_DAMAGE'
     && event.type !== 'SWING_DAMAGE'
     && event.type !== 'SWING_DAMAGE_LANDED') {
      return
    }

    const destIsMob   = isHostileMob(event.dest)
    const sourceIsMob = isHostileMob(event.source)
    if (!destIsMob && !sourceIsMob) return

    // Track whichever side is the hostile mob. HP snapshot is only reliable when the
    // mob is the dest of a SPELL/RANGE damage event (parser populates dest HP there).
    const mobUnit = destIsMob ? event.dest : event.source
    let currentHP: number | null = null
    let maxHP: number | null = null
    if (destIsMob && event.payload.type === 'damage') {
      const p = event.payload as DamagePayload
      if (p.destMaxHP !== undefined && p.destMaxHP > 0 && p.destCurrentHP !== undefined) {
        currentHP = p.destCurrentHP
        maxHP = p.destMaxHP
      }
    }

    // Overkill damage on an already-dead mob. Pets and DoTs can land ticks on a mob
    // AFTER its UNIT_DIED fires — the event arrives with currentHP=0 on a GUID that's
    // not in activeMobs. Without this guard, that ghost tick between bosses would
    // open a spurious tiny pack (e.g. "Pack N: Umbral Tentacle" that's <1s long)
    // before the next ENCOUNTER_START closes it.
    if (currentHP === 0 && !this.activeMobs.has(mobUnit.guid)) return

    // Reset detection — simplified v1 heuristic: HP jumps to ≥95% on a mob that was
    // recently at <90%. WoW leash mechanics always heal mobs to full on reset, so this
    // catches wipes where the group died, mobs leashed back, and the group re-engaged.
    //
    // NOTE: May need expansion if edge cases surface:
    //   - Known blind spot: if a mob never drops below 90% before a wipe (e.g. very
    //     short/one-shot pulls, or phases where the mob is briefly untargetable), the
    //     detector never arms and the reset goes undetected. Narrowing the gap to
    //     e.g. <0.95 would help but increases Bolstering-heal false positives.
    //   - Partial-increase resets (none observed yet; leash always heals to full)
    //   - Bolstering affix / mob self-heals — legitimate HP increases; reconcile with
    //     SPELL_HEAL events on the same GUID if false positives emerge
    //   - Evades/leashes without a wipe (accidental body pulls) — should trigger the
    //     same detection, which is what we want
    //   - Per-mob inactivity gap as a secondary signal — deferred until needed
    // See references/m-plus-trash-pull-detection.md for the full rationale.
    if (currentHP !== null && maxHP !== null) {
      const existing = this.activeMobs.get(mobUnit.guid)
      if (existing && existing.lastHPpct < 0.9 && currentHP / maxHP >= 0.95) {
        if (this.activeTrashSegment && this.currentSegment === this.activeTrashSegment) {
          this.activeTrashSegment.endTime = event.timestamp
          this.activeTrashSegment.success = false
          this._applyFinalPackName(this.activeTrashSegment)
          console.log(`[pack] CLOSE (reset) — ${this.activeTrashSegment.encounterName}`)
          this.currentPackHighestHpMob = null
          this.emit('pack_changed', this.activeTrashSegment)
        }
        // All ghost active mobs reset with the wipe — the re-engage starts fresh
        this.activeMobs.clear()
      }
    }

    // Inactivity prune — evict any tracked mob whose last event is older than the
    // timeout. Catches mobs that despawn, leash, or get skipped past without firing
    // UNIT_DIED (e.g. NPX's Lingering Image). Only close the pack if eviction
    // happened AND the set is now empty — without the eviction guard, the very
    // first damage event on a freshly-opened pack would close it immediately
    // (activeMobs started empty, prune changes nothing, the size-0 check still
    // matches).
    let evicted = false
    let latestEvictedEventTime = 0
    for (const [guid, info] of this.activeMobs) {
      if (event.timestamp - info.lastEventTime > MOB_INACTIVITY_TIMEOUT_MS) {
        this.activeMobs.delete(guid)
        evicted = true
        if (info.lastEventTime > latestEvictedEventTime) latestEvictedEventTime = info.lastEventTime
      }
    }
    if (evicted && this.activeMobs.size === 0 && this.activeTrashSegment && this.currentSegment === this.activeTrashSegment) {
      if (this.currentPackHadKill) {
        // End the pack at the last evicted mob's final event, not `now` — the gap
        // between that time and `now` is dead air, not part of the pack.
        this.activeTrashSegment.endTime = latestEvictedEventTime
        this.activeTrashSegment.success = true
        this._applyFinalPackName(this.activeTrashSegment)
        console.log(`[pack] CLOSE (inactivity) — ${this.activeTrashSegment.encounterName}`)
        this.emit('pack_changed', this.activeTrashSegment)
      } else {
        // No mob died in this pack — it was a stray DoT / ambient tick that opened
        // a pack with nothing real in it. Drop the segment from the store and roll
        // back the counter so the next legit pack reuses this number. Leave the
        // in-memory Segment object referenced by carryoverSeg/activeTrashSegment
        // untouched — its guidToSpec still seeds the next real pack correctly.
        console.log(`[pack] DISCARD (empty) — was "${this.activeTrashSegment.encounterName}"`)
        this.store.removeById(this.activeTrashSegment.id)
        this.packCount--
        this.emit('pack_changed', this.activeTrashSegment)
        this.activeTrashSegment = this.priorActiveTrashSegment
        this.priorActiveTrashSegment = null
        this.currentSegment = this.activeTrashSegment
      }
      this.currentPackHighestHpMob = null
    }

    // If no pack is currently accepting events (post-reset, post-UNIT_DIED, or
    // post-ENCOUNTER_END), open a new one starting now. The activeTrashSegment
    // reference gets overwritten to point at the new pack. A non-null
    // currentSegment with endTime set means we're routing transit events to a
    // closed prior pack — that pack stays "live" only for accumulation, and a
    // real pull replaces it here.
    //
    // Only open on evidence of real combat: a destination-side hostile mob hit
    // with known maxHP. Source-side ticks (a boss DoT still pulsing on a player
    // after ENCOUNTER_END, a wandering mob's auto-attack) carry no HP info and
    // would otherwise open an orphan pack that gets discarded later — but any
    // transit events caught in that orphan window are lost when the segment is
    // removed from the store.
    if ((!this.currentSegment || this.currentSegment.endTime !== null)
        && destIsMob && maxHP !== null && maxHP > 0) {
      this._openTrashPack(event.timestamp)
    }

    // Update mob state in the active set
    const prev = this.activeMobs.get(mobUnit.guid)
    const newMaxHP = (maxHP && maxHP > 0) ? maxHP : (prev?.maxHP ?? 0)
    const newPct   = (currentHP !== null && maxHP !== null && maxHP > 0)
                       ? currentHP / maxHP
                       : (prev?.lastHPpct ?? 1.0)
    if (prev) {
      if (newMaxHP > prev.maxHP) prev.maxHP = newMaxHP
      prev.lastHPpct = newPct
      prev.lastEventTime = event.timestamp
    } else {
      this.activeMobs.set(mobUnit.guid, { name: mobUnit.name, maxHP: newMaxHP, lastHPpct: newPct, lastEventTime: event.timestamp })
    }

    // Track the highest-max-HP mob in this pack for naming at finalize time
    if (newMaxHP > 0 && (!this.currentPackHighestHpMob || newMaxHP > this.currentPackHighestHpMob.maxHP)) {
      this.currentPackHighestHpMob = { name: mobUnit.name, maxHP: newMaxHP }
    }
  }

  // Lock onto the biggest hostile unit damaged in the segment and keep its HP
  // fresh on every hit. "Biggest by maxHP" is a cheap proxy for "the boss" —
  // phase-2 units that spawn later with a larger maxHP steal the lock, which
  // is the right behaviour for bosses that transform or ascend. Players and
  // dest-less events are skipped. Only reads from advanced-log-enriched damage
  // events; without advanced logging the tracker stays empty and the wipe-%
  // label just doesn't render.
  private _trackBossHp(segment: Segment, event: ParsedEvent): void {
    if (event.payload.type !== 'damage') return
    const p = event.payload as DamagePayload
    if (p.destCurrentHP === undefined || p.destMaxHP === undefined || p.destMaxHP <= 0) return
    const destGuid = event.dest.guid
    if (!destGuid || destGuid.startsWith('Player-')) return

    const tracker = segment.bossHpTracker
    if (!tracker) {
      segment.bossHpTracker = { guid: destGuid, maxHP: p.destMaxHP, lastHP: p.destCurrentHP }
      return
    }
    if (destGuid === tracker.guid) {
      tracker.lastHP = p.destCurrentHP
      if (p.destMaxHP > tracker.maxHP) tracker.maxHP = p.destMaxHP
    } else if (p.destMaxHP > tracker.maxHP) {
      // A bigger unit just took damage — likely the phase-2 boss or the real
      // boss appearing after adds. Switch the lock.
      segment.bossHpTracker = { guid: destGuid, maxHP: p.destMaxHP, lastHP: p.destCurrentHP }
    }
  }

  private _openTrashPack(startTime: number): void {
    this.priorActiveTrashSegment = this.activeTrashSegment
    this.packCount++
    const segment = this._makeSegment(this._packPlaceholderName(this.packCount), startTime)
    // Carry over spec/name/pet info from the most recent closed segment (prior pack
    // or boss). Uses carryoverSeg rather than currentSegment since the latter may
    // currently point at a closed prior pack receiving transit events, which is
    // the same source we'd want anyway — but carryoverSeg is the explicit chain.
    if (this.carryoverSeg) {
      segment.guidToSpec = { ...this.carryoverSeg.guidToSpec }
      segment.guidToName = { ...this.carryoverSeg.guidToName }
      segment.petToOwner = { ...this.carryoverSeg.petToOwner }
    }
    this.store.push(segment)
    this.activeTrashSegment = segment
    this.currentSegment = segment
    this.carryoverSeg = segment
    this.currentPackHighestHpMob = null
    this.currentPackHadKill = false
    console.log(`[pack] OPEN — Pack ${this.packCount}`)
    this.emit('pack_changed', segment)
  }

  private _applyFinalPackName(segment: Segment): void {
    if (this.currentPackHighestHpMob) {
      // "Pack N: Shadowguard Champion" — the counter keeps ordering visible when
      // multiple packs in a key share the same elite mob name.
      segment.encounterName = `Pack ${this.packCount}: ${this.currentPackHighestHpMob.name}`
    }
    // Else: leave the placeholder "Pack N" name — no mob with a known max HP was
    // seen in this pack. Can happen if the pack was tracked only via mob-to-player
    // swings without any player-to-mob spell damage to source HP.
  }

  private _packPlaceholderName(packNum: number): string {
    return `Pack ${packNum}`
  }

  private _makeSegment(name: string, startTime: number, encounterID: number = 0): Segment {
    resetRecentEvents()
    return {
      id: randomUUID(),
      keyRunId: this.currentKeyRunId,
      bossSectionId: this.currentKeyRunId ? null : this.activeBossSectionId,
      encounterID,
      encounterName: name,
      startTime,
      endTime: null,
      firstEventTime: null,
      lastEventTime: null,
      success: null,
      players: {},
      guidToSpec: {},
      guidToName: {},
      petToOwner: {},
      petBatchToOwner: {},
      supportOwnedSpellIds: new Set(),
      targetDamageTaken: {},
      healingReceived: {},
      events: [],
      auraWindows: [],
      openAuras: new Map(),
      inFlightCasts: new Map(),
      inFlightChannels: new Map(),
    }
  }
}
