import { useStore, selectCurrentView } from '../store'
import type { KeyRunSnapshot, SegmentSnapshot } from '../types'

export function EncounterHeader() {
  const currentView = useStore(selectCurrentView)
  const wsStatus = useStore(s => s.wsStatus)

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
          <KeyRunHeader view={currentView} />
        ) : currentView?.type === 'segment' ? (
          <SegmentHeader view={currentView} />
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Waiting for combat data...
          </span>
        )}
      </div>

    </div>
  )
}

function SegmentHeader({ view }: { view: SegmentSnapshot }) {
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

function KeyRunHeader({ view }: { view: KeyRunSnapshot }) {
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
