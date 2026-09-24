/**
 * MoveDatabase.ts — Authentic Pokémon Stadium Move Registry
 *
 * Defines moves used by Stadium towers, including damage, rate of fire,
 * elemental type, 3D particle effect types, and status effects.
 */

import { PokemonType } from './TypeMatrix';

export type StatusEffectType = 'none' | 'burn' | 'freeze' | 'paralyze' | 'stun' | 'poison' | 'sleep' | 'confuse';

/** Statuses that tick damage. A creep carries at most one of these... */
export type DamageStatus = 'burn' | 'poison';
/** ...plus at most one of these, which change how it moves. */
export type MovementStatus = 'freeze' | 'paralyze' | 'stun' | 'sleep' | 'confuse';

export function isDamageStatus(effect: StatusEffectType): effect is DamageStatus {
  return effect === 'burn' || effect === 'poison';
}

export type ParticleFXType =
  | 'lightning'
  | 'flamethrower'
  | 'water_stream'
  | 'razor_leaf'
  | 'shadow_ball'
  | 'psychic_wave'
  | 'blizzard'
  | 'hyper_beam'
  | 'spore_cloud'
  | 'earthquake'
  | 'impact';

/**
 * How a move reaches what it hits. The shape decides who is caught in it, so
 * each archetype rewards a different spot beside the lane.
 *
 * projectile  a travelling mesh that homes onto one creep, then splashes
 * beam        an instant line from the caster out to full range, piercing
 * cone        an instant arc fanning out from the caster toward the target
 * field       an instant ring around the caster; misses Airborne creeps
 * aura        an instant effect blooming on the target and its splash radius;
 *             untargeted, so it can reach Phantoms
 */
export type DeliveryType = 'projectile' | 'beam' | 'cone' | 'field' | 'aura';

export interface MoveDefinition {
  id: string;
  name: string;
  type: PokemonType;
  basePower: number;
  attackSpeed: number; // Attacks per second
  range: number;       // In 3D arena units
  projectileSpeed: number;
  splashRadius: number; // 0 for single target
  statusEffect: StatusEffectType;
  statusChance: number; // 0.0 - 1.0
  statusDuration: number; // In seconds
  fxType: ParticleFXType;
  delivery: DeliveryType;
  description: string;
  ignoresType?: boolean;
  /** Heavy hits punch through armor. Fixed-damage moves are always Heavy. */
  heavy?: boolean;
  /** Beam only: how many creeps it passes through. Unlimited when omitted. */
  pierce?: number;
  /** Cone only: full width of the arc in degrees. */
  coneAngle?: number;
  /** Lobbed or ground-borne: never targets or hits Airborne creeps. Fields always are. */
  groundOnly?: boolean;
}

/** Whether a move passes under Airborne creeps. */
export function isGroundOnly(move: MoveDefinition): boolean {
  return move.delivery === 'field' || !!move.groundOnly;
}

/** Light hits deal reduced damage to Armored creeps; Heavy ones don't. */
export function isHeavy(move: MoveDefinition): boolean {
  return !!move.heavy || !!move.ignoresType;
}

