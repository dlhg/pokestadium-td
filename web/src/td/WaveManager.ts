/**
 * WaveManager.ts — Tournament Cup & Wave Progression System
 *
 * Defines authentic Pokémon Stadium cups (Poke Cup, Prime Cup, Gym Leader Castle)
 * and controls wave spawning, boss arrivals, and intermissions.
 */

import * as THREE from 'three';
import { Creep, CreepConfig } from './Creep';
import { StadiumAnnouncer } from '../stadium/Announcer';

export interface WaveDefinition {
  round: number;
  cupName: string;
  name: string;
  spawns: { config: CreepConfig; count: number; interval: number }[];
}

export class WaveManager {
  public currentWaveIndex: number = 0;
  public inWave: boolean = false;
  public waveCompleted: boolean = false;
  public intermissionTimer: number = 5.0; // Seconds before auto-start (or player can click Start)

  private spawnQueue: { config: CreepConfig; delay: number }[] = [];
  private spawnTimer: number = 0;
  private waypoints: THREE.Vector3[];
  private announcer: StadiumAnnouncer;

  private waves: WaveDefinition[] = [
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
            maxHp: 95,
            speed: 5.0,
            reward: 18,
            modelType: 'zubat'
          },
          count: 12,
          interval: 1.0
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
            maxHp: 180,
            speed: 2.8,
            reward: 25,
            modelType: 'geodude'
          },
          count: 10,
          interval: 1.4
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
            id: 'rattata_2',
            name: 'Rattata',
            type: 'Normal',
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
            id: 'zubat_2',
            name: 'Zubat',
            type: 'Poison',
            maxHp: 140,
            speed: 5.2,
            reward: 22,
            modelType: 'zubat'
          },
          count: 8,
          interval: 0.9
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
            maxHp: 1400,
            speed: 2.2,
            reward: 250,
            isBoss: true,
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
        {
          config: {
            id: 'haunter_1',
            name: 'Haunter',
            type: 'Ghost',
            maxHp: 220,
            speed: 4.5,
            reward: 30,
            modelType: 'zubat'
          },
          count: 14,
          interval: 1.1
        }
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
            maxHp: 340,
            speed: 3.2,
            reward: 35,
            modelType: 'geodude'
          },
          count: 12,
          interval: 1.2
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
            id: 'mixed_1',
            name: 'Dragonair',
            type: 'Dragon',
            maxHp: 420,
            speed: 5.4,
            reward: 45,
            modelType: 'dragonair'
          },
          count: 10,
          interval: 0.8
        },
        {
          config: {
            id: 'mixed_2',
            name: 'Graveler',
            type: 'Rock',
            maxHp: 480,
            speed: 3.2,
            reward: 45,
            modelType: 'geodude'
          },
          count: 8,
          interval: 0.8
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
            maxHp: 3600,
            speed: 2.8,
            reward: 500,
            isBoss: true,
            modelType: 'boss_titan',
            titanType: 'Gyarados'
          },
          count: 1,
          interval: 1.0
        }
      ]
    }
  ];

  constructor(waypoints: THREE.Vector3[], announcer: StadiumAnnouncer) {
    this.waypoints = waypoints;
    this.announcer = announcer;
  }

  public getCurrentWave(): WaveDefinition | null {
    return this.waves[this.currentWaveIndex] || null;
  }

  public startNextWave(): boolean {
    if (this.currentWaveIndex >= this.waves.length) {
      return false; // All cups completed!
    }

    const wave = this.waves[this.currentWaveIndex];
    this.inWave = true;
    this.waveCompleted = false;
    this.spawnQueue = [];

    // Populate spawn queue
    wave.spawns.forEach(group => {
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({
          config: { ...group.config },
          delay: group.interval
        });
      }
    });

    if (wave.spawns.some(s => s.config.isBoss)) {
      this.announcer.trigger('boss_spawn', wave.name);
    } else {
      this.announcer.trigger('battle_start');
    }

    return true;
  }

  public update(
    dt: number,
    activeCreeps: Creep[],
    onSpawn: (creep: Creep) => void
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
      if (this.spawnTimer <= 0) {
        const next = this.spawnQueue.shift()!;
        this.spawnTimer = next.delay;
        const creep = new Creep(next.config, this.waypoints);
        onSpawn(creep);
      }
    } else {
      // Check if all creeps are defeated or reached end
      if (activeCreeps.length === 0) {
        this.inWave = false;
        this.waveCompleted = true;
        this.currentWaveIndex++;
        this.intermissionTimer = 7.0; // 7s break between rounds
        this.announcer.trigger('wave_cleared');
      }
    }
  }
}
