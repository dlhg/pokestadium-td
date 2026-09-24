/**
 * WaveManager.ts — Tournament Cup & Wave Progression System
 *
 * Defines the tournament stages each match runs through (Qualifiers, Main Draw, Gym Leader Castle...)
 * and controls wave spawning, boss arrivals, and intermissions.
 */

import * as THREE from 'three';
import { Creep, CreepConfig, CreepTrait, traitsForTypes } from './Creep';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { CUPS, equivalentRound, finalStartRound, isFinalRound, midTitanRound, type CupRules } from './Cups';
import type { PokemonType } from '../stadium/TypeMatrix';
import type { BallType } from './CaptureSequence';
import { creepLevel } from './progression/Stats';
import { finalFor, type FinalBeat, type FinalGroup } from './Finals';
import { TITAN_BASE_HP, TITAN_BASE_REWARD, TITANS, type TitanId } from './Titans';

export interface SpawnGroup {
  config: CreepConfig;
  count: number;
  interval: number;
  /** Seconds after the round starts; groups without one follow the group before. */
  at?: number;
  /** Pinned to one route; otherwise creeps take turns across the course's routes. */
  route?: number;
  /** Hand-made: `count` and HP are exactly as written, not put through the density tradeoff. */
  exact?: boolean;
}

export interface WaveDefinition {
  round: number;
  cupName: string;
  name: string;
  spawns: SpawnGroup[];
  /** Which beat of the course's final this round plays, if it's one. */
  beat?: FinalBeat;
  /** A final round's own name ("Spore Wall"). */
  title?: string;
  /** True for a generated round rolled unweighted, with a random modifier. */
  isMystery?: boolean;
  /** A mystery modifier's prize multiplier (Bounty Round pays 1.6×). */
  payMult?: number;
}

/** Density/toughness tradeoff applied to rank-and-file creeps at spawn time. */
const TRASH_COUNT_MULTIPLIER = 0.5;
const TRASH_HP_MULTIPLIER = 2;

/** Bosses, Titans and elites are singular set-pieces; everything else is rank-and-file. */
function isTrash(config: CreepConfig): boolean {
  return !config.isBoss && config.threat !== 'elite' && config.threat !== 'titan';
}

/** How many of a group reach the lane once the density tradeoff is applied. */
function spawnedCount(config: CreepConfig, count: number): number {
  return isTrash(config) ? Math.max(1, Math.round(count * TRASH_COUNT_MULTIPLIER)) : count;
}

/** A creep waiting for its moment in the round. */
interface ScheduledSpawn {
  config: CreepConfig;
  /** Seconds after the round starts. */
  at: number;
  route?: number;
}

/**
 * Lays a round's groups out in time. A group without `at` starts one of its
 * own intervals after the group before it spawns its last creep, which is how
 * every procedural round has always played.
 */
export function scheduleWave(wave: WaveDefinition): { config: CreepConfig; at: number; route?: number; interval: number }[] {
  const entries: { config: CreepConfig; at: number; route?: number; interval: number }[] = [];
  let cursor = 0;
  wave.spawns.forEach(group => {
    const trash = !group.exact && isTrash(group.config);
    const count = group.exact ? group.count : spawnedCount(group.config, group.count);
    const hpMultiplier = trash ? TRASH_HP_MULTIPLIER : 1;
    const interval = trash ? group.interval / TRASH_COUNT_MULTIPLIER : group.interval;
    const start = group.at ?? cursor;
    for (let i = 0; i < count; i++) {
      entries.push({
        config: {
          ...group.config,
          maxHp: Math.round(group.config.maxHp * hpMultiplier),
          reward: Math.round(group.config.reward * hpMultiplier),
        },
        at: start + i * interval,
        route: group.route,
        interval,
      });
    }
    cursor = Math.max(cursor, start + count * interval);
  });
  // A stable sort keeps same-moment spawns in the order they were written.
  return entries.map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.at - b.entry.at || a.order - b.order)
    .map(({ entry }) => entry);
}

type RosterEntry = Omit<CreepConfig, 'id'>;

/**
 * Rounds that play like the first ten of the original ladder draw from this
 * weaker, pre-evolution lineup instead of the mid-game ROSTER below —
 * generated, like every other round, so a map's `typeWeights` reach the
 * opening too.
 * TRAIT_ANCHOR_ROUNDS and the Phantom safety net (see rollWave) keep
 * the trait-teaching beats intact regardless of which map rolls them.
 */
