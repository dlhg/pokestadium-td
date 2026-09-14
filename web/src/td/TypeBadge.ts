import type { PokemonType } from '../stadium/TypeMatrix';

/**
 * Stadium's original 20x20 out-of-battle type tile, extracted from the ROM.
 * Reserve this compact variant for spaces too small for the standard UI badge.
 */
export function stadiumTypeBadge(type: PokemonType): string {
  const name = type.toLowerCase();
  const fallback = type.slice(0, 2).toUpperCase();
  return `<span class="stadium-type-badge" role="img" aria-label="${type} type"><span aria-hidden="true">${fallback}</span><img src="/generated/stadium/ui/type-badges/${name}.png" alt="" onerror="this.remove()"></span>`;
}
