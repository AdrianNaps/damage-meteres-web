import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ParsedEvent, EncounterPayload } from './types.js'
import { SegmentStore, type Segment } from './store.js'
import { applyEvent } from './aggregator.js'

export class EncounterStateMachine extends EventEmitter {
  private store: SegmentStore
  currentSegment: Segment | null = null

  constructor(store: SegmentStore) {
    super()
    this.store = store
    this._openSession()
  }

  private _openSession() {
    const segment: Segment = {
      id: 'open',
      encounterName: 'Open World / Trash',
      startTime: Date.now(),
      endTime: null,
      firstEventTime: null,
      lastEventTime: null,
      success: null,
      players: {},
    }
    this.store.push(segment)
    this.currentSegment = segment
  }

  handle(event: ParsedEvent) {
    switch (event.type) {
      case 'ENCOUNTER_START': {
        const p = event.payload as EncounterPayload
        const segment: Segment = {
          id: randomUUID(),
          encounterName: p.encounterName,
          startTime: event.timestamp,
          endTime: null,
          firstEventTime: null,
          lastEventTime: null,
          success: null,
          players: {},
        }
        this.store.push(segment)
        this.currentSegment = segment
        console.log(`[encounter] START — ${p.encounterName}`)
        this.emit('encounter_start', segment)
        break
      }

      case 'ENCOUNTER_END': {
        if (!this.currentSegment) break
        const p = event.payload as EncounterPayload
        this.currentSegment.endTime = event.timestamp
        this.currentSegment.success = p.success ?? false
        console.log(`[encounter] END — ${this.currentSegment.encounterName} (${p.success ? 'kill' : 'wipe'})`)
        this.emit('encounter_end', this.currentSegment)
        this._openSession() // resume capturing trash after the encounter
        break
      }

      default: {
        if (this.currentSegment) {
          applyEvent(this.currentSegment, event)
        }
        break
      }
    }
  }
}
