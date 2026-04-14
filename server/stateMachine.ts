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
  maxHP: number       // highest observed max HP (never decreases)
  lastHPpct: number   // most recent currentHP/maxHP ratio; 1.0 if unknown
}

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
  // Most recent segment (trash OR boss) in the current key — seeds guidToSpec /
  // guidToName / petToOwner on the next trash pack. Decoupled from currentSegment
  // because currentSegment goes null between packs (events are dropped in that
  // window), but we still want the metadata chain to survive.
  private carryoverSeg: Segment | null = null
  currentSegment: Segment | null = null              // segment receiving events right now

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
        const segment = this._makeSegment(this._packPlaceholderName(1), event.timestamp)
        this.store.push(segment)
        this.activeTrashSegment = segment
        this.currentSegment = segment
        this.carryoverSeg = segment
        this.activeMobs.clear()
        this.currentPackHighestHpMob = null
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
        // Only finalize the trash segment if it's still open — i.e. currentSegment
        // still points to it. If it was already closed at a prior UNIT_DIED, reset,
        // or ENCOUNTER_START, its endTime is already set and we leave it alone.
        const trashStillOpen = this.activeTrashSegment && this.currentSegment === this.activeTrashSegment
        if (trashStillOpen && this.activeTrashSegment) {
          this.activeTrashSegment.endTime = event.timestamp
          this.activeTrashSegment.success = p.success ?? false
          this._applyFinalPackName(this.activeTrashSegment)
        }
        if (this.activeTrashSegment) {
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
        if (this.activeTrashSegment && this.currentSegment === this.activeTrashSegment) {
          this.activeTrashSegment.endTime = event.timestamp
          this.activeTrashSegment.success = true
          this._applyFinalPackName(this.activeTrashSegment)
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
          console.log(`[boss] END — ${this.currentSegment.encounterName} (${p.success ? 'kill' : 'wipe'})`)
          this.emit('encounter_end', this.currentSegment)
        }
        // Return to key with no active pack (next hostile event will open one),
        // or go idle for standalone raid bosses. activeTrashSegment stays pointing
        // at the prior trash (for challenge_end) until a new pack replaces it.
        if (this.dungeonName) {
          // Spec/name/pet info from the boss fight seeds the NEXT trash pack when
          // the first hostile mob event opens it — see _openTrashPack.
          this.currentSegment = null
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
  private _trackTrashMobs(event: ParsedEvent): void {
    if (!this.currentKeyRunId) return

    // UNIT_DIED on a tracked hostile mob → remove from active set. If the set
    // empties, the pack is finished (kill). activeTrashSegment keeps pointing at
    // the just-closed pack; currentSegment goes null so events between packs are
    // dropped until the next hostile event opens a new pack.
    if (event.type === 'UNIT_DIED') {
      if (!this.activeMobs.has(event.dest.guid)) return
      this.activeMobs.delete(event.dest.guid)
      if (this.activeMobs.size === 0 && this.activeTrashSegment && this.currentSegment === this.activeTrashSegment) {
        this.activeTrashSegment.endTime = event.timestamp
        this.activeTrashSegment.success = true
        this._applyFinalPackName(this.activeTrashSegment)
        this.currentSegment = null
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
          this.currentSegment = null
          this.currentPackHighestHpMob = null
        }
        // All ghost active mobs reset with the wipe — the re-engage starts fresh
        this.activeMobs.clear()
      }
    }

    // If no pack is currently accepting events (post-reset, post-UNIT_DIED, or
    // post-ENCOUNTER_END), open a new one starting now. The activeTrashSegment
    // reference gets overwritten to point at the new pack.
    if (!this.currentSegment) {
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
    } else {
      this.activeMobs.set(mobUnit.guid, { name: mobUnit.name, maxHP: newMaxHP, lastHPpct: newPct })
    }

    // Track the highest-max-HP mob in this pack for naming at finalize time
    if (newMaxHP > 0 && (!this.currentPackHighestHpMob || newMaxHP > this.currentPackHighestHpMob.maxHP)) {
      this.currentPackHighestHpMob = { name: mobUnit.name, maxHP: newMaxHP }
    }
  }

  private _openTrashPack(startTime: number): void {
    this.packCount++
    const segment = this._makeSegment(this._packPlaceholderName(this.packCount), startTime)
    // Carry over spec/name/pet info from the most recent closed segment (prior pack
    // or boss). Uses carryoverSeg rather than currentSegment since currentSegment
    // is null between packs.
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
    }
  }
}
