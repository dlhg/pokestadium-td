/**
 * WaveManager.ts — Tournament Cup & Wave Progression System
 *
 * Defines authentic Pokémon Stadium cups (Poke Cup, Prime Cup, Gym Leader Castle)
 * and controls wave spawning, boss arrivals, and intermissions.
 */

import * as THREE from 'three';
import { Creep, CreepConfig } from './Creep';
import { StadiumAnnouncer } from '../stadium/Announcer';
import type { MapDifficulty } from './MapCatalog';
import type { PokemonType } from '../stadium/TypeMatrix';
import type { BallType } from './CaptureSequence';
import { creepLevel } from './progression/Stats';

export interface WaveDefinition {
  round: number;
  cupName: string;
  name: string;
  spawns: { config: CreepConfig; count: number; interval: number }[];
}

/** The opening cups, hand-authored. Later rounds are generated. */
const AUTHORED_WAVES: WaveDefinition[] = [
  // POKE CUP (Waves 1 - 5)
  {
    round: 1,
    cupName: 'POKE CUP',
    name: 'Round 1: Route 1 Runners',
    spawns: [
      {
        config: {
          id: 'rattata_1',
          name: 'Rattata',
          type: 'Normal',
          maxHp: 75,
          speed: 4.2,
          reward: 15,
          modelType: 'rattata'
        },
        count: 8,
        interval: 1.2
      },
      {
        config: {
          id: 'pidgey_1', name: 'Pidgey', type: 'Normal', secondaryType: 'Flying',
          maxHp: 68, speed: 4.8, reward: 16, modelType: 'zubat'
        },
        count: 5,
        interval: 1.35
      }
    ]
  },
  {
    round: 2,
    cupName: 'POKE CUP',
    name: 'Round 2: Mt. Moon Swarm',
    spawns: [
      {
        config: {
          id: 'zubat_1',
          name: 'Zubat',
          type: 'Poison',
          secondaryType: 'Flying',
          maxHp: 95,
          speed: 5.0,
          reward: 18,
          modelType: 'zubat'
        },
        count: 12,
        interval: 1.0
      },
      {
        config: {
          id: 'paras_1', name: 'Paras', type: 'Bug', secondaryType: 'Grass',
          maxHp: 125, speed: 3.2, reward: 23, modelType: 'rattata'
        },
        count: 6,
        interval: 1.25
      }
    ]
  },
  {
    round: 3,
    cupName: 'POKE CUP',
    name: 'Round 3: Granite Guard',
    spawns: [
      {
        config: {
          id: 'geodude_1',
          name: 'Geodude',
          type: 'Rock',
          secondaryType: 'Ground',
          maxHp: 180,
          speed: 2.8,
          reward: 25,
          modelType: 'geodude'
        },
        count: 10,
        interval: 1.4
      },
      {
        config: {
          id: 'machop_1', name: 'Machop', type: 'Fighting',
          maxHp: 210, speed: 3.1, reward: 29, modelType: 'geodude'
        },
        count: 5,
        interval: 1.55
      },
      {
        config: {
          id: 'elite_geodude_1', name: 'Geodude', type: 'Rock', secondaryType: 'Ground',
          maxHp: 720, speed: 2.35, reward: 100, threat: 'elite', modelType: 'geodude'
        },
        count: 1,
        interval: 2.4
      }
    ]
  },
  {
    round: 4,
    cupName: 'POKE CUP',
    name: 'Round 4: Stadium Qualifier',
    spawns: [
      {
        config: {
          id: 'ponyta_1',
          name: 'Ponyta',
          type: 'Fire',
          maxHp: 130,
          speed: 4.6,
          reward: 20,
          modelType: 'rattata'
        },
        count: 8,
        interval: 0.9
      },
      {
        config: {
          id: 'oddish_1',
          name: 'Oddish',
          type: 'Grass',
          secondaryType: 'Poison',
          maxHp: 140,
          speed: 5.2,
          reward: 22,
          modelType: 'rattata'
        },
        count: 8,
        interval: 0.9
      },
      {
        config: {
          id: 'psyduck_1', name: 'Psyduck', type: 'Water',
          maxHp: 165, speed: 4.1, reward: 25, modelType: 'rattata'
        },
        count: 6,
        interval: 1.0
      }
    ]
  },
  {
    round: 5,
    cupName: 'POKE CUP',
    name: 'Poke Cup Final: TITAN ONIX',
    spawns: [
      {
        config: {
          id: 'boss_onix',
          name: 'Titan Onix',
          type: 'Rock',
          secondaryType: 'Ground',
          maxHp: 1400,
          speed: 2.2,
          reward: 250,
          isBoss: true,
          threat: 'titan',
          modelType: 'boss_titan',
          titanType: 'Onix'
        },
        count: 1,
        interval: 1.0
      }
    ]
  },

  // PRIME CUP (Waves 6 - 10)
  {
    round: 6,
    cupName: 'PRIME CUP',
    name: 'Prime Cup: Spectral Apparitions',
    spawns: [
      // Phantoms can't be aimed at by most towers, so targetable Zubat
      // escorts are threaded through the ghosts to keep a starter team busy.
      ...[0, 1].flatMap(half => [
        {
          config: {
            id: `zubat_escort_6_${half}`, name: 'Zubat', type: 'Poison' as const, secondaryType: 'Flying' as const,
            maxHp: 160, speed: 4.5, reward: 20, modelType: 'zubat' as const
          },
          count: 3 - half,
          interval: 1.2
        },
        {
          config: {
            id: `haunter_1_${half}`, name: 'Haunter', type: 'Ghost' as const, secondaryType: 'Poison' as const,
            maxHp: 220, speed: 4.5, reward: 30, modelType: 'zubat' as const
          },
          count: 7,
          interval: 1.1
        },
      ])
    ]
  },
  {
    round: 7,
    cupName: 'PRIME CUP',
    name: 'Prime Cup: Boulder Battalion',
    spawns: [
      {
        config: {
          id: 'geodude_2',
          name: 'Graveler',
          type: 'Rock',
          secondaryType: 'Ground',
          maxHp: 340,
          speed: 3.2,
          reward: 35,
          modelType: 'geodude'
        },
        count: 12,
        interval: 1.2
      },
      {
        config: {
          id: 'machoke_1', name: 'Machoke', type: 'Fighting',
          maxHp: 390, speed: 3.0, reward: 42, modelType: 'geodude'
        },
        count: 7,
        interval: 1.35
      }
    ]
  },
  {
    round: 8,
    cupName: 'PRIME CUP',
    name: 'Prime Cup: Dragonair Sprint',
    spawns: [
      {
        config: {
          id: 'dragonair_1',
          name: 'Dragonair',
          type: 'Dragon',
          maxHp: 380,
          speed: 5.6,
          reward: 40,
          modelType: 'dragonair'
        },
        count: 15,
        interval: 0.9
      },
      {
        config: {
          id: 'lapras_1', name: 'Lapras', type: 'Water', secondaryType: 'Ice',
          maxHp: 540, speed: 3.1, reward: 52, modelType: 'dragonair'
        },
        count: 5,
        interval: 1.5
      },
      {
        config: {
          id: 'elite_dragonair_1', name: 'Dragonair', type: 'Dragon',
          maxHp: 1520, speed: 3.7, reward: 185, threat: 'elite', modelType: 'dragonair'
        },
        count: 1,
        interval: 2.6
      }
    ]
  },
  {
    round: 9,
    cupName: 'PRIME CUP',
    name: 'Prime Cup: Semifinal Rush',
    spawns: [
      {
        config: {
          id: 'exeggutor_1',
          name: 'Exeggutor',
          type: 'Grass',
          secondaryType: 'Psychic',
          maxHp: 420,
          speed: 5.4,
          reward: 45,
          modelType: 'geodude'
        },
        count: 10,
        interval: 0.8
      },
      {
        config: {
          id: 'rhydon_1',
          name: 'Rhydon',
          type: 'Ground',
          secondaryType: 'Rock',
          maxHp: 480,
          speed: 3.2,
          reward: 45,
          modelType: 'geodude'
        },
        count: 8,
        interval: 0.8
      },
      {
        config: {
          id: 'scyther_1', name: 'Scyther', type: 'Bug', secondaryType: 'Flying',
          maxHp: 410, speed: 5.8, reward: 48, modelType: 'zubat'
        },
        count: 8,
        interval: 0.85
      },
      {
        config: {
          id: 'elite_rhydon_1', name: 'Rhydon', type: 'Ground', secondaryType: 'Rock',
          maxHp: 1920, speed: 2.55, reward: 220, threat: 'elite', modelType: 'geodude'
        },
        count: 1,
        interval: 2.8
      }
    ]
  },
  {
    round: 10,
    cupName: 'PRIME CUP',
    name: 'Prime Cup Final: TITAN GYARADOS',
    spawns: [
      {
        config: {
          id: 'boss_gyarados',
          name: 'Titan Gyarados',
          type: 'Water',
          secondaryType: 'Flying',
          maxHp: 3600,
          speed: 2.8,
          reward: 500,
          isBoss: true,
          threat: 'titan',
          modelType: 'boss_titan',
          titanType: 'Gyarados'
        },
        count: 1,
        interval: 1.0
      }
    ]
  }
];

