import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ParsedEvent, EncounterPayload, ChallengeModePayload } from './types.js'
import { SegmentStore, type Segment } from './store.js'
import { applyEvent } from './aggregator.js'

type Mode = 'idle' | 'in_key' | 'in_boss'

export class EncounterStateMachine extends EventEmitter {
  private store: SegmentStore
  private mode: Mode = 'idle'
  private keySegment: Segment | null = null  // current key's trash segment
  currentSegment: Segment | null = null      // segment receiving events right now

  constructor(store: SegmentStore) {
    super()
    this.store = store
  }

  handle(event: ParsedEvent) {
    switch (event.type) {
      case 'CHALLENGE_MODE_START': {
        if (this.mode !== 'idle') break
        const p = event.payload as ChallengeModePayload
        const segment = this._makeSegment(`${p.dungeonName} — Trash`, event.timestamp)
        this.store.push(segment)
        this.keySegment = segment
        this.currentSegment = segment
        this.mode = 'in_key'
        console.log(`[key] START — ${p.dungeonName} +${p.keystoneLevel}`)
        this.emit('challenge_start', segment)
        break
      }

      case 'CHALLENGE_MODE_END': {
        if (this.mode === 'idle') break  // orphaned END from a previous aborted key — ignore
        const p = event.payload as ChallengeModePayload
        if (this.keySegment) {
          this.keySegment.endTime = event.timestamp
          this.keySegment.success = p.success ?? false
          console.log(`[key] END (${p.success ? 'timed' : 'depleted'}, ${((p.durationMs ?? 0) / 60000).toFixed(1)}m)`)
          this.emit('challenge_end', this.keySegment)
        }
        this.keySegment = null
        this.currentSegment = null
        this.mode = 'idle'
        break
      }

      case 'ENCOUNTER_START': {
        if (this.mode === 'in_boss') break  // shouldn't happen, but guard against nested events
        const p = event.payload as EncounterPayload
        const segment = this._makeSegment(p.encounterName, event.timestamp)
        // Carry over spec info gathered from COMBATANT_INFO during trash
        if (this.keySegment) {
          segment.guidToSpec = { ...this.keySegment.guidToSpec }
          segment.guidToName = { ...this.keySegment.guidToName }
        }
        this.store.push(segment)
        this.currentSegment = segment
        this.mode = 'in_boss'
        console.log(`[boss] START — ${p.encounterName}`)
        this.emit('encounter_start', segment)
        break
      }

      case 'ENCOUNTER_END': {
        if (this.mode !== 'in_boss') break
        const p = event.payload as EncounterPayload
        if (this.currentSegment) {
          this.currentSegment.endTime = event.timestamp
          this.currentSegment.success = p.success ?? false
          console.log(`[boss] END — ${this.currentSegment.encounterName} (${p.success ? 'kill' : 'wipe'})`)
          this.emit('encounter_end', this.currentSegment)
        }
        // Return to key trash if we're in a key, otherwise go idle (standalone raid boss)
        if (this.keySegment) {
          this.currentSegment = this.keySegment
          this.mode = 'in_key'
        } else {
          this.currentSegment = null
          this.mode = 'idle'
        }
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

  private _makeSegment(name: string, startTime: number): Segment {
    return {
      id: randomUUID(),
      encounterName: name,
      startTime,
      endTime: null,
      firstEventTime: null,
      lastEventTime: null,
      success: null,
      players: {},
      guidToSpec: {},
      guidToName: {},
    }
  }
}
