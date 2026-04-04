import type { ParsedEvent, DamagePayload, HealPayload, CombatantInfoPayload } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'

import type { Segment, PlayerData, SpellDamageStats, SpellHealStats } from './store.js'

export function applyEvent(segment: Segment, event: ParsedEvent) {
  const { payload } = event

  if (payload.type === 'combatantInfo') {
    const p = payload as CombatantInfoPayload
    segment.guidToSpec[p.playerGuid] = p.specId
    // If this player already exists (e.g. from a previous pull), backfill specId
    const existingName = segment.guidToName[p.playerGuid]
    if (existingName && segment.players[existingName]) {
      segment.players[existingName].specId = p.specId
    }
    return
  }

  if (payload.type === 'summon') {
    // source is the summoning player — record pet→owner and ensure owner name is in guidToName
    segment.petToOwner[event.dest.guid] = event.source.guid
    segment.guidToName[event.source.guid] = event.source.name
    return
  }

  if (payload.type === 'damage') {
    const dmg = payload as DamagePayload
    let sourceName = event.source.name
    let sourceGuid = event.source.guid

    const isPet = !!(event.source.flags & (PET_FLAG | GUARDIAN_FLAG))
    if (isPet) {
      // Bootstrap petToOwner from the source-side advanced-log owner GUID embedded in SWING_DAMAGE
      // events (fields[10]). The advanced-log does not carry the owner's name, so this path only
      // succeeds if guidToName already has the owner (via SPELL_SUMMON, carry-over, or a prior
      // player event). If the owner name is still unknown, drop the event rather than create a
      // phantom player entry — this only affects persistent pets (e.g. Felhunter) in raids where
      // no SPELL_SUMMON was logged and the owner has not yet appeared in the segment.
      if (dmg.swingOwnerGuid && dmg.swingOwnerGuid !== '0000000000000000') {
        segment.petToOwner[event.source.guid] = dmg.swingOwnerGuid
      }
      const ownerGuid = segment.petToOwner[event.source.guid]
      const ownerName = ownerGuid ? segment.guidToName[ownerGuid] : undefined
      if (!ownerName) return
      sourceName = ownerName
      sourceGuid = ownerGuid!
    }

    applyDamage(segment, sourceName, sourceGuid, dmg)
  } else if (payload.type === 'heal') {
    applyHeal(segment, event.source.name, event.source.guid, payload as HealPayload)
  }

  if (segment.firstEventTime === null) segment.firstEventTime = event.timestamp
  segment.lastEventTime = event.timestamp
}

function getOrCreatePlayer(segment: Segment, name: string, guid: string): PlayerData {
  segment.guidToName[guid] = name
  if (!segment.players[name]) {
    segment.players[name] = {
      name,
      specId: segment.guidToSpec[guid],
      damage: { total: 0, spells: {} },
      healing: { total: 0, overheal: 0, spells: {} },
    }
  } else if (segment.players[name].specId === undefined && segment.guidToSpec[guid] !== undefined) {
    segment.players[name].specId = segment.guidToSpec[guid]
  }
  return segment.players[name]
}

function applyDamage(segment: Segment, sourceName: string, sourceGuid: string, payload: DamagePayload) {
  const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
  const { spellId, spellName, amount, absorbed, resisted, blocked, critical } = payload

  player.damage.total += amount

  if (!player.damage.spells[spellId]) {
    player.damage.spells[spellId] = {
      spellId,
      spellName,
      total: 0,
      hitCount: 0,
      critCount: 0,
      normalTotal: 0,
      normalMin: Infinity,
      normalMax: 0,
      critTotal: 0,
      critMin: Infinity,
      critMax: 0,
      absorbed: 0,
      resisted: 0,
      blocked: 0,
    }
  }

  const spell = player.damage.spells[spellId]
  spell.total += amount
  spell.hitCount++
  spell.absorbed += absorbed
  spell.resisted += resisted
  spell.blocked += blocked

  if (critical) {
    spell.critCount++
    spell.critTotal += amount
    spell.critMin = Math.min(spell.critMin, amount)
    spell.critMax = Math.max(spell.critMax, amount)
  } else {
    spell.normalTotal += amount
    spell.normalMin = Math.min(spell.normalMin, amount)
    spell.normalMax = Math.max(spell.normalMax, amount)
  }
}

function applyHeal(segment: Segment, sourceName: string, sourceGuid: string, payload: HealPayload) {
  const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
  const { spellId, spellName, amount, overheal, absorbed, critical } = payload

  // effective heal = amount - overheal
  const effective = amount - overheal
  player.healing.total += effective
  player.healing.overheal += overheal

  if (!player.healing.spells[spellId]) {
    player.healing.spells[spellId] = {
      spellId,
      spellName,
      total: 0,
      overheal: 0,
      absorbed: 0,
      hitCount: 0,
      critCount: 0,
    }
  }

  const spell = player.healing.spells[spellId]
  spell.total += effective
  spell.overheal += overheal
  spell.absorbed += absorbed
  spell.hitCount++
  if (critical) spell.critCount++
}
