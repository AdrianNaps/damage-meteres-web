import type { ClientEvent, SpellDamageStats, SpellHealStats, InterruptSpellStats } from '../types'
import { useStore } from '../store'
import { spellIconUrl } from '../utils/icons'

// Aggregates events scoped to a single (attacker, target) pair into per-spell
// rows for the drill-down target view. Keyed by spellId when present, else
// ability name — on retail both normally exist, but combat log events can
// arrive without a spellId (e.g. melee swings), and we still want one row per
// ability rather than collapsing them all into "" .
//
// Note: events carry no crit flag, so crit% isn't computable in this scope.
// The scoped tables omit the Crit column accordingly.
interface ScopedSpellStat {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  maxHit: number
}

function aggregateSpellsAgainstTarget(
  events: ClientEvent[],
  src: string,
  dst: string,
  kind: 'damage' | 'heal',
): ScopedSpellStat[] {
  const byKey = new Map<string, ScopedSpellStat>()
  for (const e of events) {
    if (e.kind !== kind) continue
    if (e.src !== src || e.dst !== dst) continue
    const amt = e.amount ?? 0
    if (amt <= 0) continue
    const key = e.spellId || `name:${e.ability}`
    const existing = byKey.get(key)
    if (existing) {
      existing.total += amt
      existing.hitCount += 1
      if (amt > existing.maxHit) existing.maxHit = amt
    } else {
      byKey.set(key, {
        spellId: e.spellId ?? '',
        spellName: e.ability,
        total: amt,
        hitCount: 1,
        maxHit: amt,
      })
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.total - a.total)
}

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
  spells: Record<string, SpellDamageStats>
  classColor: string
  duration: number
  playerTotal: number
}

export function FullDamageSpellTable({ spells, classColor, duration, playerTotal }: FullDamageProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  const totalForPct = playerTotal > 0 ? playerTotal : rows.reduce((s, r) => s + r.total, 0)
  const topShare = rows[0] && totalForPct > 0 ? rows[0].total / totalForPct : 0

  return (
    <div>
      <div style={{ ...fullHeaderStyle, gridTemplateColumns: DAMAGE_FULL_COLUMNS }}>
        <span>Ability</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span style={{ textAlign: 'right' }}>%</span>
        <span style={{ textAlign: 'right' }}>Hits</span>
        <span style={{ textAlign: 'right' }}>Avg Hit</span>
        <span style={{ textAlign: 'right' }}>Crit</span>
        <span style={{ textAlign: 'right' }}>DPS</span>
      </div>
      {rows.map(s => {
        const share = totalForPct > 0 ? s.total / totalForPct : 0
        const barPct = topShare > 0 ? (share / topShare) * 100 : 0
        const avgHit = s.hitCount > 0 ? s.total / s.hitCount : 0
        const dps = duration > 0 ? s.total / duration : 0
        const critPct = s.hitCount > 0 ? Math.round((s.critCount / s.hitCount) * 100) : 0
        return (
          <div
            key={s.spellId}
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
            <span style={fullMonoCrit}>{s.hitCount > 0 ? `${critPct}%` : '—'}</span>
            <span style={{ ...fullMonoPrimary, color: 'var(--text-primary)' }}>{formatNum(dps)}</span>
          </div>
        )
      })}
    </div>
  )
}

interface FullHealProps {
  spells: Record<string, SpellHealStats>
  classColor: string
  duration: number
  playerTotal: number
}

export function FullHealSpellTable({ spells, classColor, duration, playerTotal }: FullHealProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  const totalForPct = playerTotal > 0 ? playerTotal : rows.reduce((s, r) => s + r.total, 0)
  const topShare = rows[0] && totalForPct > 0 ? rows[0].total / totalForPct : 0

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
      {rows.map(s => {
        const share = totalForPct > 0 ? s.total / totalForPct : 0
        const barPct = topShare > 0 ? (share / topShare) * 100 : 0
        const avgHit = s.hitCount > 0 ? s.total / s.hitCount : 0
        const hps = duration > 0 ? s.total / duration : 0
        const critPct = s.hitCount > 0 ? Math.round((s.critCount / s.hitCount) * 100) : 0
        return (
          <div
            key={s.spellId}
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
            <span style={fullMonoCrit}>{s.hitCount > 0 ? `${critPct}%` : '—'}</span>
            <span style={{ ...fullMonoPrimary, color: 'var(--text-primary)' }}>{formatNum(hps)}</span>
          </div>
        )
      })}
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

// ——— Target-scoped spell tables (drill into a target) ———
// Renders the abilities the drilled player used on the chosen target.
// Crit column is omitted because ClientEvent has no crit flag on the wire.

interface ScopedSummaryProps {
  events: ClientEvent[]
  playerName: string
  targetName: string
  kind: 'damage' | 'heal'
  classColor: string
}

export function TargetScopedSpellTable({ events, playerName, targetName, kind, classColor }: ScopedSummaryProps) {
  const rows = aggregateSpellsAgainstTarget(events, playerName, targetName, kind)
  const topTotal = rows[0]?.total ?? 1

  if (rows.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
        No abilities recorded
      </div>
    )
  }

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Spell</span>
        <span style={{ width: 56, textAlign: 'right' }}>Total</span>
        <span style={{ width: 36, textAlign: 'right' }}>Hits</span>
        <span style={{ width: 48, textAlign: 'right' }}>Max</span>
      </div>
      {rows.map(s => (
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
          <span style={{ ...secondaryCol, width: 48 }}>{formatNum(s.maxHit)}</span>
        </div>
      ))}
    </div>
  )
}

interface ScopedFullProps {
  events: ClientEvent[]
  playerName: string
  targetName: string
  kind: 'damage' | 'heal'
  classColor: string
  duration: number
}

const SCOPED_FULL_COLUMNS = '1fr 64px 44px 44px 56px 60px'

export function FullTargetScopedSpellTable({ events, playerName, targetName, kind, classColor, duration }: ScopedFullProps) {
  const rows = aggregateSpellsAgainstTarget(events, playerName, targetName, kind)
  const scopedTotal = rows.reduce((s, r) => s + r.total, 0)
  const topShare = rows[0] && scopedTotal > 0 ? rows[0].total / scopedTotal : 0
  const rateLabel = kind === 'heal' ? 'HPS' : 'DPS'

  if (rows.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
        No abilities recorded
      </div>
    )
  }

  return (
    <div>
      <div style={{ ...fullHeaderStyle, gridTemplateColumns: SCOPED_FULL_COLUMNS }}>
        <span>Ability</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span style={{ textAlign: 'right' }}>%</span>
        <span style={{ textAlign: 'right' }}>Hits</span>
        <span style={{ textAlign: 'right' }}>Avg Hit</span>
        <span style={{ textAlign: 'right' }}>{rateLabel}</span>
      </div>
      {rows.map(s => {
        const share = scopedTotal > 0 ? s.total / scopedTotal : 0
        const barPct = topShare > 0 ? (share / topShare) * 100 : 0
        const avgHit = s.hitCount > 0 ? s.total / s.hitCount : 0
        const rate = duration > 0 ? s.total / duration : 0
        return (
          <div
            key={s.spellId || s.spellName}
            style={{ ...fullRowStyle, gridTemplateColumns: SCOPED_FULL_COLUMNS }}
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
            <span style={fullMonoSecondary}>{s.hitCount}</span>
            <span style={fullMonoMuted}>{formatNum(avgHit)}</span>
            <span style={{ ...fullMonoPrimary, color: 'var(--text-primary)' }}>{formatNum(rate)}</span>
          </div>
        )
      })}
    </div>
  )
}
