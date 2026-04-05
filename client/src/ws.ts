import { useStore } from './store'

// In dev (Vite), VITE_WS_URL points to the local server.
// In production (served from Node), derive from the current page's host.
const WS_URL = import.meta.env.VITE_WS_URL
  ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

let ws: WebSocket | null = null

export function connectWs() {
  const { setWsStatus, setLiveSegment, setSelectedSegment, setSegmentHistory, setTargetDetail } = useStore.getState()

  function connect() {
    setWsStatus('connecting')
    ws = new WebSocket(WS_URL)

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

      switch (msg.type) {
        case 'state_update':
          setLiveSegment(msg.segment)
          break
        case 'segment_list':
          setSegmentHistory(msg.segments)
          break
        case 'segment_detail':
          if (msg.segmentId === useStore.getState().selectedSegmentId) {
            setSelectedSegment(msg.segment)
          }
          break
        case 'encounter_start':
        case 'encounter_end':
          // state_update will follow; request fresh segment list
          send({ type: 'get_segment_list' })
          break
        case 'target_detail':
          setTargetDetail(msg)
          break
      }
    }
  }

  connect()
}

export function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function requestTargetDetail(segmentId: string, targetName: string) {
  send({ type: 'get_target_detail', segmentId, targetName })
}
