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
  activeSec: number
}

export interface ClientEvent {
  t: number
  kind: 'damage' | 'heal' | 'interrupt' | 'death'
  src: string
  dst: string
  ability: string
  spellId?: string
  amount?: number
  overheal?: number
}

// Classification bucket for a buff on the Full-mode buffs table. Must match
// the server/types.ts BuffSection — kept as a local alias because the client
// doesn't import server types directly.
export type BuffSection = 'personal' | 'raid' | 'external'

// Wire-shrunk aura window (server: see AuraWindowWire in server/types.ts).
// Short keys because a 6-min raid fight can ship up to 15k windows. One
// window represents a contiguous uptime interval for a (caster, target,
// spellId) triple. SPELL_AURA_REFRESHes observed inside the window are
// folded into `r` so the Count column reflects real reapplication activity;
// uptime (s,e) stays contiguous across refreshes because the buff was up.
// `r` is omitted when zero to keep the common case small.
export interface AuraWindowWire {
  id: string  // spellId
  n: string   // spellName
  c: string   // caster
  d: string   // target (dst)
  s: number   // start ms (absolute)
  e: number   // end ms (absolute — clamped to segment end if still open)
  r?: number  // refresh count inside this window (undefined = 0)
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
  events?: ClientEvent[]
  // Aura-window data for the Full-mode buffs metric. Absent on legacy
  // pre-aura-tracking snapshots; the buffs table falls back to an empty state.
  auras?: AuraWindowWire[]
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
  // Rounded boss HP % at the moment of a wipe. Only present on raid wipes
  // logged with advanced-log HP fields — used by the segment tab to render
  // "Pull N - 47%".
  bossHpPctAtWipe?: number
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
  events?: ClientEvent[]
  auras?: AuraWindowWire[]
  buffClassification?: Record<string, BuffSection>
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
  events?: ClientEvent[]
  auras?: AuraWindowWire[]
  buffClassification?: Record<string, BuffSection>
}

export type HistoryItem = KeyRunSummary | BossSectionSummary | SegmentSummary
