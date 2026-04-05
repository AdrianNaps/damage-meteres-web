import { useEffect } from 'react'
import { connectWs } from './ws'
import { EncounterHeader } from './components/EncounterHeader'
import { SegmentTabs } from './components/SegmentTabs'
import { MeterView } from './components/MeterView'
import { BreakdownPanel } from './components/BreakdownPanel'
import { DeathRecapPanel } from './components/DeathRecapPanel'

export default function App() {
  useEffect(() => { connectWs() }, [])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-root)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0">
        <EncounterHeader />
        <SegmentTabs />
        <MeterView />
      </div>
      <BreakdownPanel />
      <DeathRecapPanel />
    </div>
  )
}