export const EARLY_ROSTER: RosterEntry[] = [
  { name: 'Rattata', type: 'Normal', maxHp: 220, speed: 4.6, reward: 22, modelType: 'rattata' },
  { name: 'Pidgey', type: 'Normal', secondaryType: 'Flying', maxHp: 180, speed: 5.0, reward: 22, modelType: 'zubat' },
  { name: 'Zubat', type: 'Poison', secondaryType: 'Flying', maxHp: 190, speed: 5.2, reward: 22, modelType: 'zubat' },
  { name: 'Paras', type: 'Bug', secondaryType: 'Grass', maxHp: 230, speed: 3.6, reward: 24, modelType: 'rattata' },
  { name: 'Meowth', type: 'Normal', maxHp: 210, speed: 5.0, reward: 26, modelType: 'rattata' },
  { name: 'Geodude', type: 'Rock', secondaryType: 'Ground', maxHp: 260, speed: 3.0, reward: 26, modelType: 'geodude' },
  { name: 'Machop', type: 'Fighting', maxHp: 280, speed: 3.4, reward: 27, modelType: 'geodude' },
  { name: 'Ponyta', type: 'Fire', maxHp: 230, speed: 4.9, reward: 24, modelType: 'rattata' },
  { name: 'Oddish', type: 'Grass', secondaryType: 'Poison', maxHp: 240, speed: 5.5, reward: 24, modelType: 'rattata' },
  { name: 'Psyduck', type: 'Water', maxHp: 260, speed: 4.4, reward: 26, modelType: 'rattata' },
  { name: 'Haunter', type: 'Ghost', secondaryType: 'Poison', maxHp: 240, speed: 4.6, reward: 28, modelType: 'zubat' },
  { name: 'Graveler', type: 'Rock', secondaryType: 'Ground', maxHp: 320, speed: 3.2, reward: 32, modelType: 'geodude' },
  { name: 'Machoke', type: 'Fighting', maxHp: 340, speed: 3.1, reward: 34, modelType: 'geodude' },
  { name: 'Dragonair', type: 'Dragon', maxHp: 320, speed: 5.3, reward: 34, modelType: 'dragonair' },
  { name: 'Lapras', type: 'Water', secondaryType: 'Ice', maxHp: 400, speed: 3.1, reward: 38, modelType: 'dragonair' },
  { name: 'Exeggutor', type: 'Grass', secondaryType: 'Psychic', maxHp: 340, speed: 5.0, reward: 36, modelType: 'geodude' },
  { name: 'Rhydon', type: 'Ground', secondaryType: 'Rock', maxHp: 380, speed: 3.0, reward: 36, modelType: 'geodude' },
  { name: 'Scyther', type: 'Bug', secondaryType: 'Flying', maxHp: 330, speed: 5.6, reward: 34, modelType: 'zubat' },
];

/**
 * A Little Cup round that must field a creep of this type, regardless of the
 * map's bias, so a fresh team meets the type behind each creep trait
 * (`tower-roles.md`) on a predictable schedule: Airborne at round 1,
 * Armored at round 3, Phantom at round 6. Later cups assume the lesson.
 */
const TRAIT_ANCHOR_ROUNDS: Partial<Record<number, PokemonType>> = {
  1: 'Flying',
  3: 'Rock',
  6: 'Ghost',
};

export class WaveManager {
  public currentWaveIndex: number = 0;
  public inWave: boolean = false;
  public waveCompleted: boolean = false;
  public intermissionTimer: number = 0; // The first wave waits for the player's plan.

  /** This round's creeps still to come, soonest first. */
  private spawnQueue: ScheduledSpawn[] = [];
  /** Seconds since the round started. */
  private roundClock: number = 0;
  private routes: THREE.Vector3[][];
  private lifts?: number[][];
  private nextRoute = 0;
  private announcer: StadiumAnnouncer;
  private cup: CupRules;
  private typeWeights?: Partial<Record<PokemonType, number>>;
  private mapId?: string;

  /** Every round is generated (and map-flavored); this just caches the result. */
  private generated = new Map<number, WaveDefinition>();
  public readonly winRound: number;

  constructor(
    routes: THREE.Vector3[][],
    announcer: StadiumAnnouncer,
    cup: CupRules,
    lifts?: number[][],
    typeWeights?: Partial<Record<PokemonType, number>>,
    mapId?: string
  ) {
    if (!routes.length || routes.some(route => route.length < 2)) throw new Error('A course needs a traversable route');
    this.routes = routes;
    this.lifts = lifts;
    this.announcer = announcer;
    this.cup = cup;
    this.winRound = cup.winRound;
    this.typeWeights = typeWeights;
    this.mapId = mapId;
  }

  /** Round number of the wave in play, or the one queued next during an intermission. */
  public get round(): number { return this.currentWaveIndex + 1; }
  public get isFreeplay(): boolean { return this.round > this.winRound; }

  public getCurrentWave(): WaveDefinition {
    return this.getWave(this.round);
  }

  /** Rounds never run out: each is built once, then cached. */
  public getWave(round: number): WaveDefinition {
    let wave = this.generated.get(round);
    if (!wave) {
      wave = generateWave(round, this.cup, this.typeWeights, this.mapId);
      this.generated.set(round, wave);
    }
    return wave;
  }

