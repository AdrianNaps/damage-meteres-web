import 'dotenv/config'
import path from 'path'
import { LogWatcher } from './watcher.js'
import { parseLine } from './parser.js'
import { SegmentStore } from './store.js'
import { EncounterStateMachine } from './stateMachine.js'
import { startWsServer } from './wsServer.js'

const logsDir     = process.env.LOGS_DIR ?? 'C:/Program Files (x86)/World of Warcraft/_retail_/Logs'
const wsPort      = parseInt(process.env.WS_PORT ?? '3001')
const maxSegments = parseInt(process.env.MAX_SEGMENTS ?? '10')

const store   = new SegmentStore(maxSegments)
const machine = new EncounterStateMachine(store)
startWsServer(wsPort, store, machine)

const watcher = new LogWatcher(logsDir)

watcher.on('file_switched', (filePath: string) => {
  console.log(`[index] Active log → ${path.basename(filePath)}`)
})

watcher.on('lines', (lines: string[]) => {
  for (const line of lines) {
    const event = parseLine(line)
    if (!event) continue
    console.log(`[${event.type}] ${event.source.name} → ${event.dest.name}`, JSON.stringify(event.payload))
    machine.handle(event)
  }
})

watcher.start()
console.log('[index] Server started.')
