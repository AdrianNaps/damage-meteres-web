import type { PlayerSnapshot } from '../types'

interface Props {
  player: PlayerSnapshot
  rank: number
  topValue: number
  metric: 'damage' | 'healing'
  onClick: () => void
}

const CLASS_COLORS = [
  '#c69b3a', '#69ccf0', '#00ff96', '#f48cba',
  '#ff7c0a', '#aad372', '#3fc7eb', '#fff468',
  '#0070dd', '#8788ee', '#e8d5a3',
]

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function PlayerRow({ player, rank, topValue, metric, onClick }: Props) {
  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total
  const fillPct = topValue > 0 ? (value / topValue) * 100 : 0
  const color = CLASS_COLORS[(rank - 1) % CLASS_COLORS.length]

  return (
    <div
      className="relative flex items-center px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
      onClick={onClick}
    >
      {/* Background bar */}
      <div
        className="absolute inset-y-0 left-0 opacity-20 rounded"
        style={{ width: `${fillPct}%`, backgroundColor: color }}
      />

      {/* Rank */}
      <span className="relative w-5 text-xs text-slate-500 shrink-0">{rank}</span>

      {/* Name */}
      <span className="relative flex-1 text-sm font-medium truncate" style={{ color }}>
        {player.name}
      </span>

      {/* Total */}
      <span className="relative text-xs text-slate-400 w-16 text-right">{formatNum(total)}</span>

      {/* DPS/HPS */}
      <span className="relative text-sm font-semibold w-20 text-right text-white">
        {formatNum(value)}
      </span>
    </div>
  )
}
