export const PET_FLAG        = 0x1000  // WoW unit flag: TYPE_PET (persistent player-owned pet)
export const GUARDIAN_FLAG   = 0x2000  // WoW unit flag: TYPE_GUARDIAN (temporary summoned guardian)
export const REACTION_HOSTILE = 0x0040 // WoW unit flag: REACTION_HOSTILE — distinguishes true enemies from friendly NPCs (pets, totems, guardians)

// Damage redistribution abilities (e.g. Tempered in Battle, Spirit Link Totem).
// WCL treats these as "spiritLinkDamage": damage events are excluded from the
// damage meter, and their base hit amount is subtracted from the source's healing
// total as a negative offset. Used by both parser (self-damage filter exception)
// and aggregator (healing offset calculation).
export const REDISTRIBUTION_DAMAGE_SPELLS = new Set<string>([
  '469704', // Tempered in Battle (Prot Paladin hero talent)
])

export type EventType =
  | 'ENCOUNTER_START'
  | 'ENCOUNTER_END'
  | 'CHALLENGE_MODE_START'
  | 'CHALLENGE_MODE_END'
  | 'COMBATANT_INFO'
  | 'SPELL_SUMMON'
  | 'SPELL_DAMAGE'
  | 'SPELL_PERIODIC_DAMAGE'
  | 'RANGE_DAMAGE'
  | 'SPELL_DAMAGE_SUPPORT'
  | 'SPELL_PERIODIC_DAMAGE_SUPPORT'
  | 'RANGE_DAMAGE_SUPPORT'
  | 'SWING_DAMAGE_LANDED_SUPPORT'
  | 'SPELL_ABSORBED'
  | 'SWING_DAMAGE'
  | 'SWING_DAMAGE_LANDED'
  | 'SPELL_MISSED'
  | 'SPELL_PERIODIC_MISSED'
  | 'RANGE_MISSED'
  | 'SWING_MISSED'
  | 'SPELL_HEAL'
  | 'SPELL_PERIODIC_HEAL'
  | 'SPELL_HEAL_ABSORBED'
  | 'SPELL_AURA_APPLIED'
  | 'SPELL_AURA_REFRESH'
  | 'SPELL_AURA_REMOVED'
  | 'SPELL_CAST_SUCCESS'
  | 'SPELL_INTERRUPT'
  | 'UNIT_DIED'

export interface UnitRef {
  guid: string
  name: string
  flags: number
}

export interface DamagePayload {
  type: 'damage'
  spellId: string
  spellName: string
  amount: number
  baseAmount: number
  overkill: number
  school: number
  resisted: number
  blocked: number
  absorbed: number
  critical: boolean
  glancing: boolean
  crushing: boolean
  // Set true only on the SWING_MISSED/SPELL_MISSED(ABSORB) re-emit path where the
  // entire hit went into an absorb shield. In that case both `amount` and
  // `absorbed` carry the same absorb amount, and the Damage-Taken view needs
  // to know this unambiguously — the alternative of sniffing `absorbed >= amount`
  // misclassifies heavy-shield partial absorbs (e.g. 100 incoming, 70 absorbed,
  // 30 landed) because it can't distinguish those from full absorbs.
  fullAbsorb?: boolean
  swingOwnerGuid?: string | null  // set on SWING_DAMAGE from pets/guardians; owner GUID from advanced-log fields
  supportSourceGuid?: string | null  // set on *_SUPPORT events: GUID of the buffer (e.g. Aug Evoker) who actually owns this damage
  // Dest unit's HP snapshot from the advanced-log block. Populated on SPELL_DAMAGE,
  // SPELL_PERIODIC_DAMAGE, and RANGE_DAMAGE (dest-side advanced-log). Used by the
  // state machine's M+ trash pull detection to spot mob resets (HP jumps back to ~full
  // without a death), which signals the group wiped and the mob leashed back.
  destCurrentHP?: number
  destMaxHP?: number
}

export interface HealPayload {
  type: 'heal'
  spellId: string
  spellName: string
  amount: number
  baseAmount: number
  overheal: number
  absorbed: number
  critical: boolean
}

export interface EncounterPayload {
  type: 'encounter'
  encounterID: number
  encounterName: string
  difficultyID: number
  groupSize: number
  instanceID?: number
  success?: boolean
  fightDurationMs?: number
}

export interface DeathPayload {
  type: 'death'
  unconsciousOnDeath: boolean
}

export interface CombatantInfoPayload {
  type: 'combatantInfo'
  playerGuid: string
  specId: number
}

export interface ChallengeModePayload {
  type: 'challengeMode'
  dungeonName?: string  // present on START only
  instanceID: number
  keystoneLevel?: number
  success?: boolean     // present on END only
  durationMs?: number   // present on END only
}

