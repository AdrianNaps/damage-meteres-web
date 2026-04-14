import type { TargetDetail } from '../types'
import { formatNum, pct } from '../utils/format'
import { specIconUrl } from '../utils/icons'
import type { TargetRowStyle } from './TargetTable'

interface Props {
  detail: TargetDetail
  classColor: string
  // Same shape as TargetTable.resolveRow — lets healing-mode render each source
  // (and the heading) with the respective player's class color, spec icon, and
  // short name. Omit for damage mode (enemy mobs).
  resolveRow?: (sourceName: string) => TargetRowStyle | null
  headingStyle?: TargetRowStyle | null
  onBack: () => void
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
  color: 'var(--text-muted)',
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

export function TargetDrillDown({ detail, classColor, resolveRow, headingStyle, onBack }: Props) {
  const topTotal = detail.sources[0]?.total ?? 1
  const headingName = headingStyle?.displayName ?? detail.targetName
  const headingColor = headingStyle?.color ?? 'var(--text-primary)'
  const headingIcon = specIconUrl(headingStyle?.specId)
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          padding: '0 16px',
          marginBottom: 12,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        &larr; Targets
      </button>
      <div style={{ marginBottom: 8, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {headingIcon && (
          <img
            src={headingIcon}
            alt=""
            width={20}
            height={20}
            style={{ flexShrink: 0, border: '1px solid rgba(0, 0, 0, 0.7)', borderRadius: 2 }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: headingColor }}>
          {headingName}
        </span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {formatNum(detail.total)} total
        </span>
      </div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Source</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>%</span>
      </div>
      {detail.sources.map(s => {
        const style = resolveRow?.(s.sourceName) ?? null
        const displayName = style?.displayName ?? s.sourceName
        const barColor = style?.color ?? classColor
        const iconSrc = specIconUrl(style?.specId)
        const nameColor = style?.color ?? 'var(--text-primary)'
        return (
          <div
            key={s.sourceName}
            style={rowStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <BarFill pct={(s.total / topTotal) * 100} color={barColor} />
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
            <span style={{ ...primaryCol, width: 56 }}>{formatNum(s.total)}</span>
            <span style={{ ...secondaryCol, width: 36 }}>{pct(s.total, detail.total)}</span>
          </div>
        )
      })}
    </div>
  )
}
