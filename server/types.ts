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
  | 'SPELL_AURA_APPLIED'
  | 'SPELL_AURA_REFRESH'
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

export type EventPayload = DamagePayload | HealPayload | EncounterPayload | DeathPayload | CombatantInfoPayload | ChallengeModePayload | SummonPayload | InterruptPayload | AuraPayload

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
// time from the full window set for each spellId.
export type BuffSection = 'personal' | 'raid' | 'external'

// Aggregated aura window: one continuous uptime interval for a specific
// (caster, target, spellId) triple. Windows are built from paired APPLIED/REMOVED
// events during aggregation and closed at segment end for still-open auras.
// REFRESHes inside a window increment `refreshCount` without splitting the
// window — the buff is continuously up, but each refresh is an application
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
