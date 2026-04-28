import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EncounterStateMachine } from './stateMachine.js'
import { SegmentStore } from './store.js'
import { parseLine } from './parser.js'
import type { ParsedEvent, ChallengeModePayload, EncounterPayload, CombatantInfoPayload, DamagePayload, DeathPayload, UnitRef, AuraPayload, CastPayload, CastStartPayload, CastFailedPayload } from './types.js'

const NULL_UNIT: UnitRef = { guid: '', name: '', flags: 0 }
const BASE_TS = 1_000_000

function t(offset = 0) { return BASE_TS + offset }

function challengeStart(dungeonName = 'Ara-Kara', offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'CHALLENGE_MODE_START',
    source: NULL_UNIT,
    dest: NULL_UNIT,
    payload: { type: 'challengeMode', dungeonName, instanceID: 1, keystoneLevel: 10 } satisfies ChallengeModePayload,
  }
}

function challengeEnd(success: boolean, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'CHALLENGE_MODE_END',
    source: NULL_UNIT,
    dest: NULL_UNIT,
    payload: { type: 'challengeMode', instanceID: 1, success, durationMs: offset } satisfies ChallengeModePayload,
  }
}

function encounterStart(name: string, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'ENCOUNTER_START',
    source: NULL_UNIT,
    dest: NULL_UNIT,
    payload: { type: 'encounter', encounterID: 1, encounterName: name, difficultyID: 8, groupSize: 5 } satisfies EncounterPayload,
  }
}

function encounterEnd(name: string, success: boolean, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'ENCOUNTER_END',
    source: NULL_UNIT,
    dest: NULL_UNIT,
    payload: { type: 'encounter', encounterID: 1, encounterName: name, difficultyID: 8, groupSize: 5, success } satisfies EncounterPayload,
  }
}

function combatantInfo(playerGuid: string, specId: number, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'COMBATANT_INFO',
    source: NULL_UNIT,
    dest: NULL_UNIT,
    payload: { type: 'combatantInfo', playerGuid, specId } satisfies CombatantInfoPayload,
  }
}

// --- Trash mob event helpers ---

const PLAYER_FLAGS = 0x511        // friendly player, party/raid affiliation
const HOSTILE_NPC_FLAGS = 0xa48   // hostile NPC (outsider, HOSTILE, CONTROL_NPC, TYPE_NPC)

function makePlayer(guid = 'Player-1', name = 'Adrianw'): UnitRef {
  return { guid, name, flags: PLAYER_FLAGS }
}
function makeMob(guid: string, name: string): UnitRef {
  return { guid, name, flags: HOSTILE_NPC_FLAGS }
}

// Damage FROM a player TO a hostile mob, with an HP snapshot so reset detection
// can act on it. `currentHP`/`maxHP` are the mob's state post-hit.
function mobDamage(mob: UnitRef, currentHP: number, maxHP: number, offset = 0, player: UnitRef = makePlayer()): ParsedEvent {
  const payload: DamagePayload = {
    type: 'damage',
    spellId: '9999',
    spellName: 'Test Hit',
    amount: 1,
    baseAmount: 1,
    overkill: -1,
    school: 1,
    resisted: 0,
    blocked: 0,
    absorbed: 0,
    critical: false,
    glancing: false,
    crushing: false,
    destCurrentHP: currentHP,
    destMaxHP: maxHP,
  }
  return { timestamp: t(offset), type: 'SPELL_DAMAGE', source: player, dest: mob, payload }
}

function mobDied(mob: UnitRef, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset),
    type: 'UNIT_DIED',
    source: NULL_UNIT,
    dest: mob,
    payload: { type: 'death', unconsciousOnDeath: false } satisfies DeathPayload,
  }
}

const stubIconResolver = {
  requestMany() {},
  getAll() { return {} },
}

function makeSm() {
  const store = new SegmentStore(20, stubIconResolver)
  const sm = new EncounterStateMachine(store)
  return { sm, store }
}

// --- Tests ---

test('key with no trash combat: only Pack 1 placeholder + boss', () => {
  const { sm, store } = makeSm()

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Anub\'ikkaj', 100))
  sm.handle(encounterEnd('Anub\'ikkaj', true, 200))
  sm.handle(challengeEnd(true, 300))

  // No hostile mob events, so only the initial placeholder pack exists + the boss.
  // No post-boss pack is created since nothing was pulled.
  const segs = store.getAll()
  assert.equal(segs.length, 2)
  assert.equal(segs[0].encounterName, 'Pack 1')  // placeholder — no mob info observed
  assert.equal(segs[1].encounterName, 'Anub\'ikkaj')
})

test('single pack of trash: closes with highest-HP mob name when all mobs die', () => {
  const { sm, store } = makeSm()

  const champion = makeMob('Creature-0-1-1-1-111-000A', 'Shadowguard Champion')
  const grunt    = makeMob('Creature-0-1-1-1-222-000B', 'Famished Broken')

  sm.handle(challengeStart('Ara-Kara', 0))
  // First hit on the champion (5M HP) — opens Pack 1
  sm.handle(mobDamage(champion, 4_000_000, 5_000_000, 100))
  // First hit on the grunt (1M HP) — same pack
  sm.handle(mobDamage(grunt,      800_000, 1_000_000, 200))
  // Both die
  sm.handle(mobDied(grunt,    300))
  sm.handle(mobDied(champion, 400))
  sm.handle(challengeEnd(true, 500))

  const segs = store.getAll()
  assert.equal(segs.length, 1)
  // Highest-max-HP mob in the pack is the Champion → that's the final name
  assert.equal(segs[0].encounterName, 'Pack 1: Shadowguard Champion')
  assert.equal(segs[0].success, true)
})

