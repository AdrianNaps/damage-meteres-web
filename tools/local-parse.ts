#!/usr/bin/env npx tsx
/**
 * Local Parse CLI — replays a raw WoW combat log through the app's parser
 * pipeline and outputs structured JSON (or a human-readable summary).
 *
 * Usage:
 *   npx tsx tools/local-parse.ts <logFile> [options]
 *
 * Options:
 *   --encounter <id>    WoW encounter ID to extract
 *   --fight <n>         Fight index (1-based) if multiple pulls. Defaults to last.
 *   --list              List all fights in the log without parsing
 *   --format <fmt>      Output format: json (default) | summary
 */

import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { resolve } from 'path'
import { parseArgs } from 'node:util'
import { parseLine } from '../server/parser.js'
import { SegmentStore, type Segment, type SegmentSnapshot } from '../server/store.js'
import { EncounterStateMachine } from '../server/stateMachine.js'
import { resetRecentEvents } from '../server/aggregator.js'
import type { IconResolver } from '../server/iconResolver.js'

// ── Stub icon resolver (no network, no cache file) ──────────────────────────

const stubIconResolver: IconResolver = {
  requestMany() {},
  getAll() { return {} },
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    list:      { type: 'boolean', default: false },
    encounter: { type: 'string' },
    fight:     { type: 'string' },
    format:    { type: 'string', default: 'json' },
  },
  allowPositionals: true,
})

const listMode = values.list!
const encounterOpt = values.encounter
const fightOpt = values.fight
const formatOpt = values.format!

const logFile = positionals[0]

if (!logFile) {
  console.error('Usage: npx tsx tools/local-parse.ts <logFile> [--list] [--encounter <id>] [--fight <n>] [--format json|summary]')
  process.exit(1)
}

if (formatOpt !== 'json' && formatOpt !== 'summary') {
  console.error(`Error: unknown format "${formatOpt}" (expected json or summary)`)
  process.exit(1)
}

// ── Feed log through pipeline ───────────────────────────────────────────────

const filePath = resolve(logFile)

// Suppress state machine debug logging (console.log calls in stateMachine.ts)
// so it doesn't pollute structured output.
const origLog = console.log
console.log = () => {}

resetRecentEvents()
const store = new SegmentStore(500, stubIconResolver)
const machine = new EncounterStateMachine(store)

try {
  const rl = createInterface({ input: createReadStream(filePath) })
  for await (const line of rl) {
    if (!line.trim()) continue
    const parsed = parseLine(line)
    if (!parsed) continue
    if (Array.isArray(parsed)) {
      for (const event of parsed) machine.handle(event)
    } else {
      machine.handle(parsed)
    }
  }
} finally {
  console.log = origLog
}

const allSegments = store.getAll()

// ── --list mode ─────────────────────────────────────────────────────────────

if (listMode) {
  if (allSegments.length === 0) {
    console.error('No encounters found in log file.')
    process.exit(1)
  }

  console.log('')
  console.log(`  ${'#'.padStart(3)}  ${'EncID'.padEnd(7)} ${'Name'.padEnd(35)} ${'Duration'.padEnd(10)} Result`)
  console.log(`  ${'─'.repeat(3)}  ${'─'.repeat(7)} ${'─'.repeat(35)} ${'─'.repeat(10)} ${'─'.repeat(6)}`)

  let idx = 0
  for (const seg of allSegments) {
    if (seg.encounterID === 0) continue // skip trash segments
    idx++
    const start = seg.firstEventTime ?? seg.startTime
    const end = seg.endTime ?? seg.lastEventTime ?? start
    const dur = ((end - start) / 1000).toFixed(1) + 's'
    const result = seg.success === true ? 'Kill' : seg.success === false ? 'Wipe' : '?'
    console.log(
      `  ${String(idx).padStart(3)}  ${String(seg.encounterID).padEnd(7)} ${seg.encounterName.padEnd(35)} ${dur.padEnd(10)} ${result}`
    )
  }
  console.log('')
  process.exit(0)
}

// ── Encounter selection ─────────────────────────────────────────────────────

if (!encounterOpt) {
  console.error('Error: --encounter <id> is required (or use --list to see available fights)')
  process.exit(1)
}

const encounterID = parseInt(encounterOpt, 10)
if (isNaN(encounterID)) {
  console.error(`Error: invalid encounter ID "${encounterOpt}"`)
  process.exit(1)
}

