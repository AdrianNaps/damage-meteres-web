import { useStore } from './store'

const WS_URL = 'ws://localhost:3001'

let ws: WebSocket | null = null

export function connectWs() {
  const { setWsStatus, setLiveSegment, setSelectedSegment, setSegmentHistory } = useStore.getState()

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