test('two sequential packs: closes pack 1 on last death, opens pack 2 on next pull', () => {
  const { sm, store } = makeSm()

  const mobA = makeMob('Creature-0-1-1-1-111-000A', 'Raging Tusker')
  const mobB = makeMob('Creature-0-1-1-1-222-000B', 'Sand Cleric')

  sm.handle(challengeStart('Ara-Kara', 0))
  // Pack 1
  sm.handle(mobDamage(mobA, 900_000, 1_000_000, 100))
  sm.handle(mobDied(mobA, 200))
  // Pack 2 — new hostile event after prior pack closed
  sm.handle(mobDamage(mobB, 1_800_000, 2_000_000, 1000))
  sm.handle(mobDied(mobB, 1500))
  sm.handle(challengeEnd(true, 2000))

  const segs = store.getAll()
  assert.equal(segs.length, 2)
  assert.equal(segs[0].encounterName, 'Pack 1: Raging Tusker')
  assert.equal(segs[1].encounterName, 'Pack 2: Sand Cleric')
})

test('partial pack deaths: pack stays open while any tracked mob is still alive', () => {
  // Exercises activeMobs.size > 0 keeping the pack open across partial deaths.
  const { sm, store } = makeSm()
  const tank = makeMob('Creature-0-1-1-1-111-000A', 'Sand Guardian')
  const caster = makeMob('Creature-0-1-1-1-222-000B', 'Dune Cleric')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(mobDamage(tank, 3_000_000, 3_000_000, 100))
  sm.handle(mobDamage(caster,  500_000, 1_000_000, 200))
  sm.handle(mobDied(caster, 300))   // one mob dies — pack stays open since tank is still alive
  sm.handle(mobDamage(tank, 1_000_000, 3_000_000, 400))  // tank still being fought
  sm.handle(mobDied(tank, 500))     // now the pack closes
  sm.handle(challengeEnd(true, 600))

  const segs = store.getAll()
  assert.equal(segs.length, 1)
  // Highest-max-HP mob is Sand Guardian (3M) → pack name reflects it
  assert.equal(segs[0].encounterName, 'Pack 1: Sand Guardian')
  assert.equal(segs[0].success, true)
})

test('mob-source-only pack: unnamed pack is discarded at kill-close', () => {
  // Exercises the sourceIsMob && !destIsMob branch combined with the unnamed-pack
  // discard. A mob swinging at a player (no HP snapshot, since HP is dest-side)
  // opens a pack; when that mob dies, the pack has a kill but no named mob. Real
  // trash engagements always generate at least one player-to-mob damage event
  // with HP, so an unnamed pack is noise (distant mob's stray hit) — discard it.
  const { sm, store } = makeSm()
  const mob = makeMob('Creature-0-1-1-1-111-000A', 'Silent Stalker')
  const player = makePlayer()

  const mobAttacksPlayer: ParsedEvent = {
    timestamp: t(100),
    type: 'SPELL_DAMAGE',
    source: mob,
    dest: player,
    payload: {
      type: 'damage', spellId: '9999', spellName: 'Ambush',
      amount: 1000, baseAmount: 1000, overkill: -1, school: 1,
      resisted: 0, blocked: 0, absorbed: 0, critical: false, glancing: false, crushing: false,
    },
  }

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(mobAttacksPlayer)
  sm.handle(mobDied(mob, 200))
  sm.handle(challengeEnd(true, 300))

  // Only the initial placeholder Pack 1 from CHALLENGE_MODE_START remains; the
  // ghost pack opened by the stray mob swing was discarded.
  const segs = store.getAll()
  assert.equal(segs.length, 1)
  assert.equal(segs[0].encounterName, 'Pack 1')
})

test('sequential resets: wipe → re-engage → wipe produces three packs', () => {
  // Two consecutive wipes on the same mob should produce three distinct packs:
  // two failed and one in-flight (still open until the key ends).
  const { sm, store } = makeSm()
  const mob = makeMob('Creature-0-1-1-1-111-000A', 'Dreadstalker')

  sm.handle(challengeStart('Ara-Kara', 0))
  // Pack 1: pull → wipe
  sm.handle(mobDamage(mob, 4_000_000, 4_000_000, 100))   // 100%
  sm.handle(mobDamage(mob,   800_000, 4_000_000, 500))   // 20% — armed
  // Leash → heal to full → re-engage
  sm.handle(mobDamage(mob, 4_000_000, 4_000_000, 5_000)) // reset #1
  // Pack 2: fight it down → wipe again
  sm.handle(mobDamage(mob,   600_000, 4_000_000, 10_000)) // 15%
  sm.handle(mobDamage(mob, 4_000_000, 4_000_000, 15_000)) // reset #2
  // Pack 3: kill it
  sm.handle(mobDied(mob, 20_000))
  sm.handle(challengeEnd(true, 25_000))

  const segs = store.getAll()
  assert.equal(segs.length, 3)
  assert.equal(segs[0].success, false)  // first wipe
  assert.equal(segs[1].success, false)  // second wipe
  assert.equal(segs[2].success, true)   // final kill
  assert.equal(segs[0].encounterName, 'Pack 1: Dreadstalker')
  assert.equal(segs[1].encounterName, 'Pack 2: Dreadstalker')
  assert.equal(segs[2].encounterName, 'Pack 3: Dreadstalker')
})

test('reset detection: HP jump to 95%+ closes pack as wipe and opens a new one', () => {
  const { sm, store } = makeSm()

  const mob = makeMob('Creature-0-1-1-1-111-000A', 'Merciless Subjugator')

  sm.handle(challengeStart('Ara-Kara', 0))
  // Pull the mob, fight down to 23% HP (mimicking the real wipe log at line 23536)
  sm.handle(mobDamage(mob, 4_000_000, 4_000_000, 100))  // 100%
  sm.handle(mobDamage(mob,   920_000, 4_000_000, 500))  // 23% — group fighting
  // Group wipes, mob leashes and heals to full. Next hit shows HP back at 100%.
  sm.handle(mobDamage(mob, 3_800_000, 4_000_000, 10_000))  // 95% — reset detected
  // Group kills it this time
  sm.handle(mobDied(mob, 15_000))
  sm.handle(challengeEnd(true, 20_000))

  const segs = store.getAll()
  assert.equal(segs.length, 2)
  // First pack was the wipe — success=false, name still reflects highest-HP mob seen
  assert.equal(segs[0].encounterName, 'Pack 1: Merciless Subjugator')
  assert.equal(segs[0].success, false)
  // Second pack is the successful re-engage
  assert.equal(segs[1].encounterName, 'Pack 2: Merciless Subjugator')
  assert.equal(segs[1].success, true)
})

