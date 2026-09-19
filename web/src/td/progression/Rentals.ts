/**
 * Rentals.ts — Loaner Pokémon for Cups You Can't Field
 *
 * Each cup keeps a pool of rentals, like Pokémon Stadium's rental Pokémon, so
 * a cup stays playable when nothing the trainer owns is under its entry limit.
 * A rental is an ordinary OwnedPokemon that never joins the collection: it
 * levels up in the match, and the save never sees it. Rentals enter a couple
 * of levels under the limit so a well-raised Pokémon of your own is a little
 * better. Design and rationale: `docs/cup-rules.md`.
 */

import { CUPS, type CupId } from '../Cups';
import { createPokemon, OwnedPokemon } from './TrainerStore';

/** How far under the cup's entry limit rentals enter. */
export const RENTAL_LEVEL_GAP = 2;
const RENTAL_DVS = { attack: 8, speed: 8, special: 8 };

/** Species on loan per cup, a type spread that covers every opening threat. */
export const RENTALS: Record<CupId, string[]> = {
  little: ['charmander', 'squirtle', 'bulbasaur', 'pikachu', 'pidgey', 'rattata', 'zubat', 'geodude', 'machop', 'oddish', 'psyduck', 'gastly'],
  poke: ['charmander', 'squirtle', 'bulbasaur', 'pikachu', 'pidgey', 'rattata', 'abra', 'gastly', 'geodude', 'machop', 'ponyta', 'psyduck'],
  great: ['charmander', 'squirtle', 'bulbasaur', 'pikachu', 'gastly', 'abra', 'geodude', 'machop', 'psyduck', 'dratini', 'exeggcute', 'voltorb'],
  prime: ['charmander', 'squirtle', 'bulbasaur', 'pikachu', 'gastly', 'abra', 'geodude', 'machop', 'ponyta', 'dratini', 'rhyhorn', 'lapras'],
};

export function rentalLevel(cup: CupId): number {
  return Math.max(1, CUPS[cup].entryMax - RENTAL_LEVEL_GAP);
}

/** A fresh loaner, in the form its level has reached. */
export function createRental(speciesId: string, cup: CupId): OwnedPokemon {
  const pokemon = createPokemon(speciesId, rentalLevel(cup), { kind: 'rental', at: Date.now() }, { dvs: { ...RENTAL_DVS } });
  pokemon.uid = `rental_${pokemon.uid}`;
  return pokemon;
}

export function isRental(pokemon: OwnedPokemon): boolean {
  return pokemon.origin.kind === 'rental';
}
