export interface SpellDamageStats {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  critCount: number
  normalMin: number
  normalMax: number
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

export interface TargetDetail {
  targetName: string
  total: number
  sources: { sourceName: string; total: number }[]
}

export interface DeathRecapEvent {
  timestamp: number
  kind: 'damage' | 'heal'
  spellId: string
  spellName: string
  amount: number
  overkill: number
  absorbed: number
  critical: boolean
  sourceName: string
  sourceIsPlayer: boolean
}

export interface PlayerDeathRecord {
  playerName: string
  playerGuid: string
  timeOfDeath: number
  combatElapsed: number
  killingBlow: {
    spellId: string
    spellName: string
    sourceName: string
    overkill: number
  } | null
  recap: DeathRecapEvent[]
}

export interface PlayerSnapshot {
  name: string
  specId?: number
  dps: number
  hps: number
  damage: { total: number; spells: Record<string, SpellDamageStats>; targets: Record<string, TargetDamageStats> }
  healing: { total: number; overheal: number; spells: Record<string, SpellHealStats> }
  deaths: PlayerDeathRecord[]
}

export interface SegmentSnapshot {
  type: 'segment'
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
  duration: number
  players: Record<string, PlayerSnapshot>
}

export interface SegmentSummary {
  type: 'segment'
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
  duration: number
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
  activeDurationSec: number
  players: Record<string, PlayerSnapshot>
}

export type HistoryItem = KeyRunSummary | SegmentSummary