test('boss transition: trash pack closes at ENCOUNTER_START, next pack opens post-boss on first hostile event', () => {
  const { sm, store } = makeSm()

  const trashBefore = makeMob('Creature-0-1-1-1-100-000A', 'Pre-Boss Trash')
  const trashAfter  = makeMob('Creature-0-1-1-1-200-000B', 'Post-Boss Trash')

  sm.handle(challengeStart('Ara-Kara', 0))
  // Pack 1: pre-boss trash
  sm.handle(mobDamage(trashBefore, 900_000, 1_000_000, 100))
  sm.handle(mobDied(trashBefore, 200))
  // Pack 2 would be opened by next hit, but boss pulls first — no Pack 2 between Pack 1 kill and boss
  sm.handle(encounterStart('Anub\'ikkaj', 500))
  sm.handle(encounterEnd('Anub\'ikkaj', true, 1000))
  // Pack 2: post-boss trash (first hostile event after ENCOUNTER_END opens it)
  sm.handle(mobDamage(trashAfter, 1_500_000, 2_000_000, 1500))
  sm.handle(mobDied(trashAfter, 2000))
  sm.handle(challengeEnd(true, 3000))

  const segs = store.getAll()
  assert.equal(segs.length, 3)
  assert.equal(segs[0].encounterName, 'Pack 1: Pre-Boss Trash')
  assert.equal(segs[1].encounterName, 'Anub\'ikkaj')
  assert.equal(segs[2].encounterName, 'Pack 2: Post-Boss Trash')
})

test('overkill tick between bosses does not open a spurious pack', () => {
  // Pets/DoTs can land one last damage event on a mob AFTER UNIT_DIED fires; that
  // event arrives with currentHP=0. Between boss fights (currentSegment=null),
  // such a ghost tick would wrongly open a new pack for a single tick, producing
  // a tiny (<1s) "Pack N" segment. Guard: ignore currentHP=0 events on GUIDs
  // that aren't already tracked.
  const { sm, store } = makeSm()
  const boss3Add = makeMob('Creature-0-1-1-1-300-000A', 'Umbral Tentacle')

  sm.handle(challengeStart('Seat', 0))
  sm.handle(encounterStart('Viceroy Nezhar', 100))
  sm.handle(encounterEnd('Viceroy Nezhar', true, 1000))
  // Ghost overkill tick on an add that was killed during the boss fight —
  // arrives at currentHP=0 and is NOT already tracked.
  sm.handle(mobDamage(boss3Add, 0, 5_000_000, 1050))
  sm.handle(encounterStart('L\'ura', 1100))
  sm.handle(encounterEnd('L\'ura', true, 2000))
  sm.handle(challengeEnd(true, 3000))

  const segs = store.getAll()
  // Expected: Pack 1 (placeholder), Viceroy Nezhar, L'ura. No spurious Pack 2.
  assert.equal(segs.length, 3)
  assert.equal(segs[0].encounterName, 'Pack 1')
  assert.equal(segs[1].encounterName, 'Viceroy Nezhar')
  assert.equal(segs[2].encounterName, 'L\'ura')
})

test('key depleted mid-boss: boss closes with success=false before challenge_end fires', () => {
  const { sm, store } = makeSm()
  const events: string[] = []

  sm.on('encounter_end', seg => events.push(`encounter_end:${seg.encounterName}:${seg.success}`))
  sm.on('challenge_end', seg => events.push(`challenge_end:${seg.encounterName}`))

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Boss 1', 100))
  sm.handle(challengeEnd(false, 200))  // timer expires mid-boss

  assert.deepEqual(events, [
    'encounter_end:Boss 1:false',
    // No mobs were tracked in the initial placeholder pack — name stays as "Pack 1"
    'challenge_end:Pack 1',
  ])

  const segs = store.getAll()
  // Pack 1 had no trash combat — it was closed trivially at ENCOUNTER_START with
  // success=true. The key failing doesn't retroactively mark prior successful packs
  // as failures under the new per-pack model. Only the boss (which was in progress
  // when the key depleted) gets success=false.
  assert.equal(segs[0].success, true)
  assert.equal(segs[1].success, false)  // Boss 1 (force-closed)
})

test('inactivity prune: ghost mob with no UNIT_DIED is evicted after >15s of silence, splitting pack', () => {
  // NPX case: a Lingering Image despawns silently without firing UNIT_DIED,
  // leaving a ghost entry in activeMobs that would otherwise merge the rest of
  // the key into one pack. After 15s of silence on the ghost GUID, the next
  // trash event should prune it, close the stalled pack (since the pack had
  // real kills of other mobs), and open a new one.
  const { sm, store } = makeSm()
  const realMob  = makeMob('Creature-0-1-1-1-100-000A', 'Shadowguard Champion')
  const ghost    = makeMob('Creature-0-1-1-1-100-000B', 'Lingering Image')
  const nextPack = makeMob('Creature-0-1-1-1-200-000C', 'Dreadflail')

  sm.handle(challengeStart('Nexus-Point Xenas', 0))
  // Pack 1: real mob dies (gives the pack a kill), ghost then takes a hit and
  // goes silent without dying
  sm.handle(mobDamage(realMob, 500_000, 3_000_000, 50))
  sm.handle(mobDied(realMob, 60))
  sm.handle(mobDamage(ghost, 2_000_000, 3_000_000, 100))
  // 20s later, the group engages the next pack — prune fires, ghost evicted,
  // Pack 1 closes (had kills → kept), Pack 2 opens
  sm.handle(mobDamage(nextPack, 900_000, 1_000_000, 20_100))
  sm.handle(mobDied(nextPack, 20_200))
  sm.handle(challengeEnd(true, 21_000))

  const segs = store.getAll()
  assert.equal(segs.length, 2)
  assert.equal(segs[0].encounterName, 'Pack 1: Shadowguard Champion')
  assert.equal(segs[1].encounterName, 'Pack 2: Dreadflail')
})