export interface SummonPayload {
  type: 'summon'
}

export interface InterruptPayload {
  type: 'interrupt'
  spellId: string           // the kicker's ability (e.g. Pummel)
  spellName: string
  extraSpellId: string      // the spell that got interrupted
  extraSpellName: string
}

// A SPELL_CAST_SUCCESS event for a spellId in the known-interrupts set. Used
// to count Attempts alongside Lands so the Interrupts lens can distinguish
// "pressed the button" from "got credit." An attempt that lands generates both
// an InterruptAttemptPayload (from SPELL_CAST_SUCCESS) and an InterruptPayload
// (from the paired SPELL_INTERRUPT) — the aggregator counts them independently.
export interface InterruptAttemptPayload {
  type: 'interruptAttempt'
  spellId: string
  spellName: string
}

// Generic SPELL_CAST_SUCCESS for the Casts metric. Emitted for any cast the
// parser couldn't classify as an interrupt attempt or a pet-summon bootstrap —
// covers the full universe of ally, pet, and enemy casts. The aggregator
// credits ally casts to the casting player's CastData and mirrors every cast
// (ally and enemy) into `segment.events` so the client's Enemies perspective
// can filter on them.
export interface CastPayload {
  type: 'cast'
  spellId: string
  spellName: string
}

// Aura application, refresh, or removal for the buffs metric. Emitted from
// SPELL_AURA_APPLIED / SPELL_AURA_REFRESH / SPELL_AURA_REMOVED for BUFFs on
// player destinations. Aggregator pairs APPLIED/REMOVED into AuraWindows and
// folds REFRESHes into the current open window's reapplication counter.
// DEBUFFs are dropped at the parser today — future debuffs metric flips the filter.
export interface AuraPayload {
  type: 'aura'
  direction: 'applied' | 'refreshed' | 'removed'
  spellId: string
  spellName: string
  auraKind: 'BUFF' | 'DEBUFF'
}

export type EventPayload = DamagePayload | HealPayload | EncounterPayload | DeathPayload | CombatantInfoPayload | ChallengeModePayload | SummonPayload | InterruptPayload | InterruptAttemptPayload | CastPayload | AuraPayload

export interface ParsedEvent {
  timestamp: number
  type: EventType
  source: UnitRef
  dest: UnitRef
  payload: EventPayload
}

export interface DeathRecapEvent {
  timestamp: number        // absolute ms (same epoch as ParsedEvent.timestamp)
  kind: 'damage' | 'heal'
  spellId: string
  spellName: string
  amount: number           // effective damage or effective heal
  overkill: number         // > 0 on the killing blow
  absorbed: number
  critical: boolean
  sourceName: string       // who dealt the damage / who cast the heal
  sourceIsPlayer: boolean  // true if source is a player (not an NPC)
}

export interface PlayerDeathRecord {
  playerName: string
  playerGuid: string
  timeOfDeath: number        // absolute ms timestamp
  combatElapsed: number      // seconds since segment.firstEventTime
  killingBlow: {
    spellId: string
    spellName: string
    sourceName: string
    overkill: number
  } | null
  recap: DeathRecapEvent[]   // up to RECAP_WINDOW_SECONDS before death
}

export interface PlayerInterruptRecord {
  kickerName: string
  kickerGuid: string
  timeOfInterrupt: number    // absolute ms timestamp
  combatElapsed: number      // seconds since segment.firstEventTime
  kickerSpellId: string
  kickerSpellName: string
  kickedSpellId: string
  kickedSpellName: string
  targetName: string         // the mob whose cast was interrupted
  targetGuid: string
}

// Classification bucket for a buff on the client table — computed at snapshot
// time from the full window set for each spellId. Debuffs don't get sections
// (the personal/raid/external fan-out taxonomy doesn't map) and render flat.
export type BuffSection = 'personal' | 'raid' | 'external'

// Aggregated aura window: one continuous uptime interval for a specific
// (caster, target, spellId) triple. Windows are built from paired APPLIED/REMOVED
// events during aggregation and closed at segment end for still-open auras.
// REFRESHes inside a window increment `refreshCount` without splitting the
// window — the aura is continuously up, but each refresh is an application
// the user cares about for the Count column.
export interface AuraWindow {
  spellId: string
  spellName: string
  caster: string         // canonical name — pets resolved to owner
  target: string         // canonical name (NFC-normalized)
  start: number          // absolute ms — APPLIED timestamp, or segment start for retro-seeded
  end: number            // absolute ms — REMOVED timestamp, or segment end for still-open
  preExisting: boolean   // retroactively seeded from REMOVED-without-APPLIED
  stillOpen: boolean     // no REMOVED seen; closed at segment end
  refreshCount: number   // SPELL_AURA_REFRESHes observed inside this window
  targetHostile: boolean // true when dest carried REACTION_HOSTILE at event time — used to split the enemies perspective from friendly NPCs (pets, totems, guardians)
  kind: 'BUFF' | 'DEBUFF' // game-engine classification, straight through from the combat-log BUFF|DEBUFF tag
}

