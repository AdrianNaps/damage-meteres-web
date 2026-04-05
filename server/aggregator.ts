import type { ParsedEvent, DamagePayload, HealPayload, CombatantInfoPayload, DeathPayload, DeathRecapEvent } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'

import type { Segment, PlayerData, SpellDamageStats, SpellHealStats, TargetDamageStats, PlayerDeathRecord } from './store.js'

// Rolling window of recent damage/heal events per player GUID — not persisted to snapshot
const recentEvents = new Map<string, DeathRecapEvent[]>()

const RECAP_WINDOW_SECONDS = 10  // how far back to collect events

function isPlayerGuid(guid: string): boolean {
  return guid.startsWith('Player-')
}

function pushRecentEvent(guid: string, entry: DeathRecapEvent) {
  let buf = recentEvents.get(guid) ?? []
  const cutoff = entry.timestamp - RECAP_WINDOW_SECONDS * 1000
  buf = buf.filter(e => e.timestamp >= cutoff)
  buf.push(entry)
  recentEvents.set(guid, buf)
}

export function resetRecentEvents() {
  recentEvents.clear()
}

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

    // Track for death recap — victim tracking is independent of source pet resolution
    if (isPlayerGuid(event.dest.guid)) {
      pushRecentEvent(event.dest.guid, {
        timestamp: event.timestamp,
        kind: 'damage',
        spellId:        dmg.spellId,
        spellName:      dmg.spellName,
        amount:         dmg.amount,
        overkill:       dmg.overkill,
        absorbed:       dmg.absorbed,
        critical:       dmg.critical,
        sourceName:     event.source.name,
        sourceIsPlayer: isPlayerGuid(event.source.guid),
      })
    }

    // Only attribute damage to the meter for player/pet sources.
    // Creature→player events are allowed through the parser for death recap above,
    // but should not create phantom player entries in the damage meter.
    const sourceIsAttributable = isPlayerGuid(event.source.guid)
      || !!(event.source.flags & (PET_FLAG | GUARDIAN_FLAG))
    if (!sourceIsAttributable) return

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

    applyDamage(segment, sourceName, sourceGuid, event.dest.name, dmg)
  } else if (payload.type === 'heal') {
    const heal = payload as HealPayload

    if (isPlayerGuid(event.dest.guid)) {
      pushRecentEvent(event.dest.guid, {
        timestamp: event.timestamp,
        kind: 'heal',
        spellId:        heal.spellId,
        spellName:      heal.spellName,
        amount:         heal.amount - heal.overheal,  // effective heal
        overkill:       0,
        absorbed:       heal.absorbed,
        critical:       heal.critical,
        sourceName:     event.source.name,
        sourceIsPlayer: isPlayerGuid(event.source.guid),
      })
    }

    applyHeal(segment, event.source.name, event.source.guid, heal)
  } else if (payload.type === 'death') {
    if (payload.unconsciousOnDeath) return
    if (!isPlayerGuid(event.dest.guid)) return

    const guid = event.dest.guid
    const recap = recentEvents.get(guid) ?? []

    const killingBlow = [...recap].reverse().find(e => e.kind === 'damage' && e.overkill > 0)
      ?? [...recap].reverse().find(e => e.kind === 'damage')
      ?? null

    const playerName = segment.guidToName[guid] ?? event.dest.name

    const record: PlayerDeathRecord = {
      playerName,
      playerGuid: guid,
      timeOfDeath: event.timestamp,
      combatElapsed: segment.firstEventTime != null
        ? (event.timestamp - segment.firstEventTime) / 1000
        : 0,
      killingBlow: killingBlow
        ? {
            spellId:    killingBlow.spellId,
            spellName:  killingBlow.spellName,
            sourceName: killingBlow.sourceName,
            overkill:   killingBlow.overkill,
          }
        : null,
      recap: [...recap],
    }

    const player = getOrCreatePlayer(segment, playerName, guid)
    if (player) player.deaths.push(record)

    // Clear the buffer so a rez + second death starts fresh
    recentEvents.delete(guid)
    return
  }

  if (segment.firstEventTime === null) segment.firstEventTime = event.timestamp
  segment.lastEventTime = event.timestamp
}

function getOrCreatePlayer(segment: Segment, name: string, guid: string): PlayerData | null {
  // "nil" is Lua's tostring(nil) — emitted when the WoW API can't resolve the unit name
  if (!name || name === 'nil') return null
  // Normalize to NFC so the same special character emitted in NFC and NFD form
  // doesn't produce two separate player entries in the map
  const normalized = name.normalize('NFC')
  segment.guidToName[guid] = normalized
  if (!segment.players[normalized]) {
    segment.players[normalized] = {
      name: normalized,
      specId: segment.guidToSpec[guid],
      damage: { total: 0, spells: {}, targets: {} },
      healing: { total: 0, overheal: 0, spells: {} },
      deaths: [],
    }
  } else if (segment.players[normalized].specId === undefined && segment.guidToSpec[guid] !== undefined) {
    segment.players[normalized].specId = segment.guidToSpec[guid]
  }
  return segment.players[normalized]
}

function applyDamage(segment: Segment, sourceName: string, sourceGuid: string, destName: string, payload: DamagePayload) {
  const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
  if (!player) return
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

  if (!player.damage.targets[destName]) {
    player.damage.targets[destName] = { targetName: destName, total: 0 }
  }
  player.damage.targets[destName].total += amount

  if (!segment.targetDamageTaken[destName]) {
    segment.targetDamageTaken[destName] = { total: 0, sources: {} }
  }
  const taken = segment.targetDamageTaken[destName]
  taken.total += amount
  if (!taken.sources[sourceName]) {
    taken.sources[sourceName] = { sourceName, total: 0 }
  }
  taken.sources[sourceName].total += amount

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
  if (!player) return
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