  public startNextWave(): void {
    const wave = this.getCurrentWave();
    this.inWave = true;
    this.waveCompleted = false;
    // A manual start skips the rest of the break; don't leave a stale countdown behind.
    this.intermissionTimer = 0;
    this.roundClock = 0;
    this.nextRoute = this.currentWaveIndex % this.routes.length;

    // Rank-and-file creeps spawn at half density with double HP (and reward,
    // and spacing, so total wave income and duration are unchanged) — fewer,
    // tankier trash mobs instead of a swarm. Bosses/elites/titans are already
    // singular set-pieces, and hand-made finals are written exactly as meant.
    this.spawnQueue = scheduleWave(wave).map(({ config, at, route }) => ({
      config: { ...config, level: creepLevel(wave.round, this.cup, config.threat ?? (config.isBoss ? 'titan' : 'normal')) },
      at,
      route,
    }));

    if (wave.spawns.some(s => s.config.isBoss)) {
      this.announcer.trigger('boss_spawn', wave.name);
    } else if (wave.beat === 'showcase') {
      this.announcer.trigger('final_start', wave.title?.toUpperCase());
    } else if (wave.beat) {
      this.announcer.trigger('final_round', wave.name);
    } else if (wave.isMystery) {
      this.announcer.trigger('mystery_round', wave.name);
    } else {
      this.announcer.trigger('round_start', String(wave.round));
    }
  }

  public update(
    dt: number,
    activeCreeps: Creep[],
    onSpawn: (creep: Creep) => void,
    onRoundCleared: (round: number) => void
  ): void {
    if (!this.inWave) {
      // Intermission countdown
      if (this.intermissionTimer > 0) {
        this.intermissionTimer -= dt;
        if (this.intermissionTimer <= 0) {
          this.startNextWave();
        }
      }
      return;
    }

    // Spawning active queue
    if (this.spawnQueue.length > 0) {
      this.roundClock += dt;
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].at <= this.roundClock) {
        const next = this.spawnQueue.shift()!;
        let route: number;
        if (next.route !== undefined) {
          route = next.route % this.routes.length;
        } else {
          route = this.nextRoute;
          this.nextRoute = (this.nextRoute + 1) % this.routes.length;
        }
        const creep = new Creep(next.config, this.routes[route], this.lifts?.[route]);
        onSpawn(creep);
        if (creep.threat === 'elite') this.announcer.trigger('elite_spawn', creep.name);
      }
    } else {
      // Check if all creeps are defeated or reached end
      if (activeCreeps.length === 0) {
        const cleared = this.round;
        this.inWave = false;
        this.waveCompleted = true;
        this.currentWaveIndex++;
        this.intermissionTimer = INTERMISSION_SECONDS;
        this.announcer.trigger('wave_cleared');
        onRoundCleared(cleared);
      }
    }
  }
}

export interface MilestoneReward {
  round: number;
  label: string;
  money: number;
  balls: Partial<Record<BallType, number>>;
}

/**
 * Bonus payouts for landmark clears: every 10th round and the win round
 * itself. Round 100 and each hundred after it are the long-haul freeplay
 * trophies.
 */
export function getMilestone(round: number, winRound: number): MilestoneReward | null {
  if (round % 100 === 0) {
    return { round, label: `ROUND ${round} LEGEND`, money: 2500 * (round / 100), balls: { ultra: 3 } };
  }
  if (round === winRound) {
    return { round, label: 'STADIUM CHAMPION', money: 1000, balls: { ultra: 2 } };
  }
  if (round % 10 === 0) {
    return { round, label: `ROUND ${round} CLEAR`, money: 150 + round * 6, balls: { great: 1 } };
  }
  return null;
}

// --------------------------------------------------------------------------
// Generated rounds
// --------------------------------------------------------------------------

/** Mid-game-and-later lineup (round 11+), tuned at the round-10 baseline. */
export const ROSTER: RosterEntry[] = [
  { name: 'Raticate', type: 'Normal', maxHp: 300, speed: 5.2, reward: 30, modelType: 'rattata' },
  { name: 'Golbat', type: 'Poison', secondaryType: 'Flying', maxHp: 280, speed: 5.6, reward: 30, modelType: 'zubat' },
  { name: 'Persian', type: 'Normal', maxHp: 290, speed: 5.8, reward: 36, modelType: 'rattata' },
  { name: 'Haunter', type: 'Ghost', secondaryType: 'Poison', maxHp: 260, speed: 4.6, reward: 32, modelType: 'zubat' },
  { name: 'Graveler', type: 'Rock', secondaryType: 'Ground', maxHp: 400, speed: 3.2, reward: 36, modelType: 'geodude' },
  { name: 'Machoke', type: 'Fighting', maxHp: 420, speed: 3.1, reward: 38, modelType: 'geodude' },
  { name: 'Rapidash', type: 'Fire', maxHp: 330, speed: 5.4, reward: 34, modelType: 'rattata' },
  { name: 'Gloom', type: 'Grass', secondaryType: 'Poison', maxHp: 350, speed: 4.4, reward: 34, modelType: 'rattata' },
  { name: 'Golduck', type: 'Water', maxHp: 380, speed: 4.2, reward: 36, modelType: 'rattata' },
  { name: 'Electrode', type: 'Electric', maxHp: 290, speed: 6.0, reward: 34, modelType: 'rattata' },
  { name: 'Dragonair', type: 'Dragon', maxHp: 440, speed: 5.0, reward: 40, modelType: 'dragonair' },
  { name: 'Lapras', type: 'Water', secondaryType: 'Ice', maxHp: 560, speed: 3.1, reward: 46, modelType: 'dragonair' },
  { name: 'Scyther', type: 'Bug', secondaryType: 'Flying', maxHp: 400, speed: 5.8, reward: 40, modelType: 'zubat' },
  { name: 'Rhydon', type: 'Ground', secondaryType: 'Rock', maxHp: 520, speed: 3.0, reward: 44, modelType: 'geodude' },
  { name: 'Kadabra', type: 'Psychic', maxHp: 300, speed: 5.0, reward: 36, modelType: 'rattata' },
];

