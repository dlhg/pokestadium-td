/**
 * WaveManager.ts — Tournament Cup & Wave Progression System
 *
 * Defines the tournament stages each match runs through (Qualifiers, Main Draw, Gym Leader Castle...)
 * and controls wave spawning, boss arrivals, and intermissions.
 */

import * as THREE from 'three';
import { Creep, CreepConfig, CreepTrait, traitsForTypes } from './Creep';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { CUPS, type CupRules } from './Cups';
import type { PokemonType } from '../stadium/TypeMatrix';
import type { BallType } from './CaptureSequence';
import { creepLevel } from './progression/Stats';

export interface WaveDefinition {
  round: number;
  cupName: string;
  name: string;
  spawns: { config: CreepConfig; count: number; interval: number }[];
  /** True for a generated round rolled unweighted, with a random modifier. */
  isMystery?: boolean;
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

type RosterEntry = Omit<CreepConfig, 'id'>;

/**
 * The opening rounds (1–10, QUALIFIERS/MAIN DRAW) draw from this weaker,
 * pre-evolution lineup instead of the mid-game ROSTER below — generated,
 * like every other round, so a map's `typeWeights` reach the opening too.
 * TRAIT_ANCHOR_ROUNDS and the Phantom safety net (see rollWave) keep
 * the trait-teaching beats intact regardless of which map rolls them.
 */
export const EARLY_ROSTER: RosterEntry[] = [
  { name: 'Rattata', type: 'Normal', maxHp: 220, speed: 4.6, reward: 22, modelType: 'rattata' },
  { name: 'Pidgey', type: 'Normal', secondaryType: 'Flying', maxHp: 180, speed: 5.0, reward: 22, modelType: 'zubat' },
  { name: 'Zubat', type: 'Poison', secondaryType: 'Flying', maxHp: 190, speed: 5.2, reward: 22, modelType: 'zubat' },
  { name: 'Paras', type: 'Bug', secondaryType: 'Grass', maxHp: 230, speed: 3.6, reward: 24, modelType: 'rattata' },
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
 * A round that must field a creep of this type, regardless of the map's
 * bias, so a fresh team meets the type behind each creep trait
 * (`tower-roles.md`) on a predictable schedule: Airborne at round 1,
 * Armored at round 3, Phantom at round 6.
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

  private spawnQueue: { config: CreepConfig; delay: number }[] = [];
  private spawnTimer: number = 0;
  private routes: THREE.Vector3[][];
  private lifts?: number[][];
  private nextRoute = 0;
  private announcer: StadiumAnnouncer;
  private cup: CupRules;
  private typeWeights?: Partial<Record<PokemonType, number>>;

  /** Every round is generated (and map-flavored); this just caches the result. */
  private generated = new Map<number, WaveDefinition>();
  public readonly winRound: number;

  constructor(
    routes: THREE.Vector3[][],
    announcer: StadiumAnnouncer,
    cup: CupRules,
    lifts?: number[][],
    typeWeights?: Partial<Record<PokemonType, number>>
  ) {
    if (!routes.length || routes.some(route => route.length < 2)) throw new Error('A course needs a traversable route');
    this.routes = routes;
    this.lifts = lifts;
    this.announcer = announcer;
    this.cup = cup;
    this.winRound = cup.winRound;
    this.typeWeights = typeWeights;
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
      wave = generateWave(round, this.winRound, this.typeWeights);
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
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.nextRoute = this.currentWaveIndex % this.routes.length;

    // Populate spawn queue.
    // Rank-and-file creeps spawn at half density with double HP (and reward,
    // and spacing, so total wave income and duration are unchanged) — fewer,
    // tankier trash mobs instead of a swarm. Bosses/elites/titans are already
    // singular set-pieces and are left alone.
    wave.spawns.forEach(group => {
      const trash = isTrash(group.config);
      const count = spawnedCount(group.config, group.count);
      const hpMultiplier = trash ? TRASH_HP_MULTIPLIER : 1;
      const interval = trash ? group.interval / TRASH_COUNT_MULTIPLIER : group.interval;

      for (let i = 0; i < count; i++) {
        this.spawnQueue.push({
          config: {
            ...group.config,
            maxHp: Math.round(group.config.maxHp * hpMultiplier),
            reward: Math.round(group.config.reward * hpMultiplier),
            level: creepLevel(wave.round, this.cup, group.config.threat ?? (group.config.isBoss ? 'titan' : 'normal')),
          },
          delay: interval
        });
      }
    });

    if (wave.spawns.some(s => s.config.isBoss)) {
      this.announcer.trigger('boss_spawn', wave.name);
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
      this.spawnTimer -= dt;
      while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
        const next = this.spawnQueue.shift()!;
        this.spawnTimer += next.delay;
        const creep = new Creep(next.config, this.routes[this.nextRoute], this.lifts?.[this.nextRoute]);
        this.nextRoute = (this.nextRoute + 1) % this.routes.length;
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
        this.intermissionTimer = 7.0; // 7s break between rounds
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
 * Bonus payouts for landmark clears: every 10th round, bigger ones at each
 * quarter-century, and the win round itself. Round 100 and each hundred
 * after it are the long-haul trophies, reachable only in freeplay on easy
 * and medium courses and just past the finish on hard ones.
 */
export function getMilestone(round: number, winRound: number): MilestoneReward | null {
  if (round % 100 === 0) {
    return { round, label: `ROUND ${round} LEGEND`, money: 2500 * (round / 100), balls: { ultra: 3 } };
  }
  if (round === winRound) {
    return { round, label: 'STADIUM CHAMPION', money: 1000, balls: { ultra: 2 } };
  }
  if (round % 25 === 0) {
    return { round, label: `ROUND ${round} MILESTONE`, money: 400 + round * 12, balls: { ultra: 1 } };
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

const CUP_NAMES = ['GYM LEADER CASTLE', 'ELITE FOUR', 'MASTER CUP', 'CHAMPION LEAGUE'];

/** Deterministic per-round randomness, so round 37 is the same fight every run. */
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
 * HP multiplier over the round-10 baseline: a steady climb to the win round,
 * then a compounding freeplay ramp so endless runs eventually end.
 */
function hpScale(round: number, winRound: number): number {
  const past = round - 10;
  const base = (1 + 0.08 * past) * Math.pow(1.018, past);
  return round > winRound ? base * Math.pow(1.045, round - winRound) : base;
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

/** Every 10th round is a Titan; rounds 1–10 also close with one at round 5 (Qualifiers Final). */
function isBossRound(round: number): boolean {
  return round === 5 || round % 10 === 0;
}

/** Round 5/10 keep their original Onix-then-Gyarados pair; later Titans alternate every 20. */
function titanTypeForRound(round: number): 'Onix' | 'Gyarados' {
  if (round === 5) return 'Onix';
  if (round === 10) return 'Gyarados';
  return round % 20 === 0 ? 'Gyarados' : 'Onix';
}

/** The round as rolled, before the debut rule thins a trait's first appearance. */
export function rollWave(round: number, winRound: number, typeWeights?: Partial<Record<PokemonType, number>>): WaveDefinition {
  const rand = mulberry32(round * 2654435761);
  const hp = hpScale(round, winRound);
  // Rewards trail HP so income doesn't outrun the difficulty curve.
  const pay = Math.sqrt(hp);
  const freeplay = round > winRound;
  const roster = round <= 10 ? EARLY_ROSTER : ROSTER;
  const cupName = round <= 5 ? 'QUALIFIERS' : round <= 10 ? 'MAIN DRAW'
    : freeplay ? 'FREEPLAY' : CUP_NAMES[Math.floor((round - 11) / 10) % CUP_NAMES.length];

  // Titan rounds stay on-theme; mystery only applies to normal rounds.
  const isMystery = !isBossRound(round) && rand() < MYSTERY_CHANCE;
  const modifier = isMystery ? MYSTERY_MODIFIERS[Math.floor(rand() * MYSTERY_MODIFIERS.length)] : null;
  const weights = isMystery ? undefined : typeWeights;

  const scaled = (entry: RosterEntry, id: string, extra: Partial<CreepConfig> = {}): CreepConfig => ({
    ...entry,
    id,
    maxHp: Math.round(entry.maxHp * hp * (modifier?.hpMult ?? 1)),
    speed: Math.min(entry.speed * (1 + Math.min(round, 120) * 0.0025), entry.speed * 1.3) * (modifier?.speedMult ?? 1),
    reward: Math.round(entry.reward * pay * (modifier?.payMult ?? 1)),
    ...extra,
  });

  if (isBossRound(round)) {
    const titanType = titanTypeForRound(round);
    const escortEntry = roster[pickRosterIndices(rand, 1, roster, weights)[0]];
    return {
      round, cupName,
      name: `${freeplay ? 'Freeplay' : cupName} Final: TITAN ${titanType.toUpperCase()}`,
      spawns: [
        {
          config: {
            id: `boss_${titanType.toLowerCase()}_${round}`,
            name: `Titan ${titanType}`,
            type: titanType === 'Onix' ? 'Rock' : 'Water',
            secondaryType: titanType === 'Onix' ? 'Ground' : 'Flying',
            maxHp: Math.round(3600 * hp),
            speed: titanType === 'Onix' ? 2.3 : 2.8,
            reward: Math.round(500 * pay),
            isBoss: true, threat: 'titan', modelType: 'boss_titan', titanType,
          },
          count: 1,
          interval: 1.0,
        },
        { config: scaled(escortEntry, `escort_${round}`), count: 4 + Math.floor(round / 15), interval: 0.9 },
      ],
    };
  }

  // Rounds 1/3/6 guarantee a creep of the type behind Airborne/Armored/Phantom, on-bias or
  // not, so every save meets each trait on the same schedule (see TRAIT_ANCHOR_ROUNDS).
  const anchorType = TRAIT_ANCHOR_ROUNDS[round];
  const anchorPool = anchorType
    ? roster.map((entry, index) => index).filter(index => roster[index].type === anchorType || roster[index].secondaryType === anchorType)
    : [];
  const anchorPick = anchorPool.length ? anchorPool[Math.floor(rand() * anchorPool.length)] : undefined;

  const groupCount = (round <= 10 ? Math.min(2 + Math.floor(round / 4), 4) : Math.min(2 + Math.floor(round / 25), 4))
    + (modifier?.groupBonus ?? 0);
  const rest = pickRosterIndices(rand, anchorPick !== undefined ? groupCount - 1 : groupCount, roster, weights, anchorPick !== undefined ? [anchorPick] : []);
  const picks = ensureTargetable(anchorPick !== undefined ? [anchorPick, ...rest] : rest, rand, roster, weights);

  const spawns: WaveDefinition['spawns'] = picks.map((index, i) => ({
    config: scaled(roster[index], `gen_${round}_${i}`),
    count: Math.min(Math.round((6 + Math.floor(round / 6) + Math.floor(rand() * 4)) * (modifier?.countMult ?? 1)), 28),
    interval: Math.max(1.1 - round * 0.006, 0.45),
  }));

  const eliteEligible = round <= 10 ? (round % 3 === 0 && round !== 6) : round % 5 === 0;
  if (eliteEligible || modifier?.forceElite) {
    const eliteEntry = roster[pickRosterIndices(rand, 1, roster, weights, picks)[0]];
    spawns.push({
      config: scaled(eliteEntry, `elite_${round}`, {
        maxHp: Math.round(eliteEntry.maxHp * 4 * hp * (modifier?.hpMult ?? 1)),
        reward: Math.round(eliteEntry.reward * 5 * pay * (modifier?.payMult ?? 1)),
        speed: eliteEntry.speed * 0.8 * (modifier?.speedMult ?? 1),
        threat: 'elite',
      }),
      count: 1 + Math.floor(round / 40),
      interval: 2.4,
    });
  }

  const lead = spawns[0].config.name;
  const name = modifier ? `${cupName}: MYSTERY ROUND — ${modifier.label}` : `${cupName}: ${lead} Assault`;
  return { round, cupName, name, spawns, isMystery };
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

function waveKey(round: number, winRound: number, typeWeights?: Partial<Record<PokemonType, number>>): string {
  return `${round}|${winRound}|${typeWeights ? JSON.stringify(typeWeights) : ''}`;
}

const rolledWaves = new Map<string, WaveDefinition>();
/** Traits fielded anywhere in rounds 1..round, memoized so walking the ladder stays linear. */
const traitsThroughRound = new Map<string, Set<CreepTrait>>();

function rolled(round: number, winRound: number, typeWeights?: Partial<Record<PokemonType, number>>): WaveDefinition {
  const key = waveKey(round, winRound, typeWeights);
  let wave = rolledWaves.get(key);
  if (!wave) {
    wave = rollWave(round, winRound, typeWeights);
    rolledWaves.set(key, wave);
  }
  return wave;
}

/**
 * Which traits the player has already met by the end of `round`. Read off the
 * raw rolls, which the scout rule only thins out — it never changes which
 * creeps a round fields, so the debut schedule is the same either way.
 */
function traitsThrough(round: number, winRound: number, typeWeights?: Partial<Record<PokemonType, number>>): Set<CreepTrait> {
  if (round < 1) return new Set();
  const key = waveKey(round, winRound, typeWeights);
  let seen = traitsThroughRound.get(key);
  if (!seen) {
    seen = new Set(traitsThrough(round - 1, winRound, typeWeights));
    for (const group of rolled(round, winRound, typeWeights).spawns) {
      for (const trait of groupTraits(group.config)) seen.add(trait);
    }
    traitsThroughRound.set(key, seen);
  }
  return seen;
}

/** The round the player actually fights: the roll, with the debut rule applied. */
export function generateWave(round: number, winRound: number, typeWeights?: Partial<Record<PokemonType, number>>): WaveDefinition {
  const wave = rolled(round, winRound, typeWeights);
  const seenBefore = traitsThrough(round - 1, winRound, typeWeights);
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
  winRound = CUPS.little.winRound,
  typeWeights?: Partial<Record<PokemonType, number>>
): PokemonType[] {
  const types = new Set<PokemonType>();
  for (let round = 1; round <= rounds; round++) {
    const wave = generateWave(round, winRound, typeWeights);
    for (const spawn of wave.spawns) {
      types.add(spawn.config.type);
      if (spawn.config.secondaryType) types.add(spawn.config.secondaryType);
    }
  }
  return [...types];
}
