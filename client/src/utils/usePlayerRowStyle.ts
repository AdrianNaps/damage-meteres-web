import { useCallback } from 'react'
import { useStore, resolveSpecId } from '../store'
import { getClassColor } from '../components/PlayerRow'
import { shortName } from './format'

// Shape consumed by row renderers (TargetTable, TargetScopedView,
// TargetDrillDown). When the resolver returns null, callers fall back to
// their own default styling (raw name, shared classColor, no icon).
export interface PlayerRowStyle {
  displayName: string
  color: string
  specId?: number
}

// Canonical "is this name an ally player we know about?" resolver. Any row
// component that renders player names should call this — it's the single
// place that enforces the short-name + spec-icon + class-color convention.
// Returning null means "not an ally we have a spec for"; callers should fall
// through to plain rendering in that case (enemy mob, NPC, unknown unit).
export function usePlayerRowStyle(): (name: string) => PlayerRowStyle | null {
  const playerSpecs = useStore(s => s.playerSpecs)
  return useCallback((name: string): PlayerRowStyle | null => {
    const specId = resolveSpecId(playerSpecs, name)
    if (specId === undefined) return null
    return { displayName: shortName(name), color: getClassColor(specId), specId }
  }, [playerSpecs])
}
