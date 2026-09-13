/**
 * TowerAttack.ts — One Attack, Shaped by the Paths a Tower Buys
 *
 * A tower fires a single basic attack. Every tier it buys carries effects that
 * change that attack instead of adding another: a new move, a wider cone,
 * chains, a status on hit, a patch left on the lane, an aura around the tower.
 * `buildAttackProfile` folds the bought tiers into the attack the tower fires.
 */

import { isGroundOnly, MOVES, MoveDefinition, StatusEffectType } from '../stadium/MoveDatabase';
import type { CreepTrait } from './Creep';
import type { HazardId } from './Hazard';

/** Buying into a second path caps it here; only one path climbs past it. */
export const SECONDARY_PATH_MAX_TIER = 2;
/** At most this many paths can be bought into on one tower. */
export const MAX_PATHS_BOUGHT = 2;

export type TierEffect =
  /** Swap the basic attack for another move. Only the main path's swaps count. */
  | { kind: 'replaceAttack'; moveId: string }
  /** Overwrite fields of whichever move the tower ends up firing. */
  | { kind: 'modifyAttack'; patch: Partial<MoveDefinition> }
  /** Multiply damage, attack rate or reach. Stacks. */
  | { kind: 'scale'; damage?: number; rate?: number; range?: number }
  /** Every hit may inflict this, on top of the move's own status. */
  | { kind: 'onHitStatus'; status: StatusEffectType; chance: number; duration: number }
  /** Hits jump to this many more creeps nearby. */
  | { kind: 'chain'; count: number }
  | { kind: 'crit'; chance: number; multiplier: number }
  /** Each consecutive hit on the same target deals more, up to a cap. */
  | { kind: 'rage'; perStack: number; maxStacks: number }
  /** Every nth attack leaves a patch on the lane under the target. */
  | { kind: 'hazard'; hazard: HazardId; everyNth: number }
  /** A movement status landed by this tower spreads to creeps this close. */
  | { kind: 'spreadStatus'; radius: number }
  /** When a creep poisoned by this tower faints, the poison jumps to the nearest creep. */
  | { kind: 'seedJump'; radius: number }
  /** Hits shove non-Titan creeps back along the lane. */
  | { kind: 'knockback'; distance: number }
  /** Creeps in range move slower. The strongest slow on a creep wins. */
  | { kind: 'slowAura'; slow: number }
  /** Towers in range attack faster. The strongest buff on a tower wins. */
  | { kind: 'rateAura'; bonus: number }
  /** Extra damage to Titans and elites, a trait, or creeps already held by a status. */
  | { kind: 'bonusVs'; target: BonusTarget; multiplier: number }
  /** Each hit also removes a share of the creep's current HP. Bosses lose far less. */
  | { kind: 'percentDamage'; share: number; bossShare: number }
  /** Attack rate climbs while the tower keeps firing and drains away while idle. */
  | { kind: 'spinUp'; perShot: number; max: number }
  /** Fires at this many different creeps at once. */
  | { kind: 'multishot'; count: number }
  /** Hits harder the more creeps are in range. */
  | { kind: 'crowdPower'; perCreep: number; max: number }
  /** Hits harder as the Pokémon levels up. */
  | { kind: 'levelPower'; perLevel: number }
  /** This tower can aim at Phantoms. */
  | { kind: 'seePhantoms' }
  /** Every tower in range can aim at Phantoms. */
  | { kind: 'revealAura' }
  /** Prize money paid when a creep this tower hit faints. */
  | { kind: 'bounty'; money: number }
  /** Unlocks a signature move the player triggers. */
  | { kind: 'signature'; signatureId: string };

export type BonusTarget = CreepTrait | 'boss' | 'held';

export interface AttackProfile {
  move: MoveDefinition;
  rate: number;
  onHitStatus: { status: StatusEffectType; chance: number; duration: number } | null;
  chain: number;
  crit: { chance: number; multiplier: number } | null;
  rage: { perStack: number; maxStacks: number } | null;
  hazard: { hazard: HazardId; everyNth: number } | null;
  spreadStatusRadius: number;
  seedJumpRadius: number;
  knockback: number;
  slowAura: number;
  rateAura: number;
  bonusVs: { target: BonusTarget; multiplier: number }[];
  percentDamage: { share: number; bossShare: number } | null;
  spinUp: { perShot: number; max: number } | null;
  multishot: number;
  crowdPower: { perCreep: number; max: number } | null;
  levelPower: number;
  seePhantoms: boolean;
  revealAura: boolean;
  bounty: number;
  signatures: string[];
}

