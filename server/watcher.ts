import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import chokidar from 'chokidar'

export class LogWatcher extends EventEmitter {
  private logsDir: string
  private activeFile: string | null = null
  private lastOffset: number = 0
  private lineBuffer: string = ''
  private watcher: ReturnType<typeof chokidar.watch> | null = null

  constructor(logsDir: string) {
    super()
    this.logsDir = logsDir
  }

  start() {
    if (!fs.existsSync(this.logsDir)) {
      console.error(`[watcher] Logs directory not found: ${this.logsDir}`)
      console.error('[watcher] This is the #1 setup failure point — check your config.json logsDir')
      return
    }

    console.log(`[watcher] Watching: ${this.logsDir}`)

    // Watch the directory itself — avoids glob parsing issues with spaces/parens in path on Windows
    this.watcher = chokidar.watch(this.logsDir, {
      persistent: true,
      ignoreInitial: true,
      usePolling: true,
      interval: 500,
      depth: 0,
    })

    this.watcher.on('add', (filePath: string) => {
      if (!/WoWCombatLog-.*\.txt$/.test(filePath)) return
      console.log(`[watcher] New log file detected: ${path.basename(filePath)}`)
      this._switchToFile(filePath)
    })

    this.watcher.on('change', (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(this.activeFile ?? '')) {
        this._readNewBytes()
      }
    })

    this.watcher.on('error', (err: unknown) => {
      console.error('[watcher] Error:', err)
    })

    this._activateMostRecent()
  }

  private _activateMostRecent() {
    let files: { name: string; mtime: number }[]
    try {
      files = fs.readdirSync(this.logsDir)
        .filter(f => /^WoWCombatLog-.*\.txt$/.test(f))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(this.logsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    } catch (err: any) {
      console.warn('[watcher] Could not read logs directory:', err.message)
      return
    }

    if (files.length === 0) {
      console.log('[watcher] No WoWCombatLog-*.txt found — waiting for a new session...')
      return
    }

    const latest = files[0]
    const ageMs = Date.now() - latest.mtime
    if (ageMs > 24 * 60 * 60 * 1000) {
      console.log(`[watcher] Most recent log is ${Math.round(ageMs / 3600000)}h old — skipping. Waiting for a new session...`)
      return
    }

    const latestPath = path.join(this.logsDir, latest.name)
    if (latestPath !== this.activeFile) {
      this._switchToFile(latestPath)
    }
  }

  private _switchToFile(filePath: string) {
    console.log(`[watcher] Tailing: ${path.basename(filePath)}`)
    this.activeFile = filePath
    this.lastOffset = 0
    this.lineBuffer = ''
    this.emit('file_switched', filePath)
    this._readNewBytes()
  }

  private _readNewBytes() {
    if (!this.activeFile) return

    let stat: fs.Stats
    try {
      stat = fs.statSync(this.activeFile)
    } catch {
      return
    }

    if (stat.size < this.lastOffset) {
      console.log('[watcher] File truncated — resetting offset')
      this.lastOffset = 0
      this.lineBuffer = ''
    }

    if (stat.size === this.lastOffset) return

    const CHUNK = 64 * 1024
    const fd = fs.openSync(this.activeFile, 'r')

    try {
      while (this.lastOffset < stat.size) {
        const toRead = Math.min(CHUNK, stat.size - this.lastOffset)
        const buf = Buffer.alloc(toRead)
        fs.readSync(fd, buf, 0, toRead, this.lastOffset)
        this.lastOffset += toRead

        const raw = this.lineBuffer + buf.toString('utf8')
        const lines = raw.split('\n')
        this.lineBuffer = lines.pop() ?? ''

        const complete = lines.map(l => l.replace(/\r$/, '')).filter(l => l.length > 0)
        if (complete.length > 0) this.emit('lines', complete)
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  stop() {
    this.watcher?.close()
  }
}