test('empty pack discard: inactivity close with no kills drops the segment and rolls back the counter', () => {
  // A stray DoT tick on a distant hostile mob opens a pack; the mob never dies
  // (unrelated to the real fight) and silence hits the timeout. That pack is
  // noise and should be discarded so the next real engagement is still Pack 2
  // rather than Pack 3.
  const { sm, store } = makeSm()
  const realMob  = makeMob('Creature-0-1-1-1-100-000A', 'Raging Tusker')
  const strayMob = makeMob('Creature-0-1-1-1-200-000B', 'Distant Lurker')
  const nextReal = makeMob('Creature-0-1-1-1-300-000C', 'Sand Cleric')

  sm.handle(challengeStart('Ara-Kara', 0))
  // Pack 1: real kill
  sm.handle(mobDamage(realMob, 500_000, 1_000_000, 100))
  sm.handle(mobDied(realMob, 200))
  // A stray tick opens a new pack for the distant lurker (no kill follows)
  sm.handle(mobDamage(strayMob, 900_000, 1_000_000, 300))
  // 20s later — the lurker's pack should be pruned and discarded, then the next
  // legit engagement opens what should still be Pack 2.
  sm.handle(mobDamage(nextReal, 900_000, 1_000_000, 20_400))
  sm.handle(mobDied(nextReal, 20_500))
  sm.handle(challengeEnd(true, 21_000))

  const segs = store.getAll()
  assert.equal(segs.length, 2)
  assert.equal(segs[0].encounterName, 'Pack 1: Raging Tusker')
  assert.equal(segs[1].encounterName, 'Pack 2: Sand Cleric')
})

test('inactivity prune does not fire within the timeout window', () => {
  // Chain-pulls (common in M+) land events on the same mobs within a few seconds.
  // The prune must not misfire on healthy packs just because a mob had a brief lull.
  const { sm, store } = makeSm()
  const mob = makeMob('Creature-0-1-1-1-100-000A', 'Raging Tusker')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(mobDamage(mob, 1_000_000, 1_000_000, 100))
  // 10s later — under the 15s threshold
  sm.handle(mobDamage(mob,   500_000, 1_000_000, 10_100))
  sm.handle(mobDied(mob, 10_200))
  sm.handle(challengeEnd(true, 11_000))

  const segs = store.getAll()
  assert.equal(segs.length, 1)
  assert.equal(segs[0].encounterName, 'Pack 1: Raging Tusker')
})

test('spec/name carryover: guidToSpec propagates trash → boss → new trash', () => {
  const { sm, store } = makeSm()
  const mob = makeMob('Creature-0-1-1-1-100-000A', 'Test Mob')

  sm.handle(challengeStart('Ara-Kara', 0))
  // COMBATANT_INFO fires during trash — aggregator writes into currentSegment (Pack 1)
  sm.handle(combatantInfo('Player-1', 250, 10))

  sm.handle(encounterStart('Boss 1', 100))
  sm.handle(encounterEnd('Boss 1', true, 200))
  // A post-boss trash pull is needed to create Pack 2 under the new segmentation
  sm.handle(mobDamage(mob, 900_000, 1_000_000, 300))
  sm.handle(mobDied(mob, 400))
  sm.handle(challengeEnd(true, 500))

  const [pack1, boss1, pack2] = store.getAll()

  // Pack 1 received the COMBATANT_INFO directly
  assert.equal(pack1.guidToSpec['Player-1'], 250)

  // Boss 1 should have inherited it from Pack 1 at ENCOUNTER_START
  assert.equal(boss1.guidToSpec['Player-1'], 250)

  // Pack 2 should have inherited it from Boss 1 via the first hostile event opening it
  assert.equal(pack2.guidToSpec['Player-1'], 250)
})

// --- Aura window tracking tests (buffs metric) ---

function auraApplied(source: UnitRef, target: UnitRef, spellId: string, spellName: string, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_AURA_APPLIED', source, dest: target,
    payload: { type: 'aura', direction: 'applied', spellId, spellName, auraKind: 'BUFF' } satisfies AuraPayload,
  }
}

function auraRemoved(source: UnitRef, target: UnitRef, spellId: string, spellName: string, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_AURA_REMOVED', source, dest: target,
    payload: { type: 'aura', direction: 'removed', spellId, spellName, auraKind: 'BUFF' } satisfies AuraPayload,
  }
}

function auraRefreshed(source: UnitRef, target: UnitRef, spellId: string, spellName: string, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_AURA_REFRESH', source, dest: target,
    payload: { type: 'aura', direction: 'refreshed', spellId, spellName, auraKind: 'BUFF' } satisfies AuraPayload,
  }
}

test('aura: APPLIED→REMOVED builds a window', () => {
  const { sm, store } = makeSm()
  const shaman = makePlayer('Player-1', 'Braghorn')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  // First combat event so firstEventTime is set to 150
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, shaman))
  sm.handle(auraApplied(shaman, shaman, '32182', 'Heroism', 200))
  sm.handle(auraRemoved(shaman, shaman, '32182', 'Heroism', 40200))
  sm.handle(encounterEnd('Test Boss', true, 40300))
  sm.handle(challengeEnd(true, 40400))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  assert.equal(boss.auraWindows.length, 1)
  const w = boss.auraWindows[0]
  assert.equal(w.spellId, '32182')
  assert.equal(w.caster, 'Braghorn')
  assert.equal(w.target, 'Braghorn')
  assert.equal(w.end - w.start, 40_000)
  assert.equal(w.preExisting, false)
  assert.equal(w.stillOpen, false)
})

test('aura: REMOVED without prior APPLIED retroactively seeds at segment start', () => {
  const { sm, store } = makeSm()
  const paladin = makePlayer('Player-2', 'Adrianw')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 1000))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 1100, paladin))
  // Devotion Aura applied pre-pull, never saw the APPLIED — drops at 15s in
  sm.handle(auraRemoved(paladin, paladin, '465', 'Devotion Aura', 16100))
  sm.handle(encounterEnd('Test Boss', true, 20000))
  sm.handle(challengeEnd(true, 20100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  assert.equal(boss.auraWindows.length, 1)
  const w = boss.auraWindows[0]
  assert.equal(w.preExisting, true)
  // Segment's firstEventTime is the mobDamage at 1100 (absolute t(1100) = BASE_TS + 1100)
  assert.equal(w.start, t(1100))
  assert.equal(w.end, t(16100))
})

