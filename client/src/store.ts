import { create } from 'zustand'
import type { SegmentSnapshot, SegmentSummary } from './types'

interface AppState {
  liveSegment: SegmentSnapshot | null
  selectedSegment: SegmentSnapshot | null
  segmentHistory: SegmentSummary[]
  selectedSegmentId: string | null  // null = live
  selectedPlayer: string | null
  metric: 'damage' | 'healing'
  wsStatus: 'connecting' | 'connected' | 'disconnected'

  setLiveSegment: (s: SegmentSnapshot) => void
  setSelectedSegment: (s: SegmentSnapshot | null) => void
  setSegmentHistory: (list: SegmentSummary[]) => void
  setSelectedSegmentId: (id: string | null) => void
  setSelectedPlayer: (name: string | null) => void
  setMetric: (m: 'damage' | 'healing') => void
  setWsStatus: (s: AppState['wsStatus']) => void
}

export const useStore = create<AppState>((set) => ({
  liveSegment: null,
  selectedSegment: null,
  segmentHistory: [],
  selectedSegmentId: null,
  selectedPlayer: null,
  metric: 'damage',
  wsStatus: 'connecting',

  setLiveSegment: (s) => set({ liveSegment: s }),
  setSelectedSegment: (s) => set({ selectedSegment: s }),
  setSegmentHistory: (list) => set({ segmentHistory: list }),
  setSelectedSegmentId: (id) => set({ selectedSegmentId: id, selectedPlayer: null }),
  setSelectedPlayer: (name) => set({ selectedPlayer: name }),
  setMetric: (m) => set({ metric: m }),
  setWsStatus: (s) => set({ wsStatus: s }),
}))
