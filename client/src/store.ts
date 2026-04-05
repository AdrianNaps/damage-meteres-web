import { create } from 'zustand'
import type { SegmentSnapshot, KeyRunSnapshot, HistoryItem, TargetDetail, PlayerDeathRecord } from './types'

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

  setLiveSegment: (s) => set({ liveSegment: s }),
  setSelectedSegment: (s) => set({ selectedSegment: s }),
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
  setSelectedKeyRun: (s) => set({ selectedKeyRun: s }),
  setSelectedPlayer: (name) => set({ selectedPlayer: name }),
  setSelectedDeath: (record) => set({ selectedDeath: record }),
  setMetric: (m) => set({ metric: m, selectedPlayer: null, selectedDeath: null }),
  setWsStatus: (s) => set({ wsStatus: s }),
  setTargetDetail: (d) => set({ targetDetail: d }),
}))

export const selectCurrentView = (s: AppState): SegmentSnapshot | KeyRunSnapshot | null =>
  s.selectedKeyRun ?? (s.selectedSegmentId === null ? s.liveSegment : s.selectedSegment)

// Kept for components that only care about individual segment data (e.g. target drill-down)
export const selectCurrentSegment = (s: AppState): SegmentSnapshot | null =>
  s.selectedSegmentId === null ? s.liveSegment : s.selectedSegment
