import { useStore, selectCurrentView } from '../store'
import type { KeyRunSnapshot, BossSectionSnapshot, SegmentSnapshot } from '../types'

export function EncounterHeader() {
  const currentView = useStore(selectCurrentView)
  const wsStatus = useStore(s => s.wsStatus)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const hasApi = typeof window !== 'undefined' && Boolean(window.api)

  const disconnected = wsStatus === 'disconnected'

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{
        borderBottom: '1px solid var(--border-default)',
        background: disconnected ? 'rgba(239, 68, 68, 0.06)' : 'transparent',
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
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
        ) : currentView?.type === 'boss_section' ? (
          <BossSectionHeader view={currentView} />
        ) : currentView?.type === 'segment' ? (
          <SegmentHeader view={currentView} />
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Waiting for combat data...
          </span>
        )}
      </div>

      {hasApi && (
        <button
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <GearIcon />
        </button>
      )}
    </div>
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function SegmentHeader({ view }: { view: SegmentSnapshot }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        {view.encounterName}
      </span>
      {view.endTime !== null && (
        view.success ? (
          <StatusBadge label="KILL" color="var(--status-kill)" />
        ) : (
          <StatusBadge label="WIPE" color="var(--status-wipe)" />
        )
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

function BossSectionHeader({ view }: { view: BossSectionSnapshot }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        {view.encounterName}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {view.kills}/{view.pullCount} {view.pullCount === 1 ? 'pull' : 'pulls'}
      </span>
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
