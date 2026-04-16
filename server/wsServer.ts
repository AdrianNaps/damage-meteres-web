import fs from 'fs'
import path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import type { Segment } from './store.js'
import type { SourceRegistry } from './sources/registry.js'
import type { LiveStatus } from './sources/types.js'
import { ArchiveLogSource, archiveSourceId, type ArchiveProgress } from './sources/archiveSource.js'

export interface AttachedWsHandlers {
  stop(): void
}

export interface WsHandlerConfig {
  createArchiveSource(filePath: string): ArchiveLogSource
}

const WOW_LOG_PATTERN = /^WoWCombatLog-.*\.txt$/

interface SourceDescription {
  sourceId: string
  kind: 'live' | 'archive'
  label: string
  filePath: string | null
}

// Case-insensitive on Windows since WoW writes paths with "Program Files" but
// users may type alternative casings via the picker. Other platforms: exact.
function pathsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const na = path.normalize(a)
  const nb = path.normalize(b)
  if (process.platform === 'win32') return na.toLowerCase() === nb.toLowerCase()
  return na === nb
}

function describeSource(registry: SourceRegistry, sourceId: string): SourceDescription | null {
  const source = registry.get(sourceId)
  if (!source) return null
  if (source.kind === 'live') {
    const live = registry.getLive()
    const activeFile = live.getActiveFile()
    return {
      sourceId,
      kind: 'live',
      label: activeFile ? path.basename(activeFile) : 'Live',
      filePath: activeFile,
    }
  }
  const archive = source as ArchiveLogSource
  return {
    sourceId,
    kind: 'archive',
    label: path.basename(archive.filePath),
    filePath: archive.filePath,
  }
}

function listAllSources(registry: SourceRegistry): SourceDescription[] {
  const out: SourceDescription[] = []
  for (const s of registry.getAll()) {
    const desc = describeSource(registry, s.id)
    if (desc) out.push(desc)
  }
  return out
}

interface LogListing {
  name: string
  size: number
  mtimeMs: number
}

