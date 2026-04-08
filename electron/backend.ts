import path from 'path'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import type { AddressInfo } from 'net'
import { app } from 'electron'
import { LogWatcher } from '../server/watcher.js'
import { parseLine } from '../server/parser.js'
import { SegmentStore } from '../server/store.js'
import { EncounterStateMachine } from '../server/stateMachine.js'
import { attachWsHandlers, type AttachedWsHandlers } from '../server/wsServer.js'
import { createIconResolver } from '../server/iconResolver.js'
import { getSettings, setSetting } from './settings.js'

export class Backend {
  store!: SegmentStore
  machine!: EncounterStateMachine
  wss!: WebSocketServer
  wsPort = 0
  private watcher: LogWatcher | null = null
  private wsHandlers?: AttachedWsHandlers

  async start(): Promise<void> {
    const settings = getSettings()

    // Seed icon cache from bundled JSON on first run.
    const userCachePath = path.join(app.getPath('userData'), 'spell-icons.json')
    if (!fs.existsSync(userCachePath)) {
      // Resolve seed relative to this compiled file. After build it lives at:
      //   dist-electron/electron/backend.js
      // and the seed lives at:
      //   dist-electron/server/data/spell-icons.json (when bundled with electron-builder files glob)
      // Fall back to the source path during dev.
      const seedCandidates = [
        path.join(__dirname, '../server/data/spell-icons.json'),
        path.join(app.getAppPath(), 'server/data/spell-icons.json'),
      ]
      for (const seed of seedCandidates) {
        try {
          if (fs.existsSync(seed)) {
            const dir = path.dirname(userCachePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.copyFileSync(seed, userCachePath)
            break
          }
        } catch (err) {
          console.warn('[backend] failed to seed icon cache:', err)
        }
      }
    }

    const iconResolver = createIconResolver({ cacheFile: userCachePath })

    this.store = new SegmentStore(settings.maxSegments, iconResolver)
    this.machine = new EncounterStateMachine(this.store)

    this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve, reject) => {
      this.wss.once('listening', () => resolve())
      this.wss.once('error', reject)
    })
    this.wsHandlers = attachWsHandlers(this.wss, this.store, this.machine)
    this.wsPort = (this.wss.address() as AddressInfo).port
    console.log(`[backend] WebSocket listening on 127.0.0.1:${this.wsPort}`)

    // Path fallback — try the alternate classic install location.
    let logsDir = settings.logsDir
    if (!fs.existsSync(logsDir)) {
      const fallback = 'C:/Program Files/World of Warcraft/_retail_/Logs'
      if (fs.existsSync(fallback)) {
        setSetting('logsDir', fallback)
        logsDir = fallback
      }
    }

    this.setLogsDir(logsDir)
  }

  setLogsDir(dir: string): void {
    this.watcher?.stop()
    this.watcher = new LogWatcher(dir)
    this.watcher.on('lines', (lines: string[]) => {
      for (const line of lines) {
        const event = parseLine(line)
        if (event) this.machine.handle(event)
      }
    })
    this.watcher.start()
  }

  stop(): void {
    this.watcher?.stop()
    this.wsHandlers?.stop()
    this.wss?.close()
  }
}
