import { useStore, LIVE_SOURCE_ID, type SourceMeta } from './store'

let ws: WebSocket | null = null

async function resolveWsUrl(): Promise<string> {
  if (window.api?.getBootInfo) {
    const { wsPort } = await window.api.getBootInfo()
    return `ws://127.0.0.1:${wsPort}`
  }
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
}

export function connectWs() {
  const {
    setWsStatus,
    setSelectedSegment,
    setSegmentHistory,
    setSelectedKeyRun,
    setSelectedBossSection,
    setTargetDetail,
    addSource,
    removeSource,
    updateSourceMeta,
  } = useStore.getState()

  async function connect() {
    setWsStatus('connecting')
    let url: string
    try {
      url = await resolveWsUrl()
    } catch {
      setWsStatus('disconnected')
      setTimeout(connect, 2000)
      return
    }

    ws = new WebSocket(url)

    ws.onopen = () => {
      setWsStatus('connected')
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      setTimeout(connect, 2000) // reconnect
    }

    ws.onerror = () => {
      ws?.close()
    }

    ws.onmessage = (e) => {
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }

      // PR 4: messages may carry a sourceId. Default to LIVE for the few
      // server frames that don't (e.g. old in-flight broadcasts during a
      // server upgrade).
      const sourceId: string = typeof msg.sourceId === 'string' ? msg.sourceId : LIVE_SOURCE_ID
      const state = useStore.getState()

      switch (msg.type) {
        case 'sources': {
          // Initial source registry sync. Add/refresh metas for everything the
          // server reports; remove anything the client knew about that the
          // server no longer has.
          const incomingIds = new Set<string>()
          for (const s of msg.sources as SourceMeta[]) {
            incomingIds.add(s.sourceId)
            const existing = state.sourceMetas.get(s.sourceId)
            if (existing) {
              updateSourceMeta(s.sourceId, s)
            } else {
              addSource(s)
            }
          }
          for (const id of state.sourceMetas.keys()) {
            if (!incomingIds.has(id) && id !== LIVE_SOURCE_ID) removeSource(id)
          }
          break
        }
        case 'source_opened': {
          const meta = msg.source as SourceMeta
          if (state.sourceMetas.has(meta.sourceId)) {
            updateSourceMeta(meta.sourceId, meta)
          } else {
            addSource(meta)
          }
          // Auto-switch to the newly opened source so the user sees the result
          // of their picker action immediately. Skip when alreadyOpen — the
          // server is just confirming a dedupe and we shouldn't yank the user.
          if (!msg.alreadyOpen) {
            useStore.getState().setActiveSource(meta.sourceId)
          }
          break
        }
        case 'source_closed': {
          removeSource(sourceId)
          break
        }
        case 'source_progress': {
          updateSourceMeta(sourceId, {
            loadProgress: {
              bytesRead: msg.bytesRead,
              totalBytes: msg.totalBytes,
              linesProcessed: msg.linesProcessed,
            },
            loaded: msg.bytesRead >= msg.totalBytes,
          })
          break
        }
        case 'source_open_error': {
          // No global toast surface yet; log to console so it surfaces in
          // devtools. PR 5 wires this to the LogPicker for inline UI feedback.
          console.warn('[ws] source_open_error:', msg.message, msg.filePath)
          break
        }
        case 'live_status': {
          updateSourceMeta(LIVE_SOURCE_ID, {
            liveStatus: { writingNow: msg.writingNow, lastWriteAt: msg.lastWriteAt },
          })
          break
        }
        case 'logs_listing': {
          // Picker subscribes via a separate transient channel below; ignore
          // here. Picker requests fire from LogPicker.tsx (PR 5).
          break
        }
        case 'segment_list':
          setSegmentHistory(msg.segments, sourceId)
          break
        case 'segment_detail': {
          // Only hydrate selectedSegment when the message corresponds to the
          // current selection in the target source's slice. For the active
          // source this is the existing comparison; for non-active sources we
          // still cache the snapshot via setSelectedSegment so re-clicks hit
          // the cache.
          const targetSlice = state.sources.get(sourceId)
          if (targetSlice && msg.segmentId === targetSlice.selectedSegmentId) {
            setSelectedSegment(msg.segment, sourceId)
          }
          break
        }
        case 'key_run_detail': {
          const targetSlice = state.sources.get(sourceId)
          if (targetSlice && msg.keyRunId === targetSlice.selectedKeyRunId) {
            setSelectedKeyRun(msg.snapshot, sourceId)
          }
          break
        }
        case 'boss_section_detail': {
          const targetSlice = state.sources.get(sourceId)
          if (targetSlice && msg.bossSectionId === targetSlice.selectedBossSectionId) {
            setSelectedBossSection(msg.snapshot, sourceId)
          }
          break
        }
        case 'encounter_start':
        case 'encounter_end':
          // Request fresh segment list for the source that emitted the event.
          send({ type: 'get_segment_list', sourceId })
          break
        case 'target_detail':
          // target_detail is only meaningful for the active source's drill
          // panel — drop frames from non-active sources to avoid clobbering.
          if (sourceId === useStore.getState().activeSourceId) {
            setTargetDetail({ targetName: msg.targetName, total: msg.total, sources: msg.sources })
          }
          break
        case 'target_detail_not_found':
          if (sourceId === useStore.getState().activeSourceId) {
            setTargetDetail(null)
          }
          break
      }
    }
  }

  connect()
}

// Outbound send: callers may include `sourceId` directly in `msg`. When
// omitted, the message is unscoped — the server defaults it to live (PR 2).
export function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function requestTargetDetail(
  viewType: 'segment' | 'key_run' | 'boss_section',
  viewId: string,
  targetName: string,
  metric: 'damage' | 'healing',
) {
  send({
    type: 'get_target_detail',
    sourceId: useStore.getState().activeSourceId,
    viewType,
    viewId,
    targetName,
    metric,
  })
}

// Issue a one-shot logs-directory listing. Used by the LogPicker (PR 5);
// resolves with the server's response or null if WS isn't connected.
export function requestLogsListing(): Promise<{ dir: string; files: { name: string; size: number; mtimeMs: number }[] } | null> {
  return new Promise(resolve => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(null)
    const handler = (e: MessageEvent) => {
      let m: any
      try { m = JSON.parse(e.data) } catch { return }
      if (m?.type === 'logs_listing') {
        ws?.removeEventListener('message', handler)
        resolve({ dir: m.dir, files: m.files })
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ type: 'list_logs' }))
    // Safety timeout so we don't leak handlers if the server drops.
    setTimeout(() => {
      ws?.removeEventListener('message', handler)
      resolve(null)
    }, 5000)
  })
}

// Open an archive source by file path. The server will broadcast
// `source_opened` (and `source_progress` while loading) which the main message
// handler picks up.
export function openArchiveSource(filePath: string): void {
  send({ type: 'open_source', filePath })
}