export class WaveManager {
  public currentWaveIndex: number = 0;
  public inWave: boolean = false;
  public waveCompleted: boolean = false;
  public intermissionTimer: number = 0; // The first wave waits for the player's plan.

  private spawnQueue: { config: CreepConfig; delay: number }[] = [];
  private spawnTimer: number = 0;
  private routes: THREE.Vector3[][];
  private nextRoute = 0;
  private announcer: StadiumAnnouncer;
  private difficulty: MapDifficulty;

  private waves = AUTHORED_WAVES;

  /** Hand-authored cups cover the opening; every later round is generated. */
  private generated = new Map<number, WaveDefinition>();
  public readonly winRound: number;

  constructor(routes: THREE.Vector3[][], announcer: StadiumAnnouncer, difficulty: MapDifficulty) {
    if (!routes.length || routes.some(route => route.length < 2)) throw new Error('A course needs a traversable route');
    this.routes = routes;
    this.announcer = announcer;
    this.difficulty = difficulty;
    this.winRound = WIN_ROUNDS[difficulty];
  }

  /** Round number of the wave in play, or the one queued next during an intermission. */
  public get round(): number { return this.currentWaveIndex + 1; }
  public get isFreeplay(): boolean { return this.round > this.winRound; }

  public getCurrentWave(): WaveDefinition {
    return this.getWave(this.round);
  }

