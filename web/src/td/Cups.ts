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
  /**
   * The cup's difficulty band, as the equivalent rounds of the original
   * 40-to-80-round ladder its round 1 and win round play like. Enemy HP,
   * pay, group counts and pace are all read off that ladder, so a shorter cup
   * keeps the tuned relationships and just walks a slice of it faster. See
   * docs/match-length.md.
   */
  roundBand: readonly [from: number, to: number];
  /**
   * Prize money per knockout, over the original ladder's. Tuned so a match
   * buys a full team build around the final's breather, not by round 12
   * (`npm run balance:economy`).
   */
  payScale: number;
  /** Prize money in hand at round 1, sized to the band the cup opens on. */
  startingMoney: number;
  /**
   * Knockout XP over the original ladder's. A shorter cup fields fewer
   * creeps, so each is worth more; tuned so a team entering at the limit caps
   * at about 75–85% of the win round (`npm run balance:xp`).
   */
  xpScale: number;
}

/** The last rounds of every match are the course's hand-made final. */
export const FINAL_ROUNDS = 5;

export const CUPS: Record<CupId, CupRules> = {
  little: { id: 'little', name: 'LITTLE CUP', entryMax: 10, levelCap: 20, creepLevels: [3, 20], winRound: 20, roundBand: [1, 40], payScale: 0.19, startingMoney: 420, xpScale: 2 },
  poke: { id: 'poke', name: 'POKÉ CUP', entryMax: 22, levelCap: 32, creepLevels: [12, 32], winRound: 25, roundBand: [10, 60], payScale: 0.085, startingMoney: 1500, xpScale: 2 },
  great: { id: 'great', name: 'GREAT CUP', entryMax: 34, levelCap: 42, creepLevels: [22, 42], winRound: 30, roundBand: [18, 80], payScale: 0.04, startingMoney: 2000, xpScale: 1.5 },
  prime: { id: 'prime', name: 'PRIME CUP', entryMax: 50, levelCap: 50, creepLevels: [32, 50], winRound: 30, roundBand: [22, 88], payScale: 0.03, startingMoney: 2500, xpScale: 1 },
};

/** First round of the course's hand-made final. */
export function finalStartRound(cup: CupRules): number {
  return cup.winRound - FINAL_ROUNDS + 1;
}

/** True for the rounds a course's final plays. */
export function isFinalRound(round: number, cup: CupRules): boolean {
  return round >= finalStartRound(cup) && round <= cup.winRound;
}

/**
 * Where a round sits on the original ladder. Climbs the cup's band from round
 * 1 to the win round, then keeps walking it one-for-one in freeplay.
 */
export function equivalentRound(round: number, cup: CupRules): number {
  const [from, to] = cup.roundBand;
  if (round > cup.winRound) return to + (round - cup.winRound);
  const t = cup.winRound > 1 ? (round - 1) / (cup.winRound - 1) : 1;
  return from + (to - from) * Math.max(0, t);
}

/** The one Titan in the procedural rounds, halfway to the final. */
export function midTitanRound(cup: CupRules): number {
  return Math.ceil((finalStartRound(cup) - 1) / 2);
}

/** Easiest first — the order cups unlock and appear in map select. */
export const CUP_ORDER: CupId[] = ['little', 'poke', 'great', 'prime'];

/** Team select flags a Pokémon this close to the entry limit: one more run likely graduates it. */
export const OUTGROW_WARNING_LEVELS = 2;

export function isEligible(level: number, cup: CupRules): boolean {
  return level <= cup.entryMax;
}

/** Eligible now, but near enough the limit that this match may be its last in the cup. */
export function nearOutgrowing(level: number, cup: CupRules): boolean {
  return cup.entryMax < cup.levelCap && isEligible(level, cup) && cup.entryMax - level < OUTGROW_WARNING_LEVELS;
}

/** The first cup is always open; each later one opens once any course in the cup below is cleared. */
export function isCupUnlocked(
  id: CupId,
  maps: readonly { id: string; cup: CupId }[],
  records: Record<string, { cleared: boolean } | undefined>,
): boolean {
  const index = CUP_ORDER.indexOf(id);
  if (index <= 0) return true;
  const below = CUP_ORDER[index - 1];
  return maps.some(map => map.cup === below && records[map.id]?.cleared === true);
}

export function unlockedCups(
  maps: readonly { id: string; cup: CupId }[],
  records: Record<string, { cleared: boolean } | undefined>,
): Set<CupId> {
  return new Set(CUP_ORDER.filter(id => isCupUnlocked(id, maps, records)));
}
