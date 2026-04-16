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
export type SourceKind = 'live' | 'archive'

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

// Per-source slice. One of these exists per LogSource on the server. Each tab
// in the future SourceSwitcher swaps which slice is "active" — components
// continue to read flat top-level fields, which mirror the active slice.
export interface SourceState {
  segmentHistory: HistoryItem[]
  selectedSegment: SegmentSnapshot | null
  selectedSegmentId: string | null
  selectedKeyRunId: string | null
  selectedKeyRun: KeyRunSnapshot | null
  selectedBossSectionId: string | null
  selectedBossSection: BossSectionSnapshot | null
  selectedPlayer: string | null
  selectedDeath: PlayerDeathRecord | null
  metric: Metric
  drillMetric: Metric | null
  mode: Mode
  targetDetail: TargetDetail | null
  graphFocused: Set<string>
  graphScopeKey: string | null
  perspective: Perspective
  filters: FilterState
  snapshotCache: Map<string, AnySnapshot>
}

// Per-source metadata, pushed by the server. Distinct from SourceState because
// the server owns this — it's not driven by user interactions.
export interface SourceMeta {
  sourceId: string
  kind: SourceKind
  label: string
  filePath: string | null
  liveStatus?: { writingNow: boolean; lastWriteAt: number | null }
  loadProgress?: { bytesRead: number; totalBytes: number; linesProcessed: number }
  loaded?: boolean   // archives flip true once the server emits 'ready'
}

export const LIVE_SOURCE_ID = 'live'

function makeEmptySourceState(): SourceState {
  return {
    segmentHistory: [],
    selectedSegment: null,
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
    targetDetail: null,
    graphFocused: new Set([GRAPH_GROUP_AVG_KEY]),
    graphScopeKey: null,
    perspective: 'allies',
    filters: EMPTY_FILTERS,
    snapshotCache: new Map(),
  }
}

interface AppState {
  // Per-source storage. Each slice belongs to a server-side LogSource.
  sources: Map<string, SourceState>
  sourceMetas: Map<string, SourceMeta>
  activeSourceId: string

  // Flat mirror of the active source's slice. Components read these directly
  // without knowing about per-source storage. Kept in sync by every setter
  // (when the touched sourceId is the active one) and by setActiveSource.
  selectedSegment: SegmentSnapshot | null
  segmentHistory: HistoryItem[]
  selectedSegmentId: string | null
  selectedKeyRunId: string | null
  selectedKeyRun: KeyRunSnapshot | null
  selectedBossSectionId: string | null
  selectedBossSection: BossSectionSnapshot | null
  selectedPlayer: string | null
  selectedDeath: PlayerDeathRecord | null
  metric: Metric
  drillMetric: Metric | null
  mode: Mode
  targetDetail: TargetDetail | null
  graphFocused: Set<string>
  graphScopeKey: string | null
  perspective: Perspective
  filters: FilterState

  // Truly cross-source state (no per-source mirror needed).
  // Player specs and spell icons accumulate globally across every source we've
  // seen — the same player/spell observed in archive A and archive B keeps
  // its resolution.
  playerSpecs: Record<string, number>
  spellIcons: Record<string, string>
  wsStatus: 'connecting' | 'connected' | 'disconnected'
  bootInfo: BootInfoState | null
  settingsOpen: boolean
  logPickerOpen: boolean

  // Per-source-state setters. sourceId defaults to activeSourceId so existing
  // call sites (component clicks) keep working unchanged. WS message handlers
  // pass an explicit sourceId so updates land in the right slice even when the
  // user is viewing a different one.
  setSelectedSegment: (s: SegmentSnapshot | null, sourceId?: string) => void
  setSegmentHistory: (list: HistoryItem[], sourceId?: string) => void
  setSelectedSegmentId: (id: string | null, sourceId?: string) => void
  setSelectedKeyRunId: (id: string | null, sourceId?: string) => void
  setSelectedKeyRun: (s: KeyRunSnapshot | null, sourceId?: string) => void
  setSelectedBossSectionId: (id: string | null, sourceId?: string) => void
  setSelectedBossSection: (s: BossSectionSnapshot | null, sourceId?: string) => void
  setSelectedPlayer: (name: string | null, drillMetric?: Metric) => void
  setSelectedDeath: (record: PlayerDeathRecord | null) => void
  setMetric: (m: Metric) => void
  setMode: (m: Mode) => void
  setTargetDetail: (d: TargetDetail | null) => void
  toggleGraphFocus: (key: string) => void
  syncGraphScope: (scopeKey: string | null) => void
  setPerspective: (p: Perspective) => void
  setFilter: (axis: FilterAxis, names: string[] | undefined) => void
  toggleFilterValue: (axis: FilterAxis, name: string) => void
  clearAllFilters: () => void

