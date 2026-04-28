import { useStore, LIVE_SOURCE_ID, type SourceMeta } from './store'
import type { HistoryItem, SegmentSummary } from './types'

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

let connectStarted = false

export function connectWs() {
  // StrictMode double-invokes mount effects in dev. Without this guard a second
  // socket would be created and overwrite `ws`, leaving the first socket's
  // outbound sends pointing at a still-connecting peer (silently dropped) —
  // which manifests as a stuck Overall tab on first launch. Checking `ws`
  // alone is not enough: connect() awaits resolveWsUrl() before assigning
  // `ws`, so both invocations would pass that check.
  if (connectStarted) return
  connectStarted = true

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
          // devtools. A future toast or inline LogPicker error region will
          // surface this to the user.
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
        case 'segment_list': {
          // Capture the pre-update history so we can diff for newly-appeared
          // live segments below. Must happen BEFORE setSegmentHistory mutates
          // the slice — otherwise old and new both point at the same array.
          const prevSegments = state.sources.get(sourceId)?.segmentHistory ?? []

          setSegmentHistory(msg.segments, sourceId)

          // A new live pull just appeared (combat started) → jump straight to
          // it. Intentionally overrides whatever the user had selected: if a
          // boss is being pulled, that's the view they want. Archives never
          // produce new live segments, so the gate on LIVE keeps this quiet
          // when the user is viewing a static log.
          //
          // Two carve-outs:
          //   * Nothing selected yet (fresh source) → fall through to the
          //     auto-select block so a live M+ key lands on its Overall
          //     aggregate instead of the newest pull.
          //   * User is on a key run's Overall and the new pull belongs to
          //     that key run → leave the selection alone. M+ is a continuous
          //     timeline, so Overall is "watch the whole run"; a new pull
          //     shouldn't yank them off it. We still prefetch the segment so
          //     clicking its sub-tab is instant.
          if (sourceId === LIVE_SOURCE_ID) {
            const liveSlice = state.sources.get(sourceId)
            const hasSelection = !!liveSlice && (
              liveSlice.selectedSegmentId !== null ||
              liveSlice.selectedKeyRunId !== null ||
              liveSlice.selectedBossSectionId !== null
            )
            if (hasSelection) {
              const newLive = findNewlyAppearedLiveSegment(prevSegments, msg.segments as HistoryItem[])
              if (newLive) {
                const parentKeyRunId = findParentKeyRunId(msg.segments as HistoryItem[], newLive.id)
                const onKeyRunOverall =
                  liveSlice!.selectedSegmentId === null &&
                  liveSlice!.selectedKeyRunId !== null &&
                  parentKeyRunId !== null &&
                  parentKeyRunId === liveSlice!.selectedKeyRunId
                if (!onKeyRunOverall) {
                  useStore.getState().setSelectedSegmentId(newLive.id, sourceId)
                }
                send({ type: 'get_segment', sourceId, segmentId: newLive.id })
                break
              }
            }
          }

          // If the user hasn't picked anything in this source yet, auto-select
          // the most recent top-level instance so an opened log lands on real
          // data instead of an empty "waiting" state. Once anything is
          // selected, the guard below stops firing — re-deliveries of the
          // list during live combat won't yank the user's selection.
          const slice = useStore.getState().sources.get(sourceId)
          if (
            slice &&
            slice.selectedSegmentId === null &&
            slice.selectedKeyRunId === null &&
            slice.selectedBossSectionId === null
          ) {
            const items = msg.segments as HistoryItem[]
            let latest: HistoryItem | null = null
            for (const it of items) {
              if (!latest || it.startTime > latest.startTime) latest = it
            }
            if (latest) {
              const store = useStore.getState()
              if (latest.type === 'key_run') {
                store.setSelectedKeyRunId(latest.keyRunId, sourceId)
                send({ type: 'get_key_run', sourceId, keyRunId: latest.keyRunId })
              } else if (latest.type === 'boss_section') {
                store.setSelectedBossSectionId(latest.bossSectionId, sourceId)
                send({ type: 'get_boss_section', sourceId, bossSectionId: latest.bossSectionId })
              } else {
                store.setSelectedSegmentId(latest.id, sourceId)
                send({ type: 'get_segment', sourceId, segmentId: latest.id })
              }
            }
          }
          break
        }
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
          send({ type: 'get_segment_list', sourceId })
          break
        case 'encounter_end': {
          send({ type: 'get_segment_list', sourceId })
          // The snapshot the client holds for this segment was taken when
          // combat started and is now stale (no mid-pull pushes). Refresh it
          // so the tab shows the full pull instead of staying frozen at the
          // T=0 snapshot until the user clicks away and back.
          const endedSlice = state.sources.get(sourceId)
          if (endedSlice && endedSlice.selectedSegmentId === msg.segmentId) {
            send({ type: 'get_segment', sourceId, segmentId: msg.segmentId })
          }
          break
        }
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
    let resolved = false
    const handler = (e: MessageEvent) => {
      let m: any
      try { m = JSON.parse(e.data) } catch { return }
      if (m?.type === 'logs_listing') {
        resolved = true
        ws?.removeEventListener('message', handler)
        resolve({ dir: m.dir, files: m.files })
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ type: 'list_logs' }))
    setTimeout(() => {
      if (!resolved) {
        ws?.removeEventListener('message', handler)
        resolve(null)
      }
    }, 5000)
  })
}

// Open an archive source by file path. The server will broadcast
// `source_opened` (and `source_progress` while loading) which the main message
// handler picks up.
export function openArchiveSource(filePath: string): void {
  send({ type: 'open_source', filePath })
}

// Walk both top-level standalone segments and segments nested inside key-runs
// / boss-sections. Flattening keeps the diff logic below source-shape-agnostic.
function flattenSegments(items: HistoryItem[]): SegmentSummary[] {
  const out: SegmentSummary[] = []
  for (const it of items) {
    if (it.type === 'segment') out.push(it)
    else out.push(...it.segments)  // key_run | boss_section → inner segments
  }
  return out
}

// Find a live segment (endTime === null) that wasn't in `prev` — i.e. combat
// just started and the server just broadcast a new in-progress pull. The id
// check also filters out the steady-state case where the same live segment
// keeps re-arriving on every list delivery during an ongoing fight. Latest
// startTime wins when multiple live segments somehow appear at once (rare,
// but keeps behaviour deterministic).
// Find the key_run container that owns a given segment id, if any. Returns
// the parent's keyRunId so the new-live-pull path can decide whether the
// pull belongs to the key run the user is currently viewing.
function findParentKeyRunId(items: HistoryItem[], segmentId: string): string | null {
  for (const it of items) {
    if (it.type === 'key_run' && it.segments.some(s => s.id === segmentId)) {
      return it.keyRunId
    }
  }
  return null
}

function findNewlyAppearedLiveSegment(prev: HistoryItem[], next: HistoryItem[]): SegmentSummary | null {
  const prevIds = new Set<string>()
  for (const s of flattenSegments(prev)) prevIds.add(s.id)

  let winner: SegmentSummary | null = null
  for (const s of flattenSegments(next)) {
    if (s.endTime !== null) continue
    if (prevIds.has(s.id)) continue
    if (!winner || s.startTime > winner.startTime) winner = s
  }
  return winner
}
