import type { TargetDetail } from '../types'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
}

interface Props {
  detail: TargetDetail
  onBack: () => void
}

export function TargetDrillDown({ detail, onBack }: Props) {
  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors mb-3"
      >
        ← Targets
      </button>
      <div className="text-sm font-semibold text-white mb-3">
        {detail.targetName}
        <span className="ml-2 text-xs font-normal text-slate-400">{formatNum(detail.total)} total</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-white/10">
            <th className="text-left py-1.5 font-normal">Source</th>
            <th className="text-right py-1.5 font-normal">Total</th>
            <th className="text-right py-1.5 font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {detail.sources.map(s => (
            <tr key={s.sourceName} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1 text-slate-200">{s.sourceName}</td>
              <td className="py-1 text-right text-white">{formatNum(s.total)}</td>
              <td className="py-1 text-right text-slate-400">{pct(s.total, detail.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
