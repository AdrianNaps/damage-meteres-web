import { useEffect } from 'react'
import { connectWs } from './ws'
import { useStore, selectCurrentView, selectCurrentScopeKey } from './store'
import { EncounterHeader } from './components/EncounterHeader'
import { SegmentTabs } from './components/SegmentTabs'
import { MeterView } from './components/MeterView'
import { SummaryView } from './components/SummaryView'
import { GraphContainer } from './components/GraphContainer'
import { BreakdownPanel } from './components/BreakdownPanel'
import { DeathRecapPanel } from './components/DeathRecapPanel'
import { SettingsModal } from './components/SettingsModal'
import { LogsBanner } from './components/LogsBanner'

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
    </div>
  )
}

function ContentPanel() {
  const mode = useStore(s => s.mode)
  const metric = useStore(s => s.metric)
  const setMetric = useStore(s => s.setMetric)
  const setMode = useStore(s => s.setMode)
  const currentView = useStore(selectCurrentView)
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const selectedDeath = useStore(s => s.selectedDeath)

  const hasDrill = !!(selectedPlayer || selectedDeath)

  const players = currentView?.players ?? {}
  const duration =
    currentView && 'duration' in currentView ? (currentView as { duration: number }).duration
    : currentView && 'activeDurationSec' in currentView ? (currentView as { activeDurationSec: number }).activeDurationSec
    : 0

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
      {/* Toggle bar: MetricToggle + ModeToggle */}
      <ToggleBar metric={metric} setMetric={setMetric} mode={mode} setMode={setMode} />

      {/* Graph */}
      {currentView && Object.keys(players).length > 0 && (
        <GraphContainer metric={metric} players={players} duration={duration} />
      )}

      {/* Main content area: modules/rows + inline drill panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {mode === 'summary' ? <SummaryView /> : <MeterView />}
        </div>

        {/* Right: inline drill panel */}
        <div style={{
          width: hasDrill ? 420 : 0,
          minWidth: hasDrill ? 420 : 0,
          background: 'var(--bg-root)',
          borderLeft: hasDrill ? '1px solid var(--border-default)' : 'none',
          overflow: 'hidden',
          transition: 'width 0.25s ease, min-width 0.25s ease',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {selectedPlayer && <BreakdownPanel />}
          {selectedDeath && <DeathRecapPanel />}
        </div>
      </div>
    </div>
  )
}

function ToggleBar({
  metric,
  setMetric,
  mode,
  setMode,
}: {
  metric: 'damage' | 'healing' | 'deaths' | 'interrupts'
  setMetric: (m: 'damage' | 'healing' | 'deaths' | 'interrupts') => void
  mode: 'summary' | 'full'
  setMode: (m: 'summary' | 'full') => void
}) {
  const metricOptions: { key: typeof metric; label: string }[] = [
    { key: 'damage', label: 'Damage' },
    { key: 'healing', label: 'Healing' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'interrupts', label: 'Interrupts' },
  ]

  const modeOptions: { key: typeof mode; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'full', label: 'Full' },
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 16px',
      flexShrink: 0,
    }}>
      {/* Metric toggle */}
      <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
        {metricOptions.map(opt => (
          <ToggleButton
            key={opt.key}
            label={opt.label}
            active={metric === opt.key}
            onClick={() => setMetric(opt.key)}
          />
        ))}
      </div>

      {/* Mode toggle — hidden until Full view is built */}
      {false && <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
        {modeOptions.map(opt => (
          <ToggleButton
            key={opt.key}
            label={opt.label}
            active={mode === opt.key}
            onClick={() => setMode(opt.key)}
          />
        ))}
      </div>}
    </div>
  )
}

function ToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 14px',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        border: 'none',
        borderRight: '1px solid var(--border-default)',
        background: active ? 'var(--bg-active)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hover)'
          e.currentTarget.style.color = 'var(--text-primary)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
    >
      {label}
    </button>
  )
}
