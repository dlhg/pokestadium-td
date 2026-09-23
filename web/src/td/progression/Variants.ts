/**
 * Variants.ts — Special Pokémon Flavors
 *
 * A single registry for anything that makes an individual catch stand out
 * from its species baseline. Titan is the first entry; a future kind (e.g.
 * shiny) should only need a new VariantKind, a VARIANTS entry, and its own
 * trigger — no new UI code paths, since every display hook reads generically
 * off VARIANTS[tag.kind].
 */

import type { StatBlock, TowerModifiers } from './Stats';
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
  /** Multipliers on top of the stat-derived tower modifiers. DVs alone move
   *  a tower only a few percent (STAT_WEIGHT flattens them), so a variant
   *  that should feel stronger needs its own power. */
  power: { damage: number; rate: number };
  /** Flat surcharge on the species deploy cost, so the price reads the power. */
  deployPremium: number;
}

export const VARIANTS: Record<VariantKind, VariantDef> = {
  titan: {
    label: 'TITAN',
    accentColor: '#ff8a4d',
    dvOverride: { attack: MAX_DV, speed: MAX_DV, special: MAX_DV },
    // A Lv 20 titan Onix lands near a Lv 36 Charizard's damage, and at
    // $300 it takes most of the $420 opening purse.
    power: { damage: 1.4, rate: 1.15 },
    deployPremium: 160,
  },
};

/** Tower modifiers with a variant's power folded in. */
export function withVariantPower(modifiers: TowerModifiers, tag: VariantTag | undefined): TowerModifiers {
  if (!tag) return modifiers;
  const { power } = VARIANTS[tag.kind];
  return { ...modifiers, damage: modifiers.damage * power.damage, rate: modifiers.rate * power.rate };
}

/** Titan is threat-based; a different future variant (e.g. a random shiny
 *  roll) would get its own trigger function rather than reusing this one. */
export function variantForCreep(creep: { threat: 'normal' | 'elite' | 'titan' }): VariantTag | undefined {
  return creep.threat === 'titan' ? { kind: 'titan' } : undefined;
}
