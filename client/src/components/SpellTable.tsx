import type { SpellDamageStats, SpellHealStats } from '../types'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
}

interface DamageProps { spells: Record<string, SpellDamageStats> }
interface HealProps   { spells: Record<string, SpellHealStats> }

export function DamageSpellTable({ spells }: DamageProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500 border-b border-white/10">
          <th className="text-left py-1.5 font-normal">Spell</th>
          <th className="text-right py-1.5 font-normal">Total</th>
          <th className="text-right py-1.5 font-normal">Hits</th>
          <th className="text-right py-1.5 font-normal">Crit%</th>
          <th className="text-right py-1.5 font-normal">Min</th>
          <th className="text-right py-1.5 font-normal">Max</th>
          <th className="text-right py-1.5 font-normal">Absorb</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(s => (
          <tr key={s.spellId} className="border-b border-white/5 hover:bg-white/5">
            <td className="py-1 text-slate-200">{s.spellName}</td>
            <td className="py-1 text-right text-white">{formatNum(s.total)}</td>
            <td className="py-1 text-right text-slate-300">{s.hitCount}</td>
            <td className="py-1 text-right text-yellow-400">{pct(s.critCount, s.hitCount)}</td>
            <td className="py-1 text-right text-slate-400">
              {s.normalMin === Infinity ? '—' : formatNum(s.normalMin)}
            </td>
            <td className="py-1 text-right text-slate-400">{formatNum(s.normalMax)}</td>
            <td className="py-1 text-right text-slate-400">{formatNum(s.absorbed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function HealSpellTable({ spells }: HealProps) {
  const rows = Object.values(spells).sort((a, b) => b.total - a.total)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500 border-b border-white/10">
          <th className="text-left py-1.5 font-normal">Spell</th>
          <th className="text-right py-1.5 font-normal">Total</th>
          <th className="text-right py-1.5 font-normal">Hits</th>
          <th className="text-right py-1.5 font-normal">Crit%</th>
          <th className="text-right py-1.5 font-normal">Overheal%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(s => (
          <tr key={s.spellId} className="border-b border-white/5 hover:bg-white/5">
            <td className="py-1 text-slate-200">{s.spellName}</td>
            <td className="py-1 text-right text-white">{formatNum(s.total)}</td>
            <td className="py-1 text-right text-slate-300">{s.hitCount}</td>
            <td className="py-1 text-right text-yellow-400">{pct(s.critCount, s.hitCount)}</td>
            <td className="py-1 text-right text-slate-400">{pct(s.overheal, s.total + s.overheal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
