import { create } from 'zustand'
import type { SegmentSnapshot, KeyRunSnapshot, BossSectionSnapshot, HistoryItem, TargetDetail, PlayerDeathRecord, PlayerSnapshot } from './types'

export interface BootInfoState {
  logsDir: string
  logsDirExists: boolean
}

// Sentinel used in graphFocused to mark the group-average line. Kept here so the
// reset helpers and the graph component share a single source of truth.
export const GRAPH_GROUP_AVG_KEY = '__group_avg__'

export type Metric = 'damage' | 'healing' | 'deaths' | 'interrupts'
export type Mode = 'summary' | 'full'
export type Perspective = 'allies' | 'enemies'
export type FilterAxis = 'Source' | 'Target' | 'Ability'

export interface FilterState {
  Source?: string[]
  Target?: string[]
  Ability?: string[]
}

// Empty filter object shared for equality checks and defaults. Frozen so the
// reference-identity sentinel can't be poisoned by accidental mutation — the
// store uses `state.filters === EMPTY_FILTERS` to detect the empty case.
export const EMPTY_FILTERS: FilterState = Object.freeze({}) as FilterState

// Viewed-snapshot cache so re-clicking a tab the user already loaded doesn't
// round-trip the server. Completed snapshots are immutable, so a hit is always
// correct. LRU by insertion order — Map.keys() yields oldest first.
export type AnySnapshot = SegmentSnapshot | KeyRunSnapshot | BossSectionSnapshot
const SNAPSHOT_CACHE_MAX = 20

function cachePut(cache: Map<string, AnySnapshot>, key: string, snap: AnySnapshot): Map<string, AnySnapshot> {
  const next = new Map(cache)
  next.delete(key)    // re-insert bumps to tail so LRU eviction hits oldest
  next.set(key, snap)
  while (next.size > SNAPSHOT_CACHE_MAX) {
    const oldest = next.keys().next().value
    if (oldest === undefined) break
    next.delete(oldest)
  }
  return next
}

// Called whenever the segment_list payload changes: per-segment snapshots are
// immutable once complete, but aggregates (key runs, boss sections) can gain
// pulls mid-raid. Cheapest safe invalidation is to evict all aggregate keys
// and let the next view re-fetch. No-op for completed logs where segmentHistory
// arrives once and never changes.
function cacheEvictAggregates(cache: Map<string, AnySnapshot>): Map<string, AnySnapshot> {
  let next: Map<string, AnySnapshot> | null = null
  for (const key of cache.keys()) {
    if (key.startsWith('kr:') || key.startsWith('bs:')) {
      if (!next) next = new Map(cache)
      next.delete(key)
    }
  }
  return next ?? cache
}

interface AppState {
  selectedSegment: SegmentSnapshot | null
  segmentHistory: HistoryItem[]
  selectedSegmentId: string | null
  selectedKeyRunId: string | null    // which key run header is selected
  selectedKeyRun: KeyRunSnapshot | null
  selectedBossSectionId: string | null
  selectedBossSection: BossSectionSnapshot | null
  selectedPlayer: string | null
  selectedDeath: PlayerDeathRecord | null
  metric: Metric
  drillMetric: Metric | null
  mode: Mode
  wsStatus: 'connecting' | 'connected' | 'disconnected'
  targetDetail: TargetDetail | null
  // Per-name spec cache, accumulated across every snapshot we've seen.
  // Used as a fallback when a segment (e.g. Trash 1) was created before COMBATANT_INFO fired.
  playerSpecs: Record<string, number>
  // spellId → Wowhead icon filename. Accumulated across snapshots so icons
  // stay visible even when a snapshot arrives before the server resolver
  // has finished looking up a new ID.
  spellIcons: Record<string, string>
  // Boot info from the Electron main process. null in pure-browser dev mode.
  bootInfo: BootInfoState | null
  settingsOpen: boolean
  // Focused series on the DPS/HPS line graph. Survives metric toggles and
  // sub-category tabs; reset by resetGraphFocus when the encounter changes.
  graphFocused: Set<string>
  graphScopeKey: string | null

  // Full-mode filter bar. Perspective flips which units are "sources" vs "targets";
  // filters are AND-composed subsets that narrow the event stream before rendering.
  perspective: Perspective
  filters: FilterState

