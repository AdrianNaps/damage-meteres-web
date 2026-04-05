import { useEffect, useState } from 'react'
import { useStore, selectCurrentView } from '../store'
import { DamageSpellTable, HealSpellTable } from './SpellTable'
import { TargetTable } from './TargetTable'
import { TargetDrillDown } from './TargetDrillDown'
import { requestTargetDetail } from '../ws'
import { formatNum } from '../utils/format'

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.metric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const targetDetail = useStore(s => s.targetDetail)
  const setTargetDetail = useStore(s => s.setTargetDetail)

  const isKeyRun = currentView?.type === 'key_run'
  // Target drill-down requires a segment ID and isn't available in key run aggregate view
  const canDrillTargets = !isKeyRun

  // Clear drill state when the panel closes or a different player is selected
  useEffect(() => {
    setDrillTarget(null)
    setTargetDetail(null)
  }, [selectedPlayer, setTargetDetail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillTarget) {
          setDrillTarget(null)
          setTargetDetail(null)
        } else {
          setSelectedPlayer(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drillTarget, setSelectedPlayer, setTargetDetail])

  if (!selectedPlayer || !currentView) return null

  const player = currentView.players[selectedPlayer]
  if (!player) return null

  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total
  const duration = isKeyRun ? currentView.activeDurationSec : currentView.duration

  // Clear drill state when switching away from targets tab
  function handleModeChange(mode: 'spells' | 'targets') {
    setViewMode(mode)
    if (mode !== 'targets') {
      setDrillTarget(null)
      setTargetDetail(null)
    }
  }

  function renderContent() {
    if (!currentView) return null
    if (metric === 'healing') {
      return <HealSpellTable spells={player.healing.spells} />
    }
    if (canDrillTargets && drillTarget && targetDetail?.targetName === drillTarget) {
      return (
        <TargetDrillDown
          detail={targetDetail}
          onBack={() => { setDrillTarget(null); setTargetDetail(null) }}
        />
      )
    }
    if (canDrillTargets && viewMode === 'targets') {
      // canDrillTargets === true implies currentView.type === 'segment'
      const segmentId = (currentView as { id: string }).id
      return (
        <TargetTable
          targets={player.damage.targets}
          totalDamage={player.damage.total}
          duration={duration}
          onSelect={(name) => {
            setDrillTarget(name)
            requestTargetDetail(segmentId, name)
          }}
        />
      )
    }
    return <DamageSpellTable spells={player.damage.spells} />
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setSelectedPlayer(null)}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#1a1c24] border-l border-white/10 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <div className="font-semibold text-white">{player.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {formatNum(total)} total · {formatNum(value)} {metric === 'damage' ? 'DPS' : 'HPS'}
            </div>
          </div>
          <button
            onClick={() => setSelectedPlayer(null)}
            className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {metric === 'damage' && canDrillTargets && (
          <div className="flex gap-1 px-4 pt-2">
            {(['spells', 'targets'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`text-xs px-3 py-1 rounded capitalize transition-colors ${
                  viewMode === mode
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {renderContent()}
        </div>
      </div>
    </>
  )
}
