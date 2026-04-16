import { SPEC_ICON_NAMES } from '../data/specIcons'

const CDN = 'https://wow.zamimg.com/images/wow/icons'
type IconSize = 'small' | 'medium' | 'large'

// Cache for resolved URLs, keyed by `${size}:${specId | iconName}`. Spec icons
// and spell icons are both looked up thousands of times per render pass (once
// per row × per metric tab × per paint) so memoizing the string concat avoids
// allocation churn in the render hot path.
const specIconCache = new Map<string, string | null>()
const spellIconCache = new Map<string, string | null>()

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
  const key = `${size}:${iconName}`
  const cached = spellIconCache.get(key)
  if (cached !== undefined) return cached
  const url = wowIconUrl(iconName, size)
  spellIconCache.set(key, url)
  return url
}
