import { useEffect, useState } from 'react'
import { useStore, selectCurrentView } from '../store'
import type { KeyRunSnapshot, SegmentSnapshot } from '../types'

export function EncounterHeader() {
  const currentView = useStore(selectCurrentView)
  const wsStatus = useStore(s => s.wsStatus)
  const [elapsed, setElapsed] = useState(0)

  const isLiveSegment = currentView?.type === 'segment' && currentView.endTime === null

  useEffect(() => {
    if (!isLiveSegment) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - currentView.startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isLiveSegment, currentView])

  const statusColors: Record<string, string> = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-red-500',
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${statusColors[wsStatus]}`} />
        <span className="text-sm text-slate-400 capitalize">{wsStatus}</span>
      </div>

      {currentView?.type === 'key_run' ? (
        <KeyRunHeader view={currentView} formatTime={formatTime} />
      ) : currentView?.type === 'segment' ? (
        <SegmentHeader view={currentView} elapsed={elapsed} formatTime={formatTime} />
      ) : (
        <span className="text-sm text-slate-500">Waiting for encounter...</span>
      )}

      <div className="w-24" />
    </div>
  )
}

function SegmentHeader({
  view,
  elapsed,
  formatTime,
}: {
  view: SegmentSnapshot
  elapsed: number
  formatTime: (s: number) => string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-semibold text-white">{view.encounterName}</span>
      {view.endTime === null ? (
        <>
          <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded">
            In Progress
          </span>
          <span className="text-sm text-slate-400 tabular-nums">{formatTime(elapsed)}</span>
        </>
      ) : view.success ? (
        <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/40 px-2 py-0.5 rounded">
          Kill
        </span>
      ) : (
        <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded">
          Wipe
        </span>
      )}
    </div>
  )
}

function KeyRunHeader({
  view,
  formatTime,
}: {
  view: KeyRunSnapshot
  formatTime: (s: number) => string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-semibold text-white">{view.dungeonName}</span>
      <span className="text-sm text-slate-400">+{view.keystoneLevel}</span>
      {view.success === true ? (
        <>
          <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/40 px-2 py-0.5 rounded">
            Timed
          </span>
          {view.durationMs !== null && (
            <span className="text-sm text-slate-400 tabular-nums">
              {formatTime(Math.floor(view.durationMs / 1000))}
            </span>
          )}
        </>
      ) : view.success === false ? (
        <>
          <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded">
            Depleted
          </span>
          {view.durationMs !== null && (
            <span className="text-sm text-slate-400 tabular-nums">
              {formatTime(Math.floor(view.durationMs / 1000))}
            </span>
          )}
        </>
      ) : (
        <span className="text-xs bg-slate-500/20 text-slate-400 border border-slate-500/40 px-2 py-0.5 rounded">
          Incomplete
        </span>
      )}
    </div>
  )
}
