import type { ParsedEvent, DamagePayload, HealPayload, UnitRef } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'

const PLAYER_FLAG             = 0x400
const ATTRIBUTABLE_SOURCE_FLAGS = PLAYER_FLAG | PET_FLAG | GUARDIAN_FLAG

// Placeholder used for events that have no source/dest (ENCOUNTER_*, CHALLENGE_MODE_*)
const NULL_UNIT: UnitRef = Object.freeze({ guid: '', name: '', flags: 0 })

export function parseLine(raw: string): ParsedEvent | null {
  // Format: "M/D/YYYY H:MM:SS.mmm±TZ  EVENT_TYPE,p1,p2,..."
  // Timestamp and event type are separated by TWO spaces
  const twoSpaceIdx = raw.indexOf('  ')
  if (twoSpaceIdx === -1) return null

  const tsStr = raw.slice(0, twoSpaceIdx)
  const rest = raw.slice(twoSpaceIdx + 2)

  const timestamp = parseTimestamp(tsStr)
  if (timestamp === null) return null

  const fields = splitCsv(rest)
  if (fields.length === 0) return null

  const eventType = fields[0]

  // These events have a completely different field layout — handle before building source/dest
  switch (eventType) {
    case 'ENCOUNTER_START':
      return {
        timestamp, type: eventType, source: NULL_UNIT, dest: NULL_UNIT,
        payload: {
          type:          'encounter',
          encounterID:   parseInt(fields[1]),
          encounterName: stripQuotes(fields[2]),
          difficultyID:  parseInt(fields[3]),
          groupSize:     parseInt(fields[4]),
          instanceID:    parseInt(fields[5]),
        }
      }

    case 'ENCOUNTER_END':
      return {
        timestamp, type: eventType, source: NULL_UNIT, dest: NULL_UNIT,
        payload: {
          type:            'encounter',
          encounterID:     parseInt(fields[1]),
          encounterName:   stripQuotes(fields[2]),
          difficultyID:    parseInt(fields[3]),
          groupSize:       parseInt(fields[4]),
          success:         fields[5] === '1',
          fightDurationMs: parseInt(fields[6]),
        }
      }

    case 'CHALLENGE_MODE_START':
      // CHALLENGE_MODE_START,"DungeonName",instanceID,timerSeconds,keystoneLevel,[affixes]
      return {
        timestamp, type: eventType, source: NULL_UNIT, dest: NULL_UNIT,
        payload: {
          type:          'challengeMode',
          dungeonName:   stripQuotes(fields[1]),
          instanceID:    parseInt(fields[2]),
          keystoneLevel: parseInt(fields[4]),
        }
      }

    case 'CHALLENGE_MODE_END':
      // CHALLENGE_MODE_END,instanceID,success,keystoneLevel,durationMs,...
      return {
        timestamp, type: eventType, source: NULL_UNIT, dest: NULL_UNIT,
        payload: {
          type:          'challengeMode',
          instanceID:    parseInt(fields[1]),
          success:       fields[2] === '1',
          keystoneLevel: parseInt(fields[3]),
          durationMs:    parseInt(fields[4]),
        }
      }

    case 'COMBATANT_INFO': {
      // Field layout is stats/gear, not source/dest — must be handled before standard parsing
      const playerGuid = fields[1]
      const specId = parseInt(fields[25])
      if (!playerGuid || isNaN(specId)) return null
      return {
        timestamp, type: eventType, source: NULL_UNIT, dest: NULL_UNIT,
        payload: { type: 'combatantInfo', playerGuid, specId }
      }
    }
  }

  // Standard events: source at fields[1-3], dest at fields[5-7]
  const source: UnitRef = {
    guid:  fields[1],
    name:  stripQuotes(fields[2]),
    flags: parseInt(fields[3], 16),
  }
  const dest: UnitRef = {
    guid:  fields[5],
    name:  stripQuotes(fields[6]),
    flags: parseInt(fields[7], 16),
  }

  switch (eventType) {
    case 'SPELL_SUMMON': {
      if (!(source.flags & PLAYER_FLAG)) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'summon' }
      }
    }

    case 'SPELL_DAMAGE':
    case 'SPELL_PERIODIC_DAMAGE': {
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS)) return null
      if (source.guid === dest.guid) return null
      const damage = parseDamageSuffix(fields)
      if (!damage) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'damage', spellId: fields[9], spellName: stripQuotes(fields[10]), ...damage }
      }
    }

    case 'SPELL_ABSORBED': {
      // Format (no advanced-log block):
      // [9]=spellId [10]=spellName [11]=school
      // [12-15]=absorb caster (guid/name/flags/raidflags)
      // [16]=absorbSpellId [17]=absorbSpellName [18]=absorbSchool
      // [19]=amount (full hit incl. crit multiplier)  [20]=base (non-crit) amount  [21]=critical
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS)) return null
      if (source.guid === dest.guid) return null
      const amount = parseInt(fields[19])
      if (!amount || amount <= 0) return null
      const critical = fields[21] === '1'
      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'damage',
          spellId: fields[9],
          spellName: stripQuotes(fields[10]),
          amount,
          baseAmount: amount,
          overkill: -1,
          school: parseInt(fields[11], 16),
          resisted: 0,
          blocked: 0,
          absorbed: amount, // entire hit went into absorb shield
          critical,
          glancing: false,
          crushing: false,
        }
      }
    }

    case 'SWING_DAMAGE': {
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS)) return null
      if (source.guid === dest.guid) return null
      const damage = parseDamageSuffix(fields)
      if (!damage) return null
      // For pet/guardian swings, the advanced-log block is source-side: fields[9]=unitGuid, fields[10]=ownerGuid
      const swingOwnerGuid = (source.flags & (PET_FLAG | GUARDIAN_FLAG)) ? fields[10] : null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'damage', spellId: 'swing', spellName: 'Melee', swingOwnerGuid, ...damage }
      }
    }

    case 'SWING_DAMAGE_LANDED':
      return null // dest-side mirror of SWING_DAMAGE — skip to avoid double-counting

    case 'SPELL_HEAL':
    case 'SPELL_PERIODIC_HEAL': {
      if (!(source.flags & PLAYER_FLAG)) return null
      const heal = parseHealSuffix(fields)
      if (!heal) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'heal', spellId: fields[9], spellName: stripQuotes(fields[10]), ...heal }
      }
    }

    case 'UNIT_DIED':
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'death', unconsciousOnDeath: fields[9] === '1' }
      }

    default:
      return null
  }
}