async function listLogs(dir: string): Promise<LogListing[]> {
  try {
    const names = await fs.promises.readdir(dir)
    const matching = names.filter(f => WOW_LOG_PATTERN.test(f))
    const out: LogListing[] = []
    for (const name of matching) {
      try {
        const stat = await fs.promises.stat(path.join(dir, name))
        out.push({ name, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {
        // Skip unreadable entries (permission, vanished mid-listing).
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return out
  } catch {
    return []
  }
}

export function attachWsHandlers(
  wss: WebSocketServer,
  registry: SourceRegistry,
  config: WsHandlerConfig,
): AttachedWsHandlers {
  const liveSource = registry.getLive()

  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  function broadcastSegmentList(sourceId: string) {
    const source = registry.get(sourceId)
    if (!source) return
    const items = source.store.getHistoryItems()
    console.log(`[ws] broadcast segment_list (${sourceId}) → ${items.length} items, ${wss.clients.size} clients`)
    broadcast({ type: 'segment_list', sourceId, segments: items })
  }

  // Live source's machine event handlers. Archive sources are immutable
  // post-load so they don't need ongoing event subscriptions; the 'ready'
  // handler pushes their segment_list once and never again.
  const onEncounterStart = (seg: Segment) => {
    broadcast({
      type: 'encounter_start',
      sourceId: 'live',
      encounterName: seg.encounterName,
      segmentId: seg.id,
    })
  }
  const onEncounterEnd = (seg: Segment) => {
    broadcast({ type: 'encounter_end', sourceId: 'live', segmentId: seg.id, success: seg.success })
  }
  const onChallengeStart = () => broadcastSegmentList('live')
  const onChallengeEnd = () => broadcastSegmentList('live')
  const onPackChanged = () => broadcastSegmentList('live')

  const onLiveStatus = (status: LiveStatus) => {
    broadcast({
      type: 'live_status',
      sourceId: 'live',
      writingNow: status.writingNow,
      lastWriteAt: status.lastWriteAt,
    })
  }

  // The live source's tracked filename changed (chokidar add or hot dir-swap).
  // Re-emit the full source list so clients refresh the Live tab label.
  const onFileSwitched = () => {
    broadcast({ type: 'sources', sources: listAllSources(registry) })
  }

  liveSource.machine.on('encounter_start', onEncounterStart)
  liveSource.machine.on('encounter_end', onEncounterEnd)
  liveSource.machine.on('challenge_start', onChallengeStart)
  liveSource.machine.on('challenge_end', onChallengeEnd)
  liveSource.machine.on('pack_changed', onPackChanged)
  liveSource.on('live_status', onLiveStatus)
  liveSource.on('file_switched', onFileSwitched)

  // Open an archive source: dedupe to existing tab if same file is already
  // open, refuse if it matches the live source's active file, evict LRU when
  // at cap, and broadcast progress + ready frames as the file streams in.
  // The requesting `ws` receives error responses directly; success frames are
  // broadcast to all clients.
  function openArchiveSource(requester: WebSocket, filePath: string): void {
    const absolute = path.resolve(filePath)

    // Refuse opening the file the live source is currently tailing — viewing
    // it through the live tab is the supported path.
    if (pathsEqual(absolute, liveSource.getActiveFile())) {
      requester.send(JSON.stringify({
        type: 'source_open_error',
        filePath: absolute,
        message: 'This file is currently the live source.',
      }))
      return
    }

    const id = archiveSourceId(absolute)
    const existing = registry.get(id)
    if (existing) {
      // Same file already open — re-broadcast so the requesting client knows
      // about it (handles "user clicked Open on a row that was already open
      // in another tab"). Bump LRU since the user expressed renewed interest.
      registry.touch(id)
      const desc = describeSource(registry, id)
      if (desc) requester.send(JSON.stringify({ type: 'source_opened', source: desc, alreadyOpen: true }))
      return
    }

    const evictedId = registry.evictLruArchiveIfAtCap()
    if (evictedId) broadcast({ type: 'source_closed', sourceId: evictedId, reason: 'lru' })

    let archive: ArchiveLogSource
    try {
      archive = config.createArchiveSource(absolute)
    } catch (err: any) {
      requester.send(JSON.stringify({
        type: 'source_open_error',
        filePath: absolute,
        message: err?.message ?? 'failed to create source',
      }))
      return
    }
    registry.add(archive)

    const desc = describeSource(registry, archive.id)
    broadcast({ type: 'source_opened', source: desc, alreadyOpen: false })

    archive.on('progress', (p: ArchiveProgress) => {
      broadcast({
        type: 'source_progress',
        sourceId: archive.id,
        bytesRead: p.bytesRead,
        totalBytes: p.totalBytes,
        linesProcessed: p.linesProcessed,
      })
    })

    archive.on('error', (err: any) => {
      // If load fails, broadcast a close so clients can drop the tab. The
      // initial source_opened already went out, so a paired source_closed
      // keeps client state consistent.
      console.warn(`[ws] archive load error for ${archive.id}:`, err?.message ?? err)
      registry.removeArchive(archive.id)
      broadcast({ type: 'source_closed', sourceId: archive.id, reason: 'error' })
    })

    archive.on('ready', () => {
      // Archive parsing is done — push a single segment_list. Archives are
      // immutable post-load, so we don't bind machine listeners that would
      // continue broadcasting (those only matter for the live source).
      broadcast({
        type: 'segment_list',
        sourceId: archive.id,
        segments: archive.store.getHistoryItems(),
      })
    })

    archive.load().catch(() => {
      // Already handled in the 'error' listener above; .catch silences the
      // unhandled-rejection warning.
    })
  }

  const onConnection = (ws: WebSocket) => {
    console.log('[ws] Client connected')

    // Initial sync: source list, per-source segment lists, current live status,
    // and any in-flight encounter notification.
    ws.send(JSON.stringify({ type: 'sources', sources: listAllSources(registry) }))

    for (const source of registry.getAll()) {
      ws.send(JSON.stringify({
        type: 'segment_list',
        sourceId: source.id,
        segments: source.store.getHistoryItems(),
      }))
    }

    const status = liveSource.getLiveStatus()
    ws.send(JSON.stringify({
      type: 'live_status',
      sourceId: 'live',
      writingNow: status.writingNow,
      lastWriteAt: status.lastWriteAt,
    }))

    if (liveSource.machine.currentSegment) {
      ws.send(JSON.stringify({
        type: 'encounter_start',
        sourceId: 'live',
        encounterName: liveSource.machine.currentSegment.encounterName,
        segmentId: liveSource.machine.currentSegment.id,
      }))
    }

    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // Default to 'live' for unscoped requests so PR 1-3 clients (no sourceId
      // awareness yet) keep working until PR 4 lifts the client store.
      const sourceId: string = typeof msg.sourceId === 'string' ? msg.sourceId : 'live'

      if (msg.type === 'list_sources') {
        ws.send(JSON.stringify({ type: 'sources', sources: listAllSources(registry) }))
        return
      }

      if (msg.type === 'list_logs') {
        const dir = liveSource.getLogsDir()
        listLogs(dir).then(files => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'logs_listing', dir, files }))
          }
        })
        return
      }

      if (msg.type === 'open_source') {
        const filePath: unknown = msg.filePath
        if (typeof filePath !== 'string' || !filePath) {
          ws.send(JSON.stringify({
            type: 'source_open_error',
            filePath: typeof filePath === 'string' ? filePath : null,
            message: 'invalid filePath',
          }))
          return
        }
        openArchiveSource(ws, filePath)
        return
      }

      const source = registry.get(sourceId)
      if (!source) return
      // Bump LRU on every routable hit so the archive the user is actively
      // browsing isn't the next one evicted.
      registry.touch(sourceId)
      const store = source.store

      if (msg.type === 'get_segment_list') {
        ws.send(JSON.stringify({
          type: 'segment_list',
          sourceId,
          segments: store.getHistoryItems(),
        }))
      } else if (msg.type === 'get_segment') {
        const seg = store.getById(msg.segmentId)
        if (seg) {
          ws.send(JSON.stringify({ type: 'segment_detail', sourceId, segmentId: seg.id, segment: store.toSnapshot(seg) }))
        }
      } else if (msg.type === 'get_key_run') {
        const snapshot = store.toKeyRunSnapshot(msg.keyRunId)
        if (snapshot) {
          ws.send(JSON.stringify({ type: 'key_run_detail', sourceId, keyRunId: msg.keyRunId, snapshot }))
        }
      } else if (msg.type === 'get_boss_section') {
        const snapshot = store.toBossSectionSnapshot(msg.bossSectionId)
        if (snapshot) {
          ws.send(JSON.stringify({ type: 'boss_section_detail', sourceId, bossSectionId: msg.bossSectionId, snapshot }))
        }
      } else if (msg.type === 'get_target_detail') {
        // viewType is 'segment' | 'key_run' | 'boss_section'. For aggregate views
        // we merge per-target rollups across every segment in the container so the
        // Overview's detail pane drills down the same way per-segment panes do.
        // metric selects which rollup to query: damage→targetDamageTaken,
        // healing→healingReceived. Both share the {total, sources[]} shape so
        // the client renderer can stay metric-agnostic.
        const viewType: unknown = msg.viewType
        const viewId: unknown = msg.viewId
        const targetName: unknown = msg.targetName
        if (typeof viewId !== 'string' || typeof targetName !== 'string') return
        if (viewType !== 'segment' && viewType !== 'key_run' && viewType !== 'boss_section') return
        const metric: 'damage' | 'healing' = msg.metric === 'healing' ? 'healing' : 'damage'

        let segs: Segment[] = []
        if (viewType === 'segment') {
          const seg = store.getById(viewId)
          if (seg) segs = [seg]
        } else if (viewType === 'key_run') {
          segs = store.getAll().filter(s => s.keyRunId === viewId)
        } else if (viewType === 'boss_section') {
          segs = store.getAll().filter(s => s.bossSectionId === viewId)
        }

        let total = 0
        let found = false
        const sourceTotals: Record<string, number> = {}
        for (const seg of segs) {
          const entry = metric === 'healing'
            ? seg.healingReceived[targetName]
            : seg.targetDamageTaken[targetName]
          if (!entry) continue
          found = true
          total += entry.total
          for (const src of Object.values(entry.sources)) {
            sourceTotals[src.sourceName] = (sourceTotals[src.sourceName] ?? 0) + src.total
          }
        }

        // Existence-based detection — a legitimately zero-total row (e.g. a
        // target that was fully overhealed across the view) still exists in
        // the outer Targets list and must not collapse to "not found" here.
        if (found) {
          const sources = Object.entries(sourceTotals)
            .map(([sourceName, t]) => ({ sourceName, total: t }))
            .sort((a, b) => b.total - a.total)
          ws.send(JSON.stringify({ type: 'target_detail', sourceId, targetName, total, sources }))
        } else {
          ws.send(JSON.stringify({ type: 'target_detail_not_found', sourceId, targetName }))
        }
      }
    })

    ws.on('close', () => console.log('[ws] Client disconnected'))
  }

  wss.on('connection', onConnection)

  return {
    stop() {
      liveSource.machine.off('encounter_start', onEncounterStart)
      liveSource.machine.off('encounter_end', onEncounterEnd)
      liveSource.machine.off('challenge_start', onChallengeStart)
      liveSource.machine.off('challenge_end', onChallengeEnd)
      liveSource.machine.off('pack_changed', onPackChanged)
      liveSource.off('live_status', onLiveStatus)
      liveSource.off('file_switched', onFileSwitched)
      wss.off('connection', onConnection)
    },
  }
}