/**
 * The stage a round belongs to: the procedural rounds split into QUALIFIERS
 * and MAIN DRAW, then the course's five-round final, then freeplay.
 */
export function stageName(round: number, cup: CupRules): string {
  if (round > cup.winRound) return 'FREEPLAY';
  const finalStart = finalStartRound(cup);
  if (round >= finalStart) return `FINAL ${round - finalStart + 1}/${cup.winRound - finalStart + 1}`;
  return round <= Math.ceil((finalStart - 1) / 2) ? 'QUALIFIERS' : 'MAIN DRAW';
}

/** Deterministic per-round randomness, so round 17 is the same fight every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * HP multiplier over the round-10 baseline, read at a round's place on the
 * original ladder (`equivalentRound`): a steady climb to the win round, then a
 * compounding freeplay ramp so endless runs eventually end.
 */
export function hpScale(round: number, cup: CupRules): number {
  const past = equivalentRound(round, cup) - 10;
  const base = (1 + 0.08 * past) * Math.pow(1.018, past);
  return round > cup.winRound ? base * Math.pow(1.045, round - cup.winRound) : base;
}

/** Weighted pick, without replacement, from an explicit `{index, weight}` pool. */
function weightedDraw(rand: () => number, count: number, pool: { index: number; weight: number }[]): number[] {
  const remaining = [...pool];
  const picks: number[] = [];
  while (picks.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, r) => sum + r.weight, 0);
    let r = rand() * total;
    let i = 0;
    while (i < remaining.length - 1 && (r -= remaining[i].weight) > 0) i++;
    picks.push(remaining.splice(i, 1)[0].index);
  }
  return picks;
}

/**
 * Weighted pick, without replacement, over a roster's indices. A dual-type
 * entry counts under whichever of its types has the higher weight. No
 * `weights` (or all-1) degrades to a plain uniform draw. `exclude` keeps
 * already-picked (e.g. trait-anchor) indices out of the draw.
 */
function pickRosterIndices(
  rand: () => number,
  count: number,
  roster: RosterEntry[],
  weights?: Partial<Record<PokemonType, number>>,
  exclude: readonly number[] = []
): number[] {
  const weightOf = (entry: RosterEntry): number => {
    if (!weights) return 1;
    const primary = weights[entry.type] ?? 1;
    const secondary = entry.secondaryType ? weights[entry.secondaryType] ?? 1 : primary;
    return Math.max(primary, secondary);
  };
  const pool = roster
    .map((entry, index) => ({ index, weight: weightOf(entry) }))
    .filter(r => !exclude.includes(r.index));
  return weightedDraw(rand, count, pool);
}

/** True for Ghost-type (Phantom-trait) entries — used to keep a wave targetable. */
function isPhantom(entry: RosterEntry): boolean {
  return entry.type === 'Ghost' || entry.secondaryType === 'Ghost';
}

/**
 * Towers can't target Phantoms (tower-roles.md); a wave built entirely of
 * them would be unwinnable for a team with no untargeted or Ghost/Psychic
 * coverage yet. If every pick came up Phantom, swap the last one for a
 * targetable escort (weighted, like any other pick) so there's always
 * something a starter team can aim at.
 */
function ensureTargetable(
  picks: number[],
  rand: () => number,
  roster: RosterEntry[],
  weights: Partial<Record<PokemonType, number>> | undefined
): number[] {
  if (picks.length === 0 || !picks.every(i => isPhantom(roster[i]))) return picks;
  const weightOf = (entry: RosterEntry): number => {
    if (!weights) return 1;
    const primary = weights[entry.type] ?? 1;
    const secondary = entry.secondaryType ? weights[entry.secondaryType] ?? 1 : primary;
    return Math.max(primary, secondary);
  };
  const pool = roster
    .map((entry, index) => ({ index, weight: weightOf(entry) }))
    .filter(r => !isPhantom(roster[r.index]) && !picks.includes(r.index));
  const [escort] = weightedDraw(rand, 1, pool);
  if (escort === undefined) return picks;
  return [...picks.slice(0, -1), escort];
}

