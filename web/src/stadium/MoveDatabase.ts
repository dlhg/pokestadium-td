/**
 * MoveDatabase.ts — Authentic Pokémon Stadium Move Registry
 *
 * Defines moves used by Stadium towers, including damage, rate of fire,
 * elemental type, 3D particle effect types, and status effects.
 */

import { PokemonType } from './TypeMatrix';

export type StatusEffectType = 'none' | 'burn' | 'freeze' | 'paralyze' | 'stun';

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
  | 'earthquake';

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
  description: string;
  ignoresType?: boolean;
}

export const MOVES: Record<string, MoveDefinition> = {
  lick: {
    id: 'lick', name: 'Lick', type: 'Ghost', basePower: 18, attackSpeed: 1.7,
    range: 9, projectileSpeed: 26, splashRadius: 0,
    statusEffect: 'paralyze', statusChance: 0.3, statusDuration: 2.0,
    fxType: 'shadow_ball', description: 'A close ghost strike that may paralyze its target.',
  },
  night_shade: {
    id: 'night_shade', name: 'Night Shade', type: 'Ghost', basePower: 48, attackSpeed: 1.25,
    range: 15, projectileSpeed: 25, splashRadius: 2.5,
    statusEffect: 'none', statusChance: 0, statusDuration: 0,
    fxType: 'shadow_ball', ignoresType: true,
    description: 'Fixed spectral damage that ignores elemental effectiveness.',
  },
  confusion: {
    id: 'confusion', name: 'Confusion', type: 'Psychic', basePower: 22, attackSpeed: 1.5,
    range: 14, projectileSpeed: 30, splashRadius: 0,
    statusEffect: 'stun', statusChance: 0.15, statusDuration: 0.8,
    fxType: 'psychic_wave', description: 'A psychic pulse that can briefly disorient its target.',
  },
  psybeam: {
    id: 'psybeam', name: 'Psybeam', type: 'Psychic', basePower: 49, attackSpeed: 1.3,
    range: 18, projectileSpeed: 36, splashRadius: 3.0,
    statusEffect: 'stun', statusChance: 0.25, statusDuration: 1.3,
    fxType: 'psychic_wave', description: 'A focused psychic ray that strikes a clustered lane.',
  },
  thundershock: {
    id: 'thundershock',
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
};
