/**
 * Variants.ts — Special Pokémon Flavors
 *
 * A single registry for anything that makes an individual catch stand out
 * from its species baseline. Titan is the first entry; a future kind (e.g.
 * shiny) should only need a new VariantKind, a VARIANTS entry, and its own
 * trigger — no new UI code paths, since every display hook reads generically
 * off VARIANTS[tag.kind].
 */

import type { StatBlock } from './Stats';
import { MAX_DV } from './Stats';

export type VariantKind = 'titan';

export interface VariantTag {
  kind: VariantKind;
}

export interface VariantDef {
  label: string;
  /** Badge, ring and 3D rim-light color for this variant. */
  accentColor: string;
  /** Guaranteed DVs a catch of this variant gets instead of the random roll. */
  dvOverride: StatBlock;
}

export const VARIANTS: Record<VariantKind, VariantDef> = {
  titan: {
    label: 'TITAN',
    accentColor: '#ff8a4d',
    dvOverride: { attack: MAX_DV, speed: MAX_DV, special: MAX_DV },
  },
};

/** Titan is threat-based; a different future variant (e.g. a random shiny
 *  roll) would get its own trigger function rather than reusing this one. */
export function variantForCreep(creep: { threat: 'normal' | 'elite' | 'titan' }): VariantTag | undefined {
  return creep.threat === 'titan' ? { kind: 'titan' } : undefined;
}
