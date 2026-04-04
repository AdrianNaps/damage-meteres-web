import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { LogWatcher } from './watcher.js'
import { parseLine } from './parser.js'
import { SegmentStore } from './store.js'
import { EncounterStateMachine } from './stateMachine.js'
import { startWsServer } from './wsServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const logsDir     = process.env.LOGS_DIR ?? 'C:/Program Files (x86)/World of Warcraft/_retail_/Logs'
const port        = parseInt(process.env.WS_PORT ?? '3001')
const maxSegments = parseInt(process.env.MAX_SEGMENTS ?? '10')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
}

const distDir = path.join(__dirname, '../client/dist')
const hasClient = fs.existsSync(distDir)

const httpServer = http.createServer((req, res) => {
  if (!hasClient) {
    res.writeHead(404)
    res.end('Client not built. Run: npm run build')
    return
  }

  let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url!)

  // Prevent directory traversal
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403); res.end(); return
  }

  // SPA fallback — unknown paths serve index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html')
  }

  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})

const store   = new SegmentStore(maxSegments)
const machine = new EncounterStateMachine(store)
startWsServer(httpServer, store, machine)

httpServer.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`)
  if (hasClient) console.log(`[server] Serving client from client/dist/`)
  else console.log(`[server] No client build found — run "npm run build" to serve the UI`)
})

const watcher = new LogWatcher(logsDir)

watcher.on('file_switched', (filePath: string) => {
  console.log(`[watcher] Active log → ${path.basename(filePath)}`)
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