const matchingSegments = allSegments.filter(s => s.encounterID === encounterID)

if (matchingSegments.length === 0) {
  console.error(`No fights found for encounter ID ${encounterID}. Use --list to see available fights.`)
  process.exit(1)
}

let selected: Segment

if (fightOpt) {
  const fightIndex = parseInt(fightOpt, 10)
  if (isNaN(fightIndex) || fightIndex < 1 || fightIndex > matchingSegments.length) {
    console.error(`Error: fight index ${fightOpt} out of range (1-${matchingSegments.length})`)
    process.exit(1)
  }
  selected = matchingSegments[fightIndex - 1]
} else {
  // Default to last pull
  selected = matchingSegments[matchingSegments.length - 1]
}

// ── Output ──────────────────────────────────────────────────────────────────

const snapshot = store.toSnapshot(selected)

if (formatOpt === 'summary') {
  printSummary(snapshot)
} else {
  // JSON mode — serialize with a replacer to handle Sets
  console.log(JSON.stringify(snapshot, (_key, value) => {
    if (value instanceof Set) return [...value]
    return value
  }, 2))
}

// ── Summary printer ─────────────────────────────────────────────────────────

function printSummary(snap: SegmentSnapshot) {
  const result = snap.success === true ? 'Kill' : snap.success === false ? 'Wipe' : '?'
  console.log('')
  console.log(`  ${snap.encounterName} (${snap.encounterID}) — ${snap.duration.toFixed(1)}s — ${result}`)
  console.log('')

  // Sort players by DPS descending
  const sorted = Object.values(snap.players).sort((a, b) => b.dps - a.dps)

  // Damage table
  console.log('  Damage')
  console.log(`  ${'Player'.padEnd(25)} ${'Total'.padStart(12)} ${'DPS'.padStart(10)}`)
  console.log(`  ${'─'.repeat(25)} ${'─'.repeat(12)} ${'─'.repeat(10)}`)
  for (const p of sorted) {
    if (p.damage.total === 0) continue
    console.log(
      `  ${p.name.padEnd(25)} ${formatNumber(p.damage.total).padStart(12)} ${formatNumber(p.dps).padStart(10)}`
    )
  }

  // Healing table
  const healSorted = Object.values(snap.players).sort((a, b) => b.hps - a.hps)
  console.log('')
  console.log('  Healing')
  console.log(`  ${'Player'.padEnd(25)} ${'Total'.padStart(12)} ${'HPS'.padStart(10)} ${'Overheal'.padStart(10)}`)
  console.log(`  ${'─'.repeat(25)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(10)}`)
  for (const p of healSorted) {
    if (p.healing.total === 0 && p.healing.overheal === 0) continue
    const overpct = (p.healing.total + p.healing.overheal) > 0
      ? ((p.healing.overheal / (p.healing.total + p.healing.overheal)) * 100).toFixed(1) + '%'
      : '0.0%'
    console.log(
      `  ${p.name.padEnd(25)} ${formatNumber(p.healing.total).padStart(12)} ${formatNumber(p.hps).padStart(10)} ${overpct.padStart(10)}`
    )
  }

  // Deaths
  const totalDeaths = sorted.reduce((sum, p) => sum + p.deaths.length, 0)
  if (totalDeaths > 0) {
    console.log('')
    console.log(`  Deaths (${totalDeaths})`)
    for (const p of sorted) {
      for (const d of p.deaths) {
        const time = d.combatElapsed.toFixed(1) + 's'
        const blow = d.killingBlow
          ? `${d.killingBlow.spellName} (${d.killingBlow.sourceName})`
          : 'unknown'
        console.log(`  ${time.padStart(8)}  ${p.name.padEnd(22)} — ${blow}`)
      }
    }
  }

  // Interrupts
  const totalInterrupts = sorted.reduce((sum, p) => sum + p.interrupts.total, 0)
  if (totalInterrupts > 0) {
    console.log('')
    console.log(`  Interrupts (${totalInterrupts})`)
    for (const p of sorted) {
      if (p.interrupts.total === 0) continue
      console.log(`  ${p.name.padEnd(25)} ${String(p.interrupts.total).padStart(3)}`)
    }
  }

  console.log('')
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toString()
}
