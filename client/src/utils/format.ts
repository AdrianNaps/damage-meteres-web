export function formatNum(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
}

// WoW raid difficultyID → short label. Returns null for unknown/non-raid difficulties.
export function raidDifficultyLabel(difficultyID: number): string | null {
  switch (difficultyID) {
    case 14: return 'N'    // Normal raid
    case 15: return 'H'    // Heroic raid
    case 16: return 'M'    // Mythic raid
    case 17: return 'LFR'  // Raid Finder
    default: return null
  }
}

// "Adrianw-Sargeras-US" → "Adrianw". Names without a realm pass through unchanged.
export function shortName(fullName: string): string {
  const dash = fullName.indexOf('-')
  return dash === -1 ? fullName : fullName.slice(0, dash)
}
