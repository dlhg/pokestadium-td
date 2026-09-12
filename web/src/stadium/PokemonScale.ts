/**
 * PokemonScale.ts — one world scale for every extracted Stadium model.
 *
 * The ROM models share Stadium's own units, so their relative sizes are
 * authentic (Caterpie ≪ Pikachu ≪ Charizard ≪ Onix). The build pipeline records
 * each species' idle footprint (twice its farthest horizontal reach from the
 * origin) in manifest.json, and this maps that to world units:
 *
 *   - Nothing is wider than the narrowest lane. Tower pads may touch the lane
 *     edge, so a creep any wider would clip into them. Anything larger than the
 *     reference species is capped to exactly that width.
 *   - Below the cap, sizes are compressed by an exponent so common small
 *     Pokémon stay readable next to the big ones while keeping their order.
 */

import { STADIUM_MAPS } from '../td/MapCatalog';

/** Widest ground footprint any Pokémon may have, in world units. */
export const MAX_POKEMON_FOOTPRINT = Math.min(...STADIUM_MAPS.map((map) => map.laneWidth));

/** Species whose native footprint maps to the cap; anything larger is capped. */
export const SIZE_REFERENCE_SPECIES = 'Charizard';

/** 1 keeps authentic proportions; lower values shrink the gap between small and big. */
export const SIZE_EXPONENT = 0.75;

/** World units per native unit for a model with this native footprint. */
export function worldScaleFor(nativeFootprint: number, referenceFootprint: number): number {
  const native = Math.max(nativeFootprint, 0.001);
  const relative = Math.min(native, referenceFootprint) / referenceFootprint;
  return (MAX_POKEMON_FOOTPRINT * Math.pow(relative, SIZE_EXPONENT)) / native;
}
