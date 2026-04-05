import { useStore } from '../store'
import { send } from '../ws'
import type { KeyRunSummary } from '../types'

export function SegmentTabs() {
  const history = useStore(s => s.segmentHistory)
  const selectedId = useStore(s => s.selectedSegmentId)
  const selectedKeyRunId = useStore(s => s.selectedKeyRunId)
  const liveSegment = useStore(s => s.liveSegment)
  const setSelectedSegmentId = useStore(s => s.setSelectedSegmentId)
  const setSelectedKeyRunId = useStore(s => s.setSelectedKeyRunId)

  if (history.length === 0) return null

  function selectSegment(id: string | null) {
    if (id === null) {
      setSelectedSegmentId(null)
    } else {
      setSelectedSegmentId(id)
      send({ type: 'get_segment', segmentId: id })
    }
  }

  function selectKeyRun(keyRunId: string) {
    setSelectedKeyRunId(keyRunId)
    send({ type: 'get_key_run', keyRunId })
  }

  const isLive = selectedId === null && selectedKeyRunId === null
  const reversedHistory = [...history].reverse()

  // Find which key run is "active" — either directly selected or contains the selected segment
  const activeKeyRun = reversedHistory.find(
    item =>
      item.type === 'key_run' &&
      (item.keyRunId === selectedKeyRunId || item.segments.some(s => s.id === selectedId))
  ) as KeyRunSummary | undefined

  const activeSegments = activeKeyRun?.segments ?? []

  return (
    <div className="flex flex-col">
      {/* Top tier — runs and standalone encounters */}
      <div className="flex gap-1 px-4 pt-3 overflow-x-auto items-center">
        {liveSegment && (
          <button
            onClick={() => selectSegment(null)}
            className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
              isLive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Live
          </button>
        )}
        {reversedHistory.map(item =>
          item.type === 'key_run' ? (
            <button
              key={item.keyRunId}
              onClick={() => selectKeyRun(item.keyRunId)}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
                activeKeyRun?.keyRunId === item.keyRunId
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="font-medium">{item.dungeonName}</span>
              <span className="ml-1 opacity-60">+{item.keystoneLevel}</span>
              {item.success === true && <span className="ml-1 text-green-400">✓</span>}
              {item.success === false && <span className="ml-1 text-red-400">✗</span>}
              {item.durationMs !== null && (
                <span className="ml-1.5 opacity-50 tabular-nums">
                  {formatKeyDuration(item.durationMs)}
                </span>
              )}
            </button>
          ) : (
            <button
              key={item.id}
              onClick={() => selectSegment(item.id)}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
                selectedId === item.id
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {item.encounterName}
              {item.success === true && <span className="ml-1 text-green-400">✓</span>}
              {item.success === false && <span className="ml-1 text-red-400">✗</span>}
            </button>
          )
        )}
      </div>

      {/* Bottom tier — segments within the active key run */}
      {activeSegments.length > 0 && (
        <div className="flex gap-1 px-4 pt-1 pb-0.5 overflow-x-auto items-center">
          {activeSegments.map(seg => (
            <button
              key={seg.id}
              onClick={() => selectSegment(seg.id)}
              className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
                selectedId === seg.id
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-500 hover:text-white hover:bg-white/5'
              }`}
            >
              {shortSegmentName(seg.encounterName)}
              {seg.success === true && <span className="ml-1 text-green-400">✓</span>}
              {seg.success === false && <span className="ml-1 text-red-400">✗</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Strip "Dungeon Name — " prefix from trash segment names. */
function shortSegmentName(name: string): string {
  const idx = name.indexOf(' — ')
  return idx !== -1 ? name.slice(idx + 3) : name
}

function formatKeyDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
