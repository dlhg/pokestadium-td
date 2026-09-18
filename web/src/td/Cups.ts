/**
 * Cups.ts — Stadium-Style Level Brackets
 *
 * Every course belongs to a cup. A cup bounds how strong the player's team can
 * be in that match: Pokémon enter at or under `entryMax` and can't level past
 * `levelCap`, while creeps climb the cup's own level range. Each cap sits inside
 * the next cup's entry window, so a team that maxes one cup qualifies for the
 * next. Design and rationale: `docs/cup-rules.md`.
 */

export type CupId = 'little' | 'poke' | 'great' | 'prime';

export interface CupRules {
  id: CupId;
  name: string;
  /** Highest level a Pokémon may enter at. */
  entryMax: number;
  /** In-match XP stops here. */
  levelCap: number;
  /** Rank-and-file creep level at round 1 and at the win round. */
  creepLevels: readonly [from: number, to: number];
  /** The round whose clear wins the map. Play continues afterwards as freeplay. */
  winRound: number;
}

export const CUPS: Record<CupId, CupRules> = {
  little: { id: 'little', name: 'LITTLE CUP', entryMax: 10, levelCap: 20, creepLevels: [3, 20], winRound: 40 },
  poke: { id: 'poke', name: 'POKÉ CUP', entryMax: 22, levelCap: 32, creepLevels: [12, 32], winRound: 60 },
  great: { id: 'great', name: 'GREAT CUP', entryMax: 34, levelCap: 42, creepLevels: [22, 42], winRound: 80 },
  prime: { id: 'prime', name: 'PRIME CUP', entryMax: 50, levelCap: 50, creepLevels: [32, 50], winRound: 80 },
};

/** Easiest first — the order cups unlock and appear in map select. */
export const CUP_ORDER: CupId[] = ['little', 'poke', 'great', 'prime'];
