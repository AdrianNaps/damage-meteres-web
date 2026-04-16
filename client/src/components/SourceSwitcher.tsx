import { useMemo } from 'react'
import { useStore, LIVE_SOURCE_ID, type SourceMeta } from '../store'
import { parseLogFilename, formatLogLabel } from '../utils/logFilename'

export function SourceSwitcher() {
  const sourceMetas = useStore(s => s.sourceMetas)
  const activeSourceId = useStore(s => s.activeSourceId)
  const setActiveSource = useStore(s => s.setActiveSource)
  const setLogPickerOpen = useStore(s => s.setLogPickerOpen)

  // Sort archives newest-first by parsed filename date; live always pinned
  // leftmost regardless of how its filename sorts.
  const { liveMeta, archives } = useMemo(() => {
    let liveMeta: SourceMeta | undefined
    const archives: SourceMeta[] = []
    for (const meta of sourceMetas.values()) {
      if (meta.kind === 'live') liveMeta = meta
      else archives.push(meta)
    }
    archives.sort((a, b) => {
      const aDate = a.filePath ? parseLogFilename(filenameOf(a.filePath))?.date.getTime() ?? 0 : 0
      const bDate = b.filePath ? parseLogFilename(filenameOf(b.filePath))?.date.getTime() ?? 0 : 0
      return bDate - aDate
    })
    return { liveMeta, archives }
  }, [sourceMetas])

  // Don't render until we have at least one source meta — avoids a flash of
  // the empty switcher between mount and the first WS `sources` frame.
  if (!liveMeta && archives.length === 0) return null

  const showLabeledOpenButton = archives.length === 0

  return (
    <div
      className="flex items-end gap-0 px-5 pt-1.5"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-root)',
      }}
    >
      {liveMeta && (
        <SourceTab
          active={activeSourceId === LIVE_SOURCE_ID}
          onClick={() => setActiveSource(LIVE_SOURCE_ID)}
        >
          <ListenerIcon active={!!liveMeta.liveStatus?.writingNow} />
          <span style={{ fontStyle: 'italic', fontWeight: 500 }}>
            {liveMeta.filePath ? 'Live' : 'Live (no log yet)'}
          </span>
          {liveMeta.filePath && (
            <span style={{ opacity: 0.5, marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {filenameOf(liveMeta.filePath)}
            </span>
          )}
        </SourceTab>
      )}

      {archives.map(meta => (
        <SourceTab
          key={meta.sourceId}
          active={activeSourceId === meta.sourceId}
          onClick={() => setActiveSource(meta.sourceId)}
        >
          <span>{labelForArchive(meta)}</span>
          {meta.loadProgress && !meta.loaded && (
            <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 11 }}>
              {Math.floor((meta.loadProgress.bytesRead / meta.loadProgress.totalBytes) * 100)}%
            </span>
          )}
        </SourceTab>
      ))}

      <button
        onClick={() => setLogPickerOpen(true)}
        title="Open a log file"
        aria-label="Open log file"
        style={{
          marginLeft: 6,
          padding: showLabeledOpenButton ? '6px 10px' : '6px 9px',
          fontSize: 12,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          marginBottom: -1,
          borderBottom: '2px solid transparent',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        {showLabeledOpenButton ? '+ Open log…' : '+'}
      </button>
    </div>
  )
}

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 transition-colors"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 12px',
        fontSize: 12,
        whiteSpace: 'nowrap',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: active ? '2px solid var(--text-primary)' : '2px solid transparent',
        marginBottom: -1,
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

// Antenna/wifi-style listener-health glyph. Animates when the live watcher is
// receiving bytes; dim otherwise. Distinct from the WS-connection dot in
// EncounterHeader (which represents the renderer↔backend WebSocket, not
// the watcher↔logfile pipeline).
function ListenerIcon({ active }: { active: boolean }) {
  return (
    <span
      className={active ? 'animate-pulse-dot' : ''}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginRight: 6,
        opacity: active ? 1 : 0.4,
        color: active ? 'var(--status-kill)' : 'var(--text-muted)',
      }}
      title={active ? 'Listening — bytes flowing' : 'Listening — quiet'}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M8.5 16.5a6 6 0 0 1 7 0" />
        <line x1="12" y1="20" x2="12" y2="20" />
      </svg>
    </span>
  )
}

function filenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i === -1 ? norm : norm.slice(i + 1)
}

function labelForArchive(meta: SourceMeta): string {
  if (meta.filePath) {
    const parsed = parseLogFilename(filenameOf(meta.filePath))
    if (parsed) return formatLogLabel(parsed.date)
  }
  return meta.label
}
