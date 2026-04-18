import { formatNum, pct } from '../utils/format'
import { specIconUrl } from '../utils/icons'
import type { BreakdownTargetRow } from '../utils/filters'

// Optional per-row override — used by healing-mode to render each target as a
// class-colored player entry (short name + spec icon + own class color on the
// bar). If not provided (or returns null), the row falls back to the raw
// targetName and the shared classColor.
export interface TargetRowStyle {
  displayName: string
  color: string
  specId?: number
}

interface Props {
  // Pre-filtered, pre-sorted by the breakdown selector. The component is a
  // pure renderer — no filter awareness here.
  targets: BreakdownTargetRow[]
  totalAmount: number
  duration: number
  rateLabel: 'DPS' | 'HPS' | 'DTPS'
  // Row axis label. "Target" for damage/healing (the recipient of the action)
  // and "Attacker" for damageTaken (the source of the incoming hit). Header
  // and row content are otherwise identical.
  columnLabel?: 'Target' | 'Attacker'
  classColor: string
  resolveRow?: (targetName: string) => TargetRowStyle | null
  onSelect: (targetName: string) => void
}

const headerStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  padding: '6px 16px',
  borderBottom: '1px solid var(--border-default)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const rowStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  padding: '5px 16px',
  fontSize: 12,
  borderBottom: '1px solid var(--border-subtle)',
  overflow: 'hidden',
  gap: 8,
  cursor: 'pointer',
}

const primaryCol: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  position: 'relative',
  flexShrink: 0,
  fontWeight: 600,
  color: 'var(--text-primary)',
}

const secondaryCol: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  position: 'relative',
  flexShrink: 0,
  color: 'var(--text-secondary)',
}

function BarFill({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      width: `${pct}%`,
      background: color,
      opacity: 0.18,
      borderRadius: '0 2px 2px 0',
      pointerEvents: 'none',
    }} />
  )
}

export function TargetTable({ targets, totalAmount, duration, rateLabel, columnLabel = 'Target', classColor, resolveRow, onSelect }: Props) {
  const topTotal = targets[0]?.total ?? 1

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>{columnLabel}</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 48, textAlign: 'right' }}>{rateLabel}</span>
        <span style={{ width: 36, textAlign: 'right' }}>%</span>
      </div>
      {targets.map(t => {
        const style = resolveRow?.(t.targetName) ?? null
        const displayName = style?.displayName ?? t.targetName
        const barColor = style?.color ?? classColor
        const iconSrc = specIconUrl(style?.specId)
        const nameColor = style?.color ?? 'var(--text-primary)'
        return (
          <div
            key={t.targetName}
            style={rowStyle}
            onClick={() => onSelect(t.targetName)}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <BarFill pct={(t.total / topTotal) * 100} color={barColor} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden' }}>
              {iconSrc && (
                <img
                  src={iconSrc}
                  alt=""
                  width={18}
                  height={18}
                  style={{ flexShrink: 0, border: '1px solid rgba(0, 0, 0, 0.7)', borderRadius: 2 }}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: nameColor }}>
                {displayName}
              </span>
            </div>
            <span style={{ ...primaryCol, width: 56 }}>{formatNum(t.total)}</span>
            <span style={{ ...secondaryCol, width: 48 }}>{duration > 0 ? formatNum(t.total / duration) : '—'}</span>
            <span style={{ ...secondaryCol, width: 36, color: 'var(--text-muted)' }}>{pct(t.total, totalAmount)}</span>
          </div>
        )
      })}
    </div>
  )
}
