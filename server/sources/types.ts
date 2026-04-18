import type { EventEmitter } from 'events'
import type { SegmentStore } from '../store.js'
import type { EncounterStateMachine } from '../stateMachine.js'

export type SourceKind = 'live' | 'archive'

export interface LiveStatus {
  writingNow: boolean
  lastWriteAt: number | null
}

// A LogSource owns a single feed of parsed combat events into its own store
// and state machine. The WS layer routes per-sourceId requests through the
// registry, so the same downstream surface (store + machine) serves both live
// tailing and one-shot archive ingestion. Implementations extend EventEmitter;
// live sources emit 'live_status' (LiveStatus) and 'file_switched' (string).
export interface LogSource extends EventEmitter {
  readonly id: string
  readonly kind: SourceKind
  readonly store: SegmentStore
  readonly machine: EncounterStateMachine
  dispose(): void
}