export const MOVES: Record<string, MoveDefinition> = {
  lick: {
    id: 'lick', name: 'Lick', type: 'Ghost', basePower: 18, attackSpeed: 1.7,
    delivery: 'projectile',
    range: 9, projectileSpeed: 26, splashRadius: 0,
    statusEffect: 'paralyze', statusChance: 0.3, statusDuration: 2.0,
    fxType: 'shadow_ball', description: 'A close ghost strike that may paralyze its target.',
  },
  night_shade: {
    id: 'night_shade', name: 'Night Shade', type: 'Ghost', basePower: 48, attackSpeed: 1.25,
    delivery: 'beam',
    range: 15, projectileSpeed: 25, splashRadius: 2.5,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'shadow_ball', ignoresType: true,
    description: 'Fixed spectral damage that ignores elemental effectiveness.',
  },
  confusion: {
    id: 'confusion', name: 'Confusion', type: 'Psychic', basePower: 22, attackSpeed: 1.5,
    delivery: 'projectile',
    range: 14, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.15, statusDuration: 0.8,
    fxType: 'psychic_wave', description: 'A psychic pulse that can briefly disorient its target.',
  },
  thundershock: {
    id: 'thundershock',
    delivery: 'projectile',
    name: 'ThunderShock',
    type: 'Electric',
    basePower: 18,
    attackSpeed: 1.4,
    range: 12,
    projectileSpeed: 30,
    splashRadius: 0,
    statusEffect: 'paralyze',
    statusChance: 0.15,
    statusDuration: 2.0,
    fxType: 'lightning',
    description: 'A jolt of electricity that may paralyze the target.',
  },
  thunderbolt: {
    id: 'thunderbolt',
    delivery: 'projectile',
    name: 'Thunderbolt',
    type: 'Electric',
    basePower: 26,
    attackSpeed: 1.3,
    range: 16,
    projectileSpeed: 36,
    splashRadius: 0,
    statusEffect: 'paralyze',
    statusChance: 0.25,
    statusDuration: 3.0,
    fxType: 'lightning',
    description: 'A strong bolt that may paralyze its target.',
  },
  thunder: {
    id: 'thunder',
    delivery: 'field', heavy: true,
    name: 'Thunder',
    type: 'Electric',
    basePower: 110,
    attackSpeed: 0.7,
    range: 18,
    projectileSpeed: 45,
    splashRadius: 6.0,
    statusEffect: 'paralyze',
    statusChance: 0.50,
    statusDuration: 4.0,
    fxType: 'lightning',
    description: 'A colossal bolt striking down from the stadium ceiling.',
  },
  ember: {
    id: 'ember',
    delivery: 'projectile',
    name: 'Ember',
    type: 'Fire',
    basePower: 16,
    attackSpeed: 1.6,
    range: 11,
    projectileSpeed: 24,
    splashRadius: 1.5,
    statusEffect: 'burn',
    statusChance: 0.20,
    statusDuration: 3.0,
    fxType: 'flamethrower',
    description: 'Small flames launched at the enemy, inflicting burn damage.',
  },
  flamethrower: {
    id: 'flamethrower',
    delivery: 'cone',
    name: 'Flamethrower',
    type: 'Fire',
    basePower: 30,
    attackSpeed: 1.4,
    range: 11,
    projectileSpeed: 28,
    splashRadius: 0,
    coneAngle: 60,
    statusEffect: 'burn',
    statusChance: 0.25,
    statusDuration: 4.0,
    fxType: 'flamethrower',
    description: 'A stream of searing flames scorching groups of invaders.',
  },
  fire_blast: {
    id: 'fire_blast',
    delivery: 'field', heavy: true,
    name: 'Fire Blast',
    type: 'Fire',
    basePower: 130,
    attackSpeed: 0.65,
    range: 17,
    projectileSpeed: 26,
    splashRadius: 7.0,
    statusEffect: 'burn',
    statusChance: 0.60,
    statusDuration: 5.0,
    fxType: 'flamethrower',
    description: 'The iconic kanji-shaped fire blast exploding on the field.',
  },
  water_gun: {
    id: 'water_gun',
    delivery: 'projectile',
    name: 'Water Gun',
    type: 'Water',
    basePower: 20,
    attackSpeed: 1.5,
    range: 13,
    projectileSpeed: 26,
    splashRadius: 0,
    statusEffect: 'freeze', // represented as slow
    statusChance: 0.30,
    statusDuration: 2.0,
    fxType: 'water_stream',
    description: 'A pressurized jet of water that slows enemy advance.',
  },
  hydro_pump: {
    id: 'hydro_pump',
    delivery: 'beam', heavy: true,
    name: 'Hydro Pump',
    type: 'Water',
    basePower: 68,
    attackSpeed: 1.1,
    range: 17,
    projectileSpeed: 34,
    splashRadius: 4.5,
    statusEffect: 'freeze',
    statusChance: 0.50,
    statusDuration: 3.5,
    fxType: 'water_stream',
    description: 'Blasts high-velocity water cannons, dealing massive burst & slow.',
  },
  vine_whip: {
    id: 'vine_whip',
    delivery: 'projectile',
    name: 'Vine Whip',
    type: 'Grass',
    basePower: 22,
    attackSpeed: 1.8,
    range: 10,
    projectileSpeed: 30,
    splashRadius: 0,
    statusEffect: 'none',
    statusChance: 0,
    statusDuration: 0,
    fxType: 'razor_leaf',
    description: 'Rapid, flexible strikes that punish early creep waves.',
  },
  razor_leaf: {
    id: 'razor_leaf',
    delivery: 'cone',
    name: 'Razor Leaf',
    type: 'Grass',
    basePower: 30,
    attackSpeed: 1.5,
    range: 12,
    projectileSpeed: 32,
    splashRadius: 0,
    coneAngle: 40,
    statusEffect: 'none',
    statusChance: 0,
    statusDuration: 0,
    fxType: 'razor_leaf',
    description: 'Sharp leaves slicing through armor in a narrow fan.',
  },
  solar_beam: {
    id: 'solar_beam',
    delivery: 'beam', heavy: true,
    name: 'SolarBeam',
    type: 'Grass',
    basePower: 140,
    attackSpeed: 0.55,
    range: 22,
    projectileSpeed: 50,
    splashRadius: 5.5,
    statusEffect: 'stun',
    statusChance: 0.4,
    statusDuration: 1.5,
    fxType: 'hyper_beam',
    description: 'Absorbs stadium spotlights to unleash an immense concentrated beam.',
  },
  shadow_ball: {
    id: 'shadow_ball',
    delivery: 'projectile',
    name: 'Shadow Ball',
    type: 'Ghost',
    basePower: 55,
    attackSpeed: 1.2,
    range: 16,
    projectileSpeed: 24,
    splashRadius: 4.0,
    statusEffect: 'stun',
    statusChance: 0.3,
    statusDuration: 1.8,
    fxType: 'shadow_ball',
    description: 'A shadowy sphere of negative energy piercing through defenses.',
  },
  psychic: {
    id: 'psychic',
    delivery: 'field',
    name: 'Psychic',
    type: 'Psychic',
    basePower: 65,
    attackSpeed: 1.3,
    range: 20,
    projectileSpeed: 35,
    splashRadius: 4.0,
    statusEffect: 'stun',
    statusChance: 0.35,
    statusDuration: 2.0,
    fxType: 'psychic_wave',
    description: 'Overwhelming telekinetic force ripping across the stadium.',
  },
  hyper_beam: {
    id: 'hyper_beam',
    delivery: 'beam', heavy: true,
    name: 'Hyper Beam',
    type: 'Normal',
    basePower: 160,
    attackSpeed: 0.45,
    range: 25,
    projectileSpeed: 55,
    splashRadius: 8.0,
    statusEffect: 'stun',
    statusChance: 0.8,
    statusDuration: 2.5,
    fxType: 'hyper_beam',
    description: 'The ultimate devastating attack, obliterating everything in its wake.',
  },

  // ---------------------------------------------------------------------------
  // Shared moves — swapped in by paths, or the base a signature builds on.
  // ---------------------------------------------------------------------------
  quick_attack: {
    id: 'quick_attack', name: 'Quick Attack', type: 'Normal', basePower: 15, attackSpeed: 2.4,
    delivery: 'projectile',
    range: 10, projectileSpeed: 45, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A blindingly fast tackle that always strikes first.',
  },
  bite: {
    id: 'bite', name: 'Bite', type: 'Normal', basePower: 26, attackSpeed: 1.8,
    delivery: 'projectile',
    range: 10, projectileSpeed: 34, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.1, statusDuration: 0.5,
    fxType: 'impact', description: 'A savage bite that can make the target flinch.',
  },
  wing_attack: {
    id: 'wing_attack', name: 'Wing Attack', type: 'Flying', basePower: 30, attackSpeed: 1.7,
    delivery: 'projectile',
    range: 13, projectileSpeed: 38, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A sweeping strike with spread wings, strong against Grass.',
  },
  seismic_toss: {
    id: 'seismic_toss', name: 'Seismic Toss', type: 'Fighting', basePower: 45, attackSpeed: 1.2,
    delivery: 'projectile',
    range: 11, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', ignoresType: true,
    description: 'Fixed throwing damage that lands no matter the elemental match-up.',
  },
  ice_beam: {
    id: 'ice_beam', name: 'Ice Beam', type: 'Ice', basePower: 62, attackSpeed: 1.25,
    delivery: 'beam',
    range: 17, projectileSpeed: 38, splashRadius: 2.5,
    statusEffect: 'freeze', statusChance: 0.45, statusDuration: 3.0,
    fxType: 'blizzard', description: 'A frozen beam that chills runners to a crawl.',
  },
  body_slam: {
    id: 'body_slam', name: 'Body Slam', type: 'Normal', basePower: 55, attackSpeed: 1.15,
    delivery: 'projectile',
    range: 11, projectileSpeed: 36, splashRadius: 2.0,
    statusEffect: 'paralyze', statusChance: 0.35, statusDuration: 2.5,
    fxType: 'impact', description: 'A full-body crush that frequently paralyzes on contact.',
  },
  surf: {
    id: 'surf', name: 'Surf', type: 'Water', basePower: 55, attackSpeed: 1.2,
    delivery: 'field',
    range: 16, projectileSpeed: 30, splashRadius: 5.0,
    statusEffect: 'freeze', statusChance: 0.3, statusDuration: 2.0,
    fxType: 'water_stream', description: 'A rolling wave that washes across the whole lane.',
  },
  earthquake: {
    id: 'earthquake', name: 'Earthquake', type: 'Ground', basePower: 95, attackSpeed: 0.8,
    delivery: 'field', heavy: true,
    range: 13, projectileSpeed: 60, splashRadius: 7.0,
    statusEffect: 'stun', statusChance: 0.25, statusDuration: 1.2,
    fxType: 'earthquake', description: 'Shakes the colosseum floor, hitting everything grounded nearby.',
  },
  blizzard: {
    id: 'blizzard', name: 'Blizzard', type: 'Ice', basePower: 105, attackSpeed: 0.7,
    delivery: 'cone', heavy: true,
    range: 18, projectileSpeed: 32, splashRadius: 6.5,
    statusEffect: 'freeze', statusChance: 0.7, statusDuration: 4.0,
    fxType: 'blizzard', description: 'A howling whiteout that nearly halts an entire wave.',
  },

  bubblebeam: {
    id: 'bubblebeam', name: 'BubbleBeam', type: 'Water', basePower: 26, attackSpeed: 1.3,
    delivery: 'beam', pierce: 3,
    range: 14, projectileSpeed: 34, splashRadius: 0,
    statusEffect: 'freeze', statusChance: 0.2, statusDuration: 1.5,
    fxType: 'water_stream', description: 'A spray of bubbles that punches through a short line of creeps.',
  },
  surf_ring: {
    id: 'surf_ring', name: 'Surf', type: 'Water', basePower: 18, attackSpeed: 1.1,
    delivery: 'field',
    range: 7, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'water_stream', description: 'A small ring of water washing out around the tower.',
  },

  // ---------------------------------------------------------------------------
  // Roster basic attacks — each species' starting move, built around its role.
  // ---------------------------------------------------------------------------
  psywave: {
    id: 'psywave', name: 'Psywave', type: 'Psychic', basePower: 42, attackSpeed: 0.45,
    delivery: 'projectile', range: 60, projectileSpeed: 70, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'psychic_wave', description: 'A slow, precise psychic shot that reaches anywhere on the pitch.',
  },
  psybeam_snipe: {
    id: 'psybeam_snipe', name: 'Psybeam', type: 'Psychic', basePower: 34, attackSpeed: 0.6,
    delivery: 'beam', range: 40, projectileSpeed: 60, splashRadius: 0,
    statusEffect: 'confuse', statusChance: 0.15, statusDuration: 1.5,
    fxType: 'psychic_wave', description: 'A long psychic beam that pierces every creep in its line.',
  },
  gust: {
    id: 'gust', name: 'Gust', type: 'Flying', basePower: 20, attackSpeed: 1.4,
    delivery: 'projectile', range: 14, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A gust of wind whipped up by beating wings.',
  },
  leech_life: {
    id: 'leech_life', name: 'Leech Life', type: 'Bug', basePower: 16, attackSpeed: 1.8,
    delivery: 'projectile', range: 12, projectileSpeed: 42, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'Quick draining bites.',
  },
  scratch: {
    id: 'scratch', name: 'Scratch', type: 'Normal', basePower: 22, attackSpeed: 1.1,
    delivery: 'projectile', range: 9, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'Sharp claws raked across the target.',
  },
  rock_throw: {
    id: 'rock_throw', name: 'Rock Throw', type: 'Rock', basePower: 40, attackSpeed: 0.7,
    delivery: 'projectile', heavy: true, groundOnly: true, range: 12, projectileSpeed: 22, splashRadius: 2.5,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'earthquake', description: 'A lobbed boulder that bursts on the lane. Can\'t reach flyers.',
  },
  magnitude: {
    id: 'magnitude', name: 'Magnitude', type: 'Ground', basePower: 30, attackSpeed: 0.9,
    delivery: 'field', heavy: true, range: 7, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.1, statusDuration: 0.6,
    fxType: 'earthquake', description: 'A tremor around the tower.',
  },
  karate_chop: {
    id: 'karate_chop', name: 'Karate Chop', type: 'Fighting', basePower: 34, attackSpeed: 1.1,
    delivery: 'projectile', heavy: true, range: 8, projectileSpeed: 45, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A short, crushing chop.',
  },
  bind: {
    id: 'bind', name: 'Bind', type: 'Normal', basePower: 14, attackSpeed: 1.0,
    delivery: 'projectile', range: 10, projectileSpeed: 34, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.25, statusDuration: 1.0,
    fxType: 'impact', description: 'A coil that can pin a creep in place.',
  },
  rock_mortar: {
    id: 'rock_mortar', name: 'Rock Blast', type: 'Rock', basePower: 55, attackSpeed: 0.4,
    delivery: 'projectile', heavy: true, groundOnly: true, range: 26, projectileSpeed: 18, splashRadius: 3.5,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'earthquake', description: 'A long, slow lob that shatters over a cluster. Can\'t reach flyers.',
  },
  spark_burst: {
    id: 'spark_burst', name: 'Spark', type: 'Electric', basePower: 16, attackSpeed: 1.3,
    delivery: 'field', range: 6, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'paralyze', statusChance: 0.15, statusDuration: 1.5,
    fxType: 'lightning', description: 'A crackling burst in every direction.',
  },
  absorb: {
    id: 'absorb', name: 'Absorb', type: 'Grass', basePower: 18, attackSpeed: 1.3,
    delivery: 'projectile', range: 12, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'razor_leaf', description: 'Draining motes of energy.',
  },
  psy_ring: {
    id: 'psy_ring', name: 'Psy Burst', type: 'Psychic', basePower: 26, attackSpeed: 0.9,
    delivery: 'field', range: 8, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'confuse', statusChance: 0.15, statusDuration: 1.2,
    fxType: 'psychic_wave', description: 'A headache that ripples out around the tower.',
  },
  dragon_rage: {
    id: 'dragon_rage', name: 'Dragon Rage', type: 'Dragon', basePower: 20, attackSpeed: 1.0,
    delivery: 'projectile', ignoresType: true, range: 13, projectileSpeed: 36, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'hyper_beam', description: 'Fixed draconic damage that ignores type match-ups.',
  },
  ice_shard: {
    id: 'ice_shard', name: 'Ice Shard', type: 'Ice', basePower: 22, attackSpeed: 1.2,
    delivery: 'projectile', range: 13, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'freeze', statusChance: 0.25, statusDuration: 1.5,
    fxType: 'blizzard', description: 'A shard of ice that can chill its target.',
  },
  egg_bomb: {
    id: 'egg_bomb', name: 'Egg Bomb', type: 'Normal', basePower: 26, attackSpeed: 0.8,
    delivery: 'projectile', range: 13, projectileSpeed: 24, splashRadius: 2,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A lobbed egg that bursts over a small area.',
  },
  fury_cutter: {
    id: 'fury_cutter', name: 'Fury Cutter', type: 'Bug', basePower: 18, attackSpeed: 2.6,
    delivery: 'projectile', range: 9, projectileSpeed: 50, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'razor_leaf', description: 'A blur of blades — the fastest attack on the pitch.',
  },
  splash: {
    id: 'splash', name: 'Splash', type: 'Water', basePower: 1, attackSpeed: 0.8,
    delivery: 'projectile', range: 8, projectileSpeed: 20, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'water_stream', description: 'But nothing happened!',
  },
  twister: {
    id: 'twister', name: 'Twister', type: 'Dragon', basePower: 44, attackSpeed: 1.0,
    delivery: 'beam', range: 16, projectileSpeed: 50, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'hyper_beam', description: 'A raging vortex that tears down the lane.',
  },

  fire_spin: {
    id: 'fire_spin', name: 'Fire Spin', type: 'Fire', basePower: 20, attackSpeed: 1.2,
    delivery: 'field',
    range: 7, projectileSpeed: 28, splashRadius: 0,
    statusEffect: 'burn', statusChance: 0.5, statusDuration: 4.0,
    fxType: 'flamethrower', description: 'A whirling vortex of flame around the tower that steadily burns.',
  },

  // ---- Titan lines -------------------------------------------------------
  poison_sting: {
    id: 'poison_sting', name: 'Poison Sting', type: 'Poison', basePower: 12, attackSpeed: 2.2,
    delivery: 'projectile', range: 11, projectileSpeed: 46, splashRadius: 0,
    statusEffect: 'poison', statusChance: 0.2, statusDuration: 4,
    fxType: 'razor_leaf', description: 'Quick stings that may poison.',
  },
  twineedle: {
    id: 'twineedle', name: 'Twineedle', type: 'Bug', basePower: 20, attackSpeed: 2.0,
    delivery: 'projectile', range: 11, projectileSpeed: 50, splashRadius: 0,
    statusEffect: 'poison', statusChance: 0.2, statusDuration: 5,
    fxType: 'razor_leaf', description: 'A pair of poison barbs, fired as one.',
  },
  swift: {
    id: 'swift', name: 'Swift', type: 'Normal', basePower: 22, attackSpeed: 1.5,
    delivery: 'projectile', range: 14, projectileSpeed: 60, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'psychic_wave', description: 'Star-shaped rays that never miss.',
  },
  drill_peck: {
    id: 'drill_peck', name: 'Drill Peck', type: 'Flying', basePower: 44, attackSpeed: 1.1,
    delivery: 'projectile', heavy: true, range: 13, projectileSpeed: 44, splashRadius: 0,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'impact', description: 'A spinning, corkscrew peck that drills through armor.',
  },
};
