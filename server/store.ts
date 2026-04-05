export interface SpellDamageStats {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  critCount: number
  normalTotal: number
  normalMin: number
  normalMax: number
  critTotal: number
  critMin: number
  critMax: number
  absorbed: number
  resisted: number
  blocked: number
}

export interface SpellHealStats {
  spellId: string
  spellName: string
  total: number
  overheal: number
  absorbed: number
  hitCount: number
  critCount: number
}

export interface TargetDamageStats {
  targetName: string
  total: number
}

export interface SourceDamageStats {
  sourceName: string
  total: number
}

export interface TargetDamageTaken {
  total: number
  sources: Record<string, SourceDamageStats>
}

export interface DamageData {
  total: number
  spells: Record<string, SpellDamageStats>
  targets: Record<string, TargetDamageStats>
}

export interface HealData {
  total: number
  overheal: number
  spells: Record<string, SpellHealStats>
}

export interface PlayerData {
  name: string
  specId?: number
  damage: DamageData
  healing: HealData
}

export interface Segment {
  id: string
  keyRunId: string | null           // null for non-M+ segments
  encounterName: string
  startTime: number                 // ENCOUNTER_START timestamp (or first event for open segments)
  endTime: number | null            // ENCOUNTER_END timestamp, null while in progress
  firstEventTime: number | null     // timestamp of first damage/heal event
  lastEventTime: number | null      // timestamp of last damage/heal event
  success: boolean | null
  players: Record<string, PlayerData>
  guidToSpec: Record<string, number>   // playerGuid → specId, populated by COMBATANT_INFO
  guidToName: Record<string, string>   // playerGuid → playerName
  petToOwner: Record<string, string>   // petGuid → ownerGuid, populated by SPELL_SUMMON and SWING_DAMAGE advanced-log
  targetDamageTaken: Record<string, TargetDamageTaken>
}

// Derived values computed at read time, not stored
export interface PlayerSnapshot extends PlayerData {
  dps: number
  hps: number
}

export interface SegmentSnapshot extends Omit<Segment, 'players'> {
  type: 'segment'
  duration: number
  players: Record<string, PlayerSnapshot>
}

export interface SegmentSummary {
  type: 'segment'
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
  duration: number
}

// Internal — not exported over the wire
interface KeyRunMeta {
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
}

export interface KeyRunSummary {
  type: 'key_run'
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
  segments: SegmentSummary[]
}

export interface KeyRunSnapshot {
  type: 'key_run'
  keyRunId: string
  dungeonName: string
  keystoneLevel: number
  startTime: number
  endTime: number | null
  success: boolean | null
  durationMs: number | null
  activeDurationSec: number          // sum of individual segment combat durations
  players: Record<string, PlayerSnapshot>
}

export type HistoryItem = KeyRunSummary | SegmentSummary

export class SegmentStore {
  private segments: Segment[] = []
  private maxSegments: number        // max history items (key runs + standalone segments)
  private keyRunMeta: Map<string, KeyRunMeta> = new Map()

  constructor(maxSegments = 10) {
    this.maxSegments = maxSegments
  }

  registerKeyRun(keyRunId: string, dungeonName: string, keystoneLevel: number, startTime: number) {
    this.keyRunMeta.set(keyRunId, {
      keyRunId,
      dungeonName,
      keystoneLevel,
      startTime,
      endTime: null,
      success: null,
      durationMs: null,
    })
  }

  finalizeKeyRun(keyRunId: string, endTime: number, success: boolean | null, durationMs: number | null) {
    const meta = this.keyRunMeta.get(keyRunId)
    if (meta) {
      meta.endTime = endTime
      meta.success = success
      meta.durationMs = durationMs
    }
  }

  push(segment: Segment) {
    this.segments.push(segment)
    // Evict at key-run level: count distinct key runs + standalone segments
    while (this._historyItemCount() > this.maxSegments) {
      this._evictOldest()
    }
  }

  private _historyItemCount(): number {
    const keyRunIds = new Set<string>()
    let standalone = 0
    for (const s of this.segments) {
      if (s.keyRunId) keyRunIds.add(s.keyRunId)
      else standalone++
    }
    return keyRunIds.size + standalone
  }

  private _evictOldest() {
    if (this.segments.length === 0) return
    const oldest = this.segments[0]
    if (oldest.keyRunId) {
      const id = oldest.keyRunId
      this.segments = this.segments.filter(s => s.keyRunId !== id)
      this.keyRunMeta.delete(id)
    } else {
      this.segments.shift()
    }
  }

  getById(id: string): Segment | undefined {
    return this.segments.find(s => s.id === id)
  }

  getAll(): Segment[] {
    return [...this.segments]
  }

