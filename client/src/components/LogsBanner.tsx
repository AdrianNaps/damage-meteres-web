import { useStore } from '../store'

export function LogsBanner() {
  const bootInfo = useStore(s => s.bootInfo)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)

  if (!bootInfo || bootInfo.logsDirExists) return null

  return (
    <div
      className="flex items-center gap-2 px-4 py-2"
      style={{
        background: 'rgba(239, 68, 68, 0.08)',
        borderBottom: '1px solid color-mix(in srgb, var(--status-wipe) 25%, transparent)',
        fontSize: 12,
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ color: 'var(--status-wipe)' }}>⚠</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        Logs folder not found at{' '}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
          }}
        >
          {bootInfo.logsDir}
        </span>
        .{' '}
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--status-live)',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            textDecoration: 'underline',
          }}
        >
          Open settings
        </button>{' '}
        to set the correct path.
      </span>
    </div>
  )
}
