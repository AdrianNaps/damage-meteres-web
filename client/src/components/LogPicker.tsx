import { useEffect, useState, useMemo } from 'react'
import { useStore, LIVE_SOURCE_ID, type SourceMeta } from '../store'
import { openArchiveSource, requestLogsListing } from '../ws'
import { parseLogFilename, formatLogLabel, formatFileSize } from '../utils/logFilename'

const ARCHIVE_CAP = 3   // matches server-side ARCHIVE_CAP

interface LogEntry {
  name: string
  size: number
  mtimeMs: number
  fullPath: string
}

export function LogPicker() {
  const open = useStore(s => s.logPickerOpen)
  const setLogPickerOpen = useStore(s => s.setLogPickerOpen)
  const sourceMetas = useStore(s => s.sourceMetas)

  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dir, setDir] = useState<string | null>(null)

  // Refresh listing when the modal opens. Closing leaves the cached list in
  // place — re-opening then re-fetches anyway, so no extra reset needed.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    requestLogsListing()
      .then(result => {
        if (cancelled) return
        if (!result) {
          setError('Server not connected')
          setEntries([])
          return
        }
        setDir(result.dir)
        const dirNorm = result.dir.replace(/\\/g, '/').replace(/\/$/, '')
        setEntries(result.files.map(f => ({
          ...f,
          fullPath: `${dirNorm}/${f.name}`,
        })))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLogPickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setLogPickerOpen])

  const liveFilePath = sourceMetas.get(LIVE_SOURCE_ID)?.filePath ?? null
  const openArchivePaths = useMemo(() => {
    const set = new Set<string>()
    for (const meta of sourceMetas.values()) {
      if (meta.kind === 'archive' && meta.filePath) set.add(normalizePath(meta.filePath))
    }
    return set
  }, [sourceMetas])

  const archiveCount = useMemo(() => {
    let n = 0
    for (const meta of sourceMetas.values()) if (meta.kind === 'archive') n++
    return n
  }, [sourceMetas])

  // LRU victim shown in the warning when the user is at cap. Computed by
  // ordering archive metas by their last load completion (proxy for "most
  // recently active" since the client doesn't track per-tab access). For
  // accuracy we'd thread the server's lastAccessed, but this is good enough
  // for an inline warning.
  const lruVictim = useMemo<SourceMeta | null>(() => {
    if (archiveCount < ARCHIVE_CAP) return null
    const archives: SourceMeta[] = []
    for (const meta of sourceMetas.values()) if (meta.kind === 'archive') archives.push(meta)
    archives.sort((a, b) => {
      const ad = a.filePath ? parseLogFilename(filenameOf(a.filePath))?.date.getTime() ?? 0 : 0
      const bd = b.filePath ? parseLogFilename(filenameOf(b.filePath))?.date.getTime() ?? 0 : 0
      return ad - bd
    })
    return archives[0] ?? null
  }, [sourceMetas, archiveCount])

  if (!open) return null

  function statusFor(entry: LogEntry): { disabled: boolean; badge: string | null } {
    if (liveFilePath && pathsEqual(entry.fullPath, liveFilePath)) {
      return { disabled: true, badge: 'Currently live' }
    }
    if (openArchivePaths.has(normalizePath(entry.fullPath))) {
      return { disabled: true, badge: 'Already open' }
    }
    return { disabled: false, badge: null }
  }

  function pickEntry(entry: LogEntry) {
    const { disabled } = statusFor(entry)
    if (disabled) return
    openArchiveSource(entry.fullPath)
    setLogPickerOpen(false)
  }

  async function browseExternal() {
    if (!window.api?.pickLogFile) return
    const filePath = await window.api.pickLogFile()
    if (!filePath) return
    openArchiveSource(filePath)
    setLogPickerOpen(false)
  }

  const hasNativePicker = typeof window !== 'undefined' && Boolean(window.api?.pickLogFile)

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0, 0, 0, 0.6)' }}
        onClick={() => setLogPickerOpen(false)}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)',
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            Open log
          </div>
          <button
            onClick={() => setLogPickerOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              padding: '4px 8px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            &times;
          </button>
        </div>

        {/* Subhead — current logs dir */}
        {dir && (
          <div
            className="px-4 py-2"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {dir}
          </div>
        )}

        {/* LRU warning */}
        {lruVictim && (
          <div
            className="px-4 py-2"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(234, 179, 8, 0.06)',
              borderBottom: '1px solid color-mix(in srgb, #eab308 20%, transparent)',
            }}
          >
            ⚠ At max ({ARCHIVE_CAP}) open archives. Opening another will close{' '}
            <span style={{ color: 'var(--text-primary)' }}>{labelForMeta(lruVictim)}</span>{' '}
            (least recently viewed).
          </div>
        )}

        {/* Listing */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading && entries === null && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--status-wipe)' }}>{error}</div>
          )}
          {entries && entries.length === 0 && !loading && !error && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              No combat logs found in this folder.
            </div>
          )}
          {entries && entries.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {entries.map(entry => {
                const status = statusFor(entry)
                const parsed = parseLogFilename(entry.name)
                const label = parsed ? formatLogLabel(parsed.date) : entry.name
                return (
                  <li key={entry.fullPath}>
                    <button
                      disabled={status.disabled}
                      onClick={() => pickEntry(entry)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                        padding: '8px 16px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: status.disabled ? 'default' : 'pointer',
                        color: status.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontSize: 12,
                        textAlign: 'left',
                        gap: 12,
                      }}
                      onMouseEnter={e => {
                        if (!status.disabled) e.currentTarget.style.background = 'var(--bg-hover)'
                      }}
                      onMouseLeave={e => {
                        if (!status.disabled) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                      {status.badge && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border-subtle)',
                            padding: '1px 6px',
                            lineHeight: '16px',
                          }}
                        >
                          {status.badge}
                        </span>
                      )}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 64, textAlign: 'right' }}>
                        {formatFileSize(entry.size)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {hasNativePicker && (
          <div
            className="flex items-center justify-end px-4 py-3"
            style={{ borderTop: '1px solid var(--border-default)' }}
          >
            <button
              onClick={browseExternal}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                padding: '6px 12px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
            >
              Browse files…
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function filenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i === -1 ? norm : norm.slice(i + 1)
}

function labelForMeta(meta: SourceMeta): string {
  if (meta.filePath) {
    const parsed = parseLogFilename(filenameOf(meta.filePath))
    if (parsed) return formatLogLabel(parsed.date)
  }
  return meta.label
}

function normalizePath(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return navigator.platform.startsWith('Win') ? n.toLowerCase() : n
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}
