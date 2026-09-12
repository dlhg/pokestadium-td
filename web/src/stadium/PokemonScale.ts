/**
 * PokemonScale.ts — one world scale for every extracted Stadium model.
 *
 * The extracted meshes are authored at inconsistent native scales: their bounds
 * include things such as a flying pose, long wings, or a transient effect. They
 * are excellent for rendering, but are not a reliable measure of a species'
 * size (Haunter was notably much taller than Blastoise despite both being 5'3").
 *
 * National Pokédex heights are the authority for inter-species scale. The
 * original Stadium geometry is still used to derive the uniform mesh scale and
 * to keep exceptionally wide models inside the narrowest TD lane.
 */

import { STADIUM_MAPS } from '../td/MapCatalog';

/** Widest ground footprint any Pokémon may have, in world units. */
export const MAX_POKEMON_FOOTPRINT = Math.min(...STADIUM_MAPS.map((map) => map.laneWidth));

/** Charizard anchors the familiar battle-scale used before this correction. */
const REFERENCE_HEIGHT_INCHES = 67;
const REFERENCE_WORLD_HEIGHT = 3.32;

/** 1 keeps literal Pokédex-height ratios; lower values keep small Pokémon legible. */
export const SIZE_EXPONENT = 0.75;

/** Gen-I National Pokédex heights, in inches, indexed by species number - 1. */
const POKEDEX_HEIGHTS_INCHES = [
  28, 39, 79, 24, 43, 67, 20, 39, 63, 12, 28, 43, 12, 24, 39, 12, 43, 59, 12, 28,
  12, 47, 79, 138, 16, 31, 24, 39, 16, 31, 51, 20, 35, 55, 24, 51, 24, 43, 20, 39,
  31, 63, 20, 31, 47, 12, 39, 39, 59, 8, 28, 16, 39, 31, 67, 20, 39, 28, 75, 24,
  39, 51, 35, 51, 59, 31, 59, 63, 28, 39, 67, 35, 63, 16, 39, 55, 39, 67, 47, 63,
  12, 39, 31, 55, 71, 43, 67, 35, 47, 12, 59, 51, 63, 59, 346, 39, 63, 16, 51, 20,
  47, 16, 79, 16, 39, 59, 55, 47, 24, 47, 39, 75, 43, 39, 87, 16, 47, 24, 51, 31,
  43, 51, 59, 55, 43, 51, 59, 55, 35, 256, 98, 12, 12, 39, 31, 35, 31, 16, 39, 20,
  51, 71, 83, 67, 63, 79, 71, 157, 87, 79, 16,
] as const;

/** World units per native model unit. */
export function worldScaleFor(nativeFootprint: number, nativeHeight: number, species: number): number {
  const height = POKEDEX_HEIGHTS_INCHES[species - 1];
  if (!height || nativeHeight <= 0) {
    // Graceful fallback for a non-Pokédex model in a future manifest.
    return MAX_POKEMON_FOOTPRINT / Math.max(nativeFootprint, 0.001);
  }

  const desiredWorldHeight = REFERENCE_WORLD_HEIGHT
    * Math.pow(height / REFERENCE_HEIGHT_INCHES, SIZE_EXPONENT);
  const heightScale = desiredWorldHeight / nativeHeight;
  const footprintScale = MAX_POKEMON_FOOTPRINT / Math.max(nativeFootprint, 0.001);
  return Math.min(heightScale, footprintScale);
}
