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
