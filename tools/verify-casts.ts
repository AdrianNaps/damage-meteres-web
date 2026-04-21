#!/usr/bin/env npx tsx
/**
 * Ad-hoc: replay a log and print one player's merged Casts table across
 * all segments under the same key run. Used to sanity-check the passive-
 * proc deny-list against WCL's Cast By Source table.
 *
 * Usage: npx tsx tools/verify-casts.ts <logFile> "<playerName>"
 */

import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { resolve } from 'path'
import { parseLine } from '../server/parser.js'
import { SegmentStore } from '../server/store.js'
import { EncounterStateMachine } from '../server/stateMachine.js'
import { resetRecentEvents } from '../server/aggregator.js'
import type { IconResolver } from '../server/iconResolver.js'

const stubIconResolver: IconResolver = { requestMany() {}, getAll() { return {} } }

const logFile = process.argv[2]
const playerName = process.argv[3]
if (!logFile || !playerName) {
  console.error('Usage: npx tsx tools/verify-casts.ts <logFile> "<playerName>"')
  process.exit(1)
}

const origLog = console.log
console.log = () => {}

resetRecentEvents()
const store = new SegmentStore(500, stubIconResolver)
const machine = new EncounterStateMachine(store)

const rl = createInterface({ input: createReadStream(resolve(logFile)) })
for await (const line of rl) {
  if (!line.trim()) continue
  const parsed = parseLine(line)
  if (!parsed) continue
  if (Array.isArray(parsed)) for (const e of parsed) machine.handle(e)
  else machine.handle(parsed)
}
console.log = origLog

const segs = store.getAll()
type Row = { spellId: string; spellName: string; count: number }
const merged = { total: 0, bySpell: new Map<string, Row>() }
for (const s of segs) {
  for (const p of Object.values(s.players)) {
    if (p.name !== playerName) continue
    merged.total += p.casts.total
    for (const [sid, v] of Object.entries(p.casts.bySpell)) {
      const existing = merged.bySpell.get(sid)
      if (!existing) merged.bySpell.set(sid, { ...v })
      else existing.count += v.count
    }
  }
}

console.log(`\n${playerName} — Casts (all segments merged):`)
console.log(`  Total: ${merged.total}`)
const rows = [...merged.bySpell.values()].sort((a, b) => b.count - a.count)
for (const r of rows) {
  console.log(`  ${String(r.count).padStart(5)}  ${r.spellId.padStart(8)}  ${r.spellName}`)
}
