import { useStore } from './store'

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

      switch (msg.type) {
        case 'segment_list':
          setSegmentHistory(msg.segments)
          break
        case 'segment_detail':
          if (msg.segmentId === useStore.getState().selectedSegmentId) {
            setSelectedSegment(msg.segment)
          }
          break
        case 'key_run_detail':
          if (msg.keyRunId === useStore.getState().selectedKeyRunId) {
            setSelectedKeyRun(msg.snapshot)
          }
          break
        case 'boss_section_detail':
          if (msg.bossSectionId === useStore.getState().selectedBossSectionId) {
            setSelectedBossSection(msg.snapshot)
          }
          break
        case 'encounter_start':
        case 'encounter_end':
          // request fresh segment list
          send({ type: 'get_segment_list' })
          break
        case 'target_detail':
          setTargetDetail({ targetName: msg.targetName, total: msg.total, sources: msg.sources })
          break
        case 'target_detail_not_found':
          setTargetDetail(null)
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

export function requestTargetDetail(
  viewType: 'segment' | 'key_run' | 'boss_section',
  viewId: string,
  targetName: string,
  metric: 'damage' | 'healing',
) {
  send({ type: 'get_target_detail', viewType, viewId, targetName, metric })
}
