import type { ParsedEvent, DamagePayload, HealPayload, UnitRef } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'

const PLAYER_FLAG             = 0x400
const ATTRIBUTABLE_SOURCE_FLAGS = PLAYER_FLAG | PET_FLAG | GUARDIAN_FLAG

// Boss mechanics that fire SPELL_DAMAGE with a player source/flags but mechanically
// originate from the boss (e.g. a debuff applied to a raider that radiates AoE onto
// other raiders, logged as player-to-player). WCL drops these from player damage
// entirely — the source/dest/flag triple looks indistinguishable from a real player
// hit, so a spell-ID deny list is the only way to filter them out.
//
// Add entries here when parity review identifies new offenders. Format: string spell ID.
//   1267201, 1268666 — "Dissonance" on Chimaerus (Midnight raid, encounter 3306).
//     Raiders with the debuff emit SPELL_DAMAGE onto other raiders; WCL credits zero.
const BOSS_MIRRORED_DAMAGE_SPELLS = new Set<string>([
  '1267201', // Chimaerus - Dissonance
  '1268666', // Chimaerus - Dissonance (second variant)
])

// Placeholder used for events that have no source/dest (ENCOUNTER_*, CHALLENGE_MODE_*)
const NULL_UNIT: UnitRef = Object.freeze({ guid: '', name: '', flags: 0 })