// Parse damage suffix from the END of the field list.
// Last field may be "AOE" or "ST" tag — strip it first.
// From right: crushing, glancing, critical, absorbed, blocked, resisted, school, overkill, baseAmount, amount
function parseDamageSuffix(fields: string[]): Omit<DamagePayload, 'type' | 'spellId' | 'spellName'> | null {
  let tail = fields
  const last = tail[tail.length - 1]
  if (last === 'AOE' || last === 'ST') tail = tail.slice(0, -1)
  if (tail.length < 10) return null

  return {
    amount:     parseInt(tail.at(-10)!),
    baseAmount: parseInt(tail.at(-9)!),
    overkill:   parseInt(tail.at(-8)!),
    school:     parseInt(tail.at(-7)!),
    resisted:   parseInt(tail.at(-6)!),
    blocked:    parseInt(tail.at(-5)!),
    absorbed:   parseInt(tail.at(-4)!),
    critical:   tail.at(-3) === '1',
    glancing:   tail.at(-2) === '1',
    crushing:   tail.at(-1) === '1',
  }
}

// Parse heal suffix from the END of the field list.
// Verified from sample: amount, baseAmount, overheal, absorbed, critical — 5 fields
function parseHealSuffix(fields: string[]): Omit<HealPayload, 'type' | 'spellId' | 'spellName'> | null {
  if (fields.length < 5) return null
  return {
    amount:     parseInt(fields.at(-5)!),
    baseAmount: parseInt(fields.at(-4)!),
    overheal:   parseInt(fields.at(-3)!),
    absorbed:   parseInt(fields.at(-2)!),
    critical:   fields.at(-1) === '1',
  }
}

function parseTimestamp(ts: string): number | null {
  const m = ts.match(/^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)([+-]\d+)$/)
  if (!m) return null
  const [, month, day, year, hour, min, sec, ms, tz] = m
  const tzOffsetMs = parseInt(tz) * 60 * 60000
  return Date.UTC(+year, +month - 1, +day, +hour, +min, +sec, +ms) - tzOffsetMs
}

function splitCsv(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false

  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
    } else if (ch === ',' && !inQuote) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.length > 0) result.push(current)
  return result
}

function stripQuotes(s: string): string {
  if (s?.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  return s
}
