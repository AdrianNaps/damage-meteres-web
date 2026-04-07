import { SPEC_ICON_NAMES } from '../data/specIcons'

const CDN = 'https://wow.zamimg.com/images/wow/icons'

export function wowIconUrl(name: string, size: 'small' | 'medium' | 'large' = 'small'): string {
  return `${CDN}/${size}/${name}.jpg`
}

export function specIconUrl(specId: number | undefined, size: 'small' | 'medium' | 'large' = 'small'): string | null {
  if (specId === undefined) return null
  const name = SPEC_ICON_NAMES[specId]
  return name ? wowIconUrl(name, size) : null
}

export function spellIconUrl(iconName: string | undefined, size: 'small' | 'medium' | 'large' = 'small'): string | null {
  if (!iconName) return null
  return wowIconUrl(iconName, size)
}