  getHistoryItems(): HistoryItem[] {
    const items: HistoryItem[] = []
    const seen = new Set<string>()

    for (const seg of this.segments) {
      if (seg.keyRunId) {
        if (!seen.has(seg.keyRunId)) {
          seen.add(seg.keyRunId)
          const meta = this.keyRunMeta.get(seg.keyRunId)
          if (meta) {
            const keySegments = this.segments
              .filter(s => s.keyRunId === seg.keyRunId)
              .map(s => this.toSummary(s))
            items.push({ type: 'key_run', ...meta, segments: keySegments })
          }
        }
      } else {
        items.push(this.toSummary(seg))
      }
    }

    return items
  }

  toKeyRunSnapshot(keyRunId: string): KeyRunSnapshot | null {
    const meta = this.keyRunMeta.get(keyRunId)
    if (!meta) return null
    const segs = this.segments.filter(s => s.keyRunId === keyRunId)
    if (segs.length === 0) return null

    const merged: Record<string, PlayerData> = {}
    let activeDurationSec = 0

    for (const seg of segs) {
      const start = seg.firstEventTime ?? seg.startTime
      const end   = seg.endTime ?? seg.lastEventTime ?? start
      activeDurationSec += (end - start) / 1000

      for (const [name, player] of Object.entries(seg.players)) {
        if (!merged[name]) {
          // Deep-copy the first occurrence so mutations don't affect the source segment
          merged[name] = {
            name: player.name,
            specId: player.specId,
            damage: {
              total: player.damage.total,
              spells: Object.fromEntries(
                Object.entries(player.damage.spells).map(([k, v]) => [k, { ...v }])
              ),
              targets: Object.fromEntries(
                Object.entries(player.damage.targets).map(([k, v]) => [k, { ...v }])
              ),
            },
            healing: {
              total: player.healing.total,
              overheal: player.healing.overheal,
              spells: Object.fromEntries(
                Object.entries(player.healing.spells).map(([k, v]) => [k, { ...v }])
              ),
            },
          }
        } else {
          const mp = merged[name]
          mp.damage.total += player.damage.total
          mp.healing.total += player.healing.total
          mp.healing.overheal += player.healing.overheal

          for (const [sid, spell] of Object.entries(player.damage.spells)) {
            const ms = mp.damage.spells[sid]
            if (!ms) {
              mp.damage.spells[sid] = { ...spell }
            } else {
              ms.total += spell.total
              ms.hitCount += spell.hitCount
              ms.critCount += spell.critCount
              ms.normalTotal += spell.normalTotal
              ms.normalMin = Math.min(ms.normalMin, spell.normalMin)
              ms.normalMax = Math.max(ms.normalMax, spell.normalMax)
              ms.critTotal += spell.critTotal
              ms.critMin = Math.min(ms.critMin, spell.critMin)
              ms.critMax = Math.max(ms.critMax, spell.critMax)
              ms.absorbed += spell.absorbed
              ms.resisted += spell.resisted
              ms.blocked += spell.blocked
            }
          }

          for (const [sid, spell] of Object.entries(player.healing.spells)) {
            const ms = mp.healing.spells[sid]
            if (!ms) {
              mp.healing.spells[sid] = { ...spell }
            } else {
              ms.total += spell.total
              ms.overheal += spell.overheal
              ms.absorbed += spell.absorbed
              ms.hitCount += spell.hitCount
              ms.critCount += spell.critCount
            }
          }

          for (const [tname, target] of Object.entries(player.damage.targets)) {
            const mt = mp.damage.targets[tname]
            if (!mt) {
              mp.damage.targets[tname] = { ...target }
            } else {
              mt.total += target.total
            }
          }
        }
      }
    }

    const players: Record<string, PlayerSnapshot> = {}
    for (const [name, player] of Object.entries(merged)) {
      players[name] = {
        ...player,
        dps: activeDurationSec > 0 ? player.damage.total / activeDurationSec : 0,
        hps: activeDurationSec > 0 ? player.healing.total / activeDurationSec : 0,
      }
    }

    return { type: 'key_run', ...meta, activeDurationSec, players }
  }

  toSnapshot(segment: Segment): SegmentSnapshot {
    // Duration spans only actual combat events — stable when idle, accurate when fighting
    const start = segment.firstEventTime ?? segment.startTime
    const end   = segment.endTime ?? segment.lastEventTime ?? start
    const duration = (end - start) / 1000
    const players: Record<string, PlayerSnapshot> = {}

    for (const [name, player] of Object.entries(segment.players)) {
      players[name] = {
        ...player,
        dps: duration > 0 ? player.damage.total / duration : 0,
        hps: duration > 0 ? player.healing.total / duration : 0,
      }
    }

    return { type: 'segment' as const, ...segment, duration, players }
  }

  toSummary(segment: Segment): SegmentSummary {
    const start = segment.firstEventTime ?? segment.startTime
    const end   = segment.endTime ?? segment.lastEventTime ?? start
    return {
      type: 'segment',
      id: segment.id,
      encounterName: segment.encounterName,
      startTime: segment.startTime,
      endTime: segment.endTime,
      success: segment.success,
      duration: (end - start) / 1000,
    }
  }
}