// In-flight open-aura bookkeeping. Stored on Segment, keyed by
// `${casterGuid}|${targetGuid}|${spellId}`. Moved into auraWindows when REMOVED
// fires or materialized lazily with `end = segEnd` at snapshot time. Refreshes
// observed while open increment refreshCount.
export interface AuraOpen {
  spellId: string
  spellName: string
  caster: string
  target: string
  start: number
  refreshCount: number
  targetHostile: boolean
  kind: 'BUFF' | 'DEBUFF'
}

// Wire-shrunk variant of AuraWindow — 1-letter keys because a 6-min raid fight
// can ship up to 15k windows. preExisting/stillOpen are dropped on the wire:
// retro/open flags are derivable from s===segStart / e===segEnd when needed.
// `r` (refreshCount) is optional; absent means zero — keeps legacy snapshots
// parsing cleanly and shaves bytes off the common "no refresh" case.
export interface AuraWindowWire {
  id: string  // spellId
  n: string   // spellName
  c: string   // caster
  d: string   // target (dst)
  s: number   // start ms
  e: number   // end ms
  r?: number  // SPELL_AURA_REFRESH count folded into this window
  h?: 1       // target was hostile (REACTION_HOSTILE) at event time — enemies perspective filters on this flag. Omitted for friendly targets (allies, player pets, guardians) to keep legacy snapshots parsing cleanly and shave bytes off the common case.
  k?: 1       // DEBUFF flag — omitted for BUFFs (the more common case on the wire for raid fights heavy in raid/personal buffs). Legacy snapshots (pre-debuff-metric) carry no DEBUFF windows, so absence reads correctly as BUFF.
}

// Pared-down event used by the client to re-aggregate under arbitrary filters.
// Keys are short because the array runs to 10k+ per fight; every byte matters
// on the wire. `t` is absolute ms (same epoch as ParsedEvent.timestamp) so the
// client doesn't need to know segment start offsets — it filters on its own.
//
// Damage mitigation fields (absorbed, blocked) are emitted only on 'damage'
// events and only when non-zero — the Damage Taken view needs them to compute
// gross vs effective, but the common case (hit with no mitigation) is the vast
// majority and benefits from the omission. Legacy snapshots without these
// fields read as undefined and degrade gracefully to effective-only.
export interface ClientEvent {
  t: number
  // 'interrupt' = SPELL_INTERRUPT (land). 'interruptAttempt' = SPELL_CAST_SUCCESS
  // for a known interrupt spell (press, may or may not have landed). A landing
  // interrupt produces BOTH events at the same timestamp; a missed one only
  // produces 'interruptAttempt'. The Interrupts lens in Full mode ranks on
  // whichever kind the lens selects.
  // 'cast' = every SPELL_CAST_SUCCESS that isn't an interrupt press. Includes
  // ally, pet-remapped-to-owner, and enemy casts so the Full-mode Casts tab
  // can rank on either perspective. Payload carries just ability name and
  // spellId — no amount / overheal / mitigation.
  kind: 'damage' | 'heal' | 'interrupt' | 'interruptAttempt' | 'cast' | 'death'
  src: string              // canonical source name (pets/support already resolved to owner)
  dst: string              // canonical dest name
  ability: string          // spell name; 'death' kind stores the killing-blow ability
  spellId?: string
  // Interrupt kind only: name of the spell that got interrupted (from
  // SPELL_INTERRUPT's extraSpellName). Lets the Full-mode filter bar
  // narrow interrupts by the victim's spell in addition to the kicker's
  // ability. Absent on 'interruptAttempt' (the press may not have landed
  // on any specific spell) and on every other kind.
  extraAbility?: string
  amount?: number          // damage/heal value (excludes overkill, matches meter totals)
  overheal?: number        // heal only
  absorbed?: number        // damage only; omitted when 0
  blocked?: number         // damage only; omitted when 0
  // Damage only; present as `true` only when the entire hit was absorbed by a
  // shield (SPELL_MISSED / SWING_MISSED with ABSORB result). Disambiguates
  // heavy-shield partial absorbs from true full absorbs, which the Damage
  // Taken view can't do from `amount`/`absorbed` alone.
  fullAbsorb?: boolean
}