/**
 * Rounds that skip the map's type bias and roll the full roster instead,
 * each carrying one random modifier — the "keep it spicy" exception to an
 * otherwise learnable, counterable map identity.
 */
const MYSTERY_CHANCE = 0.22;
const MYSTERY_MODIFIERS = [
  { id: 'swarm', label: 'Swarm Surge', groupBonus: 1, countMult: 0.85, hpMult: 1, speedMult: 1, payMult: 0.95, forceElite: false },
  { id: 'juggernaut', label: 'Juggernaut', groupBonus: 0, countMult: 1, hpMult: 1, speedMult: 1, payMult: 1, forceElite: true },
  { id: 'stampede', label: 'Stampede', groupBonus: 0, countMult: 1, hpMult: 1, speedMult: 1.25, payMult: 1.15, forceElite: false },
  { id: 'bounty', label: 'Bounty Round', groupBonus: 0, countMult: 1, hpMult: 0.85, speedMult: 1, payMult: 1.6, forceElite: false },
] as const;

/**
 * One Titan halfway through the procedural rounds, one to close the final
 * (the course's own, once it has a hand-made final), and one every 10th
 * freeplay round.
 */
function isBossRound(round: number, cup: CupRules): boolean {
  if (round > cup.winRound) return (round - cup.winRound) % 10 === 0;
  return round === midTitanRound(cup) || round === cup.winRound;
}

/** The generic Titans take turns: Gyarados mid-match, Onix at a procedural win, alternating in freeplay. */
function titanTypeForRound(round: number, cup: CupRules): 'Onix' | 'Gyarados' {
  if (round > cup.winRound) return (round - cup.winRound) % 20 === 0 ? 'Onix' : 'Gyarados';
  return round === midTitanRound(cup) ? 'Gyarados' : 'Onix';
}

/** Elites appear every fifth round of the original ladder, so a shorter cup meets them just as often. */
function isEliteRound(round: number, cup: CupRules): boolean {
  const here = equivalentRound(round, cup);
  if (here <= 10) return round % 3 === 0 && round !== 6;
  return Math.floor(here / 5) > Math.floor(equivalentRound(round - 1, cup) / 5);
}

/**
 * How steeply knockout pay climbs with enemy HP. Gentler than HP itself, so
 * the last rounds of a match don't pay for the whole build on their own.
 */
const PAY_EXPONENT = 0.35;

/** A Titan at a round's scaling. Course Titans and the generic Onix and Gyarados share the shape. */
function titanConfig(id: TitanId, round: number, hp: number, pay: number): CreepConfig {
  const titan = TITANS[id];
  return {
    id: `boss_${id}_${round}`,
    name: `Titan ${titan.name}`,
    type: titan.type,
    secondaryType: titan.secondaryType,
    maxHp: Math.round(TITAN_BASE_HP * titan.hp * hp),
    speed: titan.speed,
    reward: Math.round(TITAN_BASE_REWARD * pay),
    isBoss: true, threat: 'titan', modelType: 'boss_titan', titanType: titan.fallback, titanId: id,
  };
}

/** Creeps only a course's final sends, for lines the procedural rosters never field. */
export const FINAL_ROSTER: RosterEntry[] = [
  { name: 'Weedle', type: 'Bug', secondaryType: 'Poison', maxHp: 170, speed: 4.8, reward: 20, modelType: 'rattata' },
  { name: 'Kakuna', type: 'Bug', secondaryType: 'Poison', maxHp: 300, speed: 2.6, reward: 24, modelType: 'geodude' },
  { name: 'Staryu', type: 'Water', maxHp: 240, speed: 5.0, reward: 26, modelType: 'rattata' },
  { name: 'Voltorb', type: 'Electric', maxHp: 200, speed: 5.8, reward: 24, modelType: 'rattata' },
];

/**
 * A final's creep by name. The Little Cup reads the early lineup first and
 * every later cup the mid-game one, so a Haunter in a Great Cup final is as
 * tough as one in a Great Cup procedural round.
 */
export function finalRosterEntry(name: string, cup: CupRules): RosterEntry | null {
  const order = cup.id === 'little' ? [EARLY_ROSTER, ROSTER, FINAL_ROSTER] : [ROSTER, EARLY_ROSTER, FINAL_ROSTER];
  for (const roster of order) {
    const entry = roster.find(candidate => candidate.name === name);
    if (entry) return entry;
  }
  return null;
}

/** Elites hit this much harder, pay this much more, and walk this much slower than their group. */
const ELITE_HP = 4;

/** Seconds between rounds before the next one starts on its own. */
export const INTERMISSION_SECONDS = 14;
const ELITE_REWARD = 5;
const ELITE_SPEED = 0.8;

/**
 * What a typical procedural round of this round's scaling fields in total:
 * the group count and sizes `rollWave` would roll on average, at the average
 * roster creep, after the density tradeoff. The yardstick a final's beats are
 * budgeted against, so a final is never lighter than the rounds before it
 * however the dice fell on those.
 */