  // Truly global setters.
  setWsStatus: (s: AppState['wsStatus']) => void
  setBootInfo: (info: BootInfoState | null) => void
  setSettingsOpen: (open: boolean) => void
  setLogPickerOpen: (open: boolean) => void
  refreshBootInfo: () => Promise<void>

  // Source registry actions.
  setActiveSource: (sourceId: string) => void
  addSource: (meta: SourceMeta) => void
  removeSource: (sourceId: string) => void
  updateSourceMeta: (sourceId: string, partial: Partial<SourceMeta>) => void
}

// Project the slice's encounter-state fields onto the flat top-level shape.
// The flat field names match the slice field names exactly, so the mirroring
// is straightforward — any field that lives both in SourceState and AppState
// gets copied here.
function flatFromSlice(slice: SourceState): Partial<AppState> {
  return {
    selectedSegment: slice.selectedSegment,
    segmentHistory: slice.segmentHistory,
    selectedSegmentId: slice.selectedSegmentId,
    selectedKeyRunId: slice.selectedKeyRunId,
    selectedKeyRun: slice.selectedKeyRun,
    selectedBossSectionId: slice.selectedBossSectionId,
    selectedBossSection: slice.selectedBossSection,
    selectedPlayer: slice.selectedPlayer,
    selectedDeath: slice.selectedDeath,
    metric: slice.metric,
    drillMetric: slice.drillMetric,
    mode: slice.mode,
    targetDetail: slice.targetDetail,
    graphFocused: slice.graphFocused,
    graphScopeKey: slice.graphScopeKey,
    perspective: slice.perspective,
    filters: slice.filters,
  }
}

