import { useStore } from '../store'
import { send } from '../ws'
import type { KeyRunSummary } from '../types'

export function SegmentTabs() {
  const history = useStore(s => s.segmentHistory)
  const selectedId = useStore(s => s.selectedSegmentId)
  const selectedKeyRunId = useStore(s => s.selectedKeyRunId)
  const liveSegment = useStore(s => s.liveSegment)
  const setSelectedSegmentId = useStore(s => s.setSelectedSegmentId)
  const setSelectedKeyRunId = useStore(s => s.setSelectedKeyRunId)

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

  const isLive = selectedId === null && selectedKeyRunId === null
  const reversedHistory = [...history].reverse()

  const activeKeyRun = reversedHistory.find(
    item =>
      item.type === 'key_run' &&
      (item.keyRunId === selectedKeyRunId || item.segments.some(s => s.id === selectedId))
  ) as KeyRunSummary | undefined

  const activeSegments = activeKeyRun?.segments ?? []

  return (
    <div className="flex flex-col" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Top tier — runs and standalone encounters */}
      <div className="flex gap-0 px-4 pt-2 overflow-x-auto items-end">
        {liveSegment && (
          <TabButton
            active={isLive}
            accentColor="var(--status-live)"
            onClick={() => selectSegment(null)}
          >
            Live
          </TabButton>
        )}
        {reversedHistory.map(item =>
          item.type === 'key_run' ? (
            <TabButton
              key={item.keyRunId}
              active={activeKeyRun?.keyRunId === item.keyRunId}
              accentColor="#d97706"
              onClick={() => selectKeyRun(item.keyRunId)}
            >
              <span style={{ fontWeight: 500 }}>{item.dungeonName}</span>
              <span style={{ opacity: 0.5, marginLeft: 4 }}>+{item.keystoneLevel}</span>
              {item.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {item.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
              {item.durationMs !== null && (
                <span style={{ opacity: 0.4, marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
                  {formatKeyDuration(item.durationMs)}
                </span>
              )}
            </TabButton>
          ) : (
            <TabButton
              key={item.id}
              active={selectedId === item.id && !activeKeyRun}
              accentColor="var(--text-primary)"
              onClick={() => selectSegment(item.id)}
            >
              {item.encounterName}
              {item.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {item.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
            </TabButton>
          )
        )}
      </div>

      {/* Bottom tier — segments within the active key run */}
      {activeSegments.length > 0 && (
        <div
          className="flex gap-0 px-4 pt-0.5 pb-0.5 overflow-x-auto items-end"
          style={{ paddingLeft: 28 }}
        >
          {[...activeSegments].reverse().map(seg => (
            <TabButton
              key={seg.id}
              active={selectedId === seg.id}
              accentColor="var(--text-secondary)"
              small
              onClick={() => selectSegment(seg.id)}
            >
              {shortSegmentName(seg.encounterName)}
              {seg.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {seg.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
            </TabButton>
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  accentColor,
  small,
  onClick,
  children,
}: {
  active: boolean
  accentColor: string
  small?: boolean
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
        padding: small ? '4px 10px' : '6px 12px',
        fontSize: small ? 11 : 12,
        whiteSpace: 'nowrap',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: active ? `2px solid ${accentColor}` : '2px solid transparent',
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

function shortSegmentName(name: string): string {
  const idx = name.indexOf(' — ')
  return idx !== -1 ? name.slice(idx + 3) : name
}

function formatKeyDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
