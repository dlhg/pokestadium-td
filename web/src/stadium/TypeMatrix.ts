/**
 * TypeMatrix.ts — Authentic Gen 1 / Pokémon Stadium Elemental Type System
 *
 * In Pokémon Stadium, 15 types determine damage multipliers:
 * 2.0x (Super Effective), 0.5x (Not Very Effective), 0.0x (No Effect/Immune), 1.0x (Neutral)
 */

export type PokemonType =
  | 'Normal'
  | 'Fire'
  | 'Water'
  | 'Electric'
  | 'Grass'
  | 'Ice'
  | 'Fighting'
  | 'Poison'
  | 'Ground'
  | 'Flying'
  | 'Psychic'
  | 'Bug'
  | 'Rock'
  | 'Ghost'
  | 'Dragon';

export const TYPE_COLORS: Record<PokemonType, { hex: string; num: number; light: string }> = {
  Normal:   { hex: '#A8A878', num: 0xA8A878, light: '#C6C6A7' },
  Fire:     { hex: '#F08030', num: 0xF08030, light: '#F5AC78' },
  Water:    { hex: '#6890F0', num: 0x6890F0, light: '#9DB7F5' },
  Electric: { hex: '#F8D030', num: 0xF8D030, light: '#FAE078' },
  Grass:    { hex: '#78C850', num: 0x78C850, light: '#A7DB8D' },
  Ice:      { hex: '#98D8D8', num: 0x98D8D8, light: '#BCE6E6' },
  Fighting: { hex: '#C03028', num: 0xC03028, light: '#D67873' },
  Poison:   { hex: '#A040A0', num: 0xA040A0, light: '#C183C1' },
  Ground:   { hex: '#E0C068', num: 0xE0C068, light: '#EBD69D' },
  Flying:   { hex: '#A890F0', num: 0xA890F0, light: '#C6B7F5' },
  Psychic:  { hex: '#F85888', num: 0xF85888, light: '#FA92B2' },
  Bug:      { hex: '#A8B820', num: 0xA8B820, light: '#C6D16E' },
  Rock:     { hex: '#B8A038', num: 0xB8A038, light: '#D1C17D' },
  Ghost:    { hex: '#705898', num: 0x705898, light: '#A292BC' },
  Dragon:   { hex: '#7038F8', num: 0x7038F8, light: '#A27DFA' },
};

// Attack Type -> Defending Type -> Multiplier
const TYPE_CHART: Record<PokemonType, Partial<Record<PokemonType, number>>> = {
  Normal: {
    Rock: 0.5,
    Ghost: 0.0,
  },
  Fire: {
    Fire: 0.5,
    Water: 0.5,
    Grass: 2.0,
    Ice: 2.0,
    Bug: 2.0,
    Rock: 0.5,
    Dragon: 0.5,
  },
  Water: {
    Fire: 2.0,
    Water: 0.5,
    Grass: 0.5,
    Ground: 2.0,
    Rock: 2.0,
    Dragon: 0.5,
  },
  Electric: {
    Water: 2.0,
    Electric: 0.5,
    Grass: 0.5,
    Ground: 0.0,
    Flying: 2.0,
    Dragon: 0.5,
  },
  Grass: {
    Fire: 0.5,
    Water: 2.0,
    Grass: 0.5,
    Poison: 0.5,
    Ground: 2.0,
    Flying: 0.5,
    Bug: 0.5,
    Rock: 2.0,
    Dragon: 0.5,
  },
  Ice: {
    Water: 0.5,
    Grass: 2.0,
    Ice: 0.5,
    Ground: 2.0,
    Flying: 2.0,
    Dragon: 2.0,
  },
  Fighting: {
    Normal: 2.0,
    Ice: 2.0,
    Poison: 0.5,
    Flying: 0.5,
    Psychic: 0.5,
    Bug: 0.5,
    Rock: 2.0,
    Ghost: 0.0,
  },
  Poison: {
    Grass: 2.0,
    Poison: 0.5,
    Ground: 0.5,
    Bug: 2.0, // Gen 1 bug/poison interaction was 2.0x!
    Rock: 0.5,
    Ghost: 0.5,
  },
  Ground: {
    Fire: 2.0,
    Electric: 2.0,
    Grass: 0.5,
    Poison: 2.0,
    Flying: 0.0,
    Bug: 0.5,
    Rock: 2.0,
  },
  Flying: {
    Electric: 0.5,
    Grass: 2.0,
    Fighting: 2.0,
    Bug: 2.0,
    Rock: 0.5,
  },
  Psychic: {
    Fighting: 2.0,
    Poison: 2.0,
    Psychic: 0.5,
  },
  Bug: {
    Fire: 0.5,
    Grass: 2.0,
    Fighting: 0.5,
    Poison: 2.0, // Gen 1
    Flying: 0.5,
    Psychic: 2.0,
    Ghost: 0.5,
  },
  Rock: {
    Fire: 2.0,
    Ice: 2.0,
    Fighting: 0.5,
    Ground: 0.5,
    Flying: 2.0,
    Bug: 2.0,
  },
  Ghost: {
    Normal: 0.0,
    Psychic: 0.0, // Gen 1 psychic immunity glitch preserved!
    Ghost: 2.0,
  },
  Dragon: {
    Dragon: 2.0,
  },
};

export function getEffectiveness(attackType: PokemonType, defenderType: PokemonType): number {
  const attackDef = TYPE_CHART[attackType];
  if (!attackDef) return 1.0;
  const mult = attackDef[defenderType];
  return mult !== undefined ? mult : 1.0;
}

/** Gen 1 multiplies both defending types (for example Fire -> Grass/Poison is 2x * 1x). */
export function getCombinedEffectiveness(attackType: PokemonType, defenderTypes: readonly PokemonType[]): number {
  return defenderTypes.reduce(
    (multiplier, defenderType) => multiplier * getEffectiveness(attackType, defenderType),
    1.0,
  );
}

/**
 * Bulbasaur's spore-based status kit (Stun Spore, Sleep Powder, Spore
 * Carpet) hits every type the same by default, because Grass has no
 * natural 0x defender in the chart above. This carves out the intended
 * balance instead: full effect only against what Grass actually is super
 * effective against, a reduced effect against everything else, and an
 * explicit Grass immunity the chart itself can't express.
 */
export function sporeStatusMultiplier(defenderTypes: readonly PokemonType[]): number {
  if (defenderTypes.includes('Grass')) return 0;
  const superEffective = defenderTypes.some(t => getEffectiveness('Grass', t) >= 2.0);
  return superEffective ? 1 : 0.5;
}

export function getEffectivenessLabel(mult: number): { label: string; color: string } {
  if (mult >= 2.0) return { label: "SUPER EFFECTIVE!", color: "#48FF48" };
  if (mult === 0.0) return { label: "NO EFFECT!", color: "#A0A0A0" };
  if (mult < 1.0) return { label: "NOT VERY EFFECTIVE...", color: "#FF9933" };
  return { label: "EFFECTIVE", color: "#FFFFFF" };
}
