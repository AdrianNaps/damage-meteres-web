import { SPEC_ICON_NAMES } from '../data/specIcons'

const CDN = 'https://wow.zamimg.com/images/wow/icons'
type IconSize = 'small' | 'medium' | 'large'

// Cache for spec icons keyed by `${size}:${specId}`. Bounded by the number of
// specs (~40) × sizes (3), so never grows beyond ~120 entries. Spec icons are
// looked up per row × per metric tab × per paint, so memoizing the string
// concat avoids allocation churn in the render hot path. Spell icons are not
// cached — their keyspace is unbounded across sessions (thousands of spells)
// and they're only used in drill-down panels, not the row hot path.
const specIconCache = new Map<string, string | null>()

export function wowIconUrl(name: string, size: IconSize = 'small'): string {
  return `${CDN}/${size}/${name}.jpg`
}

export function specIconUrl(specId: number | undefined, size: IconSize = 'small'): string | null {
  if (specId === undefined) return null
  const key = `${size}:${specId}`
  const cached = specIconCache.get(key)
  if (cached !== undefined) return cached
  const name = SPEC_ICON_NAMES[specId]
  const url = name ? wowIconUrl(name, size) : null
  specIconCache.set(key, url)
  return url
}

export function spellIconUrl(iconName: string | undefined, size: IconSize = 'small'): string | null {
  if (!iconName) return null
  return wowIconUrl(iconName, size)
}
