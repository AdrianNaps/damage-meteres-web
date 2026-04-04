import type { ParsedEvent, DamagePayload, HealPayload } from './types.js'
import type { Segment, PlayerData, SpellDamageStats, SpellHealStats } from './store.js'

export function applyEvent(segment: Segment, event: ParsedEvent) {
  const { payload } = event

  if (payload.type === 'damage') {
    applyDamage(segment, event.source.name, payload as DamagePayload)
  } else if (payload.type === 'heal') {
    applyHeal(segment, event.source.name, payload as HealPayload)
  }

  if (segment.firstEventTime === null) segment.firstEventTime = event.timestamp
  segment.lastEventTime = event.timestamp
}

function getOrCreatePlayer(segment: Segment, name: string): PlayerData {
  if (!segment.players[name]) {
    segment.players[name] = {
      name,
      damage: { total: 0, spells: {} },
      healing: { total: 0, overheal: 0, spells: {} },
    }
  }
  return segment.players[name]
}

function applyDamage(segment: Segment, sourceName: string, payload: DamagePayload) {
  const player = getOrCreatePlayer(segment, sourceName)
  const { spellId, spellName, amount, absorbed, resisted, blocked, critical } = payload

  player.damage.total += amount

  if (!player.damage.spells[spellId]) {
    player.damage.spells[spellId] = {
      spellId,
      spellName,
      total: 0,
      hitCount: 0,
      critCount: 0,
      normalTotal: 0,
      normalMin: Infinity,
      normalMax: 0,
      critTotal: 0,
      critMin: Infinity,
      critMax: 0,
      absorbed: 0,
      resisted: 0,
      blocked: 0,
    }
  }

  const spell = player.damage.spells[spellId]
  spell.total += amount
  spell.hitCount++
  spell.absorbed += absorbed
  spell.resisted += resisted
  spell.blocked += blocked

  if (critical) {
    spell.critCount++
    spell.critTotal += amount
    spell.critMin = Math.min(spell.critMin, amount)
    spell.critMax = Math.max(spell.critMax, amount)
  } else {
    spell.normalTotal += amount
    spell.normalMin = Math.min(spell.normalMin, amount)
    spell.normalMax = Math.max(spell.normalMax, amount)
  }
}

function applyHeal(segment: Segment, sourceName: string, payload: HealPayload) {
  const player = getOrCreatePlayer(segment, sourceName)
  const { spellId, spellName, amount, overheal, absorbed, critical } = payload

  // effective heal = amount - overheal
  const effective = amount - overheal
  player.healing.total += effective
  player.healing.overheal += overheal

  if (!player.healing.spells[spellId]) {
    player.healing.spells[spellId] = {
      spellId,
      spellName,
      total: 0,
      overheal: 0,
      absorbed: 0,
      hitCount: 0,
      critCount: 0,
    }
  }

  const spell = player.healing.spells[spellId]
  spell.total += effective
  spell.overheal += overheal
  spell.absorbed += absorbed
  spell.hitCount++
  if (critical) spell.critCount++
}
