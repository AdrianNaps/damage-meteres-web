import { WebSocketServer, WebSocket } from 'ws'
import type { SegmentStore, Segment } from './store.js'
import type { EncounterStateMachine } from './stateMachine.js'

export interface AttachedWsHandlers {
  stop(): void
}

export function attachWsHandlers(
  wss: WebSocketServer,
  store: SegmentStore,
  machine: EncounterStateMachine,
): AttachedWsHandlers {
  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  function broadcastSegmentList() {
    broadcast({ type: 'segment_list', segments: store.getHistoryItems() })
  }

  const onEncounterStart = (seg: Segment) => {
    broadcast({ type: 'encounter_start', encounterName: seg.encounterName, segmentId: seg.id })
  }
  const onEncounterEnd = (seg: Segment) => {
    broadcast({ type: 'encounter_end', segmentId: seg.id, success: seg.success })
  }

  machine.on('encounter_start', onEncounterStart)
  machine.on('encounter_end', onEncounterEnd)
  machine.on('challenge_start', broadcastSegmentList)
  machine.on('challenge_end', broadcastSegmentList)

  const onConnection = (ws: WebSocket) => {
    console.log('[ws] Client connected')

    // Send segment list immediately on connect
    ws.send(JSON.stringify({
      type: 'segment_list',
      segments: store.getHistoryItems(),
    }))

    // If an encounter is in progress, notify the client
    if (machine.currentSegment) {
      ws.send(JSON.stringify({
        type: 'encounter_start',
        encounterName: machine.currentSegment.encounterName,
        segmentId: machine.currentSegment.id,
      }))
    }

    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'get_segment_list') {
        ws.send(JSON.stringify({
          type: 'segment_list',
          segments: store.getHistoryItems(),
        }))
      } else if (msg.type === 'get_segment') {
        const seg = store.getById(msg.segmentId)
        if (seg) {
          ws.send(JSON.stringify({ type: 'segment_detail', segmentId: seg.id, segment: store.toSnapshot(seg) }))
        }
      } else if (msg.type === 'get_key_run') {
        const snapshot = store.toKeyRunSnapshot(msg.keyRunId)
        if (snapshot) {
          ws.send(JSON.stringify({ type: 'key_run_detail', keyRunId: msg.keyRunId, snapshot }))
        }
      } else if (msg.type === 'get_boss_section') {
        const snapshot = store.toBossSectionSnapshot(msg.bossSectionId)
        if (snapshot) {
          ws.send(JSON.stringify({ type: 'boss_section_detail', bossSectionId: msg.bossSectionId, snapshot }))
        }
      } else if (msg.type === 'get_target_detail') {
        // viewType is 'segment' | 'key_run' | 'boss_section'. For aggregate views
        // we merge per-target rollups across every segment in the container so the
        // Overview's detail pane drills down the same way per-segment panes do.
        // metric selects which rollup to query: damage→targetDamageTaken,
        // healing→healingReceived. Both share the {total, sources[]} shape so
        // the client renderer can stay metric-agnostic.
        const { viewType, viewId, targetName, metric } = msg
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
        const sourceTotals: Record<string, number> = {}
        for (const seg of segs) {
          const entry = metric === 'healing'
            ? seg.healingReceived[targetName]
            : seg.targetDamageTaken[targetName]
          if (!entry) continue
          total += entry.total
          for (const src of Object.values(entry.sources)) {
            sourceTotals[src.sourceName] = (sourceTotals[src.sourceName] ?? 0) + src.total
          }
        }

        if (total > 0) {
          const sources = Object.entries(sourceTotals)
            .map(([sourceName, t]) => ({ sourceName, total: t }))
            .sort((a, b) => b.total - a.total)
          ws.send(JSON.stringify({ type: 'target_detail', targetName, total, sources }))
        } else {
          ws.send(JSON.stringify({ type: 'target_detail_not_found', targetName }))
        }
      }
    })

    ws.on('close', () => console.log('[ws] Client disconnected'))
  }

  wss.on('connection', onConnection)

  return {
    stop() {
      machine.off('encounter_start', onEncounterStart)
      machine.off('encounter_end', onEncounterEnd)
      machine.off('challenge_start', broadcastSegmentList)
      machine.off('challenge_end', broadcastSegmentList)
      wss.off('connection', onConnection)
    },
  }
}
