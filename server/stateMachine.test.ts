import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EncounterStateMachine } from './stateMachine.js'
import { SegmentStore } from './store.js'
import type { ParsedEvent, ChallengeModePayload, EncounterPayload, CombatantInfoPayload, DamagePayload, DeathPayload, UnitRef } from './types.js'

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
