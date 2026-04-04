export type EventType =
  | 'ENCOUNTER_START'
  | 'ENCOUNTER_END'
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

export type EventPayload = DamagePayload | HealPayload | EncounterPayload | DeathPayload

export interface ParsedEvent {
  timestamp: number
  type: EventType
  source: UnitRef
  dest: UnitRef
  payload: EventPayload
}
