import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { createRuntime } from './runtime.js'
import { createIconResolver } from './iconResolver.js'

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

const iconResolver = createIconResolver({
  cacheFile: path.resolve(__dirname, 'data/spell-icons.json'),
})

// permessage-deflate: combat-log payloads repeat player names, spell IDs, and
// ability names heavily, so compression typically cuts wire size 10–20×. Most
// impactful on the web path (real network); on Electron/localhost the smaller
// payload also reduces client-side JSON.parse time.
const wss = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 3 },  // fast compression; higher levels don't pay off for WS frames
    threshold: 1024,                   // skip compression for small control messages
  },
})

createRuntime({ logsDir, maxSegments, iconResolver, wss })

httpServer.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`)
  if (hasClient) console.log(`[server] Serving client from client/dist/`)
  else console.log(`[server] No client build found — run "npm run build" to serve the UI`)
})

console.log('[index] Server started.')
