export const PET_FLAG      = 0x1000  // WoW unit flag: TYPE_PET (persistent player-owned pet)
export const GUARDIAN_FLAG = 0x2000  // WoW unit flag: TYPE_GUARDIAN (temporary summoned guardian)

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
  | 'SPELL_AURA_REMOVED'
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

export type EventPayload = DamagePayload | HealPayload | EncounterPayload | DeathPayload | CombatantInfoPayload | ChallengeModePayload | SummonPayload | InterruptPayload

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

// Pared-down event used by the client to re-aggregate under arbitrary filters.
// Keys are short because the array runs to 10k+ per fight; every byte matters
// on the wire. `t` is absolute ms (same epoch as ParsedEvent.timestamp) so the
// client doesn't need to know segment start offsets — it filters on its own.
export interface ClientEvent {
  t: number
  kind: 'damage' | 'heal' | 'interrupt' | 'death'
  src: string              // canonical source name (pets/support already resolved to owner)
  dst: string              // canonical dest name
  ability: string          // spell name; 'death' kind stores the killing-blow ability
  spellId?: string
  amount?: number          // damage/heal value (excludes overkill, matches meter totals)
  overheal?: number        // heal only
}
