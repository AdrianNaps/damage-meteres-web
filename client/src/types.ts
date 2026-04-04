export interface SpellDamageStats {
  spellId: string
  spellName: string
  total: number
  hitCount: number
  critCount: number
  normalMin: number
  normalMax: number
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

export interface PlayerSnapshot {
  name: string
  dps: number
  hps: number
  damage: { total: number; spells: Record<string, SpellDamageStats> }
  healing: { total: number; overheal: number; spells: Record<string, SpellHealStats> }
}

export interface SegmentSnapshot {
  id: string
  encounterName: string
  startTime: number
  endTime: number | null
  success: boolean | null
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
