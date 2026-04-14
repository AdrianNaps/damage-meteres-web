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

export interface TargetHealStats {
  targetName: string
  total: number
  overheal: number
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

export interface InterruptSpellStats {
  spellId: string
  spellName: string
  count: number
}

export interface PlayerInterruptRecord {
  kickerName: string
  kickerGuid: string
  timeOfInterrupt: number
  combatElapsed: number
  kickerSpellId: string
  kickerSpellName: string
  kickedSpellId: string
  kickedSpellName: string
  targetName: string
  targetGuid: string
}

export interface InterruptData {
  total: number
  byKicker: Record<string, InterruptSpellStats>
  byKicked: Record<string, InterruptSpellStats>
  records: PlayerInterruptRecord[]
}

export interface PlayerSnapshot {
  name: string
  specId?: number
  dps: number
  hps: number
  damage: { total: number; spells: Record<string, SpellDamageStats>; targets: Record<string, TargetDamageStats> }
  healing: { total: number; overheal: number; spells: Record<string, SpellHealStats>; targets: Record<string, TargetHealStats> }
  deaths: PlayerDeathRecord[]
  interrupts: InterruptData
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
  spellIcons?: Record<string, string>
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
  spellIcons?: Record<string, string>
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
  spellIcons?: Record<string, string>
}

export type HistoryItem = KeyRunSummary | BossSectionSummary | SegmentSummary
