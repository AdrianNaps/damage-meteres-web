import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function EncounterHeader() {
  const currentSegment = useStore(s => s.currentSegment)
  const wsStatus = useStore(s => s.wsStatus)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!currentSegment || currentSegment.endTime !== null) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - currentSegment.startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [currentSegment])

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

      {currentSegment ? (
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white">{currentSegment.encounterName}</span>
          {currentSegment.endTime === null ? (
            <>
              <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded">
                In Progress
              </span>
              <span className="text-sm text-slate-400 tabular-nums">{formatTime(elapsed)}</span>
            </>
          ) : currentSegment.success ? (
            <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/40 px-2 py-0.5 rounded">
              Kill
            </span>
          ) : (
            <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded">
              Wipe
            </span>
          )}
        </div>
      ) : (
        <span className="text-sm text-slate-500">Waiting for encounter...</span>
      )}

      <div className="w-24" />
    </div>
  )
}
