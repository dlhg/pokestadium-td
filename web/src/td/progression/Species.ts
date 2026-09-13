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
import { MOVES } from '../../stadium/MoveDatabase';
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
  paths: PathDef[];
  createModel: () => AnimatedPokemon;
  description: string;
}

type TierSpec = [moveId: string, cost: number, requiresLevel?: number];

/**
 * Interim shape for species not yet given designed paths: the old move lines
 * become paths whose tiers each swap in their move.
 */
function legacyPaths(special: TierSpec[], coverage: TierSpec[], control: TierSpec[]): Pick<SpeciesDef, 'basicAttack' | 'paths' | 'role'> {
  const toTier = ([moveId, cost, requiresLevel]: TierSpec): PathTier => ({
    name: MOVES[moveId].name, cost, requiresLevel,
    effects: [{ kind: 'replaceAttack', moveId }],
    description: MOVES[moveId].description,
  });
  return {
    role: 'ALL-ROUNDER',
    basicAttack: special[0][0],
    paths: [
      { id: 'special', label: 'SPECIAL', tiers: special.slice(1).map(toTier) },
      { id: 'coverage', label: 'COVERAGE', tiers: coverage.map(toTier) },
      { id: 'control', label: 'CONTROL', tiers: control.map(toTier) },
    ].filter(path => path.tiers.length > 0),
  };
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
        tier('Sleep Powder', 220, 8, 'Patches become bigger, last longer, and put creeps to sleep.',
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
        tier('Leech Seed', 110, undefined, 'Hits may plant a seed that drains the creep for 8 s.',
          { kind: 'onHitStatus', status: 'poison', chance: 0.35, duration: 8 }),
        tier('Spreading Roots', 200, 8, 'When a seeded creep faints, the seed jumps to the nearest creep.',
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
        tier('Fire Spin', 230, 8, 'The embers become a vortex that briefly traps creeps.',
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
        tier('BubbleBeam', 120, undefined, 'The attack becomes a beam that pierces 3 creeps.',
          { kind: 'replaceAttack', moveId: 'bubblebeam' }),
        tier('Full Pressure', 230, 8, 'The beam pierces every creep in its line.',
          { kind: 'modifyAttack', patch: { pierce: undefined } }, { kind: 'scale', range: 1.15 }),
        tier('Hydro Pump', 420, 16, 'The beam hits 35% harder. Unlocks Hydro Pump.',
          { kind: 'scale', damage: 1.35 }, { kind: 'signature', signatureId: 'hydro_pump' }),
      ] },
      { id: 'chill', label: 'CHILL', tiers: [
        tier('Chilling Water', 110, undefined, 'Every hit slows the creep.',
          { kind: 'onHitStatus', status: 'freeze', chance: 1, duration: 1.5 }),
        tier('Cold Front', 220, 8, 'Creeps in range move 25% slower.',
          { kind: 'slowAura', slow: 0.25 }),
        tier('Blizzard', 400, 16, 'Creeps in range move 40% slower. Unlocks Blizzard.',
          { kind: 'slowAura', slow: 0.4 }, { kind: 'signature', signatureId: 'blizzard' }),
      ] },
      { id: 'surf', label: 'SURF', tiers: [
        tier('Ripple', 120, undefined, 'The attack becomes a small ring of water around the tower.',
          { kind: 'replaceAttack', moveId: 'surf_ring' }),
        tier('Undertow', 230, 8, 'Hits knock non-Titan creeps back along the lane.',
          { kind: 'knockback', distance: 1.2 }),
        tier('Surf', 400, 16, 'A wider ring. Unlocks Surf.',
          { kind: 'scale', range: 1.3 }, { kind: 'signature', signatureId: 'surf' }),
      ] },
    ],
    createModel: () => M.createBlastoise(),
    description: 'Holds creeps back. Belongs at the end of a straightaway.',
  },
  pikachu: {
    id: 'pikachu', deployCost: 100, expYield: 82, role: 'THE STRIKER',
    forms: [form('Pikachu', 'Electric', 0, 55, 90, 50), form('Raichu', 'Electric', 26, 90, 100, 90)],
    basicAttack: 'thundershock',
    paths: [
      { id: 'storm', label: 'STORM', tiers: [
        tier('Thunderbolt', 100, undefined, 'The attack becomes Thunderbolt, which chains to 2 more creeps.',
          { kind: 'replaceAttack', moveId: 'thunderbolt' }, { kind: 'chain', count: 2 }),
        tier('Chain Lightning', 210, 8, 'Bolts chain to 4 more creeps.',
          { kind: 'chain', count: 4 }),
        tier('Thunder', 380, 18, 'Bolts hit 30% harder. Unlocks Thunder.',
          { kind: 'scale', damage: 1.3 }, { kind: 'signature', signatureId: 'thunder' }),
      ] },
      { id: 'static', label: 'STATIC', tiers: [
        tier('Static', 100, undefined, 'Hits may paralyze.',
          { kind: 'onHitStatus', status: 'paralyze', chance: 0.35, duration: 2 }),
        tier('Static Field', 210, 8, 'Paralysis spreads to creeps next to the target.',
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
    id: 'gastly', deployCost: 140, expYield: 95,
    forms: [form('Gastly', 'Ghost', 0, 35, 80, 100, 'Poison'), form('Haunter', 'Ghost', 25, 50, 95, 115, 'Poison'), form('Gengar', 'Ghost', 38, 65, 110, 130, 'Poison')],
    ...legacyPaths(
      [['lick', 0], ['night_shade', 160, 10], ['shadow_ball', 330, 38]],
      [['sludge', 100], ['psychic', 260, 25], ['hyper_beam', 440, 38]],
      [['confuse_ray', 100], ['hypnosis', 200, 14], ['toxic', 300, 25]],
    ),
    createModel: () => M.createGengar(),
    description: 'Ghostly entity whose Night Shade ignores elemental match-ups entirely.',
  },
  abra: {
    id: 'abra', deployCost: 150, expYield: 75,
    forms: [form('Abra', 'Psychic', 0, 20, 90, 105), form('Kadabra', 'Psychic', 16, 35, 105, 120), form('Alakazam', 'Psychic', 36, 50, 120, 135)],
    ...legacyPaths(
      [['confusion', 0], ['psybeam', 170, 10], ['psychic', 350, 36]],
      [['seismic_toss', 110], ['dig', 240, 16], ['hyper_beam', 450, 36]],
      [['disable', 90], ['hypnosis', 200, 14], ['toxic', 300, 24]],
    ),
    createModel: () => M.createAlakazam(),
    description: 'Long-range psychic control. Seismic Toss lands regardless of typing.',
  },
  rattata: {
    id: 'rattata', deployCost: 80, expYield: 57,
    forms: [form('Rattata', 'Normal', 0, 56, 72, 25), form('Raticate', 'Normal', 20, 81, 97, 50)],
    ...legacyPaths(
      [['quick_attack', 0], ['bite', 110, 8], ['hyper_beam', 380, 20]],
      [['body_slam', 120], ['ice_beam', 230, 14], ['thunderbolt', 300, 20]],
      [['flash', 90], ['thunder_wave', 170, 10], ['toxic', 260, 20]],
    ),
    createModel: () => M.createRattata(),
    description: 'Cheap and quick. Coverage moves let it answer almost anything.',
  },
  pidgey: {
    id: 'pidgey', deployCost: 90, expYield: 55,
    forms: [form('Pidgey', 'Normal', 0, 45, 56, 35, 'Flying'), form('Pidgeotto', 'Normal', 18, 60, 71, 50, 'Flying'), form('Pidgeot', 'Normal', 36, 80, 91, 70, 'Flying')],
    ...legacyPaths(
      [['quick_attack', 0], ['wing_attack', 140, 8]],
      [['bite', 90], ['body_slam', 190, 14], ['hyper_beam', 400, 36]],
      [['smokescreen', 80], ['flash', 150, 12], ['toxic', 260, 22]],
    ),
    createModel: () => M.createZubat(),
    description: 'A fast flier that blinds the lane with Sand Attack smokescreens.',
  },
  zubat: {
    id: 'zubat', deployCost: 100, expYield: 54,
    forms: [form('Zubat', 'Poison', 0, 45, 55, 40, 'Flying'), form('Golbat', 'Poison', 22, 80, 90, 75, 'Flying')],
    ...legacyPaths(
      [['bite', 0], ['wing_attack', 120, 8], ['sludge', 240, 22]],
      [['quick_attack', 80], ['hyper_beam', 420, 22]],
      [['confuse_ray', 100], ['disable', 160, 10], ['toxic', 260, 22]],
    ),
    createModel: () => M.createZubat(),
    description: 'Confuses and poisons whole packs from the cave dark.',
  },
  paras: {
    id: 'paras', deployCost: 110, expYield: 70,
    forms: [form('Paras', 'Bug', 0, 70, 25, 55, 'Grass'), form('Parasect', 'Bug', 24, 95, 30, 80, 'Grass')],
    ...legacyPaths(
      [['vine_whip', 0], ['razor_leaf', 150, 10], ['solar_beam', 360, 24]],
      [['dig', 130], ['body_slam', 200, 14], ['hyper_beam', 420, 24]],
      [['stun_spore', 90], ['sleep_powder', 180, 12], ['leech_seed', 280, 24]],
    ),
    createModel: () => M.createRattata(),
    description: 'Slow, but its spores lock down anything that wanders close.',
  },
  geodude: {
    id: 'geodude', deployCost: 120, expYield: 86,
    forms: [form('Geodude', 'Rock', 0, 80, 20, 30, 'Ground'), form('Graveler', 'Rock', 25, 95, 35, 45, 'Ground'), form('Golem', 'Rock', 36, 110, 45, 55, 'Ground')],
    ...legacyPaths(
      [['seismic_toss', 0], ['dig', 150, 8], ['earthquake', 330, 25]],
      [['body_slam', 110], ['fire_blast', 380, 36]],
      [['toxic', 200, 12]],
    ),
    createModel: () => M.createGeodude(),
    description: 'Hits like a landslide and answers the Electric types it resists.',
  },
  machop: {
    id: 'machop', deployCost: 120, expYield: 88,
    forms: [form('Machop', 'Fighting', 0, 80, 35, 35), form('Machoke', 'Fighting', 28, 100, 45, 50), form('Machamp', 'Fighting', 40, 130, 55, 65)],
    ...legacyPaths(
      [['seismic_toss', 0], ['body_slam', 160, 10], ['earthquake', 340, 28]],
      [['dig', 130], ['fire_blast', 360, 40]],
      [['smokescreen', 80], ['toxic', 220, 16]],
    ),
    createModel: () => M.createGeodude(),
    description: 'Raw power. Seismic Toss ignores type match-ups.',
  },
  ponyta: {
    id: 'ponyta', deployCost: 130, expYield: 152,
    forms: [form('Ponyta', 'Fire', 0, 85, 90, 65), form('Rapidash', 'Fire', 40, 100, 105, 80)],
    ...legacyPaths(
      [['ember', 0], ['flamethrower', 160, 10], ['fire_blast', 340, 40]],
      [['quick_attack', 80], ['body_slam', 180, 12], ['hyper_beam', 420, 40]],
      [['smokescreen', 90], ['fire_spin', 180, 14]],
    ),
    createModel: () => M.createRattata(),
    description: 'A blazing sprinter with strong stats from the very start.',
  },
  oddish: {
    id: 'oddish', deployCost: 110, expYield: 78,
    forms: [form('Oddish', 'Grass', 0, 50, 30, 75, 'Poison'), form('Gloom', 'Grass', 21, 65, 40, 85, 'Poison'), form('Vileplume', 'Grass', 36, 80, 50, 100, 'Poison')],
    ...legacyPaths(
      [['vine_whip', 0], ['razor_leaf', 150, 10], ['solar_beam', 340, 36]],
      [['sludge', 110], ['body_slam', 220, 21]],
      [['stun_spore', 90], ['sleep_powder', 180, 12], ['toxic', 280, 21]],
    ),
    createModel: () => M.createRattata(),
    description: 'A status specialist whose powders stack with every other control tower.',
  },
  psyduck: {
    id: 'psyduck', deployCost: 120, expYield: 80,
    forms: [form('Psyduck', 'Water', 0, 52, 55, 50), form('Golduck', 'Water', 33, 82, 85, 80)],
    ...legacyPaths(
      [['water_gun', 0], ['surf', 150, 10], ['hydro_pump', 340, 33]],
      [['confusion', 100], ['ice_beam', 230, 14], ['psychic', 360, 33]],
      [['bubble', 80], ['disable', 160, 12]],
    ),
    createModel: () => M.createRattata(),
    description: 'Water pressure with a surprising Psychic coverage line.',
  },
  dratini: {
    id: 'dratini', deployCost: 150, expYield: 67,
    forms: [form('Dratini', 'Dragon', 0, 64, 50, 50), form('Dragonair', 'Dragon', 30, 84, 70, 70), form('Dragonite', 'Dragon', 50, 134, 80, 100, 'Flying')],
    ...legacyPaths(
      [['quick_attack', 0], ['body_slam', 160, 10], ['hyper_beam', 420, 30]],
      [['thunderbolt', 180], ['ice_beam', 240, 16], ['blizzard', 420, 40]],
      [['thunder_wave', 110], ['toxic', 260, 20]],
    ),
    createModel: () => M.createDragonair(),
    description: 'A slow-growing dragon that becomes the strongest tower in the stadium.',
  },
  lapras: {
    id: 'lapras', deployCost: 170, expYield: 219,
    forms: [form('Lapras', 'Water', 0, 85, 60, 95, 'Ice')],
    ...legacyPaths(
      [['water_gun', 0], ['surf', 160, 10], ['hydro_pump', 340, 30]],
      [['ice_beam', 180, 12], ['blizzard', 400, 30]],
      [['confuse_ray', 100], ['hypnosis', 180, 14]],
    ),
    createModel: () => M.createDragonair(),
    description: 'A rare, sturdy all-rounder with the best Ice coverage around.',
  },
  exeggcute: {
    id: 'exeggcute', deployCost: 130, expYield: 98,
    forms: [form('Exeggcute', 'Grass', 0, 40, 40, 60, 'Psychic'), form('Exeggutor', 'Grass', 30, 95, 55, 125, 'Psychic')],
    ...legacyPaths(
      [['confusion', 0], ['psybeam', 160, 10], ['psychic', 340, 30]],
      [['razor_leaf', 120], ['solar_beam', 360, 30]],
      [['stun_spore', 90], ['sleep_powder', 180, 12], ['leech_seed', 280, 30]],
    ),
    createModel: () => M.createGeodude(),
    description: 'Psychic blasts from a grove of eggs. Huge Special.',
  },
  rhyhorn: {
    id: 'rhyhorn', deployCost: 140, expYield: 135,
    forms: [form('Rhyhorn', 'Ground', 0, 85, 25, 30, 'Rock'), form('Rhydon', 'Ground', 42, 130, 40, 45, 'Rock')],
    ...legacyPaths(
      [['body_slam', 0], ['dig', 150, 10], ['earthquake', 330, 42]],
      [['thunderbolt', 200, 14], ['fire_blast', 380, 42]],
      [['smokescreen', 80], ['toxic', 220, 16]],
    ),
    createModel: () => M.createGeodude(),
    description: 'A slow battering ram whose Earthquake flattens whole waves.',
  },
  scyther: {
    id: 'scyther', deployCost: 160, expYield: 187,
    forms: [form('Scyther', 'Bug', 0, 110, 105, 55, 'Flying')],
    ...legacyPaths(
      [['quick_attack', 0], ['wing_attack', 130, 8], ['hyper_beam', 420, 30]],
      [['seismic_toss', 120]],
      [['smokescreen', 80], ['toxic', 240, 18]],
    ),
    createModel: () => M.createZubat(),
    description: 'Blinding speed. It attacks more often than anything else you own.',
  },
  voltorb: {
    id: 'voltorb', deployCost: 110, expYield: 103,
    forms: [form('Voltorb', 'Electric', 0, 30, 100, 55), form('Electrode', 'Electric', 30, 50, 140, 80)],
    ...legacyPaths(
      [['thundershock', 0], ['thunderbolt', 150, 10], ['thunder', 330, 30]],
      [['hyper_beam', 420, 30]],
      [['thunder_wave', 110], ['flash', 170, 12], ['toxic', 260, 20]],
    ),
    createModel: () => M.createRattata(),
    description: 'The fastest Pokémon there is. Paralysis on a hair trigger.',
  },
  onix: {
    id: 'onix', deployCost: 140, expYield: 108,
    forms: [form('Onix', 'Rock', 0, 45, 70, 30, 'Ground')],
    ...legacyPaths(
      [['body_slam', 0], ['dig', 150, 10], ['earthquake', 330, 30]],
      [['quick_attack', 80]],
      [['toxic', 220, 14]],
    ),
    createModel: () => M.createBossTitan('Onix'),
    description: 'A rock serpent that shakes the pitch. Rare to catch.',
  },
  magikarp: {
    id: 'magikarp', deployCost: 90, expYield: 20,
    forms: [form('Magikarp', 'Water', 0, 10, 80, 20), form('Gyarados', 'Water', 20, 125, 81, 100, 'Flying')],
    ...legacyPaths(
      [['bubble', 0], ['surf', 150, 20], ['hydro_pump', 330, 30]],
      [['bite', 90, 20], ['ice_beam', 230, 24], ['blizzard', 400, 36]],
      [['toxic', 240, 20]],
    ),
    createModel: () => M.createBossTitan('Gyarados'),
    description: 'Useless until Lv 20. Then, a Gyarados.',
  },
};

/** Every move a Pokémon of this level could end up firing: its basic attack and any it can swap in. */
export function reachableMoveIds(species: SpeciesDef, level: number): string[] {
  const swaps = species.paths.flatMap(path => path.tiers
    .filter(t => (t.requiresLevel ?? 0) <= level)
    .flatMap(t => t.effects.flatMap(effect => effect.kind === 'replaceAttack' ? [effect.moveId] : [])));
  return [...new Set([species.basicAttack, ...swaps])];
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
