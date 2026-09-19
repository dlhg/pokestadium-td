/**
 * Stats.ts — Level, XP and Stat Math
 *
 * Towers never take damage, so the Gen 1 stat block is trimmed to the three
 * stats that mean something on a defence pitch: Attack scales damage, Speed
 * scales attack rate, Special scales status chance and duration. Every tuning
 * constant for the progression curve lives in this file.
 */

import type { CupRules } from '../Cups';

export interface StatBlock {
  attack: number;
  speed: number;
  special: number;
}

export const STAT_KEYS: (keyof StatBlock)[] = ['attack', 'speed', 'special'];

export const MAX_LEVEL = 50;
export const MAX_DV = 15;

/** Gen 1 formula without HP or stat experience. */
export function statValue(base: number, dv: number, level: number): number {
  return Math.floor(((base + dv) * 2 * level) / 100) + 5;
}

export function computeStats(base: StatBlock, dvs: StatBlock, level: number): StatBlock {
  return {
    attack: statValue(base.attack, dvs.attack, level),
    speed: statValue(base.speed, dvs.speed, level),
    special: statValue(base.special, dvs.special, level),
  };
}

export interface TowerModifiers {
  damage: number;
  rate: number;
  status: number;
}

/** A base-60 stat with an average DV is the neutral point at any level. */
const REFERENCE_BASE = 60;
const REFERENCE_DV = 8;
/** Level alone: 0.9x at Lv 5, ~1x at Lv 12, 1.5x at Lv 50. */
const levelCurve = (level: number) => 0.8333 + level * 0.01333;
/** How strongly a species' own stats pull away from the level curve. */
const STAT_WEIGHT = 0.35;

function statFactor(value: number, level: number): number {
  const reference = statValue(REFERENCE_BASE, REFERENCE_DV, level);
  return 1 + (value / reference - 1) * STAT_WEIGHT;
}

export function towerModifiers(stats: StatBlock, level: number): TowerModifiers {
  const curve = levelCurve(level);
  return {
    damage: curve * statFactor(stats.attack, level),
    // Rate stays gentler than damage: cooldowns compound with multi-line towers.
    rate: (1 + (curve - 1) * 0.5) * statFactor(stats.speed, level),
    status: Math.min(1.6, (1 + (curve - 1) * 0.6) * statFactor(stats.special, level)),
  };
}

/** Medium-fast growth: total XP to reach a level. */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(Math.pow(level, 3.36));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** 0..1 progress from the current level to the next. */
export function levelProgress(xp: number, level: number): number {
  if (level >= MAX_LEVEL) return 1;
  const from = xpForLevel(level);
  return Math.min(1, Math.max(0, (xp - from) / (xpForLevel(level + 1) - from)));
}

/** Gen 5 scaled XP: an over-leveled defender earns little from weak creeps. */
export function levelScale(towerLevel: number, creepLevel: number): number {
  return Math.pow((2 * creepLevel + 10) / (creepLevel + towerLevel + 10), 2.5);
}

/** Share of a knockout pool that status work is worth, per status landed, as a fraction of max HP. */
export const STATUS_CONTRIBUTION = 0.15;
/** Share of the wave's total pool paid to every placed tower on a clear. */
export const WAVE_CLEAR_SHARE = 0.1;
export const THREAT_XP: Record<'normal' | 'elite' | 'titan', number> = { normal: 1, elite: 2, titan: 5 };

export function knockoutPool(expYield: number, creepLevel: number, threat: 'normal' | 'elite' | 'titan'): number {
  return (expYield * creepLevel / 5) * THREAT_XP[threat];
}

/** Creep levels climb the cup's range from round 1 to the win round, then hold there in freeplay. */
export function creepLevel(round: number, cup: CupRules, threat: 'normal' | 'elite' | 'titan'): number {
  const [from, to] = cup.creepLevels;
  const t = Math.min(1, Math.max(0, (round - 1) / Math.max(1, cup.winRound - 1)));
  const base = Math.round(from + (to - from) * t);
  const bonus = threat === 'titan' ? 8 : threat === 'elite' ? 3 : 0;
  return Math.min(MAX_LEVEL, base + bonus);
}
