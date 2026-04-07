export function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
}

// "Adrianw-Sargeras-US" → "Adrianw". Names without a realm pass through unchanged.
export function shortName(fullName: string): string {
  const dash = fullName.indexOf('-')
  return dash === -1 ? fullName : fullName.slice(0, dash)
}
