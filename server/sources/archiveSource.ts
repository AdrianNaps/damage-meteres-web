import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { StringDecoder } from 'string_decoder'
import { parseLine } from '../parser.js'
import { SegmentStore } from '../store.js'
import { EncounterStateMachine } from '../stateMachine.js'
import type { IconResolver } from '../iconResolver.js'
import type { LogSource } from './types.js'

const CHUNK_SIZE = 64 * 1024
const PROGRESS_THROTTLE_MS = 250

export interface ArchiveProgress {
  bytesRead: number
  totalBytes: number
  linesProcessed: number
}

export interface ArchiveLogSourceOptions {
  filePath: string
  maxSegments: number
  iconResolver: IconResolver
}

// Source IDs are derived from the absolute path so opening the same file twice
// in a row dedupes to the existing tab. Path-hash (vs content-hash) is cheaper
// and sufficient because users open files by location, not by identity.
export function archiveSourceId(filePath: string): string {
  let abs = path.resolve(filePath)
  if (process.platform === 'win32') abs = abs.toLowerCase()
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 12)
  return `archive:${hash}`
}

export class ArchiveLogSource extends EventEmitter implements LogSource {
  readonly id: string
  readonly kind = 'archive' as const
  readonly store: SegmentStore
  readonly machine: EncounterStateMachine
  readonly filePath: string

  private linesProcessed = 0
  private lastProgressEmit = 0
  private aborted = false

  constructor(opts: ArchiveLogSourceOptions) {
    super()
    this.filePath = path.resolve(opts.filePath)
    this.id = archiveSourceId(this.filePath)
    this.store = new SegmentStore(opts.maxSegments, opts.iconResolver)
    this.machine = new EncounterStateMachine(this.store)
  }

  // Stream the file once, parse all lines, feed them to the state machine.
  // Emits 'progress' (throttled) during the read and 'ready' on completion.
  // Yields to the event loop between chunks so a large log doesn't starve
  // the WS server while loading.
  async load(): Promise<void> {
    let stat: fs.Stats
    try {
      stat = await fs.promises.stat(this.filePath)
    } catch (err) {
      this.emit('error', err)
      throw err
    }

    const totalBytes = stat.size
    let bytesRead = 0
    let lineBuffer = ''
    const decoder = new StringDecoder('utf8')

    return new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(this.filePath, { highWaterMark: CHUNK_SIZE })

      stream.on('data', (chunk: string | Buffer) => {
        if (this.aborted) {
          stream.destroy()
          return
        }
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        bytesRead += buf.length
        const text = lineBuffer + decoder.write(buf)
        const lines = text.split('\n')
        lineBuffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '')
          if (!line) continue
          this.linesProcessed++
          this.feedLine(line)
        }
        this.maybeEmitProgress(bytesRead, totalBytes)

        // Yield to event loop between chunks. Big logs (200MB+) would block
        // the WS server for several seconds without this.
        stream.pause()
        setImmediate(() => {
          if (!this.aborted) stream.resume()
        })
      })

      stream.on('end', () => {
        if (this.aborted) {
          resolve()
          return
        }
        // Flush trailing partial line if the file didn't end on a newline.
        const tail = lineBuffer + decoder.end()
        if (tail) {
          const line = tail.replace(/\r$/, '')
          if (line) {
            this.linesProcessed++
            this.feedLine(line)
          }
        }
        this.emit('progress', {
          bytesRead: totalBytes,
          totalBytes,
          linesProcessed: this.linesProcessed,
        })
        this.emit('ready')
        resolve()
      })

      stream.on('error', (err) => {
        this.emit('error', err)
        reject(err)
      })
    })
  }

  dispose(): void {
    this.aborted = true
  }

  private feedLine(line: string): void {
    const parsed = parseLine(line)
    if (!parsed) return
    if (Array.isArray(parsed)) {
      for (const event of parsed) this.machine.handle(event)
    } else {
      this.machine.handle(parsed)
    }
  }

  private maybeEmitProgress(bytesRead: number, totalBytes: number): void {
    const now = Date.now()
    if (now - this.lastProgressEmit < PROGRESS_THROTTLE_MS) return
    this.lastProgressEmit = now
    this.emit('progress', {
      bytesRead,
      totalBytes,
      linesProcessed: this.linesProcessed,
    })
  }
}
