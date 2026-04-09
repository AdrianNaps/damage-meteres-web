import type { ParsedEvent, DamagePayload, HealPayload, CombatantInfoPayload, DeathPayload, DeathRecapEvent } from './types.js'
import { PET_FLAG, GUARDIAN_FLAG } from './types.js'

import type { Segment, PlayerData, SpellDamageStats, SpellHealStats, TargetDamageStats, PlayerDeathRecord } from './store.js'

// Rolling window of recent damage/heal events per player GUID — not persisted to snapshot
const recentEvents = new Map<string, DeathRecapEvent[]>()

// Per-segment, per-source-guid record of the most recent damage credit. Used to subtract
// the support amount from the original caster when an Augmentation Evoker SUPPORT mirror
// arrives. Not persisted; transient WeakMap so it dies with the segment.
interface LastCredit {
  player: PlayerData
  spellId: string
  destName: string
  timestamp: number
  critical: boolean
}
const lastDamageCredit = new WeakMap<Segment, Map<string, LastCredit>>()

function getLastCreditMap(segment: Segment): Map<string, LastCredit> {
  let m = lastDamageCredit.get(segment)
  if (!m) { m = new Map(); lastDamageCredit.set(segment, m) }
  return m
}

const RECAP_WINDOW_SECONDS = 10  // how far back to collect events

function isPlayerGuid(guid: string): boolean {
  return guid.startsWith('Player-')
}

// Pet GUID format: Pet-0-{serverId}-{instanceId}-{zoneUID}-{npcId}-{spawnUID}
// The spawn UID has a leading hex index byte that increments per pet in a batch summon
// (e.g. Hunter Stampede spawning 14 pets produces UIDs 010554A4DA, 040554A4DA, … all
// sharing the trailing suffix). Two different batches — even from two different hunters
// in the same shard — get distinct suffixes from the client-side spawn counter, so the
// (shard, npcId, suffix) triple is a reliable "same summon → same owner" grouping key.
//
// Returns null if the GUID isn't a Pet- or doesn't have the expected shape, so callers
// can fall through without misattributing.
function petBatchKey(petGuid: string): string | null {
  if (!petGuid.startsWith('Pet-')) return null
  const parts = petGuid.split('-')
  if (parts.length < 7) return null
  const shard = parts.slice(2, 5).join('-')  // serverId-instanceId-zoneUID
  const npcId = parts[5]
  const spawnUid = parts[6]
  if (spawnUid.length < 3) return null
  // Strip the leading index byte (2 hex chars). Empirically stable across retail logs.
  const suffix = spawnUid.slice(2)
  return `${shard}|${npcId}|${suffix}`
}