export function standardRound(round: number, cup: CupRules): { hp: number; pay: number } {
  const ladder = equivalentRound(round, cup);
  const roster = ladder <= 10 ? EARLY_ROSTER : ROSTER;
  const groups = ladder <= 10 ? Math.min(2 + Math.floor(ladder / 4), 4) : Math.min(2 + Math.floor(ladder / 25), 4);
  const heads = groups * Math.max(1, Math.round(Math.min(6 + Math.floor(ladder / 6) + 1.5, 28) * TRASH_COUNT_MULTIPLIER));
  const mean = (pick: (entry: RosterEntry) => number) => roster.reduce((sum, entry) => sum + pick(entry), 0) / roster.length;
  const hp = hpScale(round, cup);
  const pay = Math.pow(hp, PAY_EXPONENT) * cup.payScale;
  return {
    hp: heads * mean(entry => entry.maxHp) * TRASH_HP_MULTIPLIER * hp,
    pay: heads * mean(entry => entry.reward) * TRASH_HP_MULTIPLIER * pay,
  };
}

/**
 * Each beat's crowd, as a share of a standard round's HP and pay. The final
 * climbs, dips for the breather, peaks at the gauntlet, and lets the Titan
 * carry the finale on top of a lighter escort.
 */
const BEAT_BUDGET: Record<FinalBeat, number> = { showcase: 1.0, exam: 1.1, breather: 0.6, gauntlet: 1.25, titan: 0.8 };
/** The finale's Titan alone, as a share of a standard round's HP (times the Titan's own `hp`). */
const FINALE_TITAN_SHARE = 0.45;
/**
 * Finals are written at Little Cup size. Later cups field bigger crowds, so
 * they multiply each rank-and-file group and tighten its spacing to match:
 * a group lasts as long as written, which keeps timed tricks like two
 * entrances at once or two trails converging intact.
 */
const FINAL_CROWD: Record<CupRules['id'], number> = { little: 1, poke: 1.5, great: 1.8, prime: 2 };

/** One of a course's hand-made rounds, at its round's scaling. */
function finalWave(round: number, cup: CupRules, mapId: string): WaveDefinition | null {
  const final = finalFor(mapId);
  if (!final || !isFinalRound(round, cup)) return null;
  const written = final.rounds[round - finalStartRound(cup)];
  const hp = hpScale(round, cup);
  const pay = Math.pow(hp, PAY_EXPONENT) * cup.payScale;
  const ladder = equivalentRound(round, cup);
  const standard = standardRound(round, cup);
  const crowd = FINAL_CROWD[cup.id];

  // First pass: every group at its written shape and relative toughness.
  const spawns: SpawnGroup[] = written.groups.map((group: FinalGroup, i) => {
    const place = { interval: group.interval, at: group.at, route: group.route, exact: true };
    if (group.creep === 'titan') {
      const titan = TITANS[final.titan];
      const config = titanConfig(final.titan, round, hp, pay);
      config.maxHp = Math.round(standard.hp * FINALE_TITAN_SHARE * titan.hp * (group.hp ?? 1));
      return { ...place, count: 1, config };
    }
    const entry = finalRosterEntry(group.creep, cup);
    if (!entry) throw new Error(`Final for ${mapId} sends unknown creep "${group.creep}"`);
    const elite = group.threat === 'elite';
    const count = elite ? group.count : Math.max(1, Math.round(group.count * crowd));
    return {
      ...place,
      count,
      interval: elite ? group.interval : group.interval * group.count / count,
      config: {
        ...entry,
        id: `final_${round}_${i}`,
        maxHp: entry.maxHp * (elite ? ELITE_HP : TRASH_HP_MULTIPLIER) * (group.hp ?? 1),
        reward: entry.reward * (elite ? ELITE_REWARD : TRASH_HP_MULTIPLIER),
        speed: Math.min(entry.speed * (1 + Math.min(ladder, 120) * 0.0025), entry.speed * 1.3) * (elite ? ELITE_SPEED : 1),
        ...(elite ? { threat: 'elite' as const } : {}),
      },
    };
  });

  // Second pass: scale the crowd so the beat carries its budget of a standard round.
  const crowdGroups = spawns.filter(group => !group.config.isBoss);
  const total = (pick: (group: SpawnGroup) => number) => crowdGroups.reduce((sum, group) => sum + pick(group) * group.count, 0);
  const hpFactor = BEAT_BUDGET[written.beat] * standard.hp / Math.max(1, total(group => group.config.maxHp));
  const payFactor = BEAT_BUDGET[written.beat] * standard.pay / Math.max(1, total(group => group.config.reward));
  for (const group of crowdGroups) {
    group.config.maxHp = Math.round(group.config.maxHp * hpFactor);
    group.config.reward = Math.max(1, Math.round(group.config.reward * payFactor));
  }

  return {
    round, cupName: stageName(round, cup), name: `${stageName(round, cup)}: ${written.name.toUpperCase()}`,
    spawns, beat: written.beat, title: written.name, payMult: written.payMult,
  };
}

