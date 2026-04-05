import { useEffect, useState } from 'react'
import { useStore, selectCurrentSegment } from '../store'
import { DamageSpellTable, HealSpellTable } from './SpellTable'
import { TargetTable } from './TargetTable'
import { TargetDrillDown } from './TargetDrillDown'
import { requestTargetDetail } from '../ws'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentSegment = useStore(selectCurrentSegment)
  const metric = useStore(s => s.metric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const targetDetail = useStore(s => s.targetDetail)
  const setTargetDetail = useStore(s => s.setTargetDetail)

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

  if (!selectedPlayer || !currentSegment) return null

  const player = currentSegment.players[selectedPlayer]
  if (!player) return null

  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total

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

        {metric === 'damage' && (
          <div className="flex gap-1 px-4 pt-2">
            {(['spells', 'targets'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
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
          {metric === 'damage' && drillTarget && targetDetail?.targetName === drillTarget
            ? <TargetDrillDown
                detail={targetDetail}
                onBack={() => { setDrillTarget(null); setTargetDetail(null) }}
              />
            : metric === 'damage' && viewMode === 'targets'
              ? <TargetTable
                  targets={player.damage.targets}
                  totalDamage={player.damage.total}
                  duration={currentSegment.duration}
                  onSelect={(name) => {
                    setDrillTarget(name)
                    requestTargetDetail(currentSegment.id, name)
                  }}
                />
              : metric === 'damage'
                ? <DamageSpellTable spells={player.damage.spells} />
                : <HealSpellTable spells={player.healing.spells} />
          }
        </div>
      </div>
    </>
  )
}
