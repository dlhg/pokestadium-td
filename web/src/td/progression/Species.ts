/**
 * Species.ts — Every Pokémon the Player Can Own
 *
 * A species is what a Pokémon *is*: its evolution line, base stats, deploy
 * cost, how much XP it is worth as a creep, the basic attack its tower fires,
 * and the three paths that attack grows along in a match. Level gates each
 * tier; prize money still buys it. See docs/tower-roles.md.
 *
 * Species are keyed by their base form (`charmander`, not `charizard`). A
 * creep maps onto a species and a stage by name, so a caught Haunter is a
 * Gastly-line Pokémon already at stage 1.
 */

import { AnimatedPokemon, PokemonModelFactory } from '../../stadium/PokemonModels';
import { PokemonType } from '../../stadium/TypeMatrix';
import type { TierEffect } from '../TowerAttack';
import type { StatBlock } from './Stats';

/** One purchasable step along a path. */
export interface PathTier {
  name: string;
  cost: number;
  /** Level the Pokémon must reach before this tier can be bought. */
  requiresLevel?: number;
  effects: TierEffect[];
  description: string;
}

/** A direction a tower's attack can grow in. Towers commit to two at most. */
export interface PathDef {
  id: string;
  label: string;
  tiers: PathTier[];
}

export interface SpeciesForm {
  name: string;
  type: PokemonType;
  secondaryType?: PokemonType;
  /** Level this form evolves in at; 0 for the base form. */
  atLevel: number;
  base: StatBlock;
}

export interface SpeciesDef {
  id: string;
  forms: SpeciesForm[];
  deployCost: number;
  /** Gen 1 base experience yield, awarded when one faints as a creep. */
  expYield: number;
  /** Short job title shown on the tower card ("THE STRIKER"). */
  role: string;
  /** Move the tower fires before any path is bought. */
  basicAttack: string;
  /** Per evolution stage, when a form changes the basic attack outright (Magikarp → Gyarados). */
  formAttacks?: string[];
  paths: PathDef[];
  createModel: () => AnimatedPokemon;
  description: string;
}

function tier(name: string, cost: number, requiresLevel: number | undefined, description: string, ...effects: TierEffect[]): PathTier {
  return { name, cost, requiresLevel, description, effects };
}

function form(name: string, type: PokemonType, atLevel: number, attack: number, speed: number, special: number, secondaryType?: PokemonType): SpeciesForm {
  return { name, type, secondaryType, atLevel, base: { attack, speed, special } };
}

const M = PokemonModelFactory;

