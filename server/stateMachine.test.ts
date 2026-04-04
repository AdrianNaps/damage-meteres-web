import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EncounterStateMachine } from './stateMachine.js'
import { SegmentStore } from './store.js'
import type { ParsedEvent, ChallengeModePayload, EncounterPayload, CombatantInfoPayload } from './types.js'

const NULL_UNIT = { guid: '', name: '', flags: 0 }
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

function makeSm() {
  const store = new SegmentStore(20)
  const sm = new EncounterStateMachine(store)
  return { sm, store }
}

// --- Tests ---

test('single-boss key: creates Trash 1, Boss, Trash 2 with correct names', () => {
  const { sm, store } = makeSm()

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Anub\'ikkaj', 100))
  sm.handle(encounterEnd('Anub\'ikkaj', true, 200))
  sm.handle(challengeEnd(true, 300))

  const segs = store.getAll()
  assert.equal(segs.length, 3)
  assert.equal(segs[0].encounterName, 'Ara-Kara — Trash 1')
  assert.equal(segs[1].encounterName, 'Anub\'ikkaj')
  assert.equal(segs[2].encounterName, 'Ara-Kara — Trash 2')
})

test('multi-boss key: trash counter increments correctly across all bosses', () => {
  const { sm, store } = makeSm()

  sm.handle(challengeStart('Ara-Kara', 0))
  sm.handle(encounterStart('Boss 1', 100))
  sm.handle(encounterEnd('Boss 1', true, 200))
  sm.handle(encounterStart('Boss 2', 300))
  sm.handle(encounterEnd('Boss 2', true, 400))
  sm.handle(encounterStart('Boss 3', 500))
  sm.handle(encounterEnd('Boss 3', true, 600))
  sm.handle(challengeEnd(true, 700))

  // Expected: Trash 1, Boss 1, Trash 2, Boss 2, Trash 3, Boss 3, Trash 4
  const segs = store.getAll()
  assert.equal(segs.length, 7)
  assert.equal(segs[0].encounterName, 'Ara-Kara — Trash 1')
  assert.equal(segs[2].encounterName, 'Ara-Kara — Trash 2')
  assert.equal(segs[4].encounterName, 'Ara-Kara — Trash 3')
  assert.equal(segs[6].encounterName, 'Ara-Kara — Trash 4')
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
    'challenge_end:Ara-Kara — Trash 1',
  ])

  const segs = store.getAll()
  assert.equal(segs[0].success, false)  // Trash 1 (key depleted)
  assert.equal(segs[1].success, false)  // Boss 1 (force-closed)
})

test('spec/name carryover: guidToSpec and guidToName propagate trash → boss → new trash', () => {
  const { sm, store } = makeSm()

  sm.handle(challengeStart('Ara-Kara', 0))
  // COMBATANT_INFO fires during trash — aggregator writes into currentSegment (Trash 1)
  sm.handle(combatantInfo('Player-1', 250, 10))

  sm.handle(encounterStart('Boss 1', 100))
  sm.handle(encounterEnd('Boss 1', true, 200))
  sm.handle(challengeEnd(true, 300))

  const [trash1, boss1, trash2] = store.getAll()

  // Trash 1 received the COMBATANT_INFO directly
  assert.equal(trash1.guidToSpec['Player-1'], 250)

  // Boss 1 should have inherited it from Trash 1 at ENCOUNTER_START
  assert.equal(boss1.guidToSpec['Player-1'], 250)

  // Trash 2 should have inherited it from Boss 1 at ENCOUNTER_END
  assert.equal(trash2.guidToSpec['Player-1'], 250)
})
