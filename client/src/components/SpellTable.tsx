import type { SpellDamageStats, SpellHealStats, InterruptSpellStats } from '../types'
import { useStore } from '../store'
import { spellIconUrl } from '../utils/icons'

function SpellIcon({ spellId }: { spellId: string }) {
  const name = useStore(s => s.spellIcons[spellId])
  const url = spellIconUrl(name)
  return (
    <div
      style={{
        width: 18,
        height: 18,
        border: '1px solid rgba(0, 0, 0, 0.7)',
        borderRadius: 2,
        background: 'rgba(255, 255, 255, 0.04)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {url && (
        <img
          src={url}
          alt=""
          width={18}
          height={18}
          style={{ display: 'block' }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
    </div>
  )
}

function formatNum(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}\u2009M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}\u2009K`
  return String(Math.round(n))
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
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

// Primary: the headline number (total damage, count)
const primaryCol: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  position: 'relative',
  flexShrink: 0,
  fontWeight: 600,
  color: 'var(--text-primary)',
}

// Secondary: supporting stats (hits, crit%, max, overheal%)
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

interface DamageProps { spells: Record<string, SpellDamageStats>; classColor: string }

export function DamageSpellTable({ spells, classColor }: DamageProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  const topTotal = rows[0]?.total ?? 1

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Spell</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>Hits</span>
        <span style={{ width: 44, textAlign: 'right' }}>Crit%</span>
        <span style={{ width: 48, textAlign: 'right' }}>Max</span>
      </div>
      {rows.map(s => (
        <div
          key={s.spellId}
          style={rowStyle}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <BarFill pct={(s.total / topTotal) * 100} color={classColor} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden' }}>
            <SpellIcon spellId={s.spellId} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.spellName}</span>
          </div>
          <span style={{ ...primaryCol, width: 56 }}>{formatNum(s.total)}</span>
          <span style={{ ...secondaryCol, width: 36 }}>{s.hitCount}</span>
          <span style={{ ...secondaryCol, width: 44 }}>{pct(s.critCount, s.hitCount)}</span>
          <span style={{ ...secondaryCol, width: 48 }}>{formatNum(s.normalMax)}</span>
        </div>
      ))}
    </div>
  )
}

interface InterruptProps {
  spells: Record<string, InterruptSpellStats>
  heading: string
  classColor: string
}

export function InterruptSpellTable({ spells, heading, classColor }: InterruptProps) {
  const rows = Object.values(spells).sort((a, b) => b.count - a.count)
  const total = rows.reduce((sum, s) => sum + s.count, 0)
  const topCount = rows[0]?.count ?? 1

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>{heading}</span>
        <span style={{ width: 48, textAlign: 'right' }}>Count</span>
        <span style={{ width: 44, textAlign: 'right' }}>%</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ ...rowStyle, justifyContent: 'center', color: 'var(--text-muted)' }}>None</div>
      ) : (
        rows.map(s => (
          <div
            key={s.spellId}
            style={rowStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <BarFill pct={(s.count / topCount) * 100} color={classColor} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden' }}>
              <SpellIcon spellId={s.spellId} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.spellName}</span>
            </div>
            <span style={{ ...primaryCol, width: 48 }}>{s.count}</span>
            <span style={{ ...secondaryCol, width: 44 }}>{pct(s.count, total)}</span>
          </div>
        ))
      )}
    </div>
  )
}

interface HealProps { spells: Record<string, SpellHealStats>; classColor: string }

export function HealSpellTable({ spells, classColor }: HealProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  const topTotal = rows[0]?.total ?? 1

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Spell</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>Hits</span>
        <span style={{ width: 44, textAlign: 'right' }}>Crit%</span>
        <span style={{ width: 56, textAlign: 'right' }}>Ovheal%</span>
      </div>
      {rows.map(s => (
        <div
          key={s.spellId}
          style={rowStyle}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <BarFill pct={(s.total / topTotal) * 100} color={classColor} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden' }}>
            <SpellIcon spellId={s.spellId} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.spellName}</span>
          </div>
          <span style={{ ...primaryCol, width: 56 }}>{formatNum(s.total)}</span>
          <span style={{ ...secondaryCol, width: 36 }}>{s.hitCount}</span>
          <span style={{ ...secondaryCol, width: 44 }}>{pct(s.critCount, s.hitCount)}</span>
          <span style={{ ...secondaryCol, width: 56 }}>{pct(s.overheal, s.total + s.overheal)}</span>
        </div>
      ))}
    </div>
  )
}
