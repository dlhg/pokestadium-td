/**
 * MoveDatabase.ts — Authentic Pokémon Stadium Move Registry
 *
 * Defines moves used by Stadium towers, including damage, rate of fire,
 * elemental type, 3D particle effect types, and status effects.
 */

import { PokemonType } from './TypeMatrix';

export type StatusEffectType = 'none' | 'burn' | 'freeze' | 'paralyze' | 'stun' | 'poison' | 'sleep';

/** Statuses that tick damage. A creep carries at most one of these... */
export type DamageStatus = 'burn' | 'poison';
/** ...plus at most one of these, which change how it moves. */
export type MovementStatus = 'freeze' | 'paralyze' | 'stun' | 'sleep';

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
  psybeam: {
    id: 'psybeam', name: 'Psybeam', type: 'Psychic', basePower: 49, attackSpeed: 1.3,
    delivery: 'beam',
    range: 18, projectileSpeed: 36, splashRadius: 3.0,
    statusEffect: 'stun', statusChance: 0.25, statusDuration: 1.3,
    fxType: 'psychic_wave', description: 'A focused psychic ray that strikes a clustered lane.',
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
    basePower: 45,
    attackSpeed: 1.3,
    range: 16,
    projectileSpeed: 36,
    splashRadius: 3.5,
    statusEffect: 'paralyze',
    statusChance: 0.25,
    statusDuration: 3.0,
    fxType: 'lightning',
    description: 'A strong electrical blast with area chain damage and paralysis.',
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
    basePower: 52,
    attackSpeed: 1.4,
    range: 15,
    projectileSpeed: 28,
    splashRadius: 4.0,
    statusEffect: 'burn',
    statusChance: 0.35,
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
    basePower: 48,
    attackSpeed: 1.5,
    range: 15,
    projectileSpeed: 32,
    splashRadius: 3.0,
    statusEffect: 'none',
    statusChance: 0,
    statusDuration: 0,
    fxType: 'razor_leaf',
    description: 'Sharp leaves slicing through armor with guaranteed high critical rate.',
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
  // Coverage moves — off-type attacks bought to answer match-ups a tower's own
  // element is walled by (Electric into Ground, Fire into Rock, and so on).
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
  sludge: {
    id: 'sludge', name: 'Sludge', type: 'Poison', basePower: 42, attackSpeed: 1.3,
    delivery: 'projectile',
    range: 14, projectileSpeed: 28, splashRadius: 3.0,
    statusEffect: 'poison', statusChance: 0.4, statusDuration: 5.0,
    fxType: 'spore_cloud', description: 'Hurled toxic sludge that lingers on everything it splatters.',
  },
  dig: {
    id: 'dig', name: 'Dig', type: 'Ground', basePower: 58, attackSpeed: 1.0,
    delivery: 'field', heavy: true,
    range: 12, projectileSpeed: 40, splashRadius: 2.5,
    statusEffect: 'stun', statusChance: 0.2, statusDuration: 1.0,
    fxType: 'earthquake', description: 'Burrows and erupts underfoot — the answer to Ground immunity.',
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

  // ---------------------------------------------------------------------------
  // Control moves — little damage, bought for the status they inflict.
  // ---------------------------------------------------------------------------
  thunder_wave: {
    id: 'thunder_wave', name: 'Thunder Wave', type: 'Electric', basePower: 6, attackSpeed: 1.5,
    delivery: 'aura',
    range: 13, projectileSpeed: 40, splashRadius: 0,
    statusEffect: 'paralyze', statusChance: 1.0, statusDuration: 4.0,
    fxType: 'lightning', description: 'A weak current that always paralyzes what it touches.',
  },
  flash: {
    id: 'flash', name: 'Flash', type: 'Normal', basePower: 8, attackSpeed: 1.2,
    delivery: 'aura',
    range: 12, projectileSpeed: 34, splashRadius: 4.0,
    statusEffect: 'stun', statusChance: 0.55, statusDuration: 1.2,
    fxType: 'psychic_wave', description: 'A blinding burst that leaves a cluster reeling.',
  },
  smokescreen: {
    id: 'smokescreen', name: 'Smokescreen', type: 'Normal', basePower: 5, attackSpeed: 1.4,
    delivery: 'cone',
    range: 12, projectileSpeed: 26, splashRadius: 4.5,
    statusEffect: 'stun', statusChance: 0.5, statusDuration: 1.0,
    fxType: 'spore_cloud', description: 'A choking cloud of soot that stalls the front of a wave.',
  },
  fire_spin: {
    id: 'fire_spin', name: 'Fire Spin', type: 'Fire', basePower: 22, attackSpeed: 1.5,
    delivery: 'field',
    range: 13, projectileSpeed: 28, splashRadius: 3.0,
    statusEffect: 'burn', statusChance: 0.75, statusDuration: 5.0,
    fxType: 'flamethrower', description: 'A whirling vortex of flame that traps and steadily burns.',
  },
  toxic: {
    id: 'toxic', name: 'Toxic', type: 'Poison', basePower: 4, attackSpeed: 0.9,
    delivery: 'aura',
    range: 15, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'poison', statusChance: 1.0, statusDuration: 10.0,
    fxType: 'spore_cloud', description: 'Guaranteed long-lasting poison — the answer to armored bosses.',
  },
  bubble: {
    id: 'bubble', name: 'Bubble', type: 'Water', basePower: 12, attackSpeed: 1.9,
    delivery: 'cone',
    range: 12, projectileSpeed: 28, splashRadius: 2.5,
    statusEffect: 'freeze', statusChance: 0.5, statusDuration: 2.0,
    fxType: 'water_stream', description: 'A rapid spray of bubbles that reliably slows a group.',
  },
  clamp: {
    id: 'clamp', name: 'Clamp', type: 'Water', basePower: 30, attackSpeed: 1.0,
    delivery: 'aura',
    range: 10, projectileSpeed: 26, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.6, statusDuration: 2.0,
    fxType: 'water_stream', description: 'Clamps a single runner in place for a long beat.',
  },
  stun_spore: {
    id: 'stun_spore', name: 'Stun Spore', type: 'Grass', basePower: 5, attackSpeed: 1.3,
    delivery: 'cone',
    range: 13, projectileSpeed: 24, splashRadius: 4.0,
    statusEffect: 'paralyze', statusChance: 0.85, statusDuration: 3.5,
    fxType: 'spore_cloud', description: 'Scatters paralyzing spores over a wide stretch of track.',
  },
  sleep_powder: {
    id: 'sleep_powder', name: 'Sleep Powder', type: 'Grass', basePower: 3, attackSpeed: 1.0,
    delivery: 'cone',
    range: 14, projectileSpeed: 22, splashRadius: 4.5,
    statusEffect: 'sleep', statusChance: 0.7, statusDuration: 2.6,
    fxType: 'spore_cloud', description: 'Puts a whole cluster to sleep where they stand.',
  },
  leech_seed: {
    id: 'leech_seed', name: 'Leech Seed', type: 'Grass', basePower: 10, attackSpeed: 1.1,
    delivery: 'projectile',
    range: 15, projectileSpeed: 26, splashRadius: 0,
    statusEffect: 'poison', statusChance: 1.0, statusDuration: 12.0,
    fxType: 'spore_cloud', description: 'Plants a seed that drains the target for the rest of its run.',
  },
  hypnosis: {
    id: 'hypnosis', name: 'Hypnosis', type: 'Psychic', basePower: 4, attackSpeed: 1.0,
    delivery: 'aura',
    range: 15, projectileSpeed: 30, splashRadius: 3.0,
    statusEffect: 'sleep', statusChance: 0.75, statusDuration: 2.8,
    fxType: 'psychic_wave', description: 'Lulls approaching invaders into a dead stop.',
  },
  confuse_ray: {
    id: 'confuse_ray', name: 'Confuse Ray', type: 'Ghost', basePower: 14, attackSpeed: 1.3,
    delivery: 'aura',
    range: 15, projectileSpeed: 28, splashRadius: 3.5,
    statusEffect: 'stun', statusChance: 0.5, statusDuration: 2.0,
    fxType: 'shadow_ball', description: 'A sinister light that leaves a group staggering in place.',
  },
  disable: {
    id: 'disable', name: 'Disable', type: 'Normal', basePower: 6, attackSpeed: 1.4,
    delivery: 'aura',
    range: 14, projectileSpeed: 32, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.8, statusDuration: 1.8,
    fxType: 'psychic_wave', description: 'Locks a single target down almost every time it lands.',
  },
};
