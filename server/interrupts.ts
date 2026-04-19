// Known interrupt spell IDs (as strings — log field format). Used to classify
// SPELL_CAST_SUCCESS events as interrupt attempts so the Interrupts lens can
// show Attempts vs Lands. Comments are spec/source hints for humans; the parser
// only checks membership.
//
// This set is a MUTABLE hybrid: the listed IDs are the static Midnight-era
// baseline, and the parser's SPELL_INTERRUPT path adds any spellId it sees
// firing a real interrupt to the set. That way the Attempts count still
// works for anything new (hero talents, unlisted pet abilities, later patches)
// without requiring a code change — once the attempt spell lands once in a
// session, all subsequent casts of it count as attempts.
export const INTERRUPT_SPELL_IDS = new Set<string>([
  // Melee
  '6552',    // Pummel — Warrior
  '1766',    // Kick — Rogue
  '47528',   // Mind Freeze — Death Knight
  '183752',  // Disrupt — Demon Hunter
  '116705',  // Spear Hand Strike — Monk
  '96231',   // Rebuke — Paladin
  '31935',   // Avenger's Shield — Paladin (Prot)
  '106839',  // Skull Bash — Druid (Feral/Guardian)
  '78675',   // Solar Beam — Druid (Balance)
  '187707',  // Muzzle — Hunter (Survival)

  // Ranged
  '147362',  // Counter Shot — Hunter (BM/MM)
  '2139',    // Counterspell — Mage
  '57994',   // Wind Shear — Shaman
  '351338',  // Quell — Evoker
  '15487',   // Silence — Priest (Shadow)
  '19647',   // Spell Lock — Warlock (Felhunter)
  '119914',  // Axe Toss — Warlock (Felguard, Demonology)
])
