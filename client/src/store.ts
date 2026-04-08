import { create } from 'zustand'
import type { SegmentSnapshot, KeyRunSnapshot, HistoryItem, TargetDetail, PlayerDeathRecord, PlayerSnapshot } from './types'

export interface BootInfoState {
  logsDir: string
  logsDirExists: boolean
}

interface AppState {
  liveSegment: SegmentSnapshot | null
  selectedSegment: SegmentSnapshot | null
  segmentHistory: HistoryItem[]
  selectedSegmentId: string | null   // null = live
  selectedKeyRunId: string | null    // which key run header is selected
  selectedKeyRun: KeyRunSnapshot | null
  selectedPlayer: string | null
  selectedDeath: PlayerDeathRecord | null
  metric: 'damage' | 'healing' | 'deaths'
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

  setLiveSegment: (s: SegmentSnapshot) => void
  setSelectedSegment: (s: SegmentSnapshot | null) => void
  setSegmentHistory: (list: HistoryItem[]) => void
  setSelectedSegmentId: (id: string | null) => void  // clears selectedPlayer, key run state, and (when null) selectedSegment
  setSelectedKeyRunId: (id: string | null) => void   // clears segment selection
  setSelectedKeyRun: (s: KeyRunSnapshot | null) => void
  setSelectedPlayer: (name: string | null) => void
  setSelectedDeath: (record: PlayerDeathRecord | null) => void
  setMetric: (m: AppState['metric']) => void
  setWsStatus: (s: AppState['wsStatus']) => void
  setTargetDetail: (d: TargetDetail | null) => void
  setBootInfo: (info: BootInfoState | null) => void
  setSettingsOpen: (open: boolean) => void
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
  liveSegment: null,
  selectedSegment: null,
  segmentHistory: [],
  selectedSegmentId: null,
  selectedKeyRunId: null,
  selectedKeyRun: null,
  selectedPlayer: null,
  selectedDeath: null,
  metric: 'damage',
  wsStatus: 'connecting',
  targetDetail: null,
  playerSpecs: {},
  spellIcons: {},
  bootInfo: null,
  settingsOpen: false,

  setLiveSegment: (s) => set(state => ({
    liveSegment: s,
    playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
    spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
  })),
  setSelectedSegment: (s) => set(state => ({
    selectedSegment: s,
    playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
    spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
  })),
  setSegmentHistory: (list) => set({ segmentHistory: list }),
  setSelectedSegmentId: (id) => set({
    selectedSegmentId: id,
    selectedPlayer: null,
    selectedDeath: null,
    selectedKeyRunId: null,
    selectedKeyRun: null,
    ...(id === null ? { selectedSegment: null } : {}),
  }),
  setSelectedKeyRunId: (id) => set({
    selectedKeyRunId: id,
    selectedKeyRun: null,
    selectedSegmentId: null,
    selectedSegment: null,
    selectedPlayer: null,
    selectedDeath: null,
  }),
  setSelectedKeyRun: (s) => set(state => ({
    selectedKeyRun: s,
    playerSpecs: mergeSpecs(state.playerSpecs, s?.players),
    spellIcons: mergeIcons(state.spellIcons, s?.spellIcons),
  })),
  setSelectedPlayer: (name) => set({ selectedPlayer: name }),
  setSelectedDeath: (record) => set({ selectedDeath: record }),
  setMetric: (m) => set({ metric: m, selectedPlayer: null, selectedDeath: null }),
  setWsStatus: (s) => set({ wsStatus: s }),
  setTargetDetail: (d) => set({ targetDetail: d }),
  setBootInfo: (info) => set({ bootInfo: info }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}))

export const selectCurrentView = (s: AppState): SegmentSnapshot | KeyRunSnapshot | null =>
  s.selectedKeyRun ?? (s.selectedSegmentId === null ? s.liveSegment : s.selectedSegment)

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
  s.selectedSegmentId === null ? s.liveSegment : s.selectedSegment
