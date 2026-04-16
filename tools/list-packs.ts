#!/usr/bin/env npx tsx
/**
 * Ad-hoc: replay a log through the pipeline and print every segment
 * (packs + bosses) grouped by key run.
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
if (!logFile) {
  console.error('Usage: npx tsx tools/list-packs.ts <logFile>')
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
const byKey: Record<string, typeof segs> = {}
for (const s of segs) {
  const k = s.keyRunId ?? '_standalone'
  ;(byKey[k] ??= []).push(s)
}

for (const [keyId, list] of Object.entries(byKey)) {
  const first = list[0]
  const anyWithKey = list.find(s => s.keyRunId)
  const meta = anyWithKey?.keyRunId ? (store as any).keyRunMeta?.get(anyWithKey.keyRunId) : null
  const header = meta
    ? `${meta.dungeonName} +${meta.keystoneLevel}`
    : keyId === '_standalone' ? 'Standalone' : `Key ${keyId}`
  console.log('')
  console.log(`=== ${header} (${list.length} segments) ===`)
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const start = s.firstEventTime ?? s.startTime
    const end = s.endTime ?? s.lastEventTime ?? start
    const dur = ((end - start) / 1000).toFixed(1) + 's'
    const result = s.success === true ? '✓' : s.success === false ? '✗' : '?'
    const tag = s.encounterID === 0 ? 'TRASH' : 'BOSS '
    console.log(`  ${String(i + 1).padStart(2)}. [${tag}] ${s.encounterName.padEnd(40)} ${dur.padStart(8)}  ${result}`)
  }
}
console.log('')