/** The round as rolled, before the debut rule thins a trait's first appearance. */
export function rollWave(round: number, cup: CupRules, typeWeights?: Partial<Record<PokemonType, number>>): WaveDefinition {
  const rand = mulberry32((round + 1000 * CUP_SEEDS[cup.id]) * 2654435761);
  const winRound = cup.winRound;
  const ladder = equivalentRound(round, cup);
  const hp = hpScale(round, cup);
  // Rewards trail HP so income doesn't outrun the difficulty curve; the cup's
  // pay scale sets how much of a full build one match can buy.
  const pay = Math.pow(hp, PAY_EXPONENT) * cup.payScale;
  const freeplay = round > winRound;
  const roster = ladder <= 10 ? EARLY_ROSTER : ROSTER;
  const cupName = stageName(round, cup);

  // Titan rounds and finals stay on-theme; mystery only applies to normal rounds.
  const isMystery = !isBossRound(round, cup) && !isFinalRound(round, cup) && rand() < MYSTERY_CHANCE;
  const modifier = isMystery ? MYSTERY_MODIFIERS[Math.floor(rand() * MYSTERY_MODIFIERS.length)] : null;
  const weights = isMystery ? undefined : typeWeights;

  const scaled = (entry: RosterEntry, id: string, extra: Partial<CreepConfig> = {}): CreepConfig => ({
    ...entry,
    id,
    maxHp: Math.round(entry.maxHp * hp * (modifier?.hpMult ?? 1)),
    speed: Math.min(entry.speed * (1 + Math.min(ladder, 120) * 0.0025), entry.speed * 1.3) * (modifier?.speedMult ?? 1),
    reward: Math.round(entry.reward * pay * (modifier?.payMult ?? 1)),
    ...extra,
  });

  if (isBossRound(round, cup)) {
    const titanType = titanTypeForRound(round, cup);
    const escortEntry = roster[pickRosterIndices(rand, 1, roster, weights)[0]];
    return {
      round, cupName,
      name: `${cupName}: TITAN ${titanType.toUpperCase()}`,
      spawns: [
        { config: titanConfig(titanType === 'Onix' ? 'onix' : 'gyarados', round, hp, pay), count: 1, interval: 1.0 },
        { config: scaled(escortEntry, `escort_${round}`), count: 4 + Math.floor(ladder / 15), interval: 0.9 },
      ],
    };
  }

  // Little Cup rounds 1/3/6 guarantee a creep of the type behind Airborne/Armored/Phantom,
  // on-bias or not, so every save meets each trait on the same schedule (see TRAIT_ANCHOR_ROUNDS).
  const anchorType = teachesTraits(cup) ? TRAIT_ANCHOR_ROUNDS[round] : undefined;
  const anchorPool = anchorType
    ? roster.map((entry, index) => index).filter(index => roster[index].type === anchorType || roster[index].secondaryType === anchorType)
    : [];
  const anchorPick = anchorPool.length ? anchorPool[Math.floor(rand() * anchorPool.length)] : undefined;

  const groupCount = (ladder <= 10 ? Math.min(2 + Math.floor(ladder / 4), 4) : Math.min(2 + Math.floor(ladder / 25), 4))
    + (modifier?.groupBonus ?? 0);
  const rest = pickRosterIndices(rand, anchorPick !== undefined ? groupCount - 1 : groupCount, roster, weights, anchorPick !== undefined ? [anchorPick] : []);
  const picks = ensureTargetable(anchorPick !== undefined ? [anchorPick, ...rest] : rest, rand, roster, weights);

  const spawns: WaveDefinition['spawns'] = picks.map((index, i) => ({
    config: scaled(roster[index], `gen_${round}_${i}`),
    count: Math.min(Math.round((6 + Math.floor(ladder / 6) + Math.floor(rand() * 4)) * (modifier?.countMult ?? 1)), 28),
    interval: Math.max(1.1 - ladder * 0.006, 0.45),
  }));

  if (isEliteRound(round, cup) || modifier?.forceElite) {
    const eliteEntry = roster[pickRosterIndices(rand, 1, roster, weights, picks)[0]];
    spawns.push({
      config: scaled(eliteEntry, `elite_${round}`, {
        maxHp: Math.round(eliteEntry.maxHp * ELITE_HP * hp * (modifier?.hpMult ?? 1)),
        reward: Math.round(eliteEntry.reward * ELITE_REWARD * pay * (modifier?.payMult ?? 1)),
        speed: eliteEntry.speed * ELITE_SPEED * (modifier?.speedMult ?? 1),
        threat: 'elite',
      }),
      count: 1 + Math.floor(ladder / 40),
      interval: 2.4,
    });
  }

  const lead = spawns[0].config.name;
  const name = modifier ? `${cupName}: MYSTERY ROUND — ${modifier.label}` : `${cupName}: ${lead} Assault`;
  return { round, cupName, name, spawns, isMystery, payMult: modifier?.payMult };
}

// --------------------------------------------------------------------------
// First contact
// --------------------------------------------------------------------------

