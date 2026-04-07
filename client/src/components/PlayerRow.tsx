import type { PlayerSnapshot } from '../types'
import { useStore, resolveSpecId } from '../store'
import { shortName } from '../utils/format'
import { specIconUrl } from '../utils/icons'

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
  577: 12, 581: 12, 1480: 12,    // Demon Hunter (Havoc, Vengeance, Devourer)
  1467: 13, 1468: 13, 1473: 13, // Evoker
}

const CLASS_COLORS: Record<number, string> = {
  1: '#C69B3A',  // Warrior
  2: '#F48CBA',  // Paladin
  3: '#AAD372',  // Hunter
  4: '#FFF468',  // Rogue
  5: '#E8D5A3',  // Priest
  6: '#C41E3A',  // Death Knight
  7: '#0070DD',  // Shaman
  8: '#3FC7EB',  // Mage
  9: '#8788EE',  // Warlock
  10: '#00FF96', // Monk
  11: '#FF7C0A', // Druid
  12: '#A330C9', // Demon Hunter
  13: '#33937F', // Evoker
}

const UNKNOWN_CLASS_COLOR = '#64748B'

export function getClassColor(specId?: number): string {
  const classId = specId !== undefined ? SPEC_TO_CLASS[specId] : undefined
  return classId !== undefined ? CLASS_COLORS[classId] : UNKNOWN_CLASS_COLOR
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

const textShadow = '0 1px 2px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.9)'

export function PlayerRow({ player, rank, topValue, metric, onClick }: Props) {
  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total
  const fillPct = topValue > 0 ? (value / topValue) * 100 : 0
  const pctOfTop = topValue > 0 ? Math.round((value / topValue) * 100) : 0
  const cachedSpec = useStore(s => resolveSpecId(s.playerSpecs, player.name, player.specId))
  const color = getClassColor(cachedSpec)
  const specIcon = specIconUrl(cachedSpec)

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        paddingRight: 12,
        paddingTop: 0,
        paddingBottom: 0,
        height: 32,
        cursor: 'pointer',
        borderLeft: `3px solid ${color}`,
        overflow: 'hidden',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Bar fill */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: `${fillPct}%`,
          backgroundColor: color,
          opacity: 0.7,
          borderRadius: '0 2px 2px 0',
          pointerEvents: 'none',
        }}
      />

      {/* Rank */}
      <span
        style={{
          position: 'relative',
          width: 24,
          flexShrink: 0,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: '#ffffff',
          textShadow: textShadow,
          textAlign: 'center',
          paddingLeft: 6,
        }}
      >
        {rank}
      </span>

      {/* Spec icon */}
      {specIcon && (
        <img
          src={specIcon}
          alt=""
          width={18}
          height={18}
          style={{
            position: 'relative',
            marginRight: 6,
            border: '1px solid rgba(0, 0, 0, 0.7)',
            borderRadius: 2,
            flexShrink: 0,
          }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}

      {/* Name */}
      <span
        className="truncate"
        style={{
          position: 'relative',
          flex: 1,
          fontSize: 13,
          fontWeight: 500,
          color: '#ffffff',
          textShadow: textShadow,
        }}
      >
        {shortName(player.name)}
      </span>

      {/* Total */}
      <span
        style={{
          position: 'relative',
          width: 64,
          textAlign: 'right',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: '#ffffff',
          textShadow: textShadow,
        }}
      >
        {formatNum(total)}
      </span>

      {/* DPS / HPS */}
      <span
        style={{
          position: 'relative',
          width: 72,
          textAlign: 'right',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color: '#ffffff',
          textShadow: textShadow,
        }}
      >
        {formatNum(value)}
      </span>

      {/* % of top */}
      <span
        style={{
          position: 'relative',
          width: 40,
          textAlign: 'right',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: '#ffffff',
          textShadow: textShadow,
        }}
      >
        {pctOfTop}%
      </span>
    </div>
  )
}
