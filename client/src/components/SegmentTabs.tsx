import { useMemo } from 'react'
import { useStore, LIVE_SOURCE_ID } from '../store'
import { send } from '../ws'
import type { HistoryItem, KeyRunSummary, BossSectionSummary } from '../types'
import { raidDifficultyLabel } from '../utils/format'

interface TaggedItem {
  item: HistoryItem
  sourceId: string
}

export function SegmentTabs() {
  const sources = useStore(s => s.sources)
  const activeSourceId = useStore(s => s.activeSourceId)
  const selectedId = useStore(s => s.selectedSegmentId)
  const selectedKeyRunId = useStore(s => s.selectedKeyRunId)
  const selectedBossSectionId = useStore(s => s.selectedBossSectionId)
  const setActiveSource = useStore(s => s.setActiveSource)
  const setSelectedSegmentId = useStore(s => s.setSelectedSegmentId)
  const setSelectedKeyRunId = useStore(s => s.setSelectedKeyRunId)
  const setSelectedBossSectionId = useStore(s => s.setSelectedBossSectionId)
  const setLogPickerOpen = useStore(s => s.setLogPickerOpen)

  // Aggregate instances from every source into one time-ordered set.
  // Opening a log "unpacks" its instances here; the user never thinks about
  // sources — just instances sorted by when they happened.
  const allItems = useMemo(() => {
    const items: TaggedItem[] = []
    for (const [sourceId, slice] of sources.entries()) {
      for (const item of slice.segmentHistory) {
        items.push({ item, sourceId })
      }
    }
    items.sort((a, b) => b.item.startTime - a.item.startTime)
    return items
  }, [sources])

  if (allItems.length === 0) {
    return (
      <div className="flex items-center gap-0 px-5 pt-2 pb-1">
        <OpenLogButton labeled onClick={() => setLogPickerOpen(true)} />
      </div>
    )
  }

  function selectSegment(sourceId: string, id: string | null) {
    if (sourceId !== activeSourceId) setActiveSource(sourceId)
    if (id === null) {
      setSelectedSegmentId(null)
      return
    }
    setSelectedSegmentId(id)
    if (useStore.getState().selectedSegment?.id !== id) {
      send({ type: 'get_segment', sourceId, segmentId: id })
    }
  }

  function selectKeyRun(sourceId: string, keyRunId: string) {
    if (sourceId !== activeSourceId) setActiveSource(sourceId)
    setSelectedKeyRunId(keyRunId)
    if (useStore.getState().selectedKeyRun?.keyRunId !== keyRunId) {
      send({ type: 'get_key_run', sourceId, keyRunId })
    }
  }

  function selectBossSection(sourceId: string, bossSectionId: string) {
    if (sourceId !== activeSourceId) setActiveSource(sourceId)
    setSelectedBossSectionId(bossSectionId)
    if (useStore.getState().selectedBossSection?.bossSectionId !== bossSectionId) {
      send({ type: 'get_boss_section', sourceId, bossSectionId })
    }
  }

  // Detect active container for the bottom sub-tier. Uses the active source's
  // selection state + the full aggregated list to find the right item.
  const activeKeyRun = allItems.find(
    ({ item, sourceId }) =>
      item.type === 'key_run' && sourceId === activeSourceId &&
      (item.keyRunId === selectedKeyRunId || item.segments.some(s => s.id === selectedId))
  )?.item as KeyRunSummary | undefined

  const activeBossSection = !activeKeyRun ? (allItems.find(
    ({ item, sourceId }) =>
      item.type === 'boss_section' && sourceId === activeSourceId &&
      (item.bossSectionId === selectedBossSectionId || item.segments.some(s => s.id === selectedId))
  )?.item as BossSectionSummary | undefined) : undefined

  const activeSegments = activeKeyRun?.segments ?? activeBossSection?.segments ?? []

  return (
    <div className="flex flex-col">
      {/* Top tier — instances from all sources, time-ordered */}
      <div className="px-5 pt-2">
        <div className="flex gap-0 overflow-x-auto items-end" style={{ overflowY: 'hidden' }}>
        {allItems.map(({ item, sourceId }) => {
          if (item.type === 'key_run') {
            const isLive = sourceId === LIVE_SOURCE_ID && item.endTime === null
            const isActive = activeSourceId === sourceId && activeKeyRun?.keyRunId === item.keyRunId
            return (
              <TabButton
                key={`${sourceId}:${item.keyRunId}`}
                active={isActive}
                accentColor="var(--accent-keyrun)"
                onClick={() => selectKeyRun(sourceId, item.keyRunId)}
              >
                {isLive && (
                  <span
                    className="animate-pulse-dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--status-kill)',
                      marginRight: 6,
                      flexShrink: 0,
                    }}
                  />
                )}
                {isLive && (
                  <span style={{ fontWeight: 500, marginRight: 4 }}>Live –</span>
                )}
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
            const isActive = activeSourceId === sourceId && activeBossSection?.bossSectionId === item.bossSectionId
            const kills = item.segments.filter(s => s.success === true).length
            const diff = raidDifficultyLabel(item.difficultyID)
            return (
              <TabButton
                key={`${sourceId}:${item.bossSectionId}`}
                active={isActive}
                accentColor="var(--accent-boss)"
                onClick={() => selectBossSection(sourceId, item.bossSectionId)}
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
          // Standalone segment
          const isActive = activeSourceId === sourceId && selectedId === item.id && !activeKeyRun && !activeBossSection
          return (
            <TabButton
              key={`${sourceId}:${item.id}`}
              active={isActive}
              accentColor="var(--text-primary)"
              onClick={() => selectSegment(sourceId, item.id)}
            >
              {item.encounterName}
              {item.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {item.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
            </TabButton>
          )
        })}
        <OpenLogButton labeled={false} onClick={() => setLogPickerOpen(true)} />
        </div>
      </div>

      {/* Bottom tier — segments within the active container */}
      {activeSegments.length > 0 && (
        <div className="px-5 pt-0.5 pb-0.5" style={{ paddingLeft: 28 }}>
          <div className="flex gap-0 overflow-x-auto items-end" style={{ overflowY: 'hidden' }}>
          <TabButton
            active={
              selectedId === null &&
              ((!!activeKeyRun && selectedKeyRunId === activeKeyRun.keyRunId) ||
                (!!activeBossSection && selectedBossSectionId === activeBossSection.bossSectionId))
            }
            accentColor="var(--text-secondary)"
            small
            onClick={() => {
              if (activeKeyRun) selectKeyRun(activeSourceId, activeKeyRun.keyRunId)
              else if (activeBossSection) selectBossSection(activeSourceId, activeBossSection.bossSectionId)
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
              onClick={() => selectSegment(activeSourceId, seg.id)}
            >
              {activeBossSection ? `Pull ${pullNum}` : shortSegmentName(seg.encounterName)}
              {seg.success === true && <span style={{ color: 'var(--status-kill)', marginLeft: 4 }}>&#10003;</span>}
              {seg.success === false && <span style={{ color: 'var(--status-wipe)', marginLeft: 4 }}>&#10007;</span>}
            </TabButton>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OpenLogButton({ labeled, onClick }: { labeled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Open a log file"
      aria-label="Open log file"
      style={{
        marginLeft: 6,
        padding: labeled ? '6px 10px' : '6px 9px',
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
      {labeled ? '+ Open log…' : '+'}
    </button>
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
