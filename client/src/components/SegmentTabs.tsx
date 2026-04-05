import { useState } from 'react'
import { useStore } from '../store'
import { send } from '../ws'
import type { KeyRunSummary, SegmentSummary } from '../types'

export function SegmentTabs() {
  const history = useStore(s => s.segmentHistory)
  const selectedId = useStore(s => s.selectedSegmentId)
  const selectedKeyRunId = useStore(s => s.selectedKeyRunId)
  const liveSegment = useStore(s => s.liveSegment)
  const setSelectedSegmentId = useStore(s => s.setSelectedSegmentId)
  const setSelectedKeyRunId = useStore(s => s.setSelectedKeyRunId)

  // Track which key run groups are expanded; default to all expanded
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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

  function toggleExpanded(keyRunId: string) {
    setExpanded(prev => ({ ...prev, [keyRunId]: !(prev[keyRunId] ?? true) }))
  }

  function isGroupExpanded(keyRunId: string) {
    return expanded[keyRunId] ?? true
  }

  const isLive = selectedId === null && selectedKeyRunId === null

  return (
    <div className="flex gap-1 px-4 pt-3 overflow-x-auto items-start">
      {liveSegment && (
        <button
          onClick={() => selectSegment(null)}
          className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
            isLive
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Live
        </button>
      )}
      {[...history].reverse().map(item =>
        item.type === 'key_run'
          ? <KeyRunGroup
              key={item.keyRunId}
              item={item}
              isExpanded={isGroupExpanded(item.keyRunId)}
              isSelected={selectedKeyRunId === item.keyRunId}
              selectedSegmentId={selectedId}
              onToggle={() => toggleExpanded(item.keyRunId)}
              onSelectKeyRun={() => selectKeyRun(item.keyRunId)}
              onSelectSegment={selectSegment}
            />
          : <SegmentButton
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={() => selectSegment(item.id)}
            />
      )}
    </div>
  )
}

interface KeyRunGroupProps {
  item: KeyRunSummary
  isExpanded: boolean
  isSelected: boolean
  selectedSegmentId: string | null
  onToggle: () => void
  onSelectKeyRun: () => void
  onSelectSegment: (id: string) => void
}

function KeyRunGroup({
  item,
  isExpanded,
  isSelected,
  selectedSegmentId,
  onToggle,
  onSelectKeyRun,
  onSelectSegment,
}: KeyRunGroupProps) {
  const hasSelectedChild = item.segments.some(s => s.id === selectedSegmentId)

  return (
    <div className="flex-shrink-0 flex flex-col gap-0.5">
      {/* Group header */}
      <div className={`flex items-center gap-0.5 rounded overflow-hidden ${
        isSelected || hasSelectedChild ? 'ring-1 ring-white/20' : ''
      }`}>
        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="px-1.5 py-1.5 text-slate-500 hover:text-white hover:bg-white/5 transition-colors text-xs leading-none"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        {/* Key run header — clicking selects aggregate view */}
        <button
          onClick={onSelectKeyRun}
          className={`px-2 py-1.5 text-xs whitespace-nowrap transition-colors ${
            isSelected
              ? 'bg-amber-600 text-white'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="font-medium">{item.dungeonName}</span>
          <span className="ml-1 text-slate-400">+{item.keystoneLevel}</span>
          {item.success === true && <span className="ml-1 text-green-400">✓</span>}
          {item.success === false && <span className="ml-1 text-red-400">✗</span>}
          {item.durationMs !== null && (
            <span className="ml-1.5 text-slate-500 tabular-nums">
              {formatKeyDuration(item.durationMs)}
            </span>
          )}
        </button>
      </div>

      {/* Child segments */}
      {isExpanded && (
        <div className="flex flex-col gap-0.5 pl-5">
          {item.segments.map(seg => (
            <SegmentButton
              key={seg.id}
              item={seg}
              isSelected={selectedSegmentId === seg.id}
              onSelect={() => onSelectSegment(seg.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface SegmentButtonProps {
  item: SegmentSummary
  isSelected: boolean
  onSelect: () => void
}

function SegmentButton({ item, isSelected, onSelect }: SegmentButtonProps) {
  return (
    <button
      onClick={onSelect}
      className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
        isSelected
          ? 'bg-slate-600 text-white'
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {item.encounterName}
      {item.success === true && <span className="ml-1 text-green-400">✓</span>}
      {item.success === false && <span className="ml-1 text-red-400">✗</span>}
    </button>
  )
}

function formatKeyDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
