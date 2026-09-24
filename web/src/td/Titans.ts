/**
 * Titans.ts — The Bosses That End a Course
 *
 * Onix and Gyarados are the generic Titans: the one halfway through every
 * match and the ones in freeplay. Every course's hand-made final ends on a
 * Titan of its own (docs/match-length.md), and each of those carries one
 * ability that tests how the player built, not how fast they click.
 */

import type { PokemonType } from '../stadium/TypeMatrix';

/** What a Titan does besides walk. See `TitanAbility.ts`. */
export type TitanAbilityId =
  | 'call_swarm' | 'dig' | 'recover' | 'lightning_dash' | 'fire_trail' | 'fade' | 'haze' | 'barrier';

export type TitanId =
  | 'onix' | 'gyarados' | 'beedrill' | 'starmie' | 'zapdos' | 'moltres' | 'gengar' | 'articuno' | 'mewtwo';

export interface TitanDef {
  id: TitanId;
  /** Species form name; the creep is called `Titan <name>` and caught as this form. */
  name: string;
  type: PokemonType;
  secondaryType?: PokemonType;
  /** HP over the base Titan's 3600 at the round's scaling. */
  hp: number;
  speed: number;
  /** Stand-in body while the extracted model loads, or when it isn't extracted. */
  fallback: 'Onix' | 'Gyarados';
  ability?: TitanAbilityId;
}

/** Every Titan starts from this much HP before the round's scaling. */
export const TITAN_BASE_HP = 3600;
/** And pays this much before the round's pay scaling. */
export const TITAN_BASE_REWARD = 500;

export const TITANS: Record<TitanId, TitanDef> = {
  onix: { id: 'onix', name: 'Onix', type: 'Rock', secondaryType: 'Ground', hp: 1, speed: 2.3, fallback: 'Onix', ability: 'dig' },
  gyarados: { id: 'gyarados', name: 'Gyarados', type: 'Water', secondaryType: 'Flying', hp: 1, speed: 2.8, fallback: 'Gyarados' },
  beedrill: { id: 'beedrill', name: 'Beedrill', type: 'Bug', secondaryType: 'Poison', hp: 0.8, speed: 3.4, fallback: 'Gyarados', ability: 'call_swarm' },
  starmie: { id: 'starmie', name: 'Starmie', type: 'Water', secondaryType: 'Psychic', hp: 0.85, speed: 3.6, fallback: 'Onix', ability: 'recover' },
  zapdos: { id: 'zapdos', name: 'Zapdos', type: 'Electric', secondaryType: 'Flying', hp: 1, speed: 3.0, fallback: 'Gyarados', ability: 'lightning_dash' },
  moltres: { id: 'moltres', name: 'Moltres', type: 'Fire', secondaryType: 'Flying', hp: 1.05, speed: 2.8, fallback: 'Gyarados', ability: 'fire_trail' },
  gengar: { id: 'gengar', name: 'Gengar', type: 'Ghost', secondaryType: 'Poison', hp: 0.9, speed: 2.6, fallback: 'Onix', ability: 'fade' },
  articuno: { id: 'articuno', name: 'Articuno', type: 'Ice', secondaryType: 'Flying', hp: 1.1, speed: 2.6, fallback: 'Gyarados', ability: 'haze' },
  mewtwo: { id: 'mewtwo', name: 'Mewtwo', type: 'Psychic', hp: 1.3, speed: 2.4, fallback: 'Onix', ability: 'barrier' },
};
