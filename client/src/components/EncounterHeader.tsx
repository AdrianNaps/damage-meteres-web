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

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const disconnected = wsStatus === 'disconnected'

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{
        borderBottom: '1px solid var(--border-default)',
        background: disconnected ? 'rgba(239, 68, 68, 0.06)' : 'transparent',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={wsStatus === 'connected' ? 'animate-pulse-dot' : ''}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background:
              wsStatus === 'connected' ? 'var(--status-kill)'
              : wsStatus === 'connecting' ? '#eab308'
              : 'var(--status-wipe)',
          }}
        />

        {currentView?.type === 'key_run' ? (
          <KeyRunHeader view={currentView} formatTime={formatTime} />
        ) : currentView?.type === 'segment' ? (
          <SegmentHeader view={currentView} elapsed={elapsed} formatTime={formatTime} />
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Waiting for combat data...
          </span>
        )}
      </div>

      {/* Duration / timer on the right */}
      {currentView?.type === 'segment' && currentView.endTime === null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
          {formatTime(elapsed)}
        </span>
      )}
      {currentView?.type === 'segment' && currentView.endTime !== null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>
          {formatTime(currentView.duration)}
        </span>
      )}
      {currentView?.type === 'key_run' && currentView.durationMs !== null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>
          {formatTime(Math.floor(currentView.durationMs / 1000))}
        </span>
      )}
    </div>
  )
}

function SegmentHeader({
  view,
  elapsed: _elapsed,
  formatTime: _formatTime,
}: {
  view: SegmentSnapshot
  elapsed: number
  formatTime: (s: number) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        {view.encounterName}
      </span>
      {view.endTime === null ? (
        <StatusBadge label="LIVE" color="var(--status-live)" />
      ) : view.success ? (
        <StatusBadge label="KILL" color="var(--status-kill)" />
      ) : (
        <StatusBadge label="WIPE" color="var(--status-wipe)" />
      )}
    </div>
  )
}

function KeyRunHeader({
  view,
  formatTime: _formatTime,
}: {
  view: KeyRunSnapshot
  formatTime: (s: number) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        {view.dungeonName}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>+{view.keystoneLevel}</span>
      {view.success === true ? (
        <StatusBadge label="TIMED" color="var(--status-kill)" />
      ) : view.success === false ? (
        <StatusBadge label="DEPLETED" color="var(--status-wipe)" />
      ) : null}
    </div>
  )
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
        color: color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        padding: '1px 6px',
        lineHeight: '18px',
      }}
    >
      {label}
    </span>
  )
}
