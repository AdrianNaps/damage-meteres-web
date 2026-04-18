import { EventEmitter } from 'events'
import { LogWatcher } from '../watcher.js'
import { parseLine } from '../parser.js'
import { SegmentStore } from '../store.js'
import { EncounterStateMachine } from '../stateMachine.js'
import type { IconResolver } from '../iconResolver.js'
import type { LogSource, LiveStatus } from './types.js'

// File counts as "writing now" if we received at least one parsed line within
// this trailing window. Tuned to a comfortable between-pull silence on a key —
// long enough that combat-pocket gaps don't dim the indicator, short enough
// that a closed game registers as quiet within ~30s.
const WRITING_WINDOW_MS = 30_000

// How often to recompute writingNow and emit if it flipped. The 'lines' handler
// also force-recomputes on the leading edge so the indicator goes "live" the
// instant data starts flowing without waiting for the next tick.
const STATUS_TICK_MS = 5_000

export interface LiveLogSourceOptions {
  logsDir: string
  maxSegments: number
  iconResolver: IconResolver
}

export class LiveLogSource extends EventEmitter implements LogSource {
  readonly id = 'live'
  readonly kind = 'live' as const
  readonly store: SegmentStore
  readonly machine: EncounterStateMachine

  private opts: LiveLogSourceOptions
  private watcher: LogWatcher
  private statusTimer: NodeJS.Timeout | null = null
  private lastWriteAt: number | null = null
  private writingNow = false
  private currentLogsDir: string
  private activeFile: string | null = null

  constructor(opts: LiveLogSourceOptions) {
    super()
    this.opts = opts
    this.store = new SegmentStore(opts.maxSegments, opts.iconResolver)
    this.machine = new EncounterStateMachine(this.store)
    this.currentLogsDir = opts.logsDir
    this.watcher = this.createWatcher(opts.logsDir)
  }

  start(): void {
    this.watcher.start()
    this.statusTimer = setInterval(() => this.recomputeStatus(), STATUS_TICK_MS)
  }

  // Hot-swap the watcher to a different logs directory. Keeps store + machine
  // intact so prior session history survives the dir change — same behavior as
  // the pre-refactor backend, which only replaced the LogWatcher on dir change.
  setLogsDir(dir: string): void {
    this.currentLogsDir = dir
    this.activeFile = null
    this.watcher.stop()
    this.watcher = this.createWatcher(dir)
    this.watcher.start()
  }

  dispose(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
    this.watcher.stop()
  }

  getLogsDir(): string {
    return this.currentLogsDir
  }

  getActiveFile(): string | null {
    return this.activeFile
  }

  getLiveStatus(): LiveStatus {
    return { writingNow: this.writingNow, lastWriteAt: this.lastWriteAt }
  }

  private createWatcher(dir: string): LogWatcher {
    const w = new LogWatcher(dir)
    w.on('lines', (lines: string[]) => this.handleLines(lines))
    w.on('file_switched', (filePath: string) => {
      this.activeFile = filePath
      this.emit('file_switched', filePath)
    })
    return w
  }

  private handleLines(lines: string[]): void {
    this.lastWriteAt = Date.now()
    if (!this.writingNow) this.recomputeStatus()
    for (const line of lines) {
      const parsed = parseLine(line)
      if (!parsed) continue
      if (Array.isArray(parsed)) {
        for (const event of parsed) this.machine.handle(event)
      } else {
        this.machine.handle(parsed)
      }
    }
  }

  private recomputeStatus(): void {
    const writing = this.lastWriteAt !== null
      && (Date.now() - this.lastWriteAt) < WRITING_WINDOW_MS
    if (writing === this.writingNow) return
    this.writingNow = writing
    const status: LiveStatus = { writingNow: writing, lastWriteAt: this.lastWriteAt }
    this.emit('live_status', status)
  }
}
