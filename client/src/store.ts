import { create } from 'zustand'
import type { SegmentSnapshot, SegmentSummary } from './types'

interface AppState {
  currentSegment: SegmentSnapshot | null
  segmentHistory: SegmentSummary[]
  selectedSegmentId: string | null  // null = live current
  selectedPlayer: string | null
  metric: 'damage' | 'healing'
  wsStatus: 'connecting' | 'connected' | 'disconnected'

  setCurrentSegment: (s: SegmentSnapshot) => void
  setSegmentHistory: (list: SegmentSummary[]) => void
  setSelectedSegment: (id: string | null) => void
  setSelectedPlayer: (name: string | null) => void
  setMetric: (m: 'damage' | 'healing') => void
  setWsStatus: (s: AppState['wsStatus']) => void
}

export const useStore = create<AppState>((set) => ({
  currentSegment: null,
  segmentHistory: [],
  selectedSegmentId: null,
  selectedPlayer: null,
  metric: 'damage',
  wsStatus: 'connecting',

  setCurrentSegment: (s) => set({ currentSegment: s }),
  setSegmentHistory: (list) => set({ segmentHistory: list }),
  setSelectedSegment: (id) => set({ selectedSegmentId: id, selectedPlayer: null }),
  setSelectedPlayer: (name) => set({ selectedPlayer: name }),
  setMetric: (m) => set({ metric: m }),
  setWsStatus: (s) => set({ wsStatus: s }),
}))
