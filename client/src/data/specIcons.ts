// Wowhead icon filenames (without extension) for each spec ID.
// Served from https://wow.zamimg.com/images/wow/icons/{size}/{name}.jpg
export const SPEC_ICON_NAMES: Record<number, string> = {
  // Warrior
  71:  'ability_warrior_savageblow',       // Arms
  72:  'ability_warrior_innerrage',        // Fury
  73:  'ability_warrior_defensivestance',  // Protection

  // Paladin
  65:  'spell_holy_holybolt',              // Holy
  66:  'ability_paladin_shieldofthetemplar',// Protection
  70:  'spell_holy_auraoflight',           // Retribution

  // Hunter
  253: 'ability_hunter_bestialdiscipline', // Beast Mastery
  254: 'ability_hunter_focusedaim',        // Marksmanship
  255: 'ability_hunter_camouflage',        // Survival

  // Rogue
  259: 'ability_rogue_eviscerate',         // Assassination
  260: 'inv_sword_30',                     // Outlaw
  261: 'ability_stealth',                  // Subtlety

  // Priest
  256: 'spell_holy_powerwordshield',       // Discipline
  257: 'spell_holy_guardianspirit',        // Holy
  258: 'spell_shadow_shadowwordpain',      // Shadow

  // Death Knight
  250: 'spell_deathknight_bloodpresence',  // Blood
  251: 'spell_deathknight_frostpresence',  // Frost
  252: 'spell_deathknight_unholypresence', // Unholy

  // Shaman
  262: 'spell_nature_lightning',           // Elemental
  263: 'spell_shaman_improvedstormstrike', // Enhancement
  264: 'spell_nature_magicimmunity',       // Restoration

  // Mage
  62:  'spell_holy_magicalsentry',         // Arcane
  63:  'spell_fire_firebolt02',            // Fire
  64:  'spell_frost_frostbolt02',          // Frost

  // Warlock
  265: 'spell_shadow_deathcoil',           // Affliction
  266: 'spell_shadow_metamorphosis',       // Demonology
  267: 'spell_shadow_rainoffire',          // Destruction

  // Monk
  268: 'spell_monk_brewmaster_spec',       // Brewmaster
  270: 'spell_monk_mistweaver_spec',       // Mistweaver
  269: 'spell_monk_windwalker_spec',       // Windwalker

  // Druid
  102: 'spell_nature_starfall',            // Balance
  103: 'ability_druid_catform',            // Feral
  104: 'ability_racial_bearform',          // Guardian
  105: 'spell_nature_healingtouch',        // Restoration

  // Demon Hunter
  577: 'ability_demonhunter_specdps',      // Havoc
  581: 'ability_demonhunter_spectank',     // Vengeance
  1480:'ability_demonhunter_specdps',      // (Devourer placeholder)

  // Evoker
  1467:'classicon_evoker_devastation',     // Devastation
  1468:'classicon_evoker_preservation',    // Preservation
  1473:'classicon_evoker_augmentation',    // Augmentation
}