/**
 * A trait's debut round fields exactly one creep carrying it, instead of a
 * whole group.
 *
 * Airborne, Phantom and Armored each answer to something a starter team may
 * simply not own yet — above all Phantom, which most towers cannot even aim
 * at. Meeting four Haunters in the round that introduces them costs a fresh
 * trainer most of their lives before they have been told what the trait is,
 * which teaches the lesson by ending the run. One scout still leaks, the
 * announcer still calls the trait out, and the player is down a single life
 * with the next round to answer it. Later rounds field them at full strength.
 */
const SCOUT_COUNT = 1;

/** The traits a spawn group puts on the lane, read off its typing like any creep's. */
function groupTraits(config: CreepConfig): CreepTrait[] {
  return traitsForTypes([config.type, ...(config.secondaryType ? [config.secondaryType] : [])]);
}

/** Only the Little Cup teaches traits; every later cup assumes the player has met all three. */
function teachesTraits(cup: CupRules): boolean {
  return cup.id === 'little';
}

/** Mixed into each cup's wave seed, so two cups never roll the same round. */
const CUP_SEEDS: Record<CupRules['id'], number> = { little: 0, poke: 1, great: 2, prime: 3 };

function waveKey(round: number, cup: CupRules, typeWeights?: Partial<Record<PokemonType, number>>): string {
  return `${round}|${cup.id}|${cup.winRound}|${cup.roundBand.join(',')}|${cup.payScale}|${typeWeights ? JSON.stringify(typeWeights) : ''}`;
}

const rolledWaves = new Map<string, WaveDefinition>();
/** Traits fielded anywhere in rounds 1..round, memoized so walking the ladder stays linear. */
const traitsThroughRound = new Map<string, Set<CreepTrait>>();

function rolled(round: number, cup: CupRules, typeWeights?: Partial<Record<PokemonType, number>>): WaveDefinition {
  const key = waveKey(round, cup, typeWeights);
  let wave = rolledWaves.get(key);
  if (!wave) {
    wave = rollWave(round, cup, typeWeights);
    rolledWaves.set(key, wave);
  }
  return wave;
}

/**
 * Which traits the player has already met by the end of `round`. Read off the
 * raw rolls, which the scout rule only thins out — it never changes which
 * creeps a round fields, so the debut schedule is the same either way.
 */
function traitsThrough(round: number, cup: CupRules, typeWeights?: Partial<Record<PokemonType, number>>): Set<CreepTrait> {
  if (round < 1) return new Set();
  const key = waveKey(round, cup, typeWeights);
  let seen = traitsThroughRound.get(key);
  if (!seen) {
    seen = new Set(traitsThrough(round - 1, cup, typeWeights));
    for (const group of rolled(round, cup, typeWeights).spawns) {
      for (const trait of groupTraits(group.config)) seen.add(trait);
    }
    traitsThroughRound.set(key, seen);
  }
  return seen;
}

/**
 * The round the player actually fights: the course's hand-made final when it
 * has one, otherwise the roll with the Little Cup's debut rule applied.
 */
export function generateWave(round: number, cup: CupRules, typeWeights?: Partial<Record<PokemonType, number>>, mapId?: string): WaveDefinition {
  const written = mapId ? finalWave(round, cup, mapId) : null;
  if (written) return written;
  const wave = rolled(round, cup, typeWeights);
  if (!teachesTraits(cup)) return wave;
  const seenBefore = traitsThrough(round - 1, cup, typeWeights);
  const debuting = new Set<CreepTrait>();
  for (const group of wave.spawns) {
    for (const trait of groupTraits(group.config)) if (!seenBefore.has(trait)) debuting.add(trait);
  }
  if (debuting.size === 0) return wave;

  // Titans are a single set-piece already. The scout carries the whole group's
  // purse — counted after the density tradeoff, which pays per head — so a
  // debut round pays out like any other and the economy doesn't dip at exactly
  // the round the player needs money for an answer.
  return {
    ...wave,
    spawns: wave.spawns.map(group => {
      if (group.config.isBoss || group.count <= SCOUT_COUNT) return group;
      if (!groupTraits(group.config).some(trait => debuting.has(trait))) return group;
      const purse = group.config.reward * spawnedCount(group.config, group.count);
      return {
        ...group,
        config: { ...group.config, reward: Math.round(purse / spawnedCount(group.config, SCOUT_COUNT)) },
        count: SCOUT_COUNT,
      };
    }),
  };
}

/** Every type fielded in the opening rounds — what team select warns about. */
export function openingThreatTypes(
  rounds = 10,
  cup: CupRules = CUPS.little,
  typeWeights?: Partial<Record<PokemonType, number>>
): PokemonType[] {
  const types = new Set<PokemonType>();
  for (let round = 1; round <= rounds; round++) {
    const wave = generateWave(round, cup, typeWeights);
    for (const spawn of wave.spawns) {
      types.add(spawn.config.type);
      if (spawn.config.secondaryType) types.add(spawn.config.secondaryType);
    }
  }
  return [...types];
}
