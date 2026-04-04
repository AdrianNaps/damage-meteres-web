import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ParsedEvent, EncounterPayload, ChallengeModePayload } from './types.js'
import { SegmentStore, type Segment } from './store.js'
import { applyEvent } from './aggregator.js'

type Mode = 'idle' | 'in_key' | 'in_boss'

export class EncounterStateMachine extends EventEmitter {
  private store: SegmentStore
  private mode: Mode = 'idle'
  private activeTrashSegment: Segment | null = null  // trash segment currently receiving events
  private dungeonName: string | null = null
  private trashCount = 0
  currentSegment: Segment | null = null              // segment receiving events right now

  constructor(store: SegmentStore) {
    super()
    this.store = store
  }

  handle(event: ParsedEvent) {
    switch (event.type) {
      case 'CHALLENGE_MODE_START': {
        if (this.mode !== 'idle') break
        const p = event.payload as ChallengeModePayload
        this.dungeonName = p.dungeonName ?? null
        this.trashCount = 1
        const segment = this._makeSegment(`${p.dungeonName} — Trash 1`, event.timestamp)
        this.store.push(segment)
        this.activeTrashSegment = segment
        this.currentSegment = segment
        this.mode = 'in_key'
        console.log(`[key] START — ${p.dungeonName} +${p.keystoneLevel}`)
        this.emit('challenge_start', segment)
        break
      }

      case 'CHALLENGE_MODE_END': {
        if (this.mode === 'idle') break  // orphaned END from a previous aborted key — ignore
        const p = event.payload as ChallengeModePayload
        // Key ended mid-boss (timer expired or force-restart) — close the boss segment first
        if (this.mode === 'in_boss' && this.currentSegment) {
          this.currentSegment.endTime = event.timestamp
          this.currentSegment.success = false
          this.emit('encounter_end', this.currentSegment)
        }
        if (this.activeTrashSegment) {
          this.activeTrashSegment.endTime = event.timestamp
          this.activeTrashSegment.success = p.success ?? false
          console.log(`[key] END (${p.success ? 'timed' : 'depleted'}, ${((p.durationMs ?? 0) / 60000).toFixed(1)}m)`)
          // Emits the last (most recent) trash segment for the key, not the original Trash 1
          this.emit('challenge_end', this.activeTrashSegment)
        }
        this.activeTrashSegment = null
        this.dungeonName = null
        this.trashCount = 0
        this.currentSegment = null
        this.mode = 'idle'
        break
      }

      case 'ENCOUNTER_START': {
        if (this.mode === 'in_boss') break  // shouldn't happen, but guard against nested events
        const p = event.payload as EncounterPayload
        const segment = this._makeSegment(p.encounterName, event.timestamp)
        // Carry over spec info gathered from COMBATANT_INFO during trash
        if (this.activeTrashSegment) {
          segment.guidToSpec = { ...this.activeTrashSegment.guidToSpec }
          segment.guidToName = { ...this.activeTrashSegment.guidToName }
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
        if (this.dungeonName) {
          this.trashCount++
          const trashSegment = this._makeSegment(`${this.dungeonName} — Trash ${this.trashCount}`, event.timestamp)
          // Carry over spec/name info accumulated so far
          if (this.currentSegment) {
            trashSegment.guidToSpec = { ...this.currentSegment.guidToSpec }
            trashSegment.guidToName = { ...this.currentSegment.guidToName }
          }
          this.store.push(trashSegment)
          this.activeTrashSegment = trashSegment
          this.currentSegment = trashSegment
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
