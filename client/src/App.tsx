import { useEffect } from 'react'
import { connectWs } from './ws'
import { useStore } from './store'
import { EncounterHeader } from './components/EncounterHeader'
import { SegmentTabs } from './components/SegmentTabs'
import { MeterView } from './components/MeterView'
import { BreakdownPanel } from './components/BreakdownPanel'
import { DeathRecapPanel } from './components/DeathRecapPanel'
import { SettingsModal } from './components/SettingsModal'
import { LogsBanner } from './components/LogsBanner'

export default function App() {
  const refreshBootInfo = useStore(s => s.refreshBootInfo)

  useEffect(() => {
    connectWs()
    refreshBootInfo()
  }, [refreshBootInfo])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-root)', color: 'var(--text-primary)' }}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <LogsBanner />
        <EncounterHeader />
        <SegmentTabs />
        <MeterView />
      </div>
      <BreakdownPanel />
      <DeathRecapPanel />
      <SettingsModal />
    </div>
  )
}
