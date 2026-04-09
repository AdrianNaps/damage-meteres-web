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
        const seg = store.getById(msg.segmentId)
        const entry = seg?.targetDamageTaken[msg.targetName]
        if (entry) {
          ws.send(JSON.stringify({
            type: 'target_detail',
            targetName: msg.targetName,
            total: entry.total,
            sources: Object.values(entry.sources).sort((a, b) => b.total - a.total),
          }))
        } else {
          ws.send(JSON.stringify({ type: 'target_detail_not_found', targetName: msg.targetName }))
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
