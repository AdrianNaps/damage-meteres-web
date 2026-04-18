import { useEffect, useMemo } from 'react'
import { connectWs } from './ws'
import { useStore, selectCurrentView, selectCurrentScopeKey, selectIsOverall, selectIsActiveScopeInProgress, type Metric, type Mode } from './store'
import { EncounterHeader } from './components/EncounterHeader'
import { SegmentTabs } from './components/SegmentTabs'
import { SummaryView } from './components/SummaryView'
import { FullMeterView } from './components/FullMeterView'
import { GraphContainer } from './components/GraphContainer'
import { BreakdownPanel } from './components/BreakdownPanel'
import { DeathRecapPanel } from './components/DeathRecapPanel'
import { SettingsModal } from './components/SettingsModal'
import { LogsBanner } from './components/LogsBanner'
import { FilterBar } from './components/FilterBar'
import { LogPicker } from './components/LogPicker'
import { computeEnemyPlayers } from './utils/filters'
import type { ClientEvent } from './types'

const EMPTY_EVENTS: ClientEvent[] = []

export default function App() {
  const refreshBootInfo = useStore(s => s.refreshBootInfo)
  const scopeKey = useStore(selectCurrentScopeKey)
  const syncGraphScope = useStore(s => s.syncGraphScope)

  useEffect(() => {
    connectWs()
    refreshBootInfo()
  }, [refreshBootInfo])

  // Reset graph focus when the parent dungeon/encounter changes. Lives on App
  // so the reset fires even while GraphContainer is unmounted between a tab
  // click and the server's snapshot response.
  useEffect(() => {
    syncGraphScope(scopeKey)
  }, [scopeKey, syncGraphScope])

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-root)', color: 'var(--text-primary)' }}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <LogsBanner />
        <EncounterHeader />
        <SegmentTabs />
        <ContentPanel />
      </div>
      <SettingsModal />
      <LogPicker />
    </div>
  )
}

function ContentPanel() {
  const mode = useStore(s => s.mode)
  const metric = useStore(s => s.metric)
  const setMetric = useStore(s => s.setMetric)
  const setMode = useStore(s => s.setMode)
  const currentView = useStore(selectCurrentView)
  const isOverall = useStore(selectIsOverall)
  const isInProgress = useStore(selectIsActiveScopeInProgress)
  const perspective = useStore(s => s.perspective)
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const selectedDeath = useStore(s => s.selectedDeath)

  // Death recap stays Summary-only — Full mode surfaces deaths as a top-level
  // table. Spell/target breakdown is shared across both modes with a wider
  // layout in Full.
  const hasBreakdown = !!selectedPlayer
  const hasDeath = mode === 'summary' && !!selectedDeath
  const hasDrill = hasBreakdown || hasDeath
  const drillWidth = hasDrill ? (mode === 'full' ? 720 : 420) : 0

  const players = currentView?.players ?? {}
  const duration =
    currentView && 'duration' in currentView ? currentView.duration
    : currentView && 'activeDurationSec' in currentView ? currentView.activeDurationSec
    : 0

  const events = currentView?.events ?? EMPTY_EVENTS

  // When Full mode + enemies perspective, derive enemy pseudo-snapshots from
  // events so the graph shows enemy output instead of ally data.
  const graphPlayers = useMemo(() => {
    if (mode === 'full' && perspective === 'enemies' && events.length > 0) {
      return computeEnemyPlayers(events, players, duration)
    }
    return players
  }, [mode, perspective, events, players, duration])

  return (
    <div style={{
      flex: 1,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '2px 2px 0 0',
      margin: '0 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* Toggle bar: CategoryTabs + ModeToggle */}
      <ToggleBar
        metric={metric}
        setMetric={setMetric}
        mode={mode}
        setMode={setMode}
        fullDisabled={isInProgress}
      />

      {/* Full-mode filter bar — Summary stays unfiltered for now. */}
      {mode === 'full' && <FilterBar />}

      {/* Graph appears in both modes. On the Overall aggregate tab, it shows
          an inactive placeholder (no per-segment timeline to plot). In Full
          mode with enemies perspective, graph series use enemy-derived data. */}
      {currentView && (isOverall || Object.keys(graphPlayers).length > 0) && (
        <GraphContainer metric={metric} players={graphPlayers} duration={duration} inactive={isOverall} />
      )}

      {/* Main content area: modules/rows + inline drill panel. Shared shell so
          the drill push-sidebar behaves identically in Summary and Full. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {mode === 'summary' ? <SummaryView /> : <FullMeterView />}
        </div>

        <div style={{
          width: drillWidth,
          minWidth: drillWidth,
          background: 'var(--bg-root)',
          borderLeft: hasDrill ? '1px solid var(--border-default)' : 'none',
          overflow: 'hidden',
          transition: 'width 0.25s ease, min-width 0.25s ease',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {hasBreakdown && <BreakdownPanel />}
          {hasDeath && <DeathRecapPanel />}
        </div>
      </div>
    </div>
  )
}

// Shared category list for Summary. Full mode will later extend this with
// additional groups (Damage Taken, Dispels, Buffs, Casts, Timeline, …).
const SUMMARY_CATEGORIES: { key: Metric; label: string }[] = [
  { key: 'damage', label: 'Damage Done' },
  { key: 'healing', label: 'Healing' },
  { key: 'interrupts', label: 'Interrupts' },
  { key: 'deaths', label: 'Deaths' },
]

function ToggleBar({
  metric,
  setMetric,
  mode,
  setMode,
  fullDisabled,
}: {
  metric: Metric
  setMetric: (m: Metric) => void
  mode: Mode
  setMode: (m: Mode) => void
  fullDisabled: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '8px 16px',
      minHeight: 46,
      flexShrink: 0,
    }}>
      <CategoryBar metric={metric} setMetric={setMetric} />
      <ModeToggle mode={mode} setMode={setMode} fullDisabled={fullDisabled} />
    </div>
  )
}

function CategoryBar({ metric, setMetric }: { metric: Metric; setMetric: (m: Metric) => void }) {
  // Both Summary and Full use the same underline-tab visual language. Full will
  // add more groups (separated by a small gap) as additional categories land.
  return (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflowX: 'auto' }}>
      {SUMMARY_CATEGORIES.map(opt => (
        <CategoryTab
          key={opt.key}
          label={opt.label}
          active={metric === opt.key}
          onClick={() => setMetric(opt.key)}
        />
      ))}
    </div>
  )
}

function CategoryTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 12px',
        fontSize: 12,
        fontFamily: 'inherit',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--text-primary)' : 'transparent'}`,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
    >
      {label}
    </button>
  )
}

function ModeToggle({
  mode,
  setMode,
  fullDisabled,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  fullDisabled: boolean
}) {
  const options: { key: Mode; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'full', label: 'Full' },
  ]
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-default)',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {options.map((opt, i) => {
        const active = mode === opt.key
        const disabled = opt.key === 'full' && fullDisabled
        return (
          <button
            key={opt.key}
            onClick={() => { if (!disabled) setMode(opt.key) }}
            disabled={disabled}
            title={disabled ? 'Full view is available once the segment has ended' : undefined}
            style={{
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'inherit',
              background: active ? 'var(--bg-active)' : 'transparent',
              color: disabled
                ? 'var(--text-muted)'
                : active ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderLeft: i === 0 ? 'none' : '1px solid var(--border-default)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              if (!active && !disabled) {
                e.currentTarget.style.background = 'var(--bg-hover)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }
            }}
            onMouseLeave={e => {
              if (!active && !disabled) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