export function parseLine(raw: string): ParsedEvent | ParsedEvent[] | null {
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

    // Some hero-talent / class-fantasy clones cast through a Creature source that
    // never emits SPELL_SUMMON (e.g. Rogue Subtlety "Akaari's Soul" NPC 144961 that
    // fires Secret Technique / 282449 as the 5 shadow clones). The advanced-log
    // block on SPELL_CAST_SUCCESS carries the owning player's GUID at fields[13]
    // (the ownerGUID slot immediately after infoGUID). If source is a creature
    // and fields[13] is a Player- GUID, re-emit as a synthetic summon so the
    // aggregator's existing petToOwner bootstrap picks it up and subsequent
    // SPELL_DAMAGE events from the clone get credited to the owning player.
    //
    // The synthetic summon source has an empty name string because the raw event
    // doesn't carry the owner's name — the aggregator's summon handler is guarded
    // to not overwrite guidToName with an empty string, and by the time clones
    // deal damage the owner's name is already populated via earlier player events
    // or COMBATANT_INFO.
    case 'SPELL_CAST_SUCCESS': {
      if (!source.guid.startsWith('Creature-')) return null
      if (fields.length < 14) return null
      const ownerGuid = fields[13]
      if (!ownerGuid?.startsWith('Player-')) return null
      return {
        timestamp,
        type: 'SPELL_SUMMON',
        source: { guid: ownerGuid, name: '', flags: PLAYER_FLAG },
        dest: source,
        payload: { type: 'summon' }
      }
    }

    case 'SPELL_DAMAGE':
    case 'SPELL_PERIODIC_DAMAGE':
    case 'RANGE_DAMAGE': {
      // Drop boss mechanics that are logged with a raider in the source slot.
      // See BOSS_MIRRORED_DAMAGE_SPELLS comment at the top of this file.
      if (BOSS_MIRRORED_DAMAGE_SPELLS.has(fields[9])) return null
      const destIsPlayer = dest.guid.startsWith('Player-')
      // Pets summoned by Army of the Dead / Apocalypse / similar can emit damage with
      // flags TYPE_NPC|CONTROL_NPC|AFFILIATION_OUTSIDER instead of the expected GUARDIAN
      // flag. We can't tell from the event itself whether such a source belongs to a
      // player, so we pass any "Pet-" / "Creature-" source through and let the aggregator
      // resolve ownership via its petToOwner map (populated from SPELL_SUMMON events).
      const srcLooksLikeUnit = source.guid.startsWith('Pet-') || source.guid.startsWith('Creature-')
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS) && !destIsPlayer && !srcLooksLikeUnit) return null
      if (source.guid === dest.guid) return null
      const damage = parseDamageSuffix(fields)
      if (!damage) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'damage', spellId: fields[9], spellName: stripQuotes(fields[10]), ...damage }
      }
    }

    // SPELL_ABSORBED fires alongside a sibling *_MISSED(ABSORB) (fully absorbed) or
    // *_DAMAGE (partially absorbed). For DAMAGE accounting we rely on the sibling — the
    // *_DAMAGE suffix already carries the absorbed portion, and *_MISSED handles full
    // absorbs. So we do NOT consume SPELL_ABSORBED for damage.
    //
    // For HEAL accounting, however, this is the only event that credits the shield caster
    // (the healer) with the effective mitigation. WCL counts it as healing. We re-emit it
    // here as a heal event whose source is the absorber, spell is the shield, and amount
    // is the absorbed portion (overheal=0 — shield overhealing would need aura tracking).
    //
    // Two field layouts:
    //   Swing-absorbed (~19 fields): [9..12]=absorber, [13..15]=shield, [16]=absorbed
    //   Spell-absorbed (~22 fields): [9..11]=damagingSpell, [12..15]=absorber,
    //                                [16..18]=shield, [19]=absorbed
    case 'SPELL_ABSORBED': {
      // Distinguish by whether fields[9] looks like a GUID (swing) or an integer spellId (spell-caused)
      const f9 = fields[9] ?? ''
      const isSwing = f9.startsWith('Player-') || f9.startsWith('Creature-') || f9.startsWith('Pet-') || f9.startsWith('Vehicle-')
      const absorberBase = isSwing ? 9 : 12
      const shieldBase   = isSwing ? 13 : 16
      const amountIdx    = isSwing ? 16 : 19
      if (fields.length <= amountIdx) return null

      const absorberGuid  = fields[absorberBase]
      const absorberName  = stripQuotes(fields[absorberBase + 1])
      const absorberFlags = parseInt(fields[absorberBase + 2], 16)

      // Normal path: absorber is the player who cast the shield — credit them.
      //
      // Ally-shielded hero-talent proc path (e.g. Deathbringer DK "Anti-Magic Shell"
      // 444741 landing on an Ebon Blade champion like Nazgrim): the absorber slot
      // holds the allied NPC (Creature-...) but the outer SPELL_ABSORBED dest is the
      // player who owns the shield buff. WCL credits the player in that case. Fall
      // through to dest-as-credit when absorber is a non-player unit and dest is a
      // real player.
      const absorberIsPlayer = !!(absorberFlags & PLAYER_FLAG)
      const destIsPlayer = dest.guid.startsWith('Player-')
      let creditRef: UnitRef
      if (absorberIsPlayer) {
        creditRef = { guid: absorberGuid, name: absorberName, flags: absorberFlags }
      } else if (destIsPlayer) {
        creditRef = dest
      } else {
        // Creature-on-creature absorb — not meter-relevant.
        return null
      }

      const shieldSpellId = fields[shieldBase]
      const shieldName    = stripQuotes(fields[shieldBase + 1])
      const amount        = parseInt(fields[amountIdx])
      if (!amount || isNaN(amount)) return null

      return {
        timestamp, type: eventType, source: creditRef, dest,
        payload: {
          type: 'heal',
          spellId: shieldSpellId,
          spellName: shieldName,
          amount,
          baseAmount: amount,
          overheal: 0,
          absorbed: 0,
          critical: false,
        }
      }
    }

    // Fully-absorbed hits come through as *_MISSED with missType=ABSORB instead of *_DAMAGE.
    // The combat log still carries the real attacker in the source fields (unlike the
    // sibling SPELL_ABSORBED event, which often nulls the source for pet AOEs), so this is
    // the reliable credit path. Other miss types (MISS/DODGE/PARRY/IMMUNE/RESIST/REFLECT/
    // EVADE) are genuinely zero-damage and stay dropped.
    //
    // Field layout after source/dest:
    //   SPELL_MISSED / SPELL_PERIODIC_MISSED / RANGE_MISSED:
    //     [9]=spellId [10]=spellName [11]=school [12]=missType
    //     [13]=isOffHand [14]=amount [15]=baseAmount [16]=critical
    //   SWING_MISSED:
    //     [9]=missType [10]=isOffHand [11]=amount [12]=baseAmount [13]=critical
    case 'SPELL_MISSED':
    case 'SPELL_PERIODIC_MISSED':
    case 'RANGE_MISSED':
    case 'SWING_MISSED': {
      // Same flag-inconsistency concern as SPELL_DAMAGE: mis-flagged summoned pets
      // can appear here too. Aggregator resolves ownership via petToOwner.
      const srcLooksLikeUnit = source.guid.startsWith('Pet-') || source.guid.startsWith('Creature-')
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS) && !srcLooksLikeUnit) return null
      if (source.guid === dest.guid) return null

      const isSwing = eventType === 'SWING_MISSED'
      // Spell-absorbed miss path also carries the boss-mirrored damage mechanics that
      // SPELL_DAMAGE drops via BOSS_MIRRORED_DAMAGE_SPELLS. Drop the same spell IDs here
      // before re-emitting as synthetic damage, otherwise absorbed Dissonance (etc.)
      // hits leak back into player damage totals via the ABSORB-miss path.
      if (!isSwing && BOSS_MIRRORED_DAMAGE_SPELLS.has(fields[9])) return null

      const missType = isSwing ? fields[9] : fields[12]
      if (missType !== 'ABSORB') return null

      const amountIdx    = isSwing ? 11 : 14
      const baseIdx      = isSwing ? 12 : 15
      const criticalIdx  = isSwing ? 13 : 16
      const amount = parseInt(fields[amountIdx])
      if (!amount || amount <= 0) return null

      const spellId   = isSwing ? 'swing' : fields[9]
      const spellName = isSwing ? 'Melee' : stripQuotes(fields[10])
      const school    = isSwing ? 0x1 : parseInt(fields[11], 16)
      // SWING_MISSED has no advanced-log block, so no pet-owner bootstrap field.
      // The aggregator's petToOwner map (populated from SPELL_SUMMON and from prior
      // SWING_DAMAGE events) is enough to attribute these.
      const swingOwnerGuid = null

      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'damage',
          spellId,
          spellName,
          amount,
          baseAmount: parseInt(fields[baseIdx]) || amount,
          overkill: 0,
          school,
          resisted: 0,
          blocked: 0,
          absorbed: amount, // entire hit went into an absorb shield
          critical: fields[criticalIdx] === '1',
          glancing: false,
          crushing: false,
          swingOwnerGuid,
        }
      }
    }

    case 'SWING_DAMAGE': {
      // Same flag-inconsistency concern as SPELL_DAMAGE.
      const srcLooksLikeUnit = source.guid.startsWith('Pet-') || source.guid.startsWith('Creature-')
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS) && !srcLooksLikeUnit) return null
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

    case 'SWING_DAMAGE_LANDED': {
      // Normally a dest-side mirror of SWING_DAMAGE — paired 1:1 and skipped to avoid
      // double-counting. BUT: pets summoned by Army of the Dead / Apocalypse / similar
      // sometimes emit ONLY the _LANDED event (no paired SWING_DAMAGE) when their source
      // flags are TYPE_NPC|AFFILIATION_OUTSIDER rather than GUARDIAN. Recover those here.
      //
      // Rule: if the source has any attributable flag (PLAYER/PET/GUARDIAN), a sibling
      // SWING_DAMAGE was (or will be) emitted and processed — skip. Otherwise emit the
      // LANDED event as a swing damage event; the aggregator resolves ownership via
      // petToOwner for mis-flagged creature sources.
      if (source.flags & ATTRIBUTABLE_SOURCE_FLAGS) return null
      if (source.guid === dest.guid) return null
      if (!source.guid.startsWith('Pet-') && !source.guid.startsWith('Creature-')) return null
      const damage = parseDamageSuffix(fields)
      if (!damage) return null
      // Guard against truncated/non-numeric suffixes — unlike SWING_DAMAGE, we have no
      // sibling event to fall back on if this one is malformed, so a bad row would feed
      // NaN straight into the aggregator. parseDamageSuffix only length-checks; the field
      // values themselves can still be non-numeric.
      if (!Number.isFinite(damage.amount) || !Number.isFinite(damage.baseAmount)) return null
      // LANDED's advanced-log block is dest-side, so no source-owner GUID is available;
      // petToOwner (from SPELL_SUMMON) is the only attribution path for these hits.
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'damage', spellId: 'swing', spellName: 'Melee', swingOwnerGuid: null, ...damage }
      }
    }

    // Augmentation Evoker support events: damage mechanically dealt through an ally's action
    // but credited to the supporter (Aug). The trailing field is the supporter's player GUID.
    // Field layout otherwise matches SPELL_DAMAGE (spellId at [9], spellName at [10]).
    case 'SPELL_DAMAGE_SUPPORT':
    case 'SPELL_PERIODIC_DAMAGE_SUPPORT':
    case 'RANGE_DAMAGE_SUPPORT':
    case 'SWING_DAMAGE_LANDED_SUPPORT': {
      const supportSourceGuid = fields[fields.length - 1]
      if (!supportSourceGuid?.startsWith('Player-')) return null
      // Strip the trailing supporter GUID so parseDamageSuffix reads the correct positions
      const damage = parseDamageSuffix(fields.slice(0, -1))
      if (!damage) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'damage',
          spellId: fields[9],
          spellName: stripQuotes(fields[10]),
          supportSourceGuid,
          ...damage,
        }
      }
    }

    // SPELL_HEAL_ABSORBED fires when a heal lands on a target carrying a heal-absorption
    // debuff (e.g. Light of the Martyr, Rift Sickness on Chimaerus).
    //
    // Field layout: [1..3] debuff applier, [5..7] target, [9..11] debuff spell,
    //               [12..14] healer of the absorbed heal, [16..18] heal spell,
    //               [-2] absorbedAmount, [-1] totalAmount
    //
    // WCL's model — which we mirror:
    //   - The original healer is already credited for the full pre-absorb
    //     amount, because the paired SPELL_HEAL carries baseAmount (pre-absorb)
    //     and the aggregator computes effective = baseAmount - overheal. For
    //     fully-absorbed heals no SPELL_HEAL fires at all, so those land only
    //     on the Martyr row — which matches WCL (e.g. Leech rows only include
    //     hits that actually reached the target).
    //   - The absorb debuff is shown as a NEGATIVE heal under the debuff's
    //     spell, credited to the debuff applier (paladin Light of the Martyr
    //     shows -N). Only emitted when the debuff applier is a player.
    //
    // Net effect on player total: sum(base - overheal) - sum(absorbed),
    // matching WCL's grand total.
    case 'SPELL_HEAL_ABSORBED': {
      if (fields.length < 21) return null
      if (!(source.flags & PLAYER_FLAG)) return null
      const absorbed = parseInt(fields[fields.length - 2])
      if (!absorbed || isNaN(absorbed)) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'heal',
          spellId: fields[9],
          spellName: stripQuotes(fields[10]),
          amount: -absorbed,
          baseAmount: -absorbed,
          overheal: 0,
          absorbed: 0,
          critical: false,
        }
      }
    }

    case 'SPELL_HEAL':
    case 'SPELL_PERIODIC_HEAL': {
      // Accept guardian/pet sources too (e.g. Yu'lon Soothing Breath, Jade Serpent Statue).
      // Owner resolution happens in the aggregator, same path as damage.
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS)) return null
      const heal = parseHealSuffix(fields)
      if (!heal) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: { type: 'heal', spellId: fields[9], spellName: stripQuotes(fields[10]), ...heal }
      }
    }

    // Absorb shields expiring unused → overheal. WCL's "overheal" column for classes
    // that cast absorb shields (DK Anti-Magic Shell, Priest Power Word: Shield, etc.)
    // is dominated by the leftover portion of shields that timed out before being fully
    // consumed. The leftover amount is carried in the trailing field of SPELL_AURA_REMOVED
    // for absorb buffs; non-absorb auras omit that field entirely.
    //
    // The shield caster's consumed absorption is already credited via SPELL_ABSORBED
    // (handled above), so here we only emit the unused remainder as pure overheal
    // (baseAmount = overheal, effective = 0) under the shield spell.
    //
    // The aura source may be a pet/creature if the shield was placed on a minion via a
    // hero-talent proc (e.g. Deathbringer's Anti-Magic Shell on the Four Horsemen). The
    // aggregator's knownOwnedCreature / petToOwner path resolves these back to the summoner.
    //
    // Field layout:
    //   Non-absorb buff (13 fields): [9]=spellId [10]=spellName [11]=school [12]=BUFF|DEBUFF
    //   Absorb buff    (14 fields): same + [13]=absorbAmount (leftover when aura expires)
    //
    // We require exactly 14 fields — non-absorb buffs never emit the trailing amount, and
    // any future layout change would push the field we read out of position, so better to
    // bail than to misinterpret. The BUFF check filters debuff removals (target-side), and
    // the positive-leftover check filters absorb shields that were fully consumed.
    case 'SPELL_AURA_REMOVED': {
      if (fields.length !== 14) return null
      if (fields[12] !== 'BUFF') return null
      const leftover = parseInt(fields[13])
      if (!leftover || isNaN(leftover) || leftover <= 0) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'heal',
          spellId: fields[9],
          spellName: stripQuotes(fields[10]),
          amount: 0,
          baseAmount: leftover,
          overheal: leftover,
          absorbed: 0,
          critical: false,
        }
      }
    }

    case 'SPELL_INTERRUPT': {
      // [9]=spellId [10]=spellName [11]=school [12]=extraSpellId [13]=extraSpellName [14]=extraSchool
      if (!(source.flags & ATTRIBUTABLE_SOURCE_FLAGS)) return null
      if (fields.length < 14) return null
      return {
        timestamp, type: eventType, source, dest,
        payload: {
          type: 'interrupt',
          spellId:       fields[9],
          spellName:     stripQuotes(fields[10]),
          extraSpellId:  fields[12],
          extraSpellName: stripQuotes(fields[13]),
        }
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