  // Cache of recently-viewed snapshots keyed by `seg:<id>`, `kr:<id>`,
  // `bs:<id>`. Re-clicks hydrate from here instead of round-tripping the
  // server. See AnySnapshot / cachePut / cacheEvictAggregates above.
  snapshotCache: Map<string, AnySnapshot>

  setSelectedSegment: (s: SegmentSnapshot | null) => void
  setSegmentHistory: (list: HistoryItem[]) => void
  setSelectedSegmentId: (id: string | null) => void  // clears selectedPlayer, key run state, and (when null) selectedSegment
  setSelectedKeyRunId: (id: string | null) => void   // clears segment selection
  setSelectedKeyRun: (s: KeyRunSnapshot | null) => void
  setSelectedBossSectionId: (id: string | null) => void
  setSelectedBossSection: (s: BossSectionSnapshot | null) => void
  setSelectedPlayer: (name: string | null, drillMetric?: AppState['metric']) => void
  setSelectedDeath: (record: PlayerDeathRecord | null) => void
  setMetric: (m: AppState['metric']) => void
  setMode: (m: AppState['mode']) => void
  setWsStatus: (s: AppState['wsStatus']) => void
  setTargetDetail: (d: TargetDetail | null) => void
  setBootInfo: (info: BootInfoState | null) => void
  setSettingsOpen: (open: boolean) => void
  toggleGraphFocus: (key: string) => void
  syncGraphScope: (scopeKey: string | null) => void
  setPerspective: (p: Perspective) => void
  setFilter: (axis: FilterAxis, names: string[] | undefined) => void
  toggleFilterValue: (axis: FilterAxis, name: string) => void
  clearAllFilters: () => void
  refreshBootInfo: () => Promise<void>
}

function mergeIcons(
  prev: Record<string, string>,
  incoming: Record<string, string> | undefined,
): Record<string, string> {
  if (!incoming) return prev
  let next = prev
  for (const [id, name] of Object.entries(incoming)) {
    if (name && prev[id] !== name) {
      if (next === prev) next = { ...prev }
      next[id] = name
    }
  }
  return next
}

// Segment/key-run/boss-section switches drop Source and Target — the name sets
// may no longer make sense in the new scope (e.g. "Commander Venel" doesn't
// exist in a different dungeon). Ability survives because spell names often
// persist across fights; if they don't, they drop silently during aggregation.
function clearUnitFiltersOnScopeChange(filters: FilterState): FilterState {
  if (!filters.Source && !filters.Target) return filters
  if (!filters.Ability) return EMPTY_FILTERS
  return { Ability: filters.Ability }
}

function stringArraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Normalizes to the shared EMPTY_FILTERS sentinel when all axes are empty so
// subscribers comparing by reference don't see a new object for the same
// "no filters" state.
function normalizeFilters(next: FilterState): FilterState {
  return Object.keys(next).length === 0 ? EMPTY_FILTERS : next
}

function mergeSpecs(
  prev: Record<string, number>,
  players: Record<string, PlayerSnapshot> | undefined,
): Record<string, number> {
  if (!players) return prev
  let next = prev
  for (const p of Object.values(players)) {
    if (p.specId !== undefined && prev[p.name] !== p.specId) {
      if (next === prev) next = { ...prev }
      next[p.name] = p.specId
    }
  }
  return next
}

