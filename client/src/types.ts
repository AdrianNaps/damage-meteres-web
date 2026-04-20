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
  // Attempts (cast-success events) for this kicker spell. Only meaningful on
  // `byKicker` entries; undefined on `byKicked` and on legacy snapshots that
  // predate attempt tracking. The lens renders undefined as "-".
  casts?: number
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
  // Total SPELL_CAST_SUCCESS events for known interrupt spells — attempts,
  // whether or not each press landed. Always ≥ total. Undefined on legacy
  // snapshots; the lens treats that as "unknown" and falls back to count.
  attempts?: number
  byKicker: Record<string, InterruptSpellStats>
  byKicked: Record<string, InterruptSpellStats>
  records: PlayerInterruptRecord[]
}

export interface CastSpellStats {
  spellId: string
  spellName: string
  count: number
}

// Per-player cast aggregate for the Casts metric. Counts the player's OWN
// SPELL_CAST_SUCCESS events only — pet/guardian casts are excluded. Interrupt
// presses are included (an interrupt IS a player cast). Absent on legacy
// snapshots (pre-Casts-tab); readers must coalesce to `{ total: 0, bySpell: {} }`.
export interface CastData {
  total: number
  bySpell: Record<string, CastSpellStats>
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
  // Optional for legacy snapshots that shipped before the Casts tab existed —
  // the Full-mode Casts view coalesces undefined to `{ total: 0, bySpell: {} }`
  // so those render as empty rather than crashing.
  casts?: CastData
  activeSec: number
}

export interface ClientEvent {
  t: number
  // 'interrupt' is a land (SPELL_INTERRUPT); 'interruptAttempt' is a press
  // (SPELL_CAST_SUCCESS for a known interrupt spell). A landing interrupt
  // produces both at the same timestamp; a missed one only produces
  // 'interruptAttempt'. Attempts lens ranks on presses; Lands lens ranks on
  // landings only.
  // 'cast' = SPELL_CAST_SUCCESS from a player or an enemy NPC. Pet/guardian
  // casts are dropped by the aggregator so the Casts metric doesn't conflate
  // a player's presses with their pets' abilities. Interrupt presses also
  // emit a companion 'cast' event at the same timestamp so the Casts metric
  // and the Interrupts-Attempts lens stay consistent. No amount / overheal
  // fields.
  kind: 'damage' | 'heal' | 'interrupt' | 'interruptAttempt' | 'cast' | 'death'
  src: string
  dst: string
  ability: string
  spellId?: string
  // Interrupt-land only: name of the spell the kick cut. Enables the Full-
  // mode filter bar to narrow by interrupted spell alongside the kicker's
  // ability. Absent on 'interruptAttempt' and all non-interrupt kinds.
  extraAbility?: string
  amount?: number
  overheal?: number
  // Damage-only mitigation fields. Omitted when zero (the common case) to
  // keep the wire thin. See server/types.ts ClientEvent for the wire source.
  absorbed?: number
  blocked?: number
  // Present only on `kind: 'damage'` events representing a full shield absorb.
  // Required to disambiguate heavy-shield partial absorbs (absorbed > landed)
  // from true full absorbs (both amount and absorbed equal the absorbed
  // amount). Without it, `absorbed >= amount` misclassifies the former.
  fullAbsorb?: boolean
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
// uptime (s,e) stays contiguous across refreshes because the aura was up.
// `r` is omitted when zero to keep the common case small.
export interface AuraWindowWire {
  id: string  // spellId
  n: string   // spellName
  c: string   // caster
  d: string   // target (dst)
  s: number   // start ms (absolute)
  e: number   // end ms (absolute — clamped to segment end if still open)
  r?: number  // refresh count inside this window (undefined = 0)
  h?: 1       // target was hostile at event time — enemies-perspective filter signal. Omitted for friendly targets (allies, player pets, totems, guardians). Legacy snapshots (pre-hostile-flag) read as undefined → treated as friendly on the enemies view, which is safe (they simply won't appear).
  k?: 1       // DEBUFF flag (game-engine classification). Omitted for BUFFs. Drives the Buffs vs Debuffs tab split. Legacy snapshots (pre-debuff-metric) ship only BUFFs so an absent flag correctly defaults to BUFF.
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
  duration: number
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
  duration: number
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
