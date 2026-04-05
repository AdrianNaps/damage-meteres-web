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
  encounterName: string
  startTime: number       // ENCOUNTER_START timestamp (or first event for open segments)
  endTime: number | null  // ENCOUNTER_END timestamp, null while in progress
  firstEventTime: number | null  // timestamp of first damage/heal event
  lastEventTime: number | null   // timestamp of last damage/heal event
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
  duration: number
  players: Record<string, PlayerSnapshot>
}

export interface SegmentSummary {
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
  duration: number
}

export class SegmentStore {
  private segments: Segment[] = []
  private maxSegments: number

  constructor(maxSegments = 10) {
    this.maxSegments = maxSegments
  }

  push(segment: Segment) {
    this.segments.push(segment)
    if (this.segments.length > this.maxSegments) {
      this.segments.shift()
    }
  }

  getById(id: string): Segment | undefined {
    return this.segments.find(s => s.id === id)
  }

  getAll(): Segment[] {
    return [...this.segments]
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

    return { ...segment, duration, players }
  }

  toSummary(segment: Segment): SegmentSummary {
    const start = segment.firstEventTime ?? segment.startTime
    const end   = segment.endTime ?? segment.lastEventTime ?? start
    return {
      id: segment.id,
      encounterName: segment.encounterName,
      startTime: segment.startTime,
      endTime: segment.endTime,
      success: segment.success,
      duration: (end - start) / 1000,
    }
  }
}