// Single entry point for recording pet→owner. Also populates the batch map so that
// un-swung siblings from the same summon can be attributed later.
function recordPetOwner(segment: Segment, petGuid: string, ownerGuid: string) {
  if (segment.petToOwner[petGuid]) return  // don't overwrite — first owner wins
  segment.petToOwner[petGuid] = ownerGuid
  const key = petBatchKey(petGuid)
  if (key && !segment.petBatchToOwner[key]) {
    segment.petBatchToOwner[key] = ownerGuid
  }
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
    recordPetOwner(segment, event.dest.guid, event.source.guid)
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

    // Support events (e.g. Augmentation Evoker procs): damage is mechanically dealt through
    // an ally's action but belongs to the supporter. The combat log emits TWO events for the
    // same hit: a plain SPELL_DAMAGE listing the ally as source, and a *_DAMAGE_SUPPORT mirror
    // with the supporter GUID in the trailing field. WCL credits only the supporter.
    //
    // We mirror that: redirect SUPPORT events to the supporter, mark the spellId as
    // "support-owned", and (a) ignore future plain events for that spellId, (b) retroactively
    // strip any plain credits already booked before the first SUPPORT event arrived.
    if (dmg.supportSourceGuid) {
      const supporterName = segment.guidToName[dmg.supportSourceGuid]
      if (!supporterName) return  // haven't seen the supporter in any prior event yet — drop

      // (1) Precise pairing: the underlying hit was just credited to the original caster
      // (event.source.guid). The combat log emits the SUPPORT mirror immediately after the
      // original event with the same timestamp/source/dest. Subtract the support amount from
      // that prior credit so the caster's per-spell + total numbers match WCL. This handles
      // BOTH overlay-style support (Ebon Might/Shifting Sands/Prescience — original spellId
      // is unrelated, so the legacy spellId-scrub never matched) AND standalone Aug spells
      // (Breath of Eons etc.) where the plain event is fully attributable to the supporter.
      const creditMap = getLastCreditMap(segment)
      const prior = creditMap.get(event.source.guid)
      if (prior
          && prior.timestamp === event.timestamp
          && prior.destName === event.dest.name) {
        subtractFromCredit(segment, prior, event.source.name, dmg.amount - Math.max(dmg.overkill, 0))
      }

      // (2) Legacy spellId-scrub: kept as a fallback for any standalone-Aug plain events
      // that arrived before the first SUPPORT mirror (e.g. carry-over across segments).
      // Harmless for overlay-style support since their spellIds never appear as plain hits.
      if (!segment.supportOwnedSpellIds.has(dmg.spellId)) {
        segment.supportOwnedSpellIds.add(dmg.spellId)
        scrubSupportOwnedSpell(segment, dmg.spellId)
      }

      applyDamage(segment, supporterName, dmg.supportSourceGuid, event.dest.name, dmg, event.timestamp)
      return
    }

    // Plain damage event for a spellId that has been seen as support-owned: skip.
    // The matching SUPPORT mirror will (or already did) credit the supporter.
    if (segment.supportOwnedSpellIds.has(dmg.spellId)) return

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
        recordPetOwner(segment, event.source.guid, dmg.swingOwnerGuid)
      }
      let ownerGuid = segment.petToOwner[event.source.guid]
      // Sibling-suffix fallback: un-swung batched pets (Hunter Stampede in particular)
      // never populate petToOwner directly — no SPELL_SUMMON, no SWING_DAMAGE source-side
      // advanced-log block. If an already-attributed sibling from the same summon exists,
      // inherit its owner. See petBatchKey() comment for the reasoning.
      if (!ownerGuid) {
        const key = petBatchKey(event.source.guid)
        if (key) ownerGuid = segment.petBatchToOwner[key]
        if (ownerGuid) recordPetOwner(segment, event.source.guid, ownerGuid)
      }
      const ownerName = ownerGuid ? segment.guidToName[ownerGuid] : undefined
      if (!ownerName) return
      sourceName = ownerName
      sourceGuid = ownerGuid
    }

    applyDamage(segment, sourceName, sourceGuid, event.dest.name, dmg, event.timestamp)
  } else if (payload.type === 'heal') {
    const heal = payload as HealPayload

    if (isPlayerGuid(event.dest.guid)) {
      pushRecentEvent(event.dest.guid, {
        timestamp: event.timestamp,
        kind: 'heal',
        spellId:        heal.spellId,
        spellName:      heal.spellName,
        amount:         heal.baseAmount - heal.overheal,  // effective heal
        overkill:       0,
        absorbed:       heal.absorbed,
        critical:       heal.critical,
        sourceName:     event.source.name,
        sourceIsPlayer: isPlayerGuid(event.source.guid),
      })
    }

    // Resolve pet/guardian heal sources (Yu'lon Soothing Breath, Jade Serpent Statue
    // Soothing Mist, etc.) back to the summoning player. Same logic as the damage path,
    // minus the SWING advanced-log bootstrap (heal events don't carry source-side owner).
    let sourceName = event.source.name
    let sourceGuid = event.source.guid
    const isPet = !!(event.source.flags & (PET_FLAG | GUARDIAN_FLAG))
    if (isPet) {
      let ownerGuid = segment.petToOwner[event.source.guid]
      if (!ownerGuid) {
        const key = petBatchKey(event.source.guid)
        if (key) ownerGuid = segment.petBatchToOwner[key]
        if (ownerGuid) recordPetOwner(segment, event.source.guid, ownerGuid)
      }
      const ownerName = ownerGuid ? segment.guidToName[ownerGuid] : undefined
      if (!ownerName) return
      sourceName = ownerName
      sourceGuid = ownerGuid
    }

    applyHeal(segment, sourceName, sourceGuid, heal)
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
  } else if (payload.type === 'interrupt') {
    // Resolve pet/guardian source back to owning player, same as damage/heal paths.
    let sourceName = event.source.name
    let sourceGuid = event.source.guid
    const isPet = !!(event.source.flags & (PET_FLAG | GUARDIAN_FLAG))
    if (isPet) {
      let ownerGuid = segment.petToOwner[event.source.guid]
      if (!ownerGuid) {
        const key = petBatchKey(event.source.guid)
        if (key) ownerGuid = segment.petBatchToOwner[key]
        if (ownerGuid) recordPetOwner(segment, event.source.guid, ownerGuid)
      }
      const ownerName = ownerGuid ? segment.guidToName[ownerGuid] : undefined
      if (!ownerName) return
      sourceName = ownerName
      sourceGuid = ownerGuid
    } else if (!event.source.guid.startsWith('Player-')) {
      return
    }

    const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
    if (!player) return

    player.interrupts.total++

    const kicker = player.interrupts.byKicker[payload.spellId]
    if (!kicker) {
      player.interrupts.byKicker[payload.spellId] = {
        spellId: payload.spellId,
        spellName: payload.spellName,
        count: 1,
      }
    } else {
      kicker.count++
    }

    const kicked = player.interrupts.byKicked[payload.extraSpellId]
    if (!kicked) {
      player.interrupts.byKicked[payload.extraSpellId] = {
        spellId: payload.extraSpellId,
        spellName: payload.extraSpellName,
        count: 1,
      }
    } else {
      kicked.count++
    }
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
      interrupts: { total: 0, byKicker: {}, byKicked: {} },
    }
  } else if (segment.players[normalized].specId === undefined && segment.guidToSpec[guid] !== undefined) {
    segment.players[normalized].specId = segment.guidToSpec[guid]
  }
  return segment.players[normalized]
}