test('aura: still-open at snapshot time materializes to segment end', () => {
  const { sm, store } = makeSm()
  const priest = makePlayer('Player-3', 'Xakwynne')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, priest))
  // Applied but never removed — e.g. PW:F that stays up past combat
  sm.handle(auraApplied(priest, priest, '21562', 'Power Word: Fortitude', 300))
  sm.handle(encounterEnd('Test Boss', true, 10000))
  sm.handle(challengeEnd(true, 10100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  // Open at segment-end; auraWindows hasn't captured it yet but snapshot will.
  const snap = store.toSnapshot(boss)
  assert.ok(snap.auras, 'snapshot should include auras')
  assert.equal(snap.auras!.length, 1)
  const w = snap.auras![0]
  assert.equal(w.id, '21562')
  assert.equal(w.s, t(300))
  // end is the segment endTime (encounterEnd offset = 10000)
  assert.equal(w.e, t(10000))
})

test('aura: classification across personal / raid / external', () => {
  const { sm, store } = makeSm()
  const shaman = makePlayer('Player-S', 'Braghorn')
  const priest = makePlayer('Player-P', 'Xakwynne')
  const ally1 = makePlayer('Player-1', 'A1')
  const ally2 = makePlayer('Player-2', 'A2')
  const ally3 = makePlayer('Player-3', 'A3')
  const ally4 = makePlayer('Player-4', 'A4')
  const mob = makeMob('Creature-X', 'X')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  // Each raider deals damage so they're registered in segment.players
  const raiders = [shaman, priest, ally1, ally2, ally3, ally4]
  raiders.forEach((p, i) => sm.handle(mobDamage(mob, 900_000, 1_000_000, 150 + i, p)))

  // Heroism — fans out to all 6 raiders within 100ms → raid
  raiders.forEach(r => sm.handle(auraApplied(shaman, r, '32182', 'Heroism', 200)))
  raiders.forEach(r => sm.handle(auraRemoved(shaman, r, '32182', 'Heroism', 40200)))

  // Power Infusion — priest→ally1 only, single target → external
  sm.handle(auraApplied(priest, ally1, '10060', 'Power Infusion', 1000))
  sm.handle(auraRemoved(priest, ally1, '10060', 'Power Infusion', 21000))

  // Soul Leech — shaman self-cast only → personal
  sm.handle(auraApplied(shaman, shaman, '108366', 'Soul Leech', 500))
  sm.handle(auraRemoved(shaman, shaman, '108366', 'Soul Leech', 8500))

  sm.handle(encounterEnd('Test Boss', true, 60000))
  sm.handle(challengeEnd(true, 60100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const snap = store.toSnapshot(boss)
  assert.ok(snap.buffClassification, 'classification should be present')
  assert.equal(snap.buffClassification!['32182'], 'raid')
  assert.equal(snap.buffClassification!['10060'], 'external')
  assert.equal(snap.buffClassification!['108366'], 'personal')
})

test('aura: SPELL_AURA_REMOVED emits both overheal re-emit and aura-remove when absorb leftover present', () => {
  // Parser-level check that the dual-emit returns an array in the right order.
  const raw = '4/17/2026 19:54:50.384-7  SPELL_AURA_REMOVED,Player-1,"Adrianw",0x511,0x80000000,Player-1,"Adrianw",0x511,0x80000000,17,"Power Word: Shield",0x2,BUFF,1000'
  const parsed = parseLine(raw)
  assert.ok(Array.isArray(parsed), 'expected an array of events')
  const arr = parsed as ParsedEvent[]
  assert.equal(arr.length, 2)
  assert.equal(arr[0].payload.type, 'heal')
  assert.equal(arr[1].payload.type, 'aura')
})

test('aura: parser keeps DEBUFFs and tags auraKind', () => {
  const raw = '4/17/2026 19:54:50.384-7  SPELL_AURA_APPLIED,Creature-1,"Boss",0xa48,0x0,Player-1,"Adrianw",0x511,0x0,12345,"Test Debuff",0x20,DEBUFF'
  const parsed = parseLine(raw)
  assert.ok(parsed && !Array.isArray(parsed), 'expected a single parsed event')
  const evt = parsed as ParsedEvent
  assert.equal(evt.payload.type, 'aura')
  const aura = evt.payload as AuraPayload
  assert.equal(aura.auraKind, 'DEBUFF')
  assert.equal(aura.direction, 'applied')
})

test('aura: SPELL_AURA_REFRESH folds into the open window and increments refreshCount', () => {
  const { sm, store } = makeSm()
  const tank = makePlayer('Player-T', 'Tankguy')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, tank))
  // Tank casts Ironfur at 200ms, refreshes at 3s, 5s, 7s, then lets it drop.
  sm.handle(auraApplied(tank, tank, '192081', 'Ironfur', 200))
  sm.handle(auraRefreshed(tank, tank, '192081', 'Ironfur', 3200))
  sm.handle(auraRefreshed(tank, tank, '192081', 'Ironfur', 5200))
  sm.handle(auraRefreshed(tank, tank, '192081', 'Ironfur', 7200))
  sm.handle(auraRemoved(tank, tank, '192081', 'Ironfur', 13200))
  sm.handle(encounterEnd('Test Boss', true, 20000))
  sm.handle(challengeEnd(true, 20100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  assert.equal(boss.auraWindows.length, 1)
  const w = boss.auraWindows[0]
  // Uptime is one contiguous block — refreshes don't split it.
  assert.equal(w.end - w.start, 13000)
  assert.equal(w.refreshCount, 3)

  // Wire shape drops r when zero but carries the refresh count here.
  const snap = store.toSnapshot(boss)
  assert.ok(snap.auras && snap.auras.length === 1)
  assert.equal(snap.auras![0].r, 3)
})

test('aura: REFRESH without a prior APPLIED in the segment is ignored', () => {
  const { sm, store } = makeSm()
  const priest = makePlayer('Player-P', 'Priesty')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, priest))
  // PW:F was applied pre-pull; the mage refreshes it mid-combat but we never
  // saw the APPLIED. No window should open and no count should accrue — the
  // refresh has nothing to attribute to.
  sm.handle(auraRefreshed(priest, priest, '21562', 'Power Word: Fortitude', 5000))
  sm.handle(encounterEnd('Test Boss', true, 10000))
  sm.handle(challengeEnd(true, 10100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  assert.equal(boss.auraWindows.length, 0)
  assert.equal(boss.openAuras.size, 0)
})

test('aura: parser accepts SPELL_AURA_APPLIED and builds aura payload', () => {
  const raw = '4/17/2026 20:05:41.249-7  SPELL_AURA_APPLIED,Player-1,"Braghorn",0x514,0x80000000,Player-1,"Braghorn",0x514,0x80000000,32182,"Heroism",0x8,BUFF'
  const parsed = parseLine(raw) as ParsedEvent
  assert.equal(parsed.type, 'SPELL_AURA_APPLIED')
  assert.equal(parsed.payload.type, 'aura')
  if (parsed.payload.type === 'aura') {
    assert.equal(parsed.payload.direction, 'applied')
    assert.equal(parsed.payload.spellId, '32182')
    assert.equal(parsed.payload.spellName, 'Heroism')
  }
})

// --- Cast quality: parser ---

test('cast quality: parser SPELL_CAST_START builds castStart payload', () => {
  const raw = '4/19/2026 19:56:19.310-7  SPELL_CAST_START,Player-76-0B9E1F45,"Adrianw-Sargeras-US",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,29722,"Incinerate",0x4'
  const parsed = parseLine(raw) as ParsedEvent
  assert.equal(parsed.type, 'SPELL_CAST_START')
  assert.equal(parsed.payload.type, 'castStart')
  const p = parsed.payload as CastStartPayload
  assert.equal(p.spellId, '29722')
  assert.equal(p.spellName, 'Incinerate')
})

test('cast quality: parser SPELL_CAST_FAILED with cancellation reason builds castFailed payload', () => {
  const raw = '4/19/2026 19:56:23.252-7  SPELL_CAST_FAILED,Player-76-0B9E1F45,"Adrianw-Sargeras-US",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,29722,"Incinerate",0x4,"Interrupted"'
  const parsed = parseLine(raw) as ParsedEvent
  assert.equal(parsed.type, 'SPELL_CAST_FAILED')
  const p = parsed.payload as CastFailedPayload
  assert.equal(p.type, 'castFailed')
  assert.equal(p.spellId, '29722')
  assert.equal(p.reason, 'interrupted')
})

test('cast quality: parser drops SPELL_CAST_FAILED rejection reasons (no cast was in flight)', () => {
  // "Not yet recovered" = CD wall; "Another action is in progress" = button mash.
  // Real-world frequency in a fight is high; these MUST not surface as cancellations.
  for (const reason of ['Not yet recovered', 'Another action is in progress', 'Out of range', 'No target', 'Item is not ready yet']) {
    const raw = `4/19/2026 19:56:23.252-7  SPELL_CAST_FAILED,Player-76-0B9E1F45,"Adrianw-Sargeras-US",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,29722,"Incinerate",0x4,"${reason}"`
    assert.equal(parseLine(raw), null, `expected null for reason "${reason}"`)
  }
})

test('cast quality: parser maps movement and stunned reasons', () => {
  for (const [raw, expected] of [
    ["Can't do that while moving", 'movement'],
    ["Can't do that while stunned", 'stunned'],
  ] as const) {
    const line = `4/19/2026 19:56:23.252-7  SPELL_CAST_FAILED,Player-76-0B9E1F45,"Adrianw",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,29722,"Incinerate",0x4,"${raw}"`
    const p = (parseLine(line) as ParsedEvent).payload as CastFailedPayload
    assert.equal(p.reason, expected)
  }
})

test('cast quality: parser drops SPELL_CAST_START / FAILED from non-player sources', () => {
  // Boss casts (creature source, no PLAYER_FLAG) shouldn't pollute the
  // hardcast lifecycle — only player casts get cast quality treatment in v1.
  const startRaw = '4/19/2026 19:56:08.961-7  SPELL_CAST_START,Creature-0-4209-1753-127412-229227-00006595C3,"Xal\'atath",0xa48,0x80000000,0000000000000000,nil,0x80000000,0x80000000,461870,"Xal\'atath\'s Bargain",0x20'
  assert.equal(parseLine(startRaw), null)
})

// --- Cast quality: parser test helpers for aggregator scenarios ---

function castSuccess(player: UnitRef, spellId: string, spellName: string, offset = 0, target: UnitRef = NULL_UNIT): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_CAST_SUCCESS', source: player, dest: target,
    payload: { type: 'cast', spellId, spellName } satisfies CastPayload,
  }
}
function castStart(player: UnitRef, spellId: string, spellName: string, offset = 0): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_CAST_START', source: player, dest: NULL_UNIT,
    payload: { type: 'castStart', spellId, spellName } satisfies CastStartPayload,
  }
}
function castFailed(player: UnitRef, spellId: string, spellName: string, reason: 'interrupted' | 'movement' | 'stunned', offset = 0): ParsedEvent {
  return {
    timestamp: t(offset), type: 'SPELL_CAST_FAILED', source: player, dest: NULL_UNIT,
    payload: { type: 'castFailed', spellId, spellName, reason } satisfies CastFailedPayload,
  }
}