// Apply a partial slice update for a sourceId and (when that sourceId is the
// active source) mirror those same fields to the flat top-level state. The
// flat field names match SourceState field names by design, so we can spread
// `patch` straight into the returned partial.
function applySliceUpdate(
  state: AppState,
  sourceId: string,
  patch: Partial<SourceState>,
): Partial<AppState> {
  const current = state.sources.get(sourceId) ?? makeEmptySourceState()
  const nextSlice: SourceState = { ...current, ...patch }
  const sources = new Map(state.sources)
  sources.set(sourceId, nextSlice)
  if (sourceId === state.activeSourceId) {
    return { sources, ...flatFromSlice(nextSlice) }
  }
  return { sources }
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

// Initial source map seed: a single 'live' slice. The actual SourceMeta for
// 'live' is added by the WS layer once the server's `sources` frame lands —
// meaning the initial UI render before WS connect has slice data but no meta,
// which is fine because the source switcher (PR 5) reads sourceMetas only.
const initialSources = new Map<string, SourceState>([
  [LIVE_SOURCE_ID, makeEmptySourceState()],
])

export const useStore = create<AppState>((set) => ({
  sources: initialSources,
  sourceMetas: new Map(),
  activeSourceId: LIVE_SOURCE_ID,

  // Initial flat state mirrors the empty live slice. Defaults match the
  // pre-multi-source store exactly so first render is unchanged.
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
  targetDetail: null,
  graphFocused: new Set([GRAPH_GROUP_AVG_KEY]),
  graphScopeKey: null,
  perspective: 'allies',
  filters: EMPTY_FILTERS,

  playerSpecs: {},
  spellIcons: {},
  wsStatus: 'connecting',
  bootInfo: null,
  settingsOpen: false,
  logPickerOpen: false,

  setSelectedSegment: (s, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    // Only cache completed segments. In-progress pulls (endTime === null) would
    // go stale the moment combat resumes; we'd rather always re-fetch those.
    const nextCache = (s && s.endTime !== null)
      ? cachePut(slice.snapshotCache, `seg:${s.id}`, s)
      : slice.snapshotCache
    const sliceUpdate: Partial<SourceState> = {
      selectedSegment: s,
      snapshotCache: nextCache,
    }
    const out = applySliceUpdate(state, sid, sliceUpdate)
    // Specs and icons accumulate globally — independent of which source.
    return {
      ...out,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
  }),

  setSegmentHistory: (list, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    if (slice.segmentHistory === list) return {}
    return applySliceUpdate(state, sid, {
      segmentHistory: list,
      snapshotCache: cacheEvictAggregates(slice.snapshotCache),
    })
  }),

  setSelectedSegmentId: (id, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    // Hydrate from cache if we have it; otherwise clear so the view shows a
    // loading skeleton while the server round-trip is in flight. Re-clicking
    // the same id preserves whatever snapshot is already loaded.
    let nextSegment = slice.selectedSegment
    if (id === null) {
      nextSegment = null
    } else if (id !== slice.selectedSegmentId) {
      nextSegment = (slice.snapshotCache.get(`seg:${id}`) as SegmentSnapshot | undefined) ?? null
    }
    return applySliceUpdate(state, sid, {
      selectedSegmentId: id,
      selectedSegment: nextSegment,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      selectedKeyRunId: null,
      selectedKeyRun: null,
      selectedBossSectionId: null,
      selectedBossSection: null,
      filters: clearUnitFiltersOnScopeChange(slice.filters),
    })
  }),

  setSelectedKeyRunId: (id, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const cached = id !== null
      ? (slice.snapshotCache.get(`kr:${id}`) as KeyRunSnapshot | undefined) ?? null
      : null
    return applySliceUpdate(state, sid, {
      selectedKeyRunId: id,
      selectedKeyRun: cached,
      selectedSegmentId: null,
      selectedSegment: null,
      selectedBossSectionId: null,
      selectedBossSection: null,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      filters: clearUnitFiltersOnScopeChange(slice.filters),
    })
  }),

  setSelectedKeyRun: (s, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const nextCache = (s && s.endTime !== null)
      ? cachePut(slice.snapshotCache, `kr:${s.keyRunId}`, s)
      : slice.snapshotCache
    const out = applySliceUpdate(state, sid, {
      selectedKeyRun: s,
      snapshotCache: nextCache,
    })
    return {
      ...out,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
  }),

  setSelectedBossSectionId: (id, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const cached = id !== null
      ? (slice.snapshotCache.get(`bs:${id}`) as BossSectionSnapshot | undefined) ?? null
      : null
    return applySliceUpdate(state, sid, {
      selectedBossSectionId: id,
      selectedBossSection: cached,
      selectedSegmentId: null,
      selectedSegment: null,
      selectedKeyRunId: null,
      selectedKeyRun: null,
      selectedPlayer: null,
      selectedDeath: null,
      drillMetric: null,
      filters: clearUnitFiltersOnScopeChange(slice.filters),
    })
  }),

  setSelectedBossSection: (s, sourceId) => set(state => {
    const sid = sourceId ?? state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const nextCache = (s && s.endTime !== null)
      ? cachePut(slice.snapshotCache, `bs:${s.bossSectionId}`, s)
      : slice.snapshotCache
    const out = applySliceUpdate(state, sid, {
      selectedBossSection: s,
      snapshotCache: nextCache,
    })
    return {
      ...out,
      playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
      spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
    }
  }),

  setSelectedPlayer: (name, drillMetric) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    return applySliceUpdate(state, sid, {
      selectedPlayer: name,
      selectedDeath: null,
      drillMetric: name ? (drillMetric ?? slice.metric) : null,
    })
  }),

  setSelectedDeath: (record) => set(state => applySliceUpdate(state, state.activeSourceId, {
    selectedDeath: record,
    selectedPlayer: null,
    drillMetric: record ? 'deaths' : null,
  })),

  // Changing the focused metric keeps the existing drill panel open — the panel
  // shows whatever was clicked (tracked via drillMetric), not whatever is focused.
  setMetric: (m) => set(state => applySliceUpdate(state, state.activeSourceId, { metric: m })),

  setMode: (m) => set(state => applySliceUpdate(state, state.activeSourceId, {
    mode: m,
    selectedPlayer: null,
    selectedDeath: null,
    drillMetric: null,
  })),

  setTargetDetail: (d) => set(state => applySliceUpdate(state, state.activeSourceId, { targetDetail: d })),

  toggleGraphFocus: (key) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const next = new Set(slice.graphFocused)
    if (next.has(key)) next.delete(key); else next.add(key)
    return applySliceUpdate(state, sid, { graphFocused: next })
  }),

  // Called on every render with the current scope key; resets focus only when
  // the parent encounter actually changes (null → non-null transitions, e.g.
  // initial load into a scope, are ignored so the default stays intact).
  syncGraphScope: (scopeKey) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    if (slice.graphScopeKey === scopeKey) return {}
    const scopeChanged = slice.graphScopeKey !== null && scopeKey !== slice.graphScopeKey
    return applySliceUpdate(state, sid, {
      graphScopeKey: scopeKey,
      ...(scopeChanged ? { graphFocused: new Set([GRAPH_GROUP_AVG_KEY]) } : {}),
    })
  }),

  // Flipping perspective inverts the source/target universes (allies ↔ enemies),
  // so keeping the old Source/Target/Ability names would reference units that
  // no longer exist on the active side. Spec says clear all three.
  setPerspective: (p) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    if (slice.perspective === p) return {}
    if (slice.filters === EMPTY_FILTERS) {
      return applySliceUpdate(state, sid, { perspective: p })
    }
    return applySliceUpdate(state, sid, { perspective: p, filters: EMPTY_FILTERS })
  }),

  setFilter: (axis, names) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const desired = !names || names.length === 0 ? undefined : names
    const current = slice.filters[axis]
    // No-op when already in the requested state. Returning {} keeps the filters
    // reference stable so downstream useMemo deps don't miss.
    if (stringArraysEqual(current, desired)) return {}
    const next: FilterState = { ...slice.filters }
    if (desired === undefined) delete next[axis]
    else next[axis] = desired
    return applySliceUpdate(state, sid, { filters: normalizeFilters(next) })
  }),

  toggleFilterValue: (axis, name) => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    const current = slice.filters[axis] ?? []
    const idx = current.indexOf(name)
    const nextList = idx === -1 ? [...current, name] : current.filter((_, i) => i !== idx)
    const next: FilterState = { ...slice.filters }
    if (nextList.length === 0) delete next[axis]
    else next[axis] = nextList
    return applySliceUpdate(state, sid, { filters: normalizeFilters(next) })
  }),

  clearAllFilters: () => set(state => {
    const sid = state.activeSourceId
    const slice = state.sources.get(sid) ?? makeEmptySourceState()
    if (slice.filters === EMPTY_FILTERS) return {}
    return applySliceUpdate(state, sid, { filters: EMPTY_FILTERS })
  }),

  setWsStatus: (s) => set({ wsStatus: s }),
  setBootInfo: (info) => set({ bootInfo: info }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLogPickerOpen: (open) => set({ logPickerOpen: open }),

  setActiveSource: (sourceId) => set(state => {
    if (sourceId === state.activeSourceId) return {}
    const slice = state.sources.get(sourceId)
    if (!slice) return {}
    // Hydrate flat fields from the new slice so components see the new
    // source's encounter state.
    return { activeSourceId: sourceId, ...flatFromSlice(slice) }
  }),

  addSource: (meta) => set(state => {
    const sourceMetas = new Map(state.sourceMetas)
    sourceMetas.set(meta.sourceId, meta)
    let sources = state.sources
    if (!sources.has(meta.sourceId)) {
      sources = new Map(sources)
      sources.set(meta.sourceId, makeEmptySourceState())
    }
    return { sourceMetas, sources }
  }),

  removeSource: (sourceId) => set(state => {
    if (sourceId === LIVE_SOURCE_ID) return {}   // live can't be removed
    const sourceMetas = new Map(state.sourceMetas)
    sourceMetas.delete(sourceId)
    const sources = new Map(state.sources)
    sources.delete(sourceId)
    // If the removed source was active, fall back to live and re-mirror.
    if (sourceId === state.activeSourceId) {
      const liveSlice = sources.get(LIVE_SOURCE_ID) ?? makeEmptySourceState()
      return {
        sources, sourceMetas,
        activeSourceId: LIVE_SOURCE_ID,
        ...flatFromSlice(liveSlice),
      }
    }
    return { sources, sourceMetas }
  }),

  updateSourceMeta: (sourceId, partial) => set(state => {
    const existing = state.sourceMetas.get(sourceId)
    if (!existing) return {}
    const sourceMetas = new Map(state.sourceMetas)
    sourceMetas.set(sourceId, { ...existing, ...partial })
    return { sourceMetas }
  }),

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

// Convenience hook for code that explicitly wants the active source's slice
// (e.g. the future SourceSwitcher's per-source previews). Most components keep
// reading flat fields and don't need this.
export function useActiveSource(): SourceState | undefined {
  return useStore(s => s.sources.get(s.activeSourceId))
}

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
//
// Includes the activeSourceId so switching tabs (e.g. live → archive) is treated
// as a scope change for graph-focus reset purposes.
export const selectCurrentScopeKey = (s: AppState): string | null => {
  const prefix = `src:${s.activeSourceId}:`
  if (s.selectedKeyRunId) return `${prefix}kr:${s.selectedKeyRunId}`
  if (s.selectedBossSectionId) return `${prefix}bs:${s.selectedBossSectionId}`
  if (s.selectedSegmentId) {
    for (const item of s.segmentHistory) {
      if (item.type === 'key_run' && item.segments.some(seg => seg.id === s.selectedSegmentId)) {
        return `${prefix}kr:${item.keyRunId}`
      }
      if (item.type === 'boss_section' && item.segments.some(seg => seg.id === s.selectedSegmentId)) {
        return `${prefix}bs:${item.bossSectionId}`
      }
    }
    return `${prefix}seg:${s.selectedSegmentId}`
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
