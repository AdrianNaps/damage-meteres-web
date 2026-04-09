import { useStore } from '../store'
import { send } from '../ws'
import type { KeyRunSummary, BossSectionSummary } from '../types'
import { raidDifficultyLabel } from '../utils/format'

export function SegmentTabs() {
  const history = useStore(s => s.segmentHistory)
  const selectedId = useStore(s => s.selectedSegmentId)
  const selectedKeyRunId = useStore(s => s.selectedKeyRunId)
  const selectedBossSectionId = useStore(s => s.selectedBossSectionId)
  const setSelectedSegmentId = useStore(s => s.setSelectedSegmentId)
  const setSelectedKeyRunId = useStore(s => s.setSelectedKeyRunId)
  const setSelectedBossSectionId = useStore(s => s.setSelectedBossSectionId)

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

  function selectBossSection(bossSectionId: string) {
    setSelectedBossSectionId(bossSectionId)
    send({ type: 'get_boss_section', bossSectionId })
  }

  const reversedHistory = [...history].reverse()

  const activeKeyRun = reversedHistory.find(
    item =>
      item.type === 'key_run' &&
      (item.keyRunId === selectedKeyRunId || item.segments.some(s => s.id === selectedId))
  ) as KeyRunSummary | undefined

  const activeBossSection = !activeKeyRun ? (reversedHistory.find(
    item =>
      item.type === 'boss_section' &&
      (item.bossSectionId === selectedBossSectionId || item.segments.some(s => s.id === selectedId))
  ) as BossSectionSummary | undefined) : undefined

  const activeSegments = activeKeyRun?.segments ?? activeBossSection?.segments ?? []

  return (
    <div className="flex flex-col" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Top tier — runs and standalone encounters */}
      <div className="flex gap-0 px-4 pt-2 overflow-x-auto items-end">
        {reversedHistory.map(item => {
          if (item.type === 'key_run') {
            return (
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
            )
          }
          if (item.type === 'boss_section') {
            const kills = item.segments.filter(s => s.success === true).length
            const diff = raidDifficultyLabel(item.difficultyID)
            return (
              <TabButton
                key={item.bossSectionId}
                active={activeBossSection?.bossSectionId === item.bossSectionId}
                accentColor="#8b5cf6"
                onClick={() => selectBossSection(item.bossSectionId)}
              >
                <span style={{ fontWeight: 500 }}>{item.encounterName}</span>
                {diff && (
                  <span style={{ opacity: 0.5, marginLeft: 4 }}>{diff}</span>
                )}
                <span style={{ opacity: 0.5, marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
                  {kills}/{item.segments.length}
                </span>
              </TabButton>
            )
          }
          return (
            <TabButton
              key={item.id}
              active={selectedId === item.id && !activeKeyRun && !activeBossSection}
              accentColor="var(--text-primary)"
              onClick={() => selectSegment(item.id)}
            >
              {item.encounterName}
              {item.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {item.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
            </TabButton>
          )
        })}
      </div>

      {/* Bottom tier — segments within the active container */}
      {activeSegments.length > 0 && (
        <div
          className="flex gap-0 px-4 pt-0.5 pb-0.5 overflow-x-auto items-end"
          style={{ paddingLeft: 28 }}
        >
          <TabButton
            active={
              selectedId === null &&
              ((!!activeKeyRun && selectedKeyRunId === activeKeyRun.keyRunId) ||
                (!!activeBossSection && selectedBossSectionId === activeBossSection.bossSectionId))
            }
            accentColor="var(--text-secondary)"
            small
            onClick={() => {
              if (activeKeyRun) selectKeyRun(activeKeyRun.keyRunId)
              else if (activeBossSection) selectBossSection(activeBossSection.bossSectionId)
            }}
          >
            Overall
          </TabButton>
          {activeSegments.map((seg, i) => ({ seg, pullNum: i + 1 })).reverse().map(({ seg, pullNum }) => (
            <TabButton
              key={seg.id}
              active={selectedId === seg.id}
              accentColor="var(--text-secondary)"
              small
              onClick={() => selectSegment(seg.id)}
            >
              {activeBossSection ? `Pull ${pullNum}` : shortSegmentName(seg.encounterName)}
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
