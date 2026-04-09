import type { PlayerDeathRecord } from './types.js'
import type { IconResolver } from './iconResolver.js'
export type { PlayerDeathRecord }

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

export interface InterruptSpellStats {
  spellId: string
  spellName: string
  count: number
}

export interface InterruptData {
  total: number
  // Kicker's own abilities (e.g. Pummel, Kick, Mind Freeze)
  byKicker: Record<string, InterruptSpellStats>
  // Enemy spells that got interrupted
  byKicked: Record<string, InterruptSpellStats>
}

export interface PlayerData {
  name: string
  specId?: number
  damage: DamageData
  healing: HealData
  deaths: PlayerDeathRecord[]
  interrupts: InterruptData
}

export interface Segment {
  id: string
  keyRunId: string | null           // null for non-M+ segments
  bossSectionId: string | null      // container id for contiguous pulls of the same raid boss (null inside M+ or trash)
  encounterID: number               // 0 for trash segments
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
  petBatchToOwner: Record<string, string>  // batch-key (shard|npcId|spawnSuffix) → ownerGuid, for sibling-suffix bootstrap of un-swung batched pets (e.g. Hunter Stampede)
  supportOwnedSpellIds: Set<string>    // spellIds that have fired as *_DAMAGE_SUPPORT; their plain variants are not real source damage
  targetDamageTaken: Record<string, TargetDamageTaken>
}

// Derived values computed at read time, not stored
export interface PlayerSnapshot extends PlayerData {
  dps: number
  hps: number
}

export interface SegmentSnapshot extends Omit<Segment, 'players' | 'supportOwnedSpellIds'> {
  type: 'segment'
  duration: number
  players: Record<string, PlayerSnapshot>
  spellIcons: Record<string, string>   // spellId → Wowhead icon filename
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
interface BossSectionMeta {
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
}

export interface BossSectionSummary {
  type: 'boss_section'
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
  endTime: number | null
  segments: SegmentSummary[]
}

export interface BossSectionSnapshot {
  type: 'boss_section'
  bossSectionId: string
  encounterID: number
  encounterName: string
  difficultyID: number
  startTime: number
  endTime: number | null
  activeDurationSec: number
  pullCount: number
  kills: number
  players: Record<string, PlayerSnapshot>
  spellIcons: Record<string, string>
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
  spellIcons: Record<string, string> // spellId → Wowhead icon filename
}

export type HistoryItem = KeyRunSummary | BossSectionSummary | SegmentSummary

export class SegmentStore {
  private segments: Segment[] = []
  private maxSegments: number        // max history items (key runs + boss sections + standalone segments)
  private keyRunMeta: Map<string, KeyRunMeta> = new Map()
  private bossSectionMeta: Map<string, BossSectionMeta> = new Map()
  private iconResolver: IconResolver

