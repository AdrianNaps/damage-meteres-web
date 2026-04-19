import { useMemo } from 'react'
import type { InterruptSpellStats } from '../types'
import { useStore } from '../store'
import type { BreakdownSpellRow } from '../utils/filters'
import { spellIconUrl } from '../utils/icons'

// All damage/heal spell tables consume BreakdownSpellRow[]. Rows are
// pre-filtered and pre-sorted by selectPlayerBreakdown so the renderers
// stay dumb. Crit% / max-hit cells render "—" when the source is the
// events-driven path (ClientEvent doesn't carry a crit flag yet); the
// no-filter path projects PlayerSnapshot and populates them.
//
// Interrupts still consume PlayerSnapshot.interrupts.{byKicker,byKicked}
// because the kicked-spell info isn't on ClientEvent. Once it lands the
// interrupt table can move to the same dumb-renderer model.

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

interface DamageProps { spells: BreakdownSpellRow[]; classColor: string }

export function DamageSpellTable({ spells, classColor }: DamageProps) {
  const topTotal = spells[0]?.total ?? 1

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Spell</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>Hits</span>
        <span style={{ width: 44, textAlign: 'right' }}>Crit%</span>
        <span style={{ width: 48, textAlign: 'right' }}>Max</span>
      </div>
      {spells.map(s => (
        <div
          key={s.spellId || s.spellName}
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
          <span style={{ ...secondaryCol, width: 44 }}>{s.critCount === undefined ? '—' : pct(s.critCount, s.hitCount)}</span>
          <span style={{ ...secondaryCol, width: 48 }}>{s.normalMax === undefined ? '—' : formatNum(s.normalMax)}</span>
        </div>
      ))}
    </div>
  )
}

interface HealProps { spells: BreakdownSpellRow[]; classColor: string }

export function HealSpellTable({ spells, classColor }: HealProps) {
  const topTotal = spells[0]?.total ?? 1

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Spell</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>Hits</span>
        <span style={{ width: 44, textAlign: 'right' }}>Crit%</span>
        <span style={{ width: 56, textAlign: 'right' }}>Ovheal%</span>
      </div>
      {spells.map(s => (
        <div
          key={s.spellId || s.spellName}
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
          <span style={{ ...secondaryCol, width: 44 }}>{s.critCount === undefined ? '—' : pct(s.critCount, s.hitCount)}</span>
          <span style={{ ...secondaryCol, width: 56 }}>{s.overheal === undefined ? '—' : pct(s.overheal, s.total + s.overheal)}</span>
        </div>
      ))}
    </div>
  )
}

// ——— Full-mode spell tables ———
// Wider layout used when the drill panel is in Full mode. Columns match the
// staging mock's full-drill-panel minus Casts/Avg-per-cast (no cast count on
// the wire yet — tracked to add later). Bar is scaled to the max-share row so
// mid-pack rows read sharper than a raw-total scale would give them.

const fullHeaderStyle: React.CSSProperties = {
  display: 'grid',
  alignItems: 'center',
  padding: '6px 16px',
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-default)',
}

const fullRowStyle: React.CSSProperties = {
  position: 'relative',
  display: 'grid',
  alignItems: 'center',
  padding: '4px 16px',
  fontSize: 12,
  borderBottom: '1px solid var(--border-subtle)',
  overflow: 'hidden',
}

const fullMonoPrimary: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  color: 'var(--text-primary)',
  fontWeight: 600,
}

const fullMonoSecondary: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  color: 'var(--text-secondary)',
}

const fullMonoMuted: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  color: 'var(--text-muted)',
}

const fullMonoCrit: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  color: 'var(--data-crit)',
}

const DAMAGE_FULL_COLUMNS = '1fr 64px 44px 44px 56px 44px 60px'
const HEAL_FULL_COLUMNS = '1fr 64px 44px 44px 56px 44px 60px'

interface FullDamageProps {
  spells: BreakdownSpellRow[]
  classColor: string
  duration: number
  // Denominator for the % column. Pass breakdown.total so percentages always
  // sum to 100% across visible rows, whether or not filters are active.
  playerTotal: number
  // Rate column label. Defaults to 'DPS' for damage-dealt; damageTaken passes
  // 'DTPS' so the header reads as the metric it belongs to. The underlying
  // computation is the same — total/duration.
  rateLabel?: 'DPS' | 'DTPS'
}

