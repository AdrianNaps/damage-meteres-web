import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import type { SegmentStore, Segment } from './store.js'
import type { EncounterStateMachine } from './stateMachine.js'

export function startWsServer(
  server: http.Server,
  store: SegmentStore,
  machine: EncounterStateMachine,
) {
  const wss = new WebSocketServer({ server })

  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  // Broadcast current segment snapshot ~1/sec
  setInterval(() => {
    const seg = machine.currentSegment
    if (!seg || wss.clients.size === 0) return
    broadcast({ type: 'state_update', segment: store.toSnapshot(seg) })
  }, 1000)

  machine.on('encounter_start', (seg: Segment) => {
    broadcast({ type: 'encounter_start', encounterName: seg.encounterName, segmentId: seg.id })
  })

  machine.on('encounter_end', (seg: Segment) => {
    broadcast({ type: 'encounter_end', segmentId: seg.id, success: seg.success })
    // Send the final snapshot so the client has complete data
    broadcast({ type: 'state_update', segment: store.toSnapshot(seg) })
  })

  wss.on('connection', (ws) => {
    console.log('[ws] Client connected')

    // Send segment list immediately on connect
    ws.send(JSON.stringify({
      type: 'segment_list',
      segments: store.getAll().map(s => store.toSummary(s)),
    }))

    // If an encounter is in progress, send current state immediately
    if (machine.currentSegment) {
      ws.send(JSON.stringify({
        type: 'encounter_start',
        encounterName: machine.currentSegment.encounterName,
        segmentId: machine.currentSegment.id,
      }))
      ws.send(JSON.stringify({
        type: 'state_update',
        segment: store.toSnapshot(machine.currentSegment),
      }))
    }

    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'get_segment_list') {
        ws.send(JSON.stringify({
          type: 'segment_list',
          segments: store.getAll().map(s => store.toSummary(s)),
        }))
      } else if (msg.type === 'get_segment') {
        const seg = store.getById(msg.segmentId)
        if (seg) {
          ws.send(JSON.stringify({ type: 'segment_detail', segmentId: seg.id, segment: store.toSnapshot(seg) }))
        }
      } else if (msg.type === 'get_target_detail') {
        const seg = store.getById(msg.segmentId)
        if (seg) {
          const entry = seg.targetDamageTaken[msg.targetName]
          if (entry) {
            ws.send(JSON.stringify({
              type: 'target_detail',
              targetName: msg.targetName,
              total: entry.total,
              sources: Object.values(entry.sources).sort((a, b) => b.total - a.total),
            }))
          }
        }
      }
    })

    ws.on('close', () => console.log('[ws] Client disconnected'))
  })

  return wss
}
