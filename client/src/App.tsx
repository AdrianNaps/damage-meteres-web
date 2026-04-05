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
    <div className="min-h-screen flex flex-col bg-[#0f1015] text-slate-200">
      <EncounterHeader />
      <SegmentTabs />
      <MeterView />
      <BreakdownPanel />
      <DeathRecapPanel />
    </div>
  )
}