// --- Cast quality: aggregator hardcast lifecycle ---

test('cast quality: hardcast START + SUCCESS produces a completed hardcast with measured castMs', () => {
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, player))
  // Starfire-style hardcast: START at 200ms, SUCCESS at 1500ms = 1.3s cast.
  sm.handle(castStart(player, '197628', 'Starfire', 200))
  sm.handle(castSuccess(player, '197628', 'Starfire', 1500))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player1 = boss.players['Adrianw']
  assert.ok(player1, 'player should exist')
  assert.equal(player1.casts.total, 1)
  assert.equal(player1.casts.bySpell['197628'].count, 1)
  assert.equal(player1.casts.bySpell['197628'].cancelled, 0)
  assert.equal(player1.casts.bySpell['197628'].totalCastMs, 1300)

  // Wire event carries castKind / castMs / castResult.
  const castEvent = boss.events.find(e => e.kind === 'cast' && e.spellId === '197628')!
  assert.ok(castEvent)
  assert.equal(castEvent.castKind, 'hardcast')
  assert.equal(castEvent.castMs, 1300)
  assert.equal(castEvent.castResult, 'completed')
})

test('cast quality: SUCCESS with no preceding START is treated as instant', () => {
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, player))
  // Wild Imp summon, Hand of Gul'dan, etc. — instant cast, no START fires.
  sm.handle(castSuccess(player, '105174', "Hand of Gul'dan", 200))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player1 = boss.players['Adrianw']
  assert.equal(player1.casts.total, 1)
  assert.equal(player1.casts.bySpell['105174'].totalCastMs, 0)

  // Wire event omits castKind/castMs entirely (instant is the implicit default).
  const castEvent = boss.events.find(e => e.kind === 'cast' && e.spellId === '105174')!
  assert.equal(castEvent.castKind, undefined)
  assert.equal(castEvent.castMs, undefined)
})