/**
 * Folds bought tiers over a basic attack. `pathsInOrder` lists each bought
 * path's effects, secondary path first and main path last. Only the main path
 * can swap the attack, so a crosspath adds to the attack rather than replacing
 * it, and the main path's patches win.
 */
export function buildAttackProfile(basicAttack: string, pathsInOrder: TierEffect[][]): AttackProfile {
  const effects = pathsInOrder.flat();

  let moveId = basicAttack;
  for (const effect of pathsInOrder[pathsInOrder.length - 1] ?? []) {
    if (effect.kind === 'replaceAttack') moveId = effect.moveId;
  }
  const base = MOVES[moveId];
  if (!base) throw new Error(`Unknown move "${moveId}"`);

  const profile: AttackProfile = {
    move: { ...base },
    rate: 1,
    onHitStatus: null,
    chain: 0,
    crit: null,
    rage: null,
    hazard: null,
    spreadStatusRadius: 0,
    seedJumpRadius: 0,
    knockback: 0,
    slowAura: 0,
    rateAura: 0,
    bonusVs: [],
    percentDamage: null,
    spinUp: null,
    multishot: 1,
    crowdPower: null,
    levelPower: 0,
    seePhantoms: false,
    revealAura: false,
    bounty: 0,
    signatures: [],
  };
  let damageScale = 1;
  let rangeScale = 1;

  for (const effect of effects) {
    switch (effect.kind) {
      case 'replaceAttack': break;
      case 'modifyAttack': Object.assign(profile.move, effect.patch); break;
      case 'scale':
        damageScale *= effect.damage ?? 1;
        profile.rate *= effect.rate ?? 1;
        rangeScale *= effect.range ?? 1;
        break;
      case 'onHitStatus': profile.onHitStatus = { status: effect.status, chance: effect.chance, duration: effect.duration }; break;
      case 'chain': profile.chain = Math.max(profile.chain, effect.count); break;
      case 'crit': profile.crit = { chance: effect.chance, multiplier: effect.multiplier }; break;
      case 'rage': profile.rage = { perStack: effect.perStack, maxStacks: effect.maxStacks }; break;
      case 'hazard': profile.hazard = { hazard: effect.hazard, everyNth: effect.everyNth }; break;
      case 'spreadStatus': profile.spreadStatusRadius = Math.max(profile.spreadStatusRadius, effect.radius); break;
      case 'seedJump': profile.seedJumpRadius = Math.max(profile.seedJumpRadius, effect.radius); break;
      case 'knockback': profile.knockback = Math.max(profile.knockback, effect.distance); break;
      case 'slowAura': profile.slowAura = Math.max(profile.slowAura, effect.slow); break;
      case 'rateAura': profile.rateAura = Math.max(profile.rateAura, effect.bonus); break;
      case 'bonusVs': {
        const existing = profile.bonusVs.find(bonus => bonus.target === effect.target);
        if (existing) existing.multiplier = Math.max(existing.multiplier, effect.multiplier);
        else profile.bonusVs.push({ target: effect.target, multiplier: effect.multiplier });
        break;
      }
      case 'percentDamage': profile.percentDamage = { share: effect.share, bossShare: effect.bossShare }; break;
      case 'spinUp': profile.spinUp = { perShot: effect.perShot, max: effect.max }; break;
      case 'multishot': profile.multishot = Math.max(profile.multishot, effect.count); break;
      case 'crowdPower': profile.crowdPower = { perCreep: effect.perCreep, max: effect.max }; break;
      case 'levelPower': profile.levelPower = Math.max(profile.levelPower, effect.perLevel); break;
      case 'seePhantoms': profile.seePhantoms = true; break;
      case 'revealAura': profile.revealAura = true; break;
      case 'bounty': profile.bounty = Math.max(profile.bounty, effect.money); break;
      case 'signature': profile.signatures.push(effect.signatureId); break;
    }
  }

  profile.move.basePower = Math.round(profile.move.basePower * damageScale);
  profile.move.range *= rangeScale;
  return profile;
}

/** The capability chips a tower card shows, at most three. */
export function attackChips(profile: AttackProfile, seesPhantoms: boolean): string[] {
  const chips: string[] = [];
  if (profile.move.heavy || profile.move.ignoresType) chips.push('HEAVY');
  if (seesPhantoms) chips.push('SEES PHANTOMS');
  if (isGroundOnly(profile.move)) chips.push('GROUND ONLY');
  return chips.slice(0, 3);
}
