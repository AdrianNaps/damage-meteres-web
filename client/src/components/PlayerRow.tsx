import type { PlayerSnapshot } from '../types'

interface Props {
  player: PlayerSnapshot
  rank: number
  topValue: number
  metric: 'damage' | 'healing'
  onClick: () => void
}

const SPEC_TO_CLASS: Record<number, number> = {
  71: 1, 72: 1, 73: 1,           // Warrior
  65: 2, 66: 2, 70: 2,           // Paladin
  253: 3, 254: 3, 255: 3,        // Hunter
  259: 4, 260: 4, 261: 4,        // Rogue
  256: 5, 257: 5, 258: 5,        // Priest
  250: 6, 251: 6, 252: 6,        // Death Knight
  262: 7, 263: 7, 264: 7,        // Shaman
  62: 8, 63: 8, 64: 8,           // Mage
  265: 9, 266: 9, 267: 9,        // Warlock
  268: 10, 269: 10, 270: 10,     // Monk
  102: 11, 103: 11, 104: 11, 105: 11, // Druid
  577: 12, 581: 12,              // Demon Hunter
  1467: 13, 1468: 13, 1473: 13, // Evoker
}

const CLASS_COLORS: Record<number, string> = {
  1: '#C69B3A',  // Warrior
  2: '#F48CBA',  // Paladin
  3: '#AAD372',  // Hunter
  4: '#FFF468',  // Rogue
  5: '#E8D5A3',  // Priest (white is too harsh on dark bg)
  6: '#C41E3A',  // Death Knight
  7: '#0070DD',  // Shaman
  8: '#3FC7EB',  // Mage
  9: '#8788EE',  // Warlock
  10: '#00FF96', // Monk
  11: '#FF7C0A', // Druid
  12: '#A330C9', // Demon Hunter
  13: '#33937F', // Evoker
}

const UNKNOWN_CLASS_COLOR = '#64748B' // slate-500, visible but clearly "unknown"

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function PlayerRow({ player, rank, topValue, metric, onClick }: Props) {
  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total
  const fillPct = topValue > 0 ? (value / topValue) * 100 : 0
  const classId = player.specId !== undefined ? SPEC_TO_CLASS[player.specId] : undefined
  const color = classId !== undefined ? CLASS_COLORS[classId] : UNKNOWN_CLASS_COLOR

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
