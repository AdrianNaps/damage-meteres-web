import type { TargetDetail } from '../types'
import { formatNum, pct } from '../utils/format'

interface Props {
  detail: TargetDetail
  onBack: () => void
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

export function TargetDrillDown({ detail, onBack }: Props) {
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
          padding: 0,
          marginBottom: 12,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        &larr; Targets
      </button>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {detail.targetName}
        </span>
        <span style={{ marginLeft: 8, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {formatNum(detail.total)} total
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left' }}>Source</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {detail.sources.map((s, i) => (
            <tr
              key={s.sourceName}
              style={{
                background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
            >
              <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>{s.sourceName}</td>
              <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{formatNum(s.total)}</td>
              <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{pct(s.total, detail.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
