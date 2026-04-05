import type { TargetDamageStats } from '../types'
import { formatNum, pct } from '../utils/format'

interface Props {
  targets: Record<string, TargetDamageStats>
  totalDamage: number
  duration: number
  onSelect: (targetName: string) => void
}

export function TargetTable({ targets, totalDamage, duration, onSelect }: Props) {
  const rows = Object.values(targets).sort((a, b) => b.total - a.total)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500 border-b border-white/10">
          <th className="text-left py-1.5 font-normal">Target</th>
          <th className="text-right py-1.5 font-normal">Total</th>
          <th className="text-right py-1.5 font-normal">DPS</th>
          <th className="text-right py-1.5 font-normal">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(t => (
          <tr
            key={t.targetName}
            className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
            onClick={() => onSelect(t.targetName)}
          >
            <td className="py-1 text-slate-200">{t.targetName}</td>
            <td className="py-1 text-right text-white">{formatNum(t.total)}</td>
            <td className="py-1 text-right text-slate-300">
              {duration > 0 ? formatNum(t.total / duration) : '—'}
            </td>
            <td className="py-1 text-right text-slate-400">{pct(t.total, totalDamage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