test('cast quality: cancelled hardcast emits a wire event with castResult=cancelled and bumps cancelled', () => {
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, player))
  // Starfire interrupted at 800ms after START at 200ms = 600ms in flight.
  sm.handle(castStart(player, '197628', 'Starfire', 200))
  sm.handle(castFailed(player, '197628', 'Starfire', 'interrupted', 800))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player1 = boss.players['Adrianw']
  // Cancelled cast does NOT bump count (no successful press happened).
  assert.equal(player1.casts.bySpell['197628'].count, 0)
  assert.equal(player1.casts.bySpell['197628'].cancelled, 1)
  assert.equal(player1.casts.bySpell['197628'].totalCastMs, 600)

  const castEvent = boss.events.find(e => e.kind === 'cast' && e.spellId === '197628')!
  assert.equal(castEvent.castKind, 'hardcast')
  assert.equal(castEvent.castMs, 600)
  assert.equal(castEvent.castResult, 'cancelled')
  assert.equal(castEvent.cancelReason, 'interrupted')
})

test('cast quality: stale in-flight (>15s) is treated as instant on next SUCCESS', () => {
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, player))
  // START at 200ms, SUCCESS 16 seconds later — too long to be a real pair.
  // Fall back to instant rather than report a 16s cast time.
  sm.handle(castStart(player, '197628', 'Starfire', 200))
  sm.handle(castSuccess(player, '197628', 'Starfire', 16_500))
  sm.handle(encounterEnd('Test Boss', true, 20_000))
  sm.handle(challengeEnd(true, 20_100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player1 = boss.players['Adrianw']
  assert.equal(player1.casts.bySpell['197628'].count, 1)
  assert.equal(player1.casts.bySpell['197628'].totalCastMs, 0)

  const castEvent = boss.events.find(e => e.kind === 'cast' && e.spellId === '197628')!
  assert.equal(castEvent.castKind, undefined, 'stale pair should fall back to instant')
})

// --- Cast quality: aggregator channel lifecycle ---

test('cast quality: channel SUCCESS + matching AURA_REMOVED produces a channel cast with measured castMs', () => {
  const { sm, store } = makeSm()
  const monk = makePlayer('Player-WW', 'Grzzchi')
  const boss = makeMob('Creature-Boss', 'Test Boss')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(boss, 900_000, 1_000_000, 150, monk))
  // Fists of Fury: APPLIED on caster (self-buff aura) + press SUCCESS at the
  // boss target, then REMOVED 3.1s later. The press carries the real target
  // (boss); the AURA_REMOVED's dest is the caster (self-buff). The wire
  // event must use the press-time target, not the aura-remove caster.
  sm.handle(auraApplied(monk, monk, '113656', 'Fists of Fury', 200))
  sm.handle(castSuccess(monk, '113656', 'Fists of Fury', 200, boss))
  sm.handle(auraRemoved(monk, monk, '113656', 'Fists of Fury', 3300))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const segment = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player = segment.players['Grzzchi']
  assert.equal(player.casts.total, 1, 'channel counts once at close, not at press')
  assert.equal(player.casts.bySpell['113656'].count, 1)
  assert.equal(player.casts.bySpell['113656'].totalCastMs, 3100)

  const castEvent = segment.events.find(e => e.kind === 'cast' && e.spellId === '113656')!
  assert.equal(castEvent.castKind, 'channel')
  assert.equal(castEvent.castMs, 3100)
  assert.equal(castEvent.castResult, 'completed')
  // Wire t is the START time, not the close time, so the timeline plots the
  // channel beginning at the press timestamp.
  assert.equal(castEvent.t, BASE_TS + 200)
  // dst MUST be the channel target captured at press, not the caster from
  // AURA_REMOVED's dest (which would be 'Grzzchi' for this self-buff aura).
  assert.equal(castEvent.dst, 'Test Boss', 'channel dst should be the press target, not the aura caster')
})

test('cast quality: channel that never closes (segment ends mid-channel) is dropped, not counted', () => {
  const { sm, store } = makeSm()
  const monk = makePlayer('Player-WW', 'Grzzchi')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, monk))
  // Channel opens but the encounter ends before AURA_REMOVED — the boss died
  // mid-channel. Better to undercount one cast than emit a fake duration.
  sm.handle(auraApplied(monk, monk, '113656', 'Fists of Fury', 200))
  sm.handle(castSuccess(monk, '113656', 'Fists of Fury', 200))
  sm.handle(encounterEnd('Test Boss', true, 1000))
  sm.handle(challengeEnd(true, 1100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player = boss.players['Grzzchi']
  assert.equal(player?.casts.total ?? 0, 0, 'unclosed channel should not count')
  assert.equal(boss.events.filter(e => e.kind === 'cast').length, 0)
})

