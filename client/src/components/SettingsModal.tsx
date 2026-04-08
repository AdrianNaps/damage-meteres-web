import { useEffect } from 'react'
import { useStore } from '../store'

export function SettingsModal() {
  const open = useStore(s => s.settingsOpen)
  const bootInfo = useStore(s => s.bootInfo)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const refreshBootInfo = useStore(s => s.refreshBootInfo)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setSettingsOpen])

  if (!open) return null

  const logsDir = bootInfo?.logsDir ?? '(unknown)'

  async function handleChange() {
    if (!window.api?.pickLogsDir) return
    const dir = await window.api.pickLogsDir()
    if (!dir) return
    // Refresh boot info so the banner clears and the displayed path updates
    await refreshBootInfo()
    setSettingsOpen(false)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0, 0, 0, 0.6)' }}
        onClick={() => setSettingsOpen(false)}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)',
          width: 'min(520px, calc(100vw - 32px))',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            Settings
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
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

        <div className="px-4 py-4 flex flex-col gap-2">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            WoW Logs folder
          </div>
          <div className="flex items-center gap-2">
            <span
              title={logsDir}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-primary)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                padding: '6px 8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {logsDir}
            </span>
            <button
              onClick={handleChange}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                padding: '6px 12px',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
            >
              Change…
            </button>
          </div>
          {bootInfo && !bootInfo.logsDirExists && (
            <div style={{ fontSize: 11, color: 'var(--status-wipe)', marginTop: 4 }}>
              This folder does not exist on disk.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
