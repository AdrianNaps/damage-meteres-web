import { useEffect } from 'react'
import { useStore } from '../store'
import { DamageSpellTable, HealSpellTable } from './SpellTable'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentSegment = useStore(s => s.currentSegment)
  const metric = useStore(s => s.metric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedPlayer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedPlayer])

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

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {metric === 'damage'
            ? <DamageSpellTable spells={player.damage.spells} />
            : <HealSpellTable spells={player.healing.spells} />
          }
        </div>
      </div>
    </>
  )
}
