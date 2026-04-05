export const PET_FLAG      = 0x1000  // WoW unit flag: TYPE_PET (persistent player-owned pet)
export const GUARDIAN_FLAG = 0x2000  // WoW unit flag: TYPE_GUARDIAN (temporary summoned guardian)

export type EventType =
  | 'ENCOUNTER_START'
  | 'ENCOUNTER_END'
  | 'CHALLENGE_MODE_START'
  | 'CHALLENGE_MODE_END'
  | 'COMBATANT_INFO'
  | 'SPELL_SUMMON'
  | 'SPELL_DAMAGE'
  | 'SPELL_PERIODIC_DAMAGE'
  | 'SPELL_ABSORBED'
  | 'SWING_DAMAGE'
  | 'SPELL_HEAL'
  | 'SPELL_PERIODIC_HEAL'
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

export type EventPayload = DamagePayload | HealPayload | EncounterPayload | DeathPayload | CombatantInfoPayload | ChallengeModePayload | SummonPayload

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
  healthPercent: number    // estimated — 0 in first pass
}

export interface PlayerDeathRecord {
  playerName: string
  playerGuid: string
  timeOfDeath: number        // absolute ms timestamp
  combatElapsed: number      // seconds since segment.firstEventTime
  unconscious: boolean       // feign death, divine shield, etc. — not a real death
  killingBlow: {
    spellId: string
    spellName: string
    sourceName: string
    overkill: number
  } | null
  recap: DeathRecapEvent[]   // up to RECAP_WINDOW_SECONDS before death
}