  /** Rounds never run out: past the authored cups they are built, then cached. */
  public getWave(round: number): WaveDefinition {
    if (round <= this.waves.length) return this.waves[round - 1];
    let wave = this.generated.get(round);
    if (!wave) {
      wave = generateWave(round, this.winRound);
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

    // Populate spawn queue
    wave.spawns.forEach(group => {
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({
          config: {
            ...group.config,
            level: creepLevel(wave.round, this.difficulty, group.config.threat ?? (group.config.isBoss ? 'titan' : 'normal')),
          },
          delay: group.interval
        });
      }
    });

    if (wave.spawns.some(s => s.config.isBoss)) {
      this.announcer.trigger('boss_spawn', wave.name);
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
        const creep = new Creep(next.config, this.routes[this.nextRoute]);
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

/** The round whose clear wins the map. Play continues afterwards as freeplay. */
export const WIN_ROUNDS: Record<MapDifficulty, number> = { easy: 40, medium: 60, hard: 80 };

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

type RosterEntry = Omit<CreepConfig, 'id'>;

/** Rank-and-file lineup for generated rounds, tuned at the Prime Cup baseline. */
const ROSTER: RosterEntry[] = [
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

function generateWave(round: number, winRound: number): WaveDefinition {
  const rand = mulberry32(round * 2654435761);
  const hp = hpScale(round, winRound);
  // Rewards trail HP so income doesn't outrun the difficulty curve.
  const pay = Math.sqrt(hp);
  const freeplay = round > winRound;
  const cupName = freeplay ? 'FREEPLAY' : CUP_NAMES[Math.floor((round - 11) / 10) % CUP_NAMES.length];

  const scaled = (entry: RosterEntry, id: string, extra: Partial<CreepConfig> = {}): CreepConfig => ({
    ...entry,
    id,
    maxHp: Math.round(entry.maxHp * hp),
    speed: Math.min(entry.speed * (1 + Math.min(round, 120) * 0.0025), entry.speed * 1.3),
    reward: Math.round(entry.reward * pay),
    ...extra,
  });

  if (round % 10 === 0) {
    const titanType = round % 20 === 0 ? 'Gyarados' : 'Onix';
    const escortEntry = ROSTER[Math.floor(rand() * ROSTER.length)];
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

  const groupCount = Math.min(2 + Math.floor(round / 25), 4);
  const picks = new Set<number>();
  while (picks.size < groupCount) picks.add(Math.floor(rand() * ROSTER.length));
  const spawns: WaveDefinition['spawns'] = [...picks].map((index, i) => ({
    config: scaled(ROSTER[index], `gen_${round}_${i}`),
    count: Math.min(6 + Math.floor(round / 6) + Math.floor(rand() * 4), 28),
    interval: Math.max(1.1 - round * 0.006, 0.45),
  }));

  if (round % 5 === 0) {
    const eliteEntry = ROSTER[Math.floor(rand() * ROSTER.length)];
    spawns.push({
      config: scaled(eliteEntry, `elite_${round}`, {
        maxHp: Math.round(eliteEntry.maxHp * 4 * hp),
        reward: Math.round(eliteEntry.reward * 5 * pay),
        speed: eliteEntry.speed * 0.8,
        threat: 'elite',
      }),
      count: 1 + Math.floor(round / 40),
      interval: 2.4,
    });
  }

  const lead = spawns[0].config.name;
  return { round, cupName, name: `${cupName}: ${lead} Assault`, spawns };
}

/** Every type fielded in the opening rounds — what team select warns about. */
export function openingThreatTypes(rounds = 10, winRound = WIN_ROUNDS.easy): PokemonType[] {
  const types = new Set<PokemonType>();
  for (let round = 1; round <= rounds; round++) {
    const wave = round <= AUTHORED_WAVES.length ? AUTHORED_WAVES[round - 1] : generateWave(round, winRound);
    for (const spawn of wave.spawns) {
      types.add(spawn.config.type);
      if (spawn.config.secondaryType) types.add(spawn.config.secondaryType);
    }
  }
  return [...types];
}
