import { useStore } from '../store'
import { send } from '../ws'

export function SegmentTabs() {
  const history = useStore(s => s.segmentHistory)
  const selectedId = useStore(s => s.selectedSegmentId)
  const currentSegment = useStore(s => s.currentSegment)
  const setSelectedSegment = useStore(s => s.setSelectedSegment)

  if (history.length === 0) return null

  function selectSegment(id: string | null) {
    if (id === null) {
      setSelectedSegment(null)
    } else {
      setSelectedSegment(id)
      send({ type: 'get_segment', segmentId: id })
    }
  }

  const isLive = selectedId === null

  return (
    <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
      {currentSegment && (
        <button
          onClick={() => selectSegment(null)}
          className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors ${
            isLive
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Live
        </button>
      )}
      {[...history].reverse().map(seg => (
        <button
          key={seg.id}
          onClick={() => selectSegment(seg.id)}
          className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors ${
            selectedId === seg.id
              ? 'bg-slate-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          {seg.encounterName}
          {seg.success === true && <span className="ml-1 text-green-400">✓</span>}
          {seg.success === false && <span className="ml-1 text-red-400">✗</span>}
        </button>
      ))}
    </div>
  )
}