// When a spellId is first identified as support-owned, retroactively remove any plain
// damage already credited to players for that spell (which arrived before the first
// SUPPORT mirror). Walks all players; cheap because it runs at most once per spellId.
function scrubSupportOwnedSpell(segment: Segment, spellId: string) {
  for (const player of Object.values(segment.players)) {
    const spell = player.damage.spells[spellId]
    if (!spell) continue
    const removed = spell.total
    player.damage.total -= removed
    delete player.damage.spells[spellId]

    // Per-target totals: we don't track which target each event hit, so we can't
    // surgically subtract per target. Instead, scale: if this spell was X% of the
    // player's total damage to a target, that approximation breaks. Simpler and
    // accurate: leave per-target totals slightly stale. They're a rollup display
    // and the player.damage.total / per-spell view is correct.
    // (Acceptable tradeoff — alternative is tracking spell-by-target which adds memory.)

    // Segment-wide damage-taken aggregation also gets the same approximation.
    // The numbers will be slightly off in the "damage to target" breakdown only.
    void removed
  }
}

function applyDamage(segment: Segment, sourceName: string, sourceGuid: string, destName: string, payload: DamagePayload, timestamp: number) {
  const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
  if (!player) return
  const { spellId, spellName, absorbed, resisted, blocked, critical } = payload
  // WCL's "Amount" column excludes overkill (damage dealt past 0 HP). Match that convention.
  // overkill is -1 when the hit wasn't a killing blow, >0 only on the killing blow itself.
  const amount = payload.amount - Math.max(payload.overkill, 0)

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

  // Record this credit so a *_DAMAGE_SUPPORT mirror arriving on the next line for the
  // same (sourceGuid, destName, timestamp) can subtract its support amount from this hit.
  getLastCreditMap(segment).set(sourceGuid, { player, spellId, destName, timestamp, critical })
}

// Subtract a SUPPORT mirror's amount from a previously credited hit on the original caster.
// Adjusts player total, the matching spell's totals, the per-target rollup, and the
// segment-wide damage-taken aggregation. hitCount/min/max are intentionally left untouched —
// the hit still happened; only its attributable magnitude shrinks.
function subtractFromCredit(segment: Segment, prior: LastCredit, sourceName: string, supportAmount: number) {
  const { player, spellId, destName, critical } = prior
  const spell = player.damage.spells[spellId]
  if (!spell) return  // already scrubbed by spellId path

  // Don't let any bucket go negative if the SUPPORT amount somehow exceeds the recorded hit
  const sub = Math.min(supportAmount, spell.total)

  player.damage.total -= sub
  spell.total -= sub
  if (critical) spell.critTotal -= sub
  else          spell.normalTotal -= sub

  const targetEntry = player.damage.targets[destName]
  if (targetEntry) targetEntry.total -= sub

  const taken = segment.targetDamageTaken[destName]
  if (taken) {
    taken.total -= sub
    const src = taken.sources[sourceName]
    if (src) src.total -= sub
  }
}

// Some spells fire under multiple spellIds that players think of as one ability
// (e.g. Sun's Avatar has 6 distinct IDs for base/empowered/etc. variants). Map
// every alias to a single canonical (id, name) pair so the breakdown aggregates
// them the way WCL/Details do.
const HEAL_SPELL_ALIASES: Record<string, { id: string; name: string }> = {
  '431911': { id: '431907', name: "Sun's Avatar" },
  '431939': { id: '431907', name: "Sun's Avatar" },
  '463073': { id: '431907', name: "Sun's Avatar" },
  '463074': { id: '431907', name: "Sun's Avatar" },
  '463075': { id: '431907', name: "Sun's Avatar" },
}

function applyHeal(segment: Segment, sourceName: string, sourceGuid: string, payload: HealPayload) {
  const player = getOrCreatePlayer(segment, sourceName, sourceGuid)
  if (!player) return
  const alias = HEAL_SPELL_ALIASES[payload.spellId]
  const spellId   = alias?.id   ?? payload.spellId
  const spellName = alias?.name ?? payload.spellName
  const { baseAmount, overheal, absorbed, critical } = payload

  // WCL's model: effective heal is (baseAmount - overheal). baseAmount is the
  // pre-absorb heal value, so this credits the healer for heals that land and
  // are then eaten by a heal-absorb debuff (Light of the Martyr, Rift Sickness,
  // etc.) — matching how WCL shows Holy Shock/Holy Light/etc. at their full
  // totals. The absorb debuff itself is accounted as a negative heal elsewhere
  // (see SPELL_HEAL_ABSORBED in parser.ts) so the player grand total nets out.
  const effective = baseAmount - overheal
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