  constructor(maxSegments: number, iconResolver: IconResolver) {
    this.maxSegments = maxSegments
    this.iconResolver = iconResolver
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

  registerBossSection(bossSectionId: string, encounterID: number, encounterName: string, difficultyID: number, startTime: number) {
    this.bossSectionMeta.set(bossSectionId, {
      bossSectionId,
      encounterID,
      encounterName,
      difficultyID,
      startTime,
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
    const bossSectionIds = new Set<string>()
    let standalone = 0
    for (const s of this.segments) {
      if (s.keyRunId) keyRunIds.add(s.keyRunId)
      else if (s.bossSectionId) bossSectionIds.add(s.bossSectionId)
      else standalone++
    }
    return keyRunIds.size + bossSectionIds.size + standalone
  }

  private _evictOldest() {
    if (this.segments.length === 0) return
    const oldest = this.segments[0]
    if (oldest.keyRunId) {
      const id = oldest.keyRunId
      this.segments = this.segments.filter(s => s.keyRunId !== id)
      this.keyRunMeta.delete(id)
    } else if (oldest.bossSectionId) {
      const id = oldest.bossSectionId
      this.segments = this.segments.filter(s => s.bossSectionId !== id)
      this.bossSectionMeta.delete(id)
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
    // Single O(n) pass: group segments by container id, preserving insertion order
    const keySegments = new Map<string, SegmentSummary[]>()
    const bossSegments = new Map<string, SegmentSummary[]>()
    const order: Array<
      | { kind: 'key_run'; keyRunId: string }
      | { kind: 'boss_section'; bossSectionId: string }
      | { kind: 'segment'; summary: SegmentSummary }
    > = []

    for (const seg of this.segments) {
      if (seg.keyRunId) {
        if (!keySegments.has(seg.keyRunId)) {
          keySegments.set(seg.keyRunId, [])
          order.push({ kind: 'key_run', keyRunId: seg.keyRunId })
        }
        keySegments.get(seg.keyRunId)!.push(this.toSummary(seg))
      } else if (seg.bossSectionId) {
        if (!bossSegments.has(seg.bossSectionId)) {
          bossSegments.set(seg.bossSectionId, [])
          order.push({ kind: 'boss_section', bossSectionId: seg.bossSectionId })
        }
        bossSegments.get(seg.bossSectionId)!.push(this.toSummary(seg))
      } else {
        order.push({ kind: 'segment', summary: this.toSummary(seg) })
      }
    }

    return order.map<HistoryItem>(entry => {
      if (entry.kind === 'key_run') {
        const meta = this.keyRunMeta.get(entry.keyRunId)!
        return { type: 'key_run' as const, ...meta, segments: keySegments.get(entry.keyRunId)! }
      }
      if (entry.kind === 'boss_section') {
        const meta = this.bossSectionMeta.get(entry.bossSectionId)!
        const segs = bossSegments.get(entry.bossSectionId)!
        const lastEnd = segs.length > 0 ? segs[segs.length - 1].endTime : null
        return {
          type: 'boss_section' as const,
          bossSectionId: meta.bossSectionId,
          encounterID: meta.encounterID,
          encounterName: meta.encounterName,
          difficultyID: meta.difficultyID,
          startTime: meta.startTime,
          endTime: lastEnd,
          segments: segs,
        }
      }
      return entry.summary
    })
  }

  toBossSectionSnapshot(bossSectionId: string): BossSectionSnapshot | null {
    const meta = this.bossSectionMeta.get(bossSectionId)
    if (!meta) return null
    const segs = this.segments.filter(s => s.bossSectionId === bossSectionId)
    if (segs.length === 0) return null

    const { players, activeDurationSec } = this._mergeSegments(segs)

    const spellIds = new Set<string>()
    for (const p of Object.values(players)) {
      for (const sid of Object.keys(p.damage.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.healing.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicker)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicked)) spellIds.add(sid)
    }
    this.iconResolver.requestMany(spellIds)

    const lastEnd = segs[segs.length - 1].endTime ?? segs[segs.length - 1].lastEventTime
    return {
      type: 'boss_section',
      bossSectionId: meta.bossSectionId,
      encounterID: meta.encounterID,
      encounterName: meta.encounterName,
      difficultyID: meta.difficultyID,
      startTime: meta.startTime,
      endTime: lastEnd,
      activeDurationSec,
      pullCount: segs.length,
      kills: segs.filter(s => s.success === true).length,
      players,
      spellIcons: this.iconResolver.getAll(),
    }
  }

  private _mergeSegments(segs: Segment[]): { players: Record<string, PlayerSnapshot>; activeDurationSec: number } {
    const merged: Record<string, PlayerData> = {}
    let activeDurationSec = 0

    for (const seg of segs) {
      const start = seg.firstEventTime ?? seg.startTime
      const end   = seg.endTime ?? seg.lastEventTime ?? start
      activeDurationSec += (end - start) / 1000

      for (const [name, player] of Object.entries(seg.players)) {
        if (!merged[name]) {
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
            deaths: [...player.deaths],
            interrupts: {
              total: player.interrupts.total,
              byKicker: Object.fromEntries(
                Object.entries(player.interrupts.byKicker).map(([k, v]) => [k, { ...v }])
              ),
              byKicked: Object.fromEntries(
                Object.entries(player.interrupts.byKicked).map(([k, v]) => [k, { ...v }])
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

          mp.deaths.push(...player.deaths)

          mp.interrupts.total += player.interrupts.total
          for (const [sid, s] of Object.entries(player.interrupts.byKicker)) {
            const existing = mp.interrupts.byKicker[sid]
            if (!existing) mp.interrupts.byKicker[sid] = { ...s }
            else existing.count += s.count
          }
          for (const [sid, s] of Object.entries(player.interrupts.byKicked)) {
            const existing = mp.interrupts.byKicked[sid]
            if (!existing) mp.interrupts.byKicked[sid] = { ...s }
            else existing.count += s.count
          }
        }
      }
    }

    for (const mp of Object.values(merged)) {
      mp.deaths.sort((a, b) => a.timeOfDeath - b.timeOfDeath)
    }

    const players: Record<string, PlayerSnapshot> = {}
    for (const [name, player] of Object.entries(merged)) {
      players[name] = {
        ...player,
        dps: activeDurationSec > 0 ? player.damage.total / activeDurationSec : 0,
        hps: activeDurationSec > 0 ? player.healing.total / activeDurationSec : 0,
      }
    }
    return { players, activeDurationSec }
  }

  toKeyRunSnapshot(keyRunId: string): KeyRunSnapshot | null {
    const meta = this.keyRunMeta.get(keyRunId)
    if (!meta) return null
    const segs = this.segments.filter(s => s.keyRunId === keyRunId)
    if (segs.length === 0) return null

    const { players, activeDurationSec } = this._mergeSegments(segs)

    const spellIds = new Set<string>()
    for (const p of Object.values(players)) {
      for (const sid of Object.keys(p.damage.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.healing.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicker)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicked)) spellIds.add(sid)
    }
    this.iconResolver.requestMany(spellIds)

    return { type: 'key_run', ...meta, activeDurationSec, players, spellIcons: this.iconResolver.getAll() }
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

    const spellIds = new Set<string>()
    for (const p of Object.values(players)) {
      for (const sid of Object.keys(p.damage.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.healing.spells)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicker)) spellIds.add(sid)
      for (const sid of Object.keys(p.interrupts.byKicked)) spellIds.add(sid)
    }
    this.iconResolver.requestMany(spellIds)

    const { supportOwnedSpellIds: _, ...segmentRest } = segment
    return { type: 'segment' as const, ...segmentRest, duration, players, spellIcons: this.iconResolver.getAll() }
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
