#!/usr/bin/env npx tsx
/**
 * Ad-hoc: per-pack mob kill counts grouped by key run.
 *
 * Counts distinct Creature-* GUIDs that received UNIT_DIED within each trash
 * segment's time window. Useful for comparing two runs of the same dungeon to
 * see whether pack-count differences reflect different chain-pull styles or
 * a segmentation bug.
 */

import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { resolve } from 'path'
import { parseLine } from '../server/parser.js'
import { SegmentStore, type Segment } from '../server/store.js'
import { EncounterStateMachine } from '../server/stateMachine.js'
import { resetRecentEvents } from '../server/aggregator.js'
import type { IconResolver } from '../server/iconResolver.js'

const stubIconResolver: IconResolver = { requestMany() {}, getAll() { return {} } }

const logFile = process.argv[2]
if (!logFile) {
  console.error('Usage: npx tsx tools/pack-mob-counts.ts <logFile>')
  process.exit(1)
}

const origLog = console.log
console.log = () => {}

resetRecentEvents()
const store = new SegmentStore(500, stubIconResolver)
const machine = new EncounterStateMachine(store)

// Record every Creature-* UNIT_DIED with its timestamp so we can bucket by pack.
const mobDeaths: Array<{ guid: string; name: string; ts: number }> = []

const rl = createInterface({ input: createReadStream(resolve(logFile)) })
for await (const line of rl) {
  if (!line.trim()) continue
  const parsed = parseLine(line)
  if (!parsed) continue
  const events = Array.isArray(parsed) ? parsed : [parsed]
  for (const e of events) {
    machine.handle(e)
    if (e.type === 'UNIT_DIED' && (e.dest.guid.startsWith('Creature-') || e.dest.guid.startsWith('Vehicle-'))) {
      mobDeaths.push({ guid: e.dest.guid, name: e.dest.name, ts: e.timestamp })
    }
  }
}
console.log = origLog

const segs = store.getAll()
const byKey: Record<string, Segment[]> = {}
for (const s of segs) {
  const k = s.keyRunId ?? '_standalone'
  ;(byKey[k] ??= []).push(s)
}

for (const [keyId, list] of Object.entries(byKey)) {
  // Header — try to pull dungeon metadata
  const keyMeta = (store as any).keyRunMeta?.get(list[0].keyRunId)
  const header = keyMeta ? `${keyMeta.dungeonName} +${keyMeta.keystoneLevel}` : (keyId === '_standalone' ? 'Standalone' : `Key ${keyId}`)
  console.log('')
  console.log(`=== ${header} ===`)

  let runningTotal = 0
  for (const s of list) {
    const start = s.startTime
    const end = s.endTime ?? s.lastEventTime ?? start
    const kills = mobDeaths.filter(d => d.ts >= start && d.ts <= end)
    const distinct = new Set(kills.map(d => d.guid)).size

    // Per-mob-name breakdown (count GUIDs per name) to spot composition
    const byName: Record<string, number> = {}
    for (const d of kills) {
      if (!byName[d.name]) byName[d.name] = 0
      byName[d.name]++
    }
    // Dedupe by counting distinct guids per name
    const byNameDistinct: Record<string, number> = {}
    const seenByName: Record<string, Set<string>> = {}
    for (const d of kills) {
      if (!seenByName[d.name]) seenByName[d.name] = new Set()
      seenByName[d.name].add(d.guid)
    }
    for (const [n, set] of Object.entries(seenByName)) byNameDistinct[n] = set.size

    const tag = s.encounterID === 0 ? 'TRASH' : 'BOSS '
    const nameList = Object.entries(byNameDistinct)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${c}× ${n}`)
      .join(', ')
    runningTotal += distinct

    console.log(`  [${tag}] ${s.encounterName.padEnd(42)} ${String(distinct).padStart(3)} mobs  (${nameList})`)
  }
  console.log(`  ── total kills in key: ${runningTotal}`)
}
console.log('')
