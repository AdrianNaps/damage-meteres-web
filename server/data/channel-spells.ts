// Channel spells — press spellId → channel metadata. Drives:
//   1. Channel lifecycle pairing in aggregator (SPELL_CAST_SUCCESS opens an
//      in-flight channel; SPELL_AURA_REMOVED for the same caster + auraSpellId
//      closes it with a measured duration).
//   2. Tick-event suppression on the cast path. Some channels emit
//      SPELL_CAST_SUCCESS per tick with a separate spellId (Tranquility) which
//      would otherwise inflate the Casts metric. The reverse-derived
//      CHANNEL_TICK_SPELL_IDS set drops those at parse time.
//
// Verified shapes from sample logs in references/. Adding a new channel
// requires confirming the (press, aura, tick) relationship — see
// references/cast-quality.md "Appendix" for verified event traces.

export interface ChannelSpellMeta {
  // The spellId on SPELL_AURA_APPLIED/REMOVED that brackets the channel
  // (BUFF on caster). Often equal to the press spellId, but not always —
  // Tranquility uses 740 for both, but the structure allows them to differ.
  auraSpellId: string
  // Tick-effect spellIds that arrive as SPELL_CAST_SUCCESS during the channel.
  // Empty when ticks come through SPELL_PERIODIC_DAMAGE / SPELL_DAMAGE / SPELL_HEAL
  // (the common case — Disintegrate, Void Ray, Fists of Fury).
  tickSpellIds: string[]
}

export const CHANNEL_SPELLS: Record<string, ChannelSpellMeta> = {
  // Druid Tranquility — press 740, channel aura 740, ticks fire as SUCCESS
  // for the heal-effect spellId 157982 (~750ms apart, ~7 ticks per cast).
  // Press uniquely emits TWO SUCCESS events at the same instant (one for
  // 740, one for 157982) — the tick-suppression set drops the 157982 SUCCESS
  // at the start, and only the 740 SUCCESS opens the channel lifecycle.
  '740':    { auraSpellId: '740',    tickSpellIds: ['157982'] },

  // Devastation Evoker Disintegrate — press / aura / damage all use 356995.
  // Damage ticks come through SPELL_PERIODIC_DAMAGE (not SUCCESS), so no
  // overcount risk. Aura is removed-and-reapplied mid-channel during
  // Mass Disintegrate buff, which v1 first-REMOVED-wins pairing measures
  // as ~50% short. Acceptable for v1 (see cast-quality.md edge cases).
  '356995': { auraSpellId: '356995', tickSpellIds: [] },

  // Demon Hunter Devourer hero talent Void Ray — press / aura share 473728,
  // AoE ticks fire as SPELL_DAMAGE for spellId 1213649. ~2.8s base channel.
  '473728': { auraSpellId: '473728', tickSpellIds: [] },

  // Windwalker Monk Fists of Fury — press / aura share 113656, AoE ticks
  // fire as SPELL_DAMAGE for spellId 117418. ~3s base channel, very
  // consistent across observed casts.
  '113656': { auraSpellId: '113656', tickSpellIds: [] },
}

// Reverse-derived: every tick spellId across all channels in CHANNEL_SPELLS.
// Used by the aggregator's cast path to drop tick SUCCESS events outright so
// they don't inflate the Casts metric. Built once at module load — no runtime
// cost per event.
export const CHANNEL_TICK_SPELL_IDS: Set<string> = new Set(
  Object.values(CHANNEL_SPELLS).flatMap(meta => meta.tickSpellIds),
)
