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

function SpellNameCell({ spellId, spellName }: { spellId: string; spellName: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <SpellIcon spellId={spellId} />
      <span>{spellName}</span>
    </div>
  )
}

function formatNum(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
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

interface DamageProps { spells: Record<string, SpellDamageStats> }
interface HealProps   { spells: Record<string, SpellHealStats> }

export function DamageSpellTable({ spells }: DamageProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Spell</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Hits</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Crit%</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Min</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Max</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Absorb</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr
            key={s.spellId}
            style={{
              background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
          >
            <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>
              <SpellNameCell spellId={s.spellId} spellName={s.spellName} />
            </td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{formatNum(s.total)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-secondary)' }}>{s.hitCount}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: '#eab308' }}>{pct(s.critCount, s.hitCount)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>
              {s.normalMin === Infinity ? '—' : formatNum(s.normalMin)}
            </td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{formatNum(s.normalMax)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{formatNum(s.absorbed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface InterruptProps {
  spells: Record<string, InterruptSpellStats>
  heading: string
}

export function InterruptSpellTable({ spells, heading }: InterruptProps) {
  const rows = Object.values(spells).sort((a, b) => b.count - a.count)
  const total = rows.reduce((sum, s) => sum + s.count, 0)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>{heading}</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Count</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>
              None
            </td>
          </tr>
        ) : (
          rows.map((s, i) => (
            <tr
              key={s.spellId}
              style={{
                background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
            >
              <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>
                <SpellNameCell spellId={s.spellId} spellName={s.spellName} />
              </td>
              <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{s.count}</td>
              <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{pct(s.count, total)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

export function HealSpellTable({ spells }: HealProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Spell</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Hits</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Crit%</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Overheal%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr
            key={s.spellId}
            style={{
              background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
          >
            <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>
              <SpellNameCell spellId={s.spellId} spellName={s.spellName} />
            </td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{formatNum(s.total)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-secondary)' }}>{s.hitCount}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: '#eab308' }}>{pct(s.critCount, s.hitCount)}</td>
            <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{pct(s.overheal, s.total + s.overheal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