export const useStore = create<AppState>((set) => ({
  selectedSegment: null,
  segmentHistory: [],
  selectedSegmentId: null,
  selectedKeyRunId: null,
  selectedKeyRun: null,
  selectedBossSectionId: null,
  selectedBossSection: null,
  selectedPlayer: null,
  selectedDeath: null,
  metric: 'damage',
  drillMetric: null,
  mode: 'summary',
  wsStatus: 'connecting',
  targetDetail: null,
  playerSpecs: {},
  spellIcons: {},
  bootInfo: null,
  settingsOpen: false,
  graphFocused: new Set([GRAPH_GROUP_AVG_KEY]),
  graphScopeKey: null,
  perspective: 'allies',
  filters: EMPTY_FILTERS,
  snapshotCache: new Map(),

  setSelectedSegment: (s) => set(state => {
    const base = {
      selectedSegment: s,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
    // Only cache completed segments. In-progress pulls (endTime === null) would
    // go stale the moment combat resumes; we'd rather always re-fetch those.
    if (!s || s.endTime === null) return base
    return { ...base, snapshotCache: cachePut(state.snapshotCache, `seg:${s.id}`, s) }
  }),
  setSegmentHistory: (list) => set(state => {
    if (state.segmentHistory === list) return {}
    return {
      segmentHistory: list,
      snapshotCache: cacheEvictAggregates(state.snapshotCache),
    }
  }),
  setSelectedSegmentId: (id) => set(state => {
    // Hydrate from cache if we have it; otherwise clear so the view shows a
    // loading skeleton while the server round-trip is in flight. Re-clicking
    // the same id preserves whatever snapshot is already loaded.
    let nextSegment = state.selectedSegment
    if (id === null) {
      nextSegment = null
    } else if (id !== state.selectedSegmentId) {
      nextSegment = (state.snapshotCache.get(`seg:${id}`) as SegmentSnapshot | undefined) ?? null
    }
    return {
      selectedSegmentId: id,
      selectedSegment: nextSegment,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      selectedKeyRunId: null,
      selectedKeyRun: null,
      selectedBossSectionId: null,
      selectedBossSection: null,
      filters: clearUnitFiltersOnScopeChange(state.filters),
    }
  }),
  setSelectedKeyRunId: (id) => set(state => {
    const cached = id !== null
      ? (state.snapshotCache.get(`kr:${id}`) as KeyRunSnapshot | undefined) ?? null
      : null
    return {
      selectedKeyRunId: id,
      selectedKeyRun: cached,
      selectedSegmentId: null,
      selectedSegment: null,
      selectedBossSectionId: null,
      selectedBossSection: null,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      filters: clearUnitFiltersOnScopeChange(state.filters),
    }
  }),
  setSelectedKeyRun: (s) => set(state => {
    const base = {
      selectedKeyRun: s,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
    if (!s || s.endTime === null) return base
    return { ...base, snapshotCache: cachePut(state.snapshotCache, `kr:${s.keyRunId}`, s) }
  }),
  setSelectedBossSectionId: (id) => set(state => {
    const cached = id !== null
      ? (state.snapshotCache.get(`bs:${id}`) as BossSectionSnapshot | undefined) ?? null
      : null
    return {
      selectedBossSectionId: id,
      selectedBossSection: cached,
      selectedSegmentId: null,
      selectedSegment: null,
      selectedKeyRunId: null,
      selectedKeyRun: null,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      filters: clearUnitFiltersOnScopeChange(state.filters),
    }
  }),
  setSelectedBossSection: (s) => set(state => {
    const base = {
      selectedBossSection: s,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
    if (!s || s.endTime === null) return base
    return { ...base, snapshotCache: cachePut(state.snapshotCache, `bs:${s.bossSectionId}`, s) }
  }),
  setSelectedPlayer: (name, drillMetric) => set(state => ({
    selectedPlayer: name,
    selectedDeath: null,
    drillMetric: name ? (drillMetric ?? state.metric) : null,
  })),
  setSelectedDeath: (record) => set({
    selectedDeath: record,
    selectedPlayer: null,
    drillMetric: record ? 'deaths' : null,
  }),
  // Changing the focused metric keeps the existing drill panel open — the panel
  // shows whatever was clicked (tracked via drillMetric), not whatever is focused.
  setMetric: (m) => set({ metric: m }),
  setMode: (m) => set({ mode: m, selectedPlayer: null, selectedDeath: null, drillMetric: null }),
  setWsStatus: (s) => set({ wsStatus: s }),
  setTargetDetail: (d) => set({ targetDetail: d }),
  setBootInfo: (info) => set({ bootInfo: info }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleGraphFocus: (key) => set(state => {
    const next = new Set(state.graphFocused)
    if (next.has(key)) next.delete(key); else next.add(key)
    return { graphFocused: next }
  }),
  // Called on every render with the current scope key; resets focus only when
  // the parent encounter actually changes (null → non-null transitions, e.g.
  // initial load into a scope, are ignored so the default stays intact).
  syncGraphScope: (scopeKey) => set(state => {
    if (state.graphScopeKey === scopeKey) return {}
    const scopeChanged = state.graphScopeKey !== null && scopeKey !== state.graphScopeKey
    return {
      graphScopeKey: scopeKey,
      ...(scopeChanged ? { graphFocused: new Set([GRAPH_GROUP_AVG_KEY]) } : {}),
    }
  }),
  // Flipping perspective inverts the source/target universes (allies ↔ enemies),
  // so keeping the old Source/Target/Ability names would reference units that
  // no longer exist on the active side. Spec says clear all three.
  setPerspective: (p) => set(state => {
    if (state.perspective === p) return {}
    if (state.filters === EMPTY_FILTERS) return { perspective: p }
    return { perspective: p, filters: EMPTY_FILTERS }
  }),
  setFilter: (axis, names) => set(state => {
    const desired = !names || names.length === 0 ? undefined : names
    const current = state.filters[axis]
    // No-op when already in the requested state. Returning {} keeps the filters
    // reference stable so downstream useMemo deps don't miss.
    if (stringArraysEqual(current, desired)) return {}
    const next: FilterState = { ...state.filters }
    if (desired === undefined) delete next[axis]
    else next[axis] = desired
    return { filters: normalizeFilters(next) }
  }),
  toggleFilterValue: (axis, name) => set(state => {
    const current = state.filters[axis] ?? []
    const idx = current.indexOf(name)
    const nextList = idx === -1 ? [...current, name] : current.filter((_, i) => i !== idx)
    const next: FilterState = { ...state.filters }
    if (nextList.length === 0) delete next[axis]
    else next[axis] = nextList
    return { filters: normalizeFilters(next) }
  }),
  clearAllFilters: () => set(state => (
    state.filters === EMPTY_FILTERS ? {} : { filters: EMPTY_FILTERS }
  )),
  refreshBootInfo: async () => {
    if (!window.api?.getBootInfo) return
    try {
      const info = await window.api.getBootInfo()
      set({ bootInfo: { logsDir: info.settings.logsDir, logsDirExists: info.logsDirExists } })
    } catch {
      // pure-browser dev mode — ignore
    }
  },
}))

export const selectCurrentView = (s: AppState): SegmentSnapshot | KeyRunSnapshot | BossSectionSnapshot | null =>
  s.selectedKeyRun ?? s.selectedBossSection ?? s.selectedSegment

// Seconds to add to x-axis time labels on the line graph so M+ segments show
// their position within the dungeon run ("20:00 – 23:00") instead of restarting
// at 0:00. Only applies when the current segment sits inside a key run; raid
// boss-section pulls and standalone segments return 0.
export const selectGraphTimeOffset = (s: AppState): number => {
  const seg = s.selectedSegment
  const segId = s.selectedSegmentId
  if (!seg || !segId) return 0
  for (const item of s.segmentHistory) {
    if (item.type === 'key_run' && item.segments.some(x => x.id === segId)) {
      return (seg.startTime - item.startTime) / 1000
    }
  }
  return 0
}

// Stable id for the current "dungeon/encounter" scope. Navigating between segments
// within the same key run or boss section returns the same key; switching to a
// different run/encounter returns a new one. Used by views that should persist
// UI state across sub-category tabs but reset across top-level tabs.
export const selectCurrentScopeKey = (s: AppState): string | null => {
  if (s.selectedKeyRunId) return `kr:${s.selectedKeyRunId}`
  if (s.selectedBossSectionId) return `bs:${s.selectedBossSectionId}`
  if (s.selectedSegmentId) {
    for (const item of s.segmentHistory) {
      if (item.type === 'key_run' && item.segments.some(seg => seg.id === s.selectedSegmentId)) {
        return `kr:${item.keyRunId}`
      }
      if (item.type === 'boss_section' && item.segments.some(seg => seg.id === s.selectedSegmentId)) {
        return `bs:${item.bossSectionId}`
      }
    }
    return `seg:${s.selectedSegmentId}`
  }
  return null
}

// Resolve a player's spec via the cross-segment cache, falling back to whatever the
// current view's player record happens to carry. Use this everywhere a class color is rendered.
export function resolveSpecId(
  playerSpecs: Record<string, number>,
  name: string,
  fallback?: number,
): number | undefined {
  return playerSpecs[name] ?? fallback
}

// Kept for components that only care about individual segment data (e.g. target drill-down)
export const selectCurrentSegment = (s: AppState): SegmentSnapshot | null =>
  s.selectedSegment

// True when the user has selected a scope but its snapshot has not yet arrived
// from the server. Views use this to render a loading skeleton instead of
// either stale data or the empty "no encounter" state.
export const selectIsLoading = (s: AppState): boolean =>
  !!(s.selectedSegmentId && !s.selectedSegment) ||
  !!(s.selectedKeyRunId && !s.selectedKeyRun) ||
  !!(s.selectedBossSectionId && !s.selectedBossSection)