test('cast quality: Tranquility tick spellId is dropped (pre-existing overcount fix)', () => {
  const { sm, store } = makeSm()
  const druid = makePlayer('Player-D', 'Adrianb')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(makeMob('Creature-X', 'X'), 900_000, 1_000_000, 150, druid))
  // One Tranquility press: aura opens, press SUCCESS for 740, then 7 tick
  // SUCCESSes for 157982, then aura removed.
  sm.handle(auraApplied(druid, druid, '740', 'Tranquility', 200))
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 200))  // tick-id SUCCESS at instant 0
  sm.handle(castSuccess(druid, '740', 'Tranquility', 200))     // press SUCCESS
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 950))  // tick 1
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 1700)) // tick 2
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 2450)) // tick 3
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 3200)) // tick 4
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 3950)) // tick 5
  sm.handle(castSuccess(druid, '157982', 'Tranquility', 4700)) // tick 6
  sm.handle(auraRemoved(druid, druid, '740', 'Tranquility', 4750))
  sm.handle(encounterEnd('Test Boss', true, 8000))
  sm.handle(challengeEnd(true, 8100))

  const boss = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player = boss.players['Adrianb']
  // ONE channel cast, not 8 (would have been 1 press + 7 ticks pre-fix).
  assert.equal(player.casts.total, 1, 'channel ticks must not inflate the cast count')
  assert.equal(player.casts.bySpell['740'].count, 1)
  assert.equal(player.casts.bySpell['740'].totalCastMs, 4550)
  // No bySpell entry for the tick spellId — those events are dropped entirely.
  assert.equal(player.casts.bySpell['157982'], undefined)
})

test('cast quality: stale channel (>15s old REMOVED) is dropped, not credited at clamp', () => {
  // A SPELL_AURA_REMOVED that arrives 30s after the press almost certainly
  // belongs to a press the parser missed (or a log oddity). Match the
  // hardcast watchdog: drop the entry rather than emit a clamped 15s
  // "channel" that would mislead the user.
  const { sm, store } = makeSm()
  const monk = makePlayer('Player-WW', 'Grzzchi')
  const boss = makeMob('Creature-Boss', 'Test Boss')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(boss, 900_000, 1_000_000, 150, monk))
  sm.handle(auraApplied(monk, monk, '113656', 'Fists of Fury', 200))
  sm.handle(castSuccess(monk, '113656', 'Fists of Fury', 200, boss))
  // REMOVED 30 seconds later — way past the 15s watchdog.
  sm.handle(auraRemoved(monk, monk, '113656', 'Fists of Fury', 30_500))
  sm.handle(encounterEnd('Test Boss', true, 35_000))
  sm.handle(challengeEnd(true, 35_100))

  const segment = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const player = segment.players['Grzzchi']
  assert.equal(player?.casts.total ?? 0, 0, 'stale channel must be dropped, not clamped')
  assert.equal(segment.events.filter(e => e.kind === 'cast').length, 0)
})

test('cast quality: re-press while in-flight hardcast exists overwrites the abandoned START', () => {
  // The doc says "Re-opening (player re-presses while a stale entry exists)
  // just overwrites — the older START is implicitly abandoned." This
  // exercises that contract: two STARTs without a SUCCESS between them, then
  // one SUCCESS — the SUCCESS pairs with the more recent START.
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')
  const target = makeMob('Creature-X', 'X')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(target, 900_000, 1_000_000, 150, player))
  // First START at 200ms (abandoned — no SUCCESS or FAILED follows).
  sm.handle(castStart(player, '197628', 'Starfire', 200))
  // Second START at 1000ms — implicitly abandons the first.
  sm.handle(castStart(player, '197628', 'Starfire', 1000))
  // SUCCESS at 2300ms — pairs with the 1000ms START = 1.3s cast, NOT 2.1s.
  sm.handle(castSuccess(player, '197628', 'Starfire', 2300, target))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const segment = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const p = segment.players['Adrianw']
  assert.equal(p.casts.bySpell['197628'].count, 1)
  assert.equal(p.casts.bySpell['197628'].totalCastMs, 1300, 'castMs must pair with the recent START, not the abandoned one')
  const castEvent = segment.events.find(e => e.kind === 'cast' && e.spellId === '197628')!
  assert.equal(castEvent.castMs, 1300)
})

test('cast quality: castFailed cancellation reasons movement and stunned each propagate to the wire', () => {
  // Coverage for the per-reason CSS variants on the client — a typo in the
  // mapping table would silently render the wrong shape without this guard.
  for (const reason of ['movement', 'stunned'] as const) {
    const { sm, store } = makeSm()
    const player = makePlayer('Player-1', 'Adrianw')
    const target = makeMob('Creature-X', 'X')

    sm.handle(challengeStart('Ara-Kara', 0))
    sm.handle(encounterStart('Test Boss', 100))
    sm.handle(mobDamage(target, 900_000, 1_000_000, 150, player))
    sm.handle(castStart(player, '197628', 'Starfire', 200))
    sm.handle(castFailed(player, '197628', 'Starfire', reason, 800))
    sm.handle(encounterEnd('Test Boss', true, 5000))
    sm.handle(challengeEnd(true, 5100))

    const segment = store.getAll().find(s => s.encounterName === 'Test Boss')!
    const castEvent = segment.events.find(e => e.kind === 'cast' && e.spellId === '197628')!
    assert.equal(castEvent.castResult, 'cancelled', `reason ${reason}`)
    assert.equal(castEvent.cancelReason, reason)
  }
})

test('cast quality: castFailed with no preceding START is dropped silently', () => {
  // The aggregator only credits cancellations against an in-flight entry.
  // A FAILED that arrives with no matching START (rare; could be a press
  // the parser missed entirely, or a reason classification edge case)
  // should drop on the floor rather than seed a phantom cancellation.
  const { sm, store } = makeSm()
  const player = makePlayer('Player-1', 'Adrianw')
  const target = makeMob('Creature-X', 'X')

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Test Boss', 100))
  sm.handle(mobDamage(target, 900_000, 1_000_000, 150, player))
  // No castStart — just a bare castFailed.
  sm.handle(castFailed(player, '197628', 'Starfire', 'interrupted', 800))
  sm.handle(encounterEnd('Test Boss', true, 5000))
  sm.handle(challengeEnd(true, 5100))

  const segment = store.getAll().find(s => s.encounterName === 'Test Boss')!
  const p = segment.players['Adrianw']
  assert.equal(p?.casts.bySpell['197628'], undefined, 'unmatched FAILED should not seed a bySpell entry')
  assert.equal(segment.events.filter(e => e.kind === 'cast').length, 0)
})