export function FullDamageSpellTable({ spells, classColor, duration, playerTotal, rateLabel = 'DPS' }: FullDamageProps) {
  const totalForPct = playerTotal > 0 ? playerTotal : spells.reduce((s, r) => s + r.total, 0)
  const topShare = spells[0] && totalForPct > 0 ? spells[0].total / totalForPct : 0

  return (
    <div>
      <div style={{ ...fullHeaderStyle, gridTemplateColumns: DAMAGE_FULL_COLUMNS }}>
        <span>Ability</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span style={{ textAlign: 'right' }}>%</span>
        <span style={{ textAlign: 'right' }}>Hits</span>
        <span style={{ textAlign: 'right' }}>Avg Hit</span>
        <span style={{ textAlign: 'right' }}>Crit</span>
        <span style={{ textAlign: 'right' }}>{rateLabel}</span>
      </div>
      {spells.map(s => {
        const share = totalForPct > 0 ? s.total / totalForPct : 0
        const barPct = topShare > 0 ? (share / topShare) * 100 : 0
        const avgHit = s.hitCount > 0 ? s.total / s.hitCount : 0
        const dps = duration > 0 ? s.total / duration : 0
        const critPct = s.critCount === undefined ? null
          : s.hitCount > 0 ? Math.round((s.critCount / s.hitCount) * 100) : 0
        return (
          <div
            key={s.spellId || s.spellName}
            style={{ ...fullRowStyle, gridTemplateColumns: DAMAGE_FULL_COLUMNS }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <BarFill pct={barPct} color={classColor} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
              <SpellIcon spellId={s.spellId} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.spellName}</span>
            </div>
            <span style={fullMonoPrimary}>{formatNum(s.total)}</span>
            <span style={fullMonoSecondary}>{(share * 100).toFixed(0)}%</span>
            <span style={fullMonoSecondary}>{s.hitCount || '—'}</span>
            <span style={fullMonoMuted}>{s.hitCount > 0 ? formatNum(avgHit) : '—'}</span>
            <span style={fullMonoCrit}>{critPct === null ? '—' : `${critPct}%`}</span>
            <span style={fullMonoPrimary}>{formatNum(dps)}</span>
          </div>
        )
      })}
    </div>
  )
}

interface FullHealProps {
  spells: BreakdownSpellRow[]
  classColor: string
  duration: number
  playerTotal: number
}

export function FullHealSpellTable({ spells, classColor, duration, playerTotal }: FullHealProps) {
  const totalForPct = playerTotal > 0 ? playerTotal : spells.reduce((s, r) => s + r.total, 0)
  const topShare = spells[0] && totalForPct > 0 ? spells[0].total / totalForPct : 0

  return (
    <div>
      <div style={{ ...fullHeaderStyle, gridTemplateColumns: HEAL_FULL_COLUMNS }}>
        <span>Ability</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span style={{ textAlign: 'right' }}>%</span>
        <span style={{ textAlign: 'right' }}>Hits</span>
        <span style={{ textAlign: 'right' }}>Avg Hit</span>
        <span style={{ textAlign: 'right' }}>Crit</span>
        <span style={{ textAlign: 'right' }}>HPS</span>
      </div>
      {spells.map(s => {
        const share = totalForPct > 0 ? s.total / totalForPct : 0
        const barPct = topShare > 0 ? (share / topShare) * 100 : 0
        const avgHit = s.hitCount > 0 ? s.total / s.hitCount : 0
        const hps = duration > 0 ? s.total / duration : 0
        const critPct = s.critCount === undefined ? null
          : s.hitCount > 0 ? Math.round((s.critCount / s.hitCount) * 100) : 0
        return (
          <div
            key={s.spellId || s.spellName}
            style={{ ...fullRowStyle, gridTemplateColumns: HEAL_FULL_COLUMNS }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <BarFill pct={barPct} color={classColor} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
              <SpellIcon spellId={s.spellId} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.spellName}</span>
            </div>
            <span style={fullMonoPrimary}>{formatNum(s.total)}</span>
            <span style={fullMonoSecondary}>{(share * 100).toFixed(0)}%</span>
            <span style={fullMonoSecondary}>{s.hitCount || '—'}</span>
            <span style={fullMonoMuted}>{s.hitCount > 0 ? formatNum(avgHit) : '—'}</span>
            <span style={fullMonoCrit}>{critPct === null ? '—' : `${critPct}%`}</span>
            <span style={fullMonoPrimary}>{formatNum(hps)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ——— Interrupt table (still on PlayerSnapshot) ———
// Interrupts stay on the pre-aggregated byKicker/byKicked buckets for the
// drill panel (the segment-wide meter re-aggregates from events). The table
// hides rows matching the relevant filter axis so it tracks the FilterBar
// chips: `Ability` narrows the kicker-ability table; `InterruptedAbility`
// narrows the victim-spell table. Source filter is implicit (player drill);
// Target filter doesn't apply at this grain.

interface InterruptProps {
  spells: Record<string, InterruptSpellStats>
  heading: string
  classColor: string
  // Which filter axis this table reads. byKicker ↔ 'Ability' (the kicker's
  // spell, i.e. the interrupting ability). byKicked ↔ 'InterruptedAbility'
  // (the victim's cast that got cut).
  filterAxis: 'Ability' | 'InterruptedAbility'
}

export function InterruptSpellTable({ spells, heading, classColor, filterAxis }: InterruptProps) {
  const filterValues = useStore(s => s.filters[filterAxis])
  const rows = useMemo(() => {
    const arr = Object.values(spells)
    const visible = filterValues ? arr.filter(s => filterValues.includes(s.spellName)) : arr
    return [...visible].sort((a, b) => b.count - a.count)
  }, [spells, filterValues])
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