export const SPECIES: Record<string, SpeciesDef> = {
  // ---- Starters & gift ----------------------------------------------------
  bulbasaur: {
    id: 'bulbasaur', deployCost: 110, expYield: 64, role: 'THE GROUNDSKEEPER',
    forms: [form('Bulbasaur', 'Grass', 0, 49, 45, 65, 'Poison'), form('Ivysaur', 'Grass', 16, 62, 60, 80, 'Poison'), form('Venusaur', 'Grass', 32, 82, 80, 100, 'Poison')],
    basicAttack: 'vine_whip',
    paths: [
      { id: 'spores', label: 'SPORES', tiers: [
        tier('Stun Spore', 100, undefined, 'Every 4th attack drops a patch of spores that paralyzes.',
          { kind: 'hazard', hazard: 'stun_spore', everyNth: 4 }),
        tier('Sleep Powder', 220, 8, 'Patches become bigger, last longer, and put enemies to sleep.',
          { kind: 'hazard', hazard: 'sleep_powder', everyNth: 3 }),
        tier('Spore Carpet', 400, 16, 'Patches drop every other attack. Unlocks Spore Carpet.',
          { kind: 'hazard', hazard: 'sleep_powder', everyNth: 2 }, { kind: 'signature', signatureId: 'spore_carpet' }),
      ] },
      { id: 'razor', label: 'RAZOR', tiers: [
        tier('Razor Leaf', 100, undefined, 'The attack becomes a narrow cone of leaves.',
          { kind: 'replaceAttack', moveId: 'razor_leaf' }),
        tier('Keen Edge', 220, 8, 'A wider, longer cone. Crits deal double.',
          { kind: 'modifyAttack', patch: { coneAngle: 70 } }, { kind: 'scale', range: 1.15 },
          { kind: 'crit', chance: 0.2, multiplier: 2 }),
        tier('SolarBeam', 420, 16, 'Leaves hit 40% harder. Unlocks SolarBeam.',
          { kind: 'scale', damage: 1.4 }, { kind: 'signature', signatureId: 'solar_beam' }),
      ] },
      { id: 'growth', label: 'GROWTH', tiers: [
        tier('Leech Seed', 110, undefined, 'Hits may plant a seed that drains the enemy for 8 s.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.35, duration: 8 }),
        tier('Spreading Roots', 200, 8, 'When a seeded enemy faints, the seed jumps to the nearest enemy.',
          { kind: 'seedJump', radius: 7 }),
        tier('Growth', 380, 16, 'Towers in range attack 15% faster. Unlocks Growth.',
          { kind: 'rateAura', bonus: 0.15 }, { kind: 'signature', signatureId: 'growth' }),
      ] },
    ],
    createModel: () => M.createVenusaur(),
    description: 'Controls the lane with spore patches instead of hitting hard.',
  },
  charmander: {
    id: 'charmander', deployCost: 130, expYield: 65, role: 'THE FLAMETHROWER',
    forms: [form('Charmander', 'Fire', 0, 52, 65, 50), form('Charmeleon', 'Fire', 16, 64, 80, 65), form('Charizard', 'Fire', 36, 84, 100, 85, 'Flying')],
    basicAttack: 'ember',
    paths: [
      { id: 'inferno', label: 'INFERNO', tiers: [
        tier('Flamethrower', 130, undefined, 'The attack becomes a cone of fire.',
          { kind: 'replaceAttack', moveId: 'flamethrower' }),
        tier('Wide Flame', 240, 8, 'A wider, longer cone, and every hit burns.',
          { kind: 'modifyAttack', patch: { coneAngle: 85, statusChance: 1 } }, { kind: 'scale', range: 1.2 }),
        tier('Fire Blast', 420, 16, 'Flames hit 30% harder. Unlocks Fire Blast.',
          { kind: 'scale', damage: 1.3 }, { kind: 'signature', signatureId: 'fire_blast' }),
      ] },
      { id: 'wildfire', label: 'WILDFIRE', tiers: [
        tier('Ember Trail', 120, undefined, 'Every 3rd attack leaves burning embers on the lane.',
          { kind: 'hazard', hazard: 'ember_patch', everyNth: 3 }),
        tier('Fire Spin', 230, 8, 'The embers become a vortex that briefly traps enemies.',
          { kind: 'hazard', hazard: 'fire_spin_patch', everyNth: 3 }),
        tier('Blaze', 400, 16, 'Fire Spin drops every other attack. Unlocks Blaze.',
          { kind: 'hazard', hazard: 'fire_spin_patch', everyNth: 2 }, { kind: 'signature', signatureId: 'blaze' }),
      ] },
      { id: 'rage', label: 'RAGE', tiers: [
        tier('Rage', 110, undefined, 'Each hit on the same target deals 12% more, up to 8 times.',
          { kind: 'rage', perStack: 0.12, maxStacks: 8 }),
        tier('Slash', 250, 8, 'Attacks become Heavy and can crit for double.',
          { kind: 'modifyAttack', patch: { heavy: true } }, { kind: 'crit', chance: 0.2, multiplier: 2 }),
        tier('Fly', 440, 16, 'Attacks hit 25% harder. Unlocks Fly.',
          { kind: 'scale', damage: 1.25 }, { kind: 'signature', signatureId: 'fly' }),
      ] },
    ],
    createModel: () => M.createCharizard(),
    description: 'Short range, shreds groups. Belongs inside a bend.',
  },
  squirtle: {
    id: 'squirtle', deployCost: 120, expYield: 66, role: 'THE HYDRANT',
    forms: [form('Squirtle', 'Water', 0, 48, 43, 50), form('Wartortle', 'Water', 16, 63, 58, 65), form('Blastoise', 'Water', 36, 83, 78, 85)],
    basicAttack: 'water_gun',
    paths: [
      { id: 'pressure', label: 'PRESSURE', tiers: [
        tier('BubbleBeam', 120, undefined, 'The attack becomes a beam that pierces 3 enemies.',
          { kind: 'replaceAttack', moveId: 'bubblebeam' }),
        tier('Full Pressure', 230, 8, 'The beam pierces every enemy in its line.',
          { kind: 'modifyAttack', patch: { pierce: undefined } }, { kind: 'scale', range: 1.15 }),
        tier('Hydro Pump', 420, 16, 'The beam hits 35% harder. Unlocks Hydro Pump.',
          { kind: 'scale', damage: 1.35 }, { kind: 'signature', signatureId: 'hydro_pump' }),
      ] },
      { id: 'chill', label: 'CHILL', tiers: [
        tier('Chilling Water', 110, undefined, 'Every hit slows the enemy.',
          { kind: 'onHitStatus', status: 'freeze', chance: 1, duration: 1.5 }),
        tier('Cold Front', 220, 8, 'Enemies in range move 25% slower.',
          { kind: 'slowAura', slow: 0.25 }),
        tier('Blizzard', 400, 16, 'Enemies in range move 40% slower. Unlocks Blizzard.',
          { kind: 'slowAura', slow: 0.4 }, { kind: 'signature', signatureId: 'blizzard' }),
      ] },
      { id: 'surf', label: 'SURF', tiers: [
        tier('Ripple', 120, undefined, 'The attack becomes a small ring of water around the tower.',
          { kind: 'replaceAttack', moveId: 'surf_ring' }),
        tier('Undertow', 230, 8, 'Hits knock non-Titan enemies back along the lane.',
          { kind: 'knockback', distance: 1.2 }),
        tier('Surf', 400, 16, 'A wider ring. Unlocks Surf.',
          { kind: 'scale', range: 1.3 }, { kind: 'signature', signatureId: 'surf' }),
      ] },
    ],
    createModel: () => M.createBlastoise(),
    description: 'Holds enemies back. Belongs at the end of a straightaway.',
  },
  pikachu: {
    id: 'pikachu', deployCost: 100, expYield: 82, role: 'THE STRIKER',
    forms: [form('Pikachu', 'Electric', 0, 55, 90, 50), form('Raichu', 'Electric', 26, 90, 100, 90)],
    basicAttack: 'thundershock',
    paths: [
      { id: 'storm', label: 'STORM', tiers: [
        tier('Thunderbolt', 100, undefined, 'The attack becomes Thunderbolt, which chains to 2 more enemies.',
          { kind: 'replaceAttack', moveId: 'thunderbolt' }, { kind: 'chain', count: 2 }),
        tier('Chain Lightning', 210, 8, 'Bolts chain to 4 more enemies.',
          { kind: 'chain', count: 4 }),
        tier('Thunder', 380, 18, 'Bolts hit 30% harder. Unlocks Thunder.',
          { kind: 'scale', damage: 1.3 }, { kind: 'signature', signatureId: 'thunder' }),
      ] },
      { id: 'static', label: 'STATIC', tiers: [
        tier('Static', 100, undefined, 'Hits may paralyze.',
          { kind: 'onHitStatus', status: 'paralyze', chance: 0.35, duration: 2 }),
        tier('Static Field', 210, 8, 'Paralysis spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3.5 }),
        tier('Thunder Wave', 380, 18, 'Paralysis lands more often and lasts longer. Unlocks Thunder Wave.',
          { kind: 'onHitStatus', status: 'paralyze', chance: 0.6, duration: 3 }, { kind: 'signature', signatureId: 'thunder_wave' }),
      ] },
      { id: 'agility', label: 'AGILITY', tiers: [
        tier('Quick Feet', 110, undefined, 'Attacks 25% faster.',
          { kind: 'scale', rate: 1.25 }),
        tier('Quick Attack', 220, 8, 'The attack becomes Normal-type Quick Attack and fires faster still.',
          { kind: 'replaceAttack', moveId: 'quick_attack' }, { kind: 'scale', rate: 1.1 }),
        tier('Agility', 380, 18, 'Attacks 20% faster. Unlocks Agility.',
          { kind: 'scale', rate: 1.2 }, { kind: 'signature', signatureId: 'agility' }),
      ] },
    ],
    createModel: () => M.createPikachu(),
    description: 'Fast single-target damage that learns to chain.',
  },

  // ---- Catchable ----------------------------------------------------------
  gastly: {
    id: 'gastly', deployCost: 140, expYield: 95, role: 'THE TRICKSTER',
    forms: [form('Gastly', 'Ghost', 0, 35, 80, 100, 'Poison'), form('Haunter', 'Ghost', 25, 50, 95, 115, 'Poison'), form('Gengar', 'Ghost', 38, 65, 110, 130, 'Poison')],
    basicAttack: 'lick',
    paths: [
      { id: 'haunt', label: 'HAUNT', tiers: [
        tier('Confuse Ray', 110, undefined, 'Hits may confuse, sending enemies stumbling backwards.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.35, duration: 2 }),
        tier('Spread Fear', 220, 8, 'Confusion spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3.5 }),
        tier('Mass Confusion', 400, 25, 'Confusion lands more often. Unlocks Confuse Ray.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.5, duration: 2.5 }, { kind: 'signature', signatureId: 'mass_confuse' }),
      ] },
      { id: 'shadow', label: 'SHADOW', tiers: [
        tier('Night Shade', 130, undefined, 'The attack becomes Night Shade: a fixed-damage beam that ignores type.',
          { kind: 'replaceAttack', moveId: 'night_shade' }),
        tier('Deep Shade', 240, 8, 'Shades hit 30% harder and reach further.',
          { kind: 'scale', damage: 1.3, range: 1.2 }),
        tier('Shadow Ball', 420, 25, 'Shades hit 20% harder. Unlocks Shadow Ball.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'shadow_ball_sig' }),
      ] },
      { id: 'curse', label: 'CURSE', tiers: [
        tier('Sludge', 110, undefined, 'Hits may poison.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.4, duration: 6 }),
        tier('Dream Eater', 230, 8, 'Deals 60% more to enemies held by sleep, stuns or confusion.',
          { kind: 'bonusVs', target: 'held', multiplier: 1.6 }),
        tier('Nightmare', 400, 25, 'Attacks 15% faster. Unlocks Nightmare.',
          { kind: 'scale', rate: 1.15 }, { kind: 'signature', signatureId: 'nightmare' }),
      ] },
    ],
    createModel: () => M.createGengar(),
    description: 'Sends enemies stumbling backwards and sees what others cannot.',
  },
  abra: {
    id: 'abra', deployCost: 150, expYield: 75, role: 'THE SNIPER',
    forms: [form('Abra', 'Psychic', 0, 20, 90, 105), form('Kadabra', 'Psychic', 16, 35, 105, 120), form('Alakazam', 'Psychic', 36, 50, 120, 135)],
    basicAttack: 'psywave',
    paths: [
      { id: 'focus', label: 'FOCUS', tiers: [
        tier('Focus', 130, undefined, 'Shots hit 40% harder.',
          { kind: 'scale', damage: 1.4 }),
        tier('Kinesis', 250, 8, 'Shots can crit for 2.5×.',
          { kind: 'crit', chance: 0.25, multiplier: 2.5 }),
        tier('Psychic', 440, 16, 'Shots hit 30% harder. Unlocks Psychic.',
          { kind: 'scale', damage: 1.3 }, { kind: 'signature', signatureId: 'psychic_storm' }),
      ] },
      { id: 'mind', label: 'MIND', tiers: [
        tier('Confusion', 110, undefined, 'Hits confuse, sending enemies stumbling backwards.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.5, duration: 2 }),
        tier('Disable', 220, 8, 'Hits always confuse, for longer.',
          { kind: 'onHitStatus', status: 'confuse', chance: 1, duration: 3 }),
        tier('Hypnosis', 400, 16, 'Shots hit 10% harder. Unlocks Hypnosis.',
          { kind: 'scale', damage: 1.1 }, { kind: 'signature', signatureId: 'mass_hypnosis' }),
      ] },
      { id: 'teleport', label: 'TELEPORT', tiers: [
        tier('Quick Mind', 120, undefined, 'Fires 30% faster.',
          { kind: 'scale', rate: 1.3 }),
        tier('Psybeam', 240, 8, 'The attack becomes a long Psybeam that pierces its whole line.',
          { kind: 'replaceAttack', moveId: 'psybeam_snipe' }),
        tier('Teleport', 420, 16, 'Fires 20% faster. Unlocks Teleport.',
          { kind: 'scale', rate: 1.2 }, { kind: 'signature', signatureId: 'teleport_strike' }),
      ] },
    ],
    createModel: () => M.createAlakazam(),
    description: 'Slow, precise shots that reach anywhere on the pitch.',
  },
  rattata: {
    id: 'rattata', deployCost: 80, expYield: 57, role: 'THE UTILITY',
    forms: [form('Rattata', 'Normal', 0, 56, 72, 25), form('Raticate', 'Normal', 20, 81, 97, 50)],
    basicAttack: 'quick_attack',
    paths: [
      { id: 'fang', label: 'FANG', tiers: [
        tier('Hyper Fang', 90, undefined, 'Bites hit 35% harder and can crit.',
          { kind: 'scale', damage: 1.35 }, { kind: 'crit', chance: 0.15, multiplier: 2 }),
        tier('Super Fang', 200, 8, 'Every bite also takes 15% of the enemy’s remaining HP. Bosses lose 2%.',
          { kind: 'percentDamage', share: 0.15, bossShare: 0.02 }),
        tier('Super Fang+', 360, 20, 'Bites hit 20% harder. Unlocks Super Fang.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'super_fang' }),
      ] },
      { id: 'scurry', label: 'SCURRY', tiers: [
        tier('Quick Feet', 90, undefined, 'Attacks 30% faster.',
          { kind: 'scale', rate: 1.3 }),
        tier('Focus Energy', 190, 8, 'Attacks 20% faster and reach further.',
          { kind: 'scale', rate: 1.2, range: 1.2 }),
        tier('Scurry', 340, 20, 'Attacks 10% faster. Unlocks Scurry.',
          { kind: 'scale', rate: 1.1 }, { kind: 'signature', signatureId: 'scurry' }),
      ] },
      { id: 'scavenge', label: 'SCAVENGE', tiers: [
        tier('Scavenge', 100, undefined, 'Earns $2 for every knockout it helps with.',
          { kind: 'bounty', money: 2 }),
        tier('Hoard', 210, 8, 'Earns $4 for every knockout it helps with.',
          { kind: 'bounty', money: 4 }),
        tier('Treasure Hunt', 360, 20, 'Earns $6 per knockout. Unlocks Treasure Hunt.',
          { kind: 'bounty', money: 6 }, { kind: 'signature', signatureId: 'treasure_hunt' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Cheap and quick, with a bite for everything.',
  },
  pidgey: {
    id: 'pidgey', deployCost: 90, expYield: 55, role: 'THE SPOTTER',
    forms: [form('Pidgey', 'Normal', 0, 45, 56, 35, 'Flying'), form('Pidgeotto', 'Normal', 18, 60, 71, 50, 'Flying'), form('Pidgeot', 'Normal', 36, 80, 91, 70, 'Flying')],
    basicAttack: 'gust',
    paths: [
      { id: 'sight', label: 'SIGHT', tiers: [
        tier('Keen Eye', 100, undefined, 'Sees Phantoms and reaches 25% further.',
          { kind: 'seePhantoms' }, { kind: 'scale', range: 1.25 }),
        tier('Spotter', 220, 8, 'Every tower in range can aim at Phantoms.',
          { kind: 'revealAura' }),
        tier('Foresight', 380, 18, 'Reaches 15% further. Unlocks Foresight.',
          { kind: 'scale', range: 1.15 }, { kind: 'signature', signatureId: 'foresight' }),
      ] },
      { id: 'gale', label: 'GALE', tiers: [
        tier('Whirlwind', 110, undefined, 'Gusts blow enemies a short way back up the lane.',
          { kind: 'knockback', distance: 1 }),
        tier('Twister', 230, 8, 'Gusts blow enemies further back and hit harder.',
          { kind: 'knockback', distance: 1.8 }, { kind: 'scale', damage: 1.2 }),
        tier('Hurricane', 400, 18, 'Gusts hit 20% harder. Unlocks Whirlwind.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'whirlwind' }),
      ] },
      { id: 'wing', label: 'WING', tiers: [
        tier('Wing Attack', 110, undefined, 'The attack becomes Wing Attack.',
          { kind: 'replaceAttack', moveId: 'wing_attack' }),
        tier('Aerial Ace', 230, 8, 'Can crit, and deals 50% more to flyers.',
          { kind: 'crit', chance: 0.25, multiplier: 2 }, { kind: 'bonusVs', target: 'airborne', multiplier: 1.5 }),
        tier('Sky Attack', 400, 18, 'Hits 20% harder. Unlocks Sky Attack.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'sky_attack' }),
      ] },
    ],
    createModel: () => M.createZubat(),
    description: 'Spots Phantoms for the whole team and keeps the air clear.',
  },
  zubat: {
    id: 'zubat', deployCost: 100, expYield: 54, role: 'THE HUNTER',
    forms: [form('Zubat', 'Poison', 0, 45, 55, 40, 'Flying'), form('Golbat', 'Poison', 22, 80, 90, 75, 'Flying')],
    basicAttack: 'leech_life',
    paths: [
      { id: 'hunt', label: 'HUNT', tiers: [
        tier('Echolocation', 110, undefined, 'Sees Phantoms and deals 60% more to flyers.',
          { kind: 'seePhantoms' }, { kind: 'bonusVs', target: 'airborne', multiplier: 1.6 }),
        tier('Wing Attack', 230, 8, 'The attack becomes Wing Attack, deadlier still against flyers.',
          { kind: 'replaceAttack', moveId: 'wing_attack' }, { kind: 'bonusVs', target: 'airborne', multiplier: 1.8 }),
        tier('Air Cutter', 400, 22, 'Hits 20% harder. Unlocks Air Cutter.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'swoop' }),
      ] },
      { id: 'sonic', label: 'SONIC', tiers: [
        tier('Supersonic', 100, undefined, 'Hits may confuse.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.3, duration: 1.5 }),
        tier('Echo Wave', 210, 8, 'Confusion spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3 }),
        tier('Screech', 380, 22, 'Confusion lands more often. Unlocks Screech.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.45, duration: 2 }, { kind: 'signature', signatureId: 'screech' }),
      ] },
      { id: 'venom', label: 'VENOM', tiers: [
        tier('Poison Fang', 100, undefined, 'Hits may poison.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.45, duration: 6 }),
        tier('Frenzy', 210, 8, 'Bites 25% faster.',
          { kind: 'scale', rate: 1.25 }),
        tier('Toxic', 380, 22, 'Poison lands every time. Unlocks Toxic.',
          { kind: 'onHitStatus', status: 'poison', chance: 1, duration: 6 }, { kind: 'signature', signatureId: 'toxic_wave' }),
      ] },
    ],
    createModel: () => M.createZubat(),
    description: 'Hunts flyers and hears Phantoms in the dark.',
  },
  paras: {
    id: 'paras', deployCost: 110, expYield: 70, role: 'THE SPORE TRAP',
    forms: [form('Paras', 'Bug', 0, 70, 25, 55, 'Grass'), form('Parasect', 'Bug', 24, 95, 30, 80, 'Grass')],
    basicAttack: 'scratch',
    paths: [
      { id: 'spore', label: 'SPORE', tiers: [
        tier('Spore Trap', 110, undefined, 'Every 6th attack leaves a long-lasting sleep trap on the lane.',
          { kind: 'hazard', hazard: 'spore_trap', everyNth: 6 }),
        tier('Big Spore', 230, 8, 'Traps are bigger, last longer and drop more often.',
          { kind: 'hazard', hazard: 'spore_trap_big', everyNth: 5 }),
        tier('Spore', 400, 24, 'Traps drop every 4th attack. Unlocks Spore.',
          { kind: 'hazard', hazard: 'spore_trap_big', everyNth: 4 }, { kind: 'signature', signatureId: 'spore' }),
      ] },
      { id: 'leech', label: 'LEECH', tiers: [
        tier('Absorb', 100, undefined, 'Hits may poison.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.35, duration: 6 }),
        tier('Spreading Spores', 210, 8, 'When a poisoned enemy faints, the poison jumps to the nearest enemy.',
          { kind: 'seedJump', radius: 6 }),
        tier('Mega Drain', 380, 24, 'Poison lands more often. Unlocks Mega Drain.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.55, duration: 7 }, { kind: 'signature', signatureId: 'mega_drain' }),
      ] },
      { id: 'claw', label: 'CLAW', tiers: [
        tier('Fury Cutter', 110, undefined, 'Each hit on the same target deals 10% more, up to 10 times.',
          { kind: 'rage', perStack: 0.1, maxStacks: 10 }),
        tier('Slash', 240, 8, 'Attacks become Heavy and can crit.',
          { kind: 'modifyAttack', patch: { heavy: true } }, { kind: 'crit', chance: 0.2, multiplier: 2 }),
        tier('X-Scissor', 420, 24, 'Hits 25% harder. Unlocks X-Scissor.',
          { kind: 'scale', damage: 1.25 }, { kind: 'signature', signatureId: 'x_scissor' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Slow, but its spore traps linger on the lane for a long time.',
  },
  geodude: {
    id: 'geodude', deployCost: 120, expYield: 86, role: 'THE BOMBER',
    forms: [form('Geodude', 'Rock', 0, 80, 20, 30, 'Ground'), form('Graveler', 'Rock', 25, 95, 35, 45, 'Ground'), form('Golem', 'Rock', 36, 110, 45, 55, 'Ground')],
    basicAttack: 'rock_throw',
    paths: [
      { id: 'blast', label: 'BLAST', tiers: [
        tier('Big Rocks', 120, undefined, 'Boulders burst over a wider area.',
          { kind: 'modifyAttack', patch: { splashRadius: 3.5 } }),
        tier('Rock Slide', 240, 8, 'Wider still, 20% harder, and may stun.',
          { kind: 'modifyAttack', patch: { splashRadius: 4.5 } }, { kind: 'scale', damage: 1.2 }, { kind: 'onHitStatus', status: 'stun', chance: 0.25, duration: 0.8 }),
        tier('Landslide', 420, 25, 'Boulders hit 20% harder. Unlocks Rock Slide.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'rock_slide' }),
      ] },
      { id: 'quake', label: 'QUAKE', tiers: [
        tier('Magnitude', 120, undefined, 'The attack becomes a tremor around the tower.',
          { kind: 'replaceAttack', moveId: 'magnitude' }),
        tier('Earthquake', 240, 8, 'The tremor reaches 30% further and hits 30% harder.',
          { kind: 'scale', range: 1.3, damage: 1.3 }),
        tier('Fissure', 420, 25, 'The tremor hits 20% harder. Unlocks Earthquake.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'earthquake_ring' }),
      ] },
      { id: 'rollout', label: 'ROLLOUT', tiers: [
        tier('Rollout', 110, undefined, 'Each hit on the same target deals 15% more, up to 6 times.',
          { kind: 'rage', perStack: 0.15, maxStacks: 6 }),
        tier('Heavy Roll', 230, 8, 'Deals 50% more to elites and Titans.',
          { kind: 'bonusVs', target: 'boss', multiplier: 1.5 }),
        tier('Double-Edge', 400, 25, 'Hits 20% harder. Unlocks Double-Edge.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'double_edge' }),
      ] },
    ],
    createModel: () => M.createGeodude(),
    description: 'Lobbed boulders that burst over groups and crack armor. Can’t hit flyers.',
  },
  machop: {
    id: 'machop', deployCost: 120, expYield: 88, role: 'THE BRAWLER',
    forms: [form('Machop', 'Fighting', 0, 80, 35, 35), form('Machoke', 'Fighting', 28, 100, 45, 50), form('Machamp', 'Fighting', 40, 130, 55, 65)],
    basicAttack: 'karate_chop',
    paths: [
      { id: 'power', label: 'POWER', tiers: [
        tier('Focus Punch', 120, undefined, 'Hits 40% harder.',
          { kind: 'scale', damage: 1.4 }),
        tier('Titan Breaker', 250, 8, 'Deals 80% more to elites and Titans.',
          { kind: 'bonusVs', target: 'boss', multiplier: 1.8 }),
        tier('DynamicPunch', 440, 25, 'Hits 20% harder. Unlocks DynamicPunch.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'dynamic_punch' }),
      ] },
      { id: 'combo', label: 'COMBO', tiers: [
        tier('Low Kick', 110, undefined, 'Attacks 30% faster.',
          { kind: 'scale', rate: 1.3 }),
        tier('Cross Chop', 230, 8, 'Can crit for double.',
          { kind: 'crit', chance: 0.3, multiplier: 2 }),
        tier('Bulk Up', 400, 25, 'Attacks 15% faster. Unlocks Bulk Up.',
          { kind: 'scale', rate: 1.15 }, { kind: 'signature', signatureId: 'bulk_up' }),
      ] },
      { id: 'throw', label: 'THROW', tiers: [
        tier('Seismic Toss', 120, undefined, 'The attack becomes Seismic Toss: fixed damage that ignores type.',
          { kind: 'replaceAttack', moveId: 'seismic_toss' }),
        tier('Vital Throw', 230, 8, 'Throws knock non-Titan enemies back up the lane.',
          { kind: 'knockback', distance: 2 }),
        tier('Submission', 400, 25, 'Throws reach 20% further. Unlocks Submission.',
          { kind: 'scale', range: 1.2 }, { kind: 'signature', signatureId: 'submission' }),
      ] },
    ],
    createModel: () => M.createGeodude(),
    description: 'Short range, Heavy hits, built to take down Titans.',
  },
  ponyta: {
    id: 'ponyta', deployCost: 130, expYield: 152, role: 'THE SPIN-UP',
    forms: [form('Ponyta', 'Fire', 0, 85, 90, 65), form('Rapidash', 'Fire', 40, 100, 105, 80)],
    basicAttack: 'ember',
    paths: [
      { id: 'gallop', label: 'GALLOP', tiers: [
        tier('Gallop', 120, undefined, 'Fires faster while it keeps attacking, up to 80% faster.',
          { kind: 'spinUp', perShot: 0.06, max: 0.8 }),
        tier('Stampede', 240, 8, 'Spins up further and faster, up to 140% faster.',
          { kind: 'spinUp', perShot: 0.08, max: 1.4 }),
        tier('Flame Charge', 420, 25, 'Spins up to 200% faster. Unlocks Flame Charge.',
          { kind: 'spinUp', perShot: 0.1, max: 2 }, { kind: 'signature', signatureId: 'flame_charge' }),
      ] },
      { id: 'flame', label: 'FLAME', tiers: [
        tier('Fire Spin', 120, undefined, 'The attack becomes a burning vortex around the tower.',
          { kind: 'replaceAttack', moveId: 'fire_spin' }),
        tier('Wildfire', 240, 8, 'The vortex hits 30% harder and reaches further.',
          { kind: 'scale', damage: 1.3, range: 1.2 }),
        tier('Inferno', 420, 25, 'The vortex hits 20% harder. Unlocks Inferno.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'inferno' }),
      ] },
      { id: 'stomp', label: 'STOMP', tiers: [
        tier('Stomp', 110, undefined, 'Hits may stun.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.2, duration: 0.8 }),
        tier('Trample', 230, 8, 'Hits knock non-Titan enemies back up the lane.',
          { kind: 'knockback', distance: 1 }),
        tier('Stomp+', 400, 25, 'Stuns land more often. Unlocks Stomp.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.35, duration: 1 }, { kind: 'signature', signatureId: 'stomp' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Starts slow, then fires faster and faster the longer it stays in the fight.',
  },
  oddish: {
    id: 'oddish', deployCost: 110, expYield: 78, role: 'THE POISONER',
    forms: [form('Oddish', 'Grass', 0, 50, 30, 75, 'Poison'), form('Gloom', 'Grass', 21, 65, 40, 85, 'Poison'), form('Vileplume', 'Grass', 36, 80, 50, 100, 'Poison')],
    basicAttack: 'absorb',
    paths: [
      { id: 'powder', label: 'POWDER', tiers: [
        tier('Poison Powder', 110, undefined, 'Every 4th attack leaves a patch of poison on the lane.',
          { kind: 'hazard', hazard: 'poison_powder', everyNth: 4 }),
        tier('Toxic Powder', 230, 8, 'Patches are bigger, stronger, and drop every 3rd attack.',
          { kind: 'hazard', hazard: 'toxic_powder', everyNth: 3 }),
        tier('Toxic Cloud', 400, 21, 'Patches drop every other attack. Unlocks Toxic Cloud.',
          { kind: 'hazard', hazard: 'toxic_powder', everyNth: 2 }, { kind: 'signature', signatureId: 'toxic_cloud' }),
      ] },
      { id: 'acid', label: 'ACID', tiers: [
        tier('Acid', 100, undefined, 'Hits may poison.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.5, duration: 6 }),
        tier('Toxic', 210, 8, 'Hits always poison, for longer.',
          { kind: 'onHitStatus', status: 'poison', chance: 1, duration: 10 }),
        tier('Venoshock', 380, 21, 'Attacks 15% faster. Unlocks Venoshock.',
          { kind: 'scale', rate: 1.15 }, { kind: 'signature', signatureId: 'venoshock' }),
      ] },
      { id: 'bloom', label: 'BLOOM', tiers: [
        tier('Sweet Scent', 110, undefined, 'Enemies in range move 15% slower.',
          { kind: 'slowAura', slow: 0.15 }),
        tier('Stun Spore', 220, 8, 'Hits may paralyze.',
          { kind: 'onHitStatus', status: 'paralyze', chance: 0.3, duration: 2 }),
        tier('Sleep Powder', 380, 21, 'Enemies in range move 25% slower. Unlocks Sleep Powder.',
          { kind: 'slowAura', slow: 0.25 }, { kind: 'signature', signatureId: 'sleep_powder_sig' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Poison patches and venom that stack with every other tower holding the lane.',
  },
  psyduck: {
    id: 'psyduck', deployCost: 120, expYield: 80, role: 'THE MIND BLAST',
    forms: [form('Psyduck', 'Water', 0, 52, 55, 50), form('Golduck', 'Water', 33, 82, 85, 80)],
    basicAttack: 'confusion',
    paths: [
      { id: 'headache', label: 'HEADACHE', tiers: [
        tier('Headache', 120, undefined, 'Hits 8% harder for every enemy in range, up to 80%.',
          { kind: 'crowdPower', perCreep: 0.08, max: 0.8 }),
        tier('Psy Burst', 240, 8, 'The attack becomes a psychic burst around the tower.',
          { kind: 'replaceAttack', moveId: 'psy_ring' }),
        tier('Migraine', 420, 25, 'The crowd bonus climbs to 120%. Unlocks Migraine.',
          { kind: 'crowdPower', perCreep: 0.1, max: 1.2 }, { kind: 'signature', signatureId: 'migraine' }),
      ] },
      { id: 'water', label: 'WATER', tiers: [
        tier('Water Pulse', 110, undefined, 'Hits may confuse, sending enemies stumbling backwards.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.3, duration: 1.5 }),
        tier('Swirling Pulse', 220, 8, 'Confusion spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3 }),
        tier('Confusion', 400, 25, 'Confusion lands more often. Unlocks Confusion.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.45, duration: 2 }, { kind: 'signature', signatureId: 'mass_confusion' }),
      ] },
      { id: 'third_eye', label: 'THIRD EYE', tiers: [
        tier('Third Eye', 110, undefined, 'Sees Phantoms.',
          { kind: 'seePhantoms' }),
        tier('Mind Link', 230, 8, 'Every tower in range can aim at Phantoms.',
          { kind: 'revealAura' }),
        tier('Future Sight', 400, 25, 'Hits 20% harder. Unlocks Future Sight.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'future_sight' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Its headache grows with every enemy that crowds it.',
  },
  dratini: {
    id: 'dratini', deployCost: 150, expYield: 67, role: 'THE CARRY',
    forms: [form('Dratini', 'Dragon', 0, 64, 50, 50), form('Dragonair', 'Dragon', 30, 84, 70, 70), form('Dragonite', 'Dragon', 50, 134, 80, 100, 'Flying')],
    basicAttack: 'dragon_rage',
    paths: [
      { id: 'rage', label: 'RAGE', tiers: [
        tier('Dragon Rage', 130, undefined, 'Hits 3% harder for every level.',
          { kind: 'levelPower', perLevel: 0.03 }),
        tier('Outrage', 260, 8, 'Hits 5% harder for every level.',
          { kind: 'levelPower', perLevel: 0.05 }),
        tier('Draco Meteor', 460, 25, 'Hits 6% harder for every level. Unlocks Draco Meteor.',
          { kind: 'levelPower', perLevel: 0.06 }, { kind: 'signature', signatureId: 'draco_meteor' }),
      ] },
      { id: 'wrap', label: 'WRAP', tiers: [
        tier('Wrap', 110, undefined, 'Hits may pin enemies in place.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.25, duration: 1 }),
        tier('Slam', 230, 8, 'Hits knock non-Titan enemies back up the lane.',
          { kind: 'knockback', distance: 1 }),
        tier('Glare', 400, 25, 'Pins land more often. Unlocks Glare.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.4, duration: 1.2 }, { kind: 'signature', signatureId: 'glare' }),
      ] },
      { id: 'scale', label: 'SCALE', tiers: [
        tier('Dragon Dance', 120, undefined, 'Attacks 20% faster.',
          { kind: 'scale', rate: 1.2 }),
        tier('Agility', 240, 8, 'Attacks 25% faster and reaches further.',
          { kind: 'scale', rate: 1.25, range: 1.2 }),
        tier('Hyper Beam', 440, 25, 'Attacks 15% faster. Unlocks Hyper Beam.',
          { kind: 'scale', rate: 1.15 }, { kind: 'signature', signatureId: 'dragon_beam' }),
      ] },
    ],
    createModel: () => M.createDragonair(),
    description: 'Weak for a long time; the strongest tower in the stadium at full level.',
  },
  lapras: {
    id: 'lapras', deployCost: 170, expYield: 219, role: 'THE FROST AURA',
    forms: [form('Lapras', 'Water', 0, 85, 60, 95, 'Ice')],
    basicAttack: 'ice_shard',
    paths: [
      { id: 'frost', label: 'FROST', tiers: [
        tier('Mist', 130, undefined, 'Enemies in range move 20% slower.',
          { kind: 'slowAura', slow: 0.2 }),
        tier('Haze', 250, 8, 'Enemies in range move 35% slower.',
          { kind: 'slowAura', slow: 0.35 }),
        tier('Sheer Cold', 420, 20, 'Enemies in range move 45% slower. Unlocks Sheer Cold.',
          { kind: 'slowAura', slow: 0.45 }, { kind: 'signature', signatureId: 'sheer_cold' }),
      ] },
      { id: 'song', label: 'SONG', tiers: [
        tier('Sing', 120, undefined, 'Hits may put enemies to sleep.',
          { kind: 'onHitStatus', status: 'sleep', chance: 0.2, duration: 2 }),
        tier('Lullaby', 240, 8, 'Sleep spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3 }),
        tier('Sing', 400, 20, 'Sleep lands more often. Unlocks Sing.',
          { kind: 'onHitStatus', status: 'sleep', chance: 0.35, duration: 2.5 }, { kind: 'signature', signatureId: 'lullaby' }),
      ] },
      { id: 'beam', label: 'BEAM', tiers: [
        tier('Ice Beam', 130, undefined, 'The attack becomes a freezing beam.',
          { kind: 'replaceAttack', moveId: 'ice_beam' }),
        tier('Deep Freeze', 250, 8, 'The beam hits 30% harder and reaches further.',
          { kind: 'scale', damage: 1.3, range: 1.15 }),
        tier('Ice Beam+', 440, 20, 'The beam hits 20% harder. Unlocks Ice Beam.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'ice_beam_sig' }),
      ] },
    ],
    createModel: () => M.createDragonair(),
    description: 'A sturdy ferry that chills everything around it to a crawl.',
  },
  exeggcute: {
    id: 'exeggcute', deployCost: 130, expYield: 98, role: 'THE SCATTER',
    forms: [form('Exeggcute', 'Grass', 0, 40, 40, 60, 'Psychic'), form('Exeggutor', 'Grass', 30, 95, 55, 125, 'Psychic')],
    basicAttack: 'egg_bomb',
    paths: [
      { id: 'scatter', label: 'SCATTER', tiers: [
        tier('Barrage', 120, undefined, 'Lobs eggs at 2 enemies at once.',
          { kind: 'multishot', count: 2 }),
        tier('Egg Storm', 250, 8, 'Lobs eggs at 4 enemies at once.',
          { kind: 'multishot', count: 4 }),
        tier('Egg Barrage', 420, 25, 'Eggs hit 15% harder. Unlocks Egg Barrage.',
          { kind: 'scale', damage: 1.15 }, { kind: 'signature', signatureId: 'egg_barrage' }),
      ] },
      { id: 'psy', label: 'PSY', tiers: [
        tier('Confusion', 110, undefined, 'Hits may confuse.',
          { kind: 'onHitStatus', status: 'confuse', chance: 0.25, duration: 1.5 }),
        tier('Psywave', 230, 8, 'Eggs hit 25% harder.',
          { kind: 'scale', damage: 1.25 }),
        tier('Psychic', 400, 25, 'Eggs hit 15% harder. Unlocks Psychic.',
          { kind: 'scale', damage: 1.15 }, { kind: 'signature', signatureId: 'psychic_all' }),
      ] },
      { id: 'seed', label: 'SEED', tiers: [
        tier('Leech Seed', 110, undefined, 'Hits may plant a draining seed.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.35, duration: 8 }),
        tier('Seed Burst', 220, 8, 'When a seeded enemy faints, the seed jumps to the nearest enemy.',
          { kind: 'seedJump', radius: 7 }),
        tier('Stun Spore', 380, 25, 'Seeds plant more often. Unlocks Stun Spore.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.55, duration: 8 }, { kind: 'signature', signatureId: 'stun_grove' }),
      ] },
    ],
    createModel: () => M.createGeodude(),
    description: 'Lobs eggs at several enemies at once.',
  },
  rhyhorn: {
    id: 'rhyhorn', deployCost: 140, expYield: 135, role: 'THE MORTAR',
    forms: [form('Rhyhorn', 'Ground', 0, 85, 25, 30, 'Rock'), form('Rhydon', 'Ground', 42, 130, 40, 45, 'Rock')],
    basicAttack: 'rock_mortar',
    paths: [
      { id: 'shell', label: 'SHELL', tiers: [
        tier('Bigger Shells', 130, undefined, 'Shells burst over a wider area.',
          { kind: 'modifyAttack', patch: { splashRadius: 4.5 } }),
        tier('Aftershock', 250, 8, 'Shells hit 15% harder and may stun.',
          { kind: 'scale', damage: 1.15 }, { kind: 'onHitStatus', status: 'stun', chance: 0.3, duration: 1 }),
        tier('Earthquake', 440, 25, 'Shells hit 20% harder. Unlocks Earthquake.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'mortar_quake' }),
      ] },
      { id: 'range', label: 'RANGE', tiers: [
        tier('Long Range', 120, undefined, 'Reaches 30% further.',
          { kind: 'scale', range: 1.3 }),
        tier('Rapid Reload', 240, 8, 'Fires 35% faster.',
          { kind: 'scale', rate: 1.35 }),
        tier('Rock Blast', 420, 25, 'Reaches 10% further. Unlocks Rock Blast.',
          { kind: 'scale', range: 1.1 }, { kind: 'signature', signatureId: 'barrage' }),
      ] },
      { id: 'horn', label: 'HORN', tiers: [
        tier('Horn Attack', 120, undefined, 'Deals 40% more to elites and Titans.',
          { kind: 'bonusVs', target: 'boss', multiplier: 1.4 }),
        tier('Drill Horn', 240, 8, 'Each hit also takes 8% of the enemy’s remaining HP. Bosses lose 1%.',
          { kind: 'percentDamage', share: 0.08, bossShare: 0.01 }),
        tier('Horn Drill', 440, 25, 'Hits 20% harder. Unlocks Horn Drill.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'horn_drill' }),
      ] },
    ],
    createModel: () => M.createGeodude(),
    description: 'A long, slow lob that shatters clusters from across the pitch. Can’t hit flyers.',
  },
  scyther: {
    id: 'scyther', deployCost: 160, expYield: 187, role: 'THE DUELIST',
    forms: [form('Scyther', 'Bug', 0, 110, 105, 55, 'Flying')],
    basicAttack: 'fury_cutter',
    paths: [
      { id: 'slash', label: 'SLASH', tiers: [
        tier('Slash', 130, undefined, 'Can crit for double.',
          { kind: 'crit', chance: 0.25, multiplier: 2 }),
        tier('Swords Dance', 260, 8, 'Blades hit 35% harder and become Heavy.',
          { kind: 'scale', damage: 1.35 }, { kind: 'modifyAttack', patch: { heavy: true } }),
        tier('X-Scissor', 440, 20, 'Blades hit 20% harder. Unlocks X-Scissor.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'x_scissor_scyther' }),
      ] },
      { id: 'fury', label: 'FURY', tiers: [
        tier('Fury Cutter', 120, undefined, 'Each hit on the same target deals 8% more, up to 10 times.',
          { kind: 'rage', perStack: 0.08, maxStacks: 10 }),
        tier('Frenzy', 240, 8, 'Attacks 25% faster.',
          { kind: 'scale', rate: 1.25 }),
        tier('Swords Dance', 420, 20, 'Attacks 15% faster. Unlocks Swords Dance.',
          { kind: 'scale', rate: 1.15 }, { kind: 'signature', signatureId: 'swords_dance' }),
      ] },
      { id: 'wing', label: 'WING', tiers: [
        tier('Wing Attack', 120, undefined, 'Deals 60% more to flyers.',
          { kind: 'bonusVs', target: 'airborne', multiplier: 1.6 }),
        tier('Double Team', 250, 8, 'Slashes 2 enemies at once.',
          { kind: 'multishot', count: 2 }),
        tier('Razor Wind', 420, 20, 'Blades reach 20% further. Unlocks Razor Wind.',
          { kind: 'scale', range: 1.2 }, { kind: 'signature', signatureId: 'razor_wind' }),
      ] },
    ],
    createModel: () => M.createZubat(),
    description: 'The fastest single-target attack in the stadium.',
  },
  voltorb: {
    id: 'voltorb', deployCost: 110, expYield: 103, role: 'THE BURST',
    forms: [form('Voltorb', 'Electric', 0, 30, 100, 55), form('Electrode', 'Electric', 30, 50, 140, 80)],
    basicAttack: 'spark_burst',
    paths: [
      { id: 'surge', label: 'SURGE', tiers: [
        tier('Discharge', 110, undefined, 'The burst reaches 30% further.',
          { kind: 'scale', range: 1.3 }),
        tier('Overcharge', 230, 8, 'Bursts hit 35% harder and 15% faster.',
          { kind: 'scale', damage: 1.35, rate: 1.15 }),
        tier('Self-Destruct', 400, 25, 'Bursts hit 15% harder. Unlocks Self-Destruct.',
          { kind: 'scale', damage: 1.15 }, { kind: 'signature', signatureId: 'self_destruct' }),
      ] },
      { id: 'static', label: 'STATIC', tiers: [
        tier('Static', 100, undefined, 'Bursts paralyze more often.',
          { kind: 'onHitStatus', status: 'paralyze', chance: 0.35, duration: 2 }),
        tier('Static Field', 210, 8, 'Paralysis spreads to enemies next to each target.',
          { kind: 'spreadStatus', radius: 3 }),
        tier('Thunder Wave', 380, 25, 'The burst reaches 15% further. Unlocks Thunder Wave.',
          { kind: 'scale', range: 1.15 }, { kind: 'signature', signatureId: 'volt_wave' }),
      ] },
      { id: 'roll', label: 'ROLL', tiers: [
        tier('Rollout', 110, undefined, 'Bursts speed up while it keeps firing, up to double rate.',
          { kind: 'spinUp', perShot: 0.08, max: 1 }),
        tier('Speed Roll', 230, 8, 'Bursts 25% faster.',
          { kind: 'scale', rate: 1.25 }),
        tier('Charge', 390, 25, 'Spins up to 150% faster. Unlocks Charge.',
          { kind: 'spinUp', perShot: 0.1, max: 1.5 }, { kind: 'signature', signatureId: 'charge' }),
      ] },
    ],
    createModel: () => M.createRattata(),
    description: 'Crackles in every direction at once.',
  },
  onix: {
    id: 'onix', deployCost: 140, expYield: 108, role: 'THE WALL',
    forms: [form('Onix', 'Rock', 0, 45, 70, 30, 'Ground')],
    basicAttack: 'bind',
    paths: [
      { id: 'wall', label: 'WALL', tiers: [
        tier('Rock Tomb', 130, undefined, 'Every 5th attack drops stone on the lane that pins enemies in place.',
          { kind: 'hazard', hazard: 'rock_tomb', everyNth: 5 }),
        tier('Stone Wall', 250, 8, 'The stone is bigger and stands longer.',
          { kind: 'hazard', hazard: 'stone_wall', everyNth: 5 }),
        tier('Rock Wall', 420, 20, 'Stone drops every 4th attack. Unlocks Rock Wall.',
          { kind: 'hazard', hazard: 'stone_wall', everyNth: 4 }, { kind: 'signature', signatureId: 'rock_wall' }),
      ] },
      { id: 'bind', label: 'BIND', tiers: [
        tier('Wrap', 110, undefined, 'Pins enemies in place more often.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.35, duration: 1.2 }),
        tier('Constrict', 230, 8, 'A pin spreads to enemies next to the target.',
          { kind: 'spreadStatus', radius: 3 }),
        tier('Bind', 400, 20, 'Pins land more often. Unlocks Bind.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.5, duration: 1.4 }, { kind: 'signature', signatureId: 'mass_bind' }),
      ] },
      { id: 'quake', label: 'QUAKE', tiers: [
        tier('Rock Throw', 120, undefined, 'The attack becomes lobbed boulders. Can’t hit flyers.',
          { kind: 'replaceAttack', moveId: 'rock_throw' }),
        tier('Heavy Stone', 240, 8, 'Boulders hit 30% harder and reach further.',
          { kind: 'scale', damage: 1.3, range: 1.2 }),
        tier('Earthquake', 420, 20, 'Boulders hit 20% harder. Unlocks Earthquake.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'onix_quake' }),
      ] },
    ],
    createModel: () => M.createBossTitan('Onix'),
    description: 'Holds the lane shut with stone and coils.',
  },
  magikarp: {
    id: 'magikarp', deployCost: 90, expYield: 20, role: 'THE LATE BLOOMER',
    forms: [form('Magikarp', 'Water', 0, 10, 80, 20), form('Gyarados', 'Water', 20, 125, 81, 100, 'Flying')],
    basicAttack: 'splash',
    formAttacks: ['splash', 'twister'],
    paths: [
      { id: 'rampage', label: 'RAMPAGE', tiers: [
        tier('Thrash', 150, 20, 'Each hit on the same target deals 12% more, up to 8 times.',
          { kind: 'rage', perStack: 0.12, maxStacks: 8 }),
        tier('Dragon Rage', 280, 20, 'Twisters hit 30% harder.',
          { kind: 'scale', damage: 1.3 }),
        tier('Hyper Beam', 460, 20, 'Twisters hit 20% harder. Unlocks Hyper Beam.',
          { kind: 'scale', damage: 1.2 }, { kind: 'signature', signatureId: 'gyarados_beam' }),
      ] },
      { id: 'tide', label: 'TIDE', tiers: [
        tier('Aqua Tail', 140, 20, 'Hits knock non-Titan enemies back up the lane.',
          { kind: 'knockback', distance: 1.2 }),
        tier('Waterfall', 260, 20, 'Hits may stun.',
          { kind: 'onHitStatus', status: 'stun', chance: 0.3, duration: 1 }),
        tier('Surf', 440, 20, 'Twisters reach 20% further. Unlocks Surf.',
          { kind: 'scale', range: 1.2 }, { kind: 'signature', signatureId: 'tidal_wave' }),
      ] },
      { id: 'intimidate', label: 'INTIMIDATE', tiers: [
        tier('Intimidate', 130, 20, 'Enemies in range move 20% slower.',
          { kind: 'slowAura', slow: 0.2 }),
        tier('Scary Face', 250, 20, 'Enemies in range move 35% slower.',
          { kind: 'slowAura', slow: 0.35 }),
        tier('Roar', 420, 20, 'Enemies in range move 40% slower. Unlocks Roar.',
          { kind: 'slowAura', slow: 0.4 }, { kind: 'signature', signatureId: 'roar' }),
      ] },
    ],
    createModel: () => M.createBossTitan('Gyarados'),
    description: 'Useless until Lv 20. Then, a Gyarados.',
  },
};

/** Every move a Pokémon of this level could end up firing: its basic attack and any it can swap in. */
export function reachableMoveIds(species: SpeciesDef, level: number): string[] {
  const swaps = species.paths.flatMap(path => path.tiers
    .filter(t => (t.requiresLevel ?? 0) <= level)
    .flatMap(t => t.effects.flatMap(effect => effect.kind === 'replaceAttack' ? [effect.moveId] : [])));
  return [...new Set([species.basicAttack, ...(species.formAttacks ?? []), ...swaps])];
}

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export const GIFT_ID = 'pikachu';

/** Index of every form name to its species and stage, for mapping creeps. */
const FORM_INDEX = new Map<string, { speciesId: string; stage: number }>();
for (const species of Object.values(SPECIES)) {
  species.forms.forEach((f, stage) => FORM_INDEX.set(f.name.toLowerCase(), { speciesId: species.id, stage }));
}

/** Maps a creep's display name ("Titan Onix", "Haunter") onto a species and stage. */
export function speciesForCreepName(name: string): { speciesId: string; stage: number } | null {
  return FORM_INDEX.get(name.replace(/^(titan|boss)\s+/i, '').trim().toLowerCase()) ?? null;
}

/** National Pokédex number of each line's first form; every line here evolves in dex order. */
const BASE_DEX: Record<string, number> = {
  bulbasaur: 1, charmander: 4, squirtle: 7, pidgey: 16, rattata: 19, pikachu: 25, zubat: 41, oddish: 43,
  paras: 46, psyduck: 54, abra: 63, machop: 66, geodude: 74, ponyta: 77, gastly: 92, onix: 95, voltorb: 100,
  exeggcute: 102, rhyhorn: 111, scyther: 123, magikarp: 129, lapras: 131, dratini: 147,
};

export function dexNumber(speciesId: string, stage: number): number {
  return (BASE_DEX[speciesId] ?? 999) + stage;
}

export function getSpecies(id: string): SpeciesDef {
  const species = SPECIES[id];
  if (!species) throw new Error(`Unknown species "${id}"`);
  return species;
}

/** The furthest form a Pokémon of this level qualifies for. */
export function stageForLevel(species: SpeciesDef, level: number): number {
  let stage = 0;
  species.forms.forEach((f, i) => { if (i > 0 && level >= f.atLevel) stage = i; });
  return stage;
}
