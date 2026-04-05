import type { TargetDamageStats } from '../types'
import { formatNum, pct } from '../utils/format'

interface Props {
  targets: Record<string, TargetDamageStats>
  totalDamage: number
  duration: number
  onSelect: (targetName: string) => void
}

const thStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  padding: '6px 0',
  borderBottom: '1px solid var(--border-default)',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 0',
  fontSize: 12,
  borderBottom: '1px solid var(--border-subtle)',
}

const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
}

export function TargetTable({ targets, totalDamage, duration, onSelect }: Props) {
  const rows = Object.values(targets).sort((a, b) => b.total - a.total)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Target</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>DPS</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <tr
            key={t.targetName}
            style={{
              cursor: 'pointer',
              background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onClick={() => onSelect(t.targetName)}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
          >
            <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>{t.targetName}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{formatNum(t.total)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-secondary)' }}>
              {duration > 0 ? formatNum(t.total / duration) : '—'}
            </td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{pct(t.total, totalDamage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
