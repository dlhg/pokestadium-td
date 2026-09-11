/**
 * Tower.ts — 3D Pokémon Tower Entity
 *
 * Manages tower stats, targeting AI, range rings, attack cycles,
 * upgrades, and evolutions.
 */

import * as THREE from 'three';
import { AnimatedPokemon, PokemonModelFactory } from '../stadium/PokemonModels';
import { MoveDefinition, MOVES } from '../stadium/MoveDatabase';
import { PokemonType } from '../stadium/TypeMatrix';
import { Creep } from './Creep';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest';

export interface TowerTemplate {
  id: string;
  name: string;
  type: PokemonType;
  cost: number;
  initialMoveId: string;
  upgradeMoveId: string;
  upgradeCost: number;
  evolveMoveId: string;
  evolveCost: number;
  midName: string;
  evolvedName: string;
  createModel: () => AnimatedPokemon;
  description: string;
}

export const TOWER_TEMPLATES: Record<string, TowerTemplate> = {
  pikachu: {
    id: 'pikachu',
    name: 'Pikachu',
    type: 'Electric',
    cost: 100,
    initialMoveId: 'thundershock',
    upgradeMoveId: 'thunderbolt',
    upgradeCost: 120,
    evolveMoveId: 'thunder',
    evolveCost: 220,
    midName: 'Pikachu',
    evolvedName: 'Raichu',
    createModel: () => PokemonModelFactory.createPikachu(),
    description: 'Rapid electric attacker. Upgrades to high-voltage chain lightning.',
  },
  charizard: {
    id: 'charizard',
    name: 'Charmander',
    type: 'Fire',
    cost: 130,
    initialMoveId: 'ember',
    upgradeMoveId: 'flamethrower',
    upgradeCost: 160,
    evolveMoveId: 'fire_blast',
    evolveCost: 260,
    midName: 'Charmeleon',
    evolvedName: 'Charizard',
    createModel: () => PokemonModelFactory.createCharizard(),
    description: 'Searing fire attacker inflicting burn damage on enemy clusters.',
  },
  blastoise: {
    id: 'blastoise',
    name: 'Squirtle',
    type: 'Water',
    cost: 120,
    initialMoveId: 'water_gun',
    upgradeMoveId: 'hydro_pump',
    upgradeCost: 150,
    evolveMoveId: 'hydro_pump',
    evolveCost: 240,
    midName: 'Wartortle',
    evolvedName: 'Blastoise',
    createModel: () => PokemonModelFactory.createBlastoise(),
    description: 'Heavy water artillery that slows down fast invading runners.',
  },
  venusaur: {
    id: 'venusaur',
    name: 'Bulbasaur',
    type: 'Grass',
    cost: 110,
    initialMoveId: 'vine_whip',
    upgradeMoveId: 'razor_leaf',
    upgradeCost: 140,
    evolveMoveId: 'solar_beam',
    evolveCost: 250,
    midName: 'Ivysaur',
    evolvedName: 'Venusaur',
    createModel: () => PokemonModelFactory.createVenusaur(),
    description: 'Critical slicing leaves and massive long-range SolarBeam laser.',
  },
  gengar: {
    id: 'gengar',
    name: 'Gastly',
    type: 'Ghost',
    cost: 140,
    initialMoveId: 'lick',
    upgradeMoveId: 'night_shade',
    upgradeCost: 170,
    evolveMoveId: 'psychic',
    evolveCost: 270,
    midName: 'Haunter',
    evolvedName: 'Gengar',
    createModel: () => PokemonModelFactory.createGengar(),
    description: 'Ghostly entity that bypasses defense and stuns targets.',
  },
  alakazam: {
    id: 'alakazam',
    name: 'Abra',
    type: 'Psychic',
    cost: 150,
    initialMoveId: 'confusion',
    upgradeMoveId: 'psybeam',
    upgradeCost: 180,
    evolveMoveId: 'psychic',
    evolveCost: 300,
    midName: 'Kadabra',
    evolvedName: 'Alakazam',
    createModel: () => PokemonModelFactory.createAlakazam(),
    description: 'Long-range psychic control that grows from Confusion into Psychic.',
  },
};

export class Tower {
  public id: string;
  public template: TowerTemplate;
  public name: string;
  public pedestalId: number;
  public position: THREE.Vector3;
  public level: number = 1; // 1: Base, 2: Upgraded, 3: Evolved
  public currentMove: MoveDefinition;
  public targetPriority: TargetPriority = 'first';
  public totalInvested: number;

  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;
  private rangeRing: THREE.Mesh;

  private attackCooldown: number = 0;
  private isAttackingAnim: boolean = false;
  private attackAnimTimer: number = 0;
  private modelLoadGeneration = 0;
  public currentTarget: Creep | null = null;

  constructor(template: TowerTemplate, pedestalId: number, pos: THREE.Vector3) {
    this.id = `tower_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.template = template;
    this.name = template.name;
    this.pedestalId = pedestalId;
    this.position = pos.clone();
    this.currentMove = MOVES[template.initialMoveId];
    this.totalInvested = template.cost;

    this.group.position.copy(pos);

    // Instantiate 3D Model
    this.animPokemon = template.createModel();
    this.group.add(this.animPokemon.mesh);

    // Range Ring Visual Indicator (Hidden until selected)
    const ringGeo = new THREE.RingGeometry(this.currentMove.range - 0.15, this.currentMove.range, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    this.rangeRing = new THREE.Mesh(ringGeo, ringMat);
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.position.y = 0.05;
    this.rangeRing.visible = false;
    this.group.add(this.rangeRing);

    // Asynchronously load authentic GLB model & animations
    this.loadAuthenticModel();
  }

  private loadAuthenticModel(): void {
    const generation = ++this.modelLoadGeneration;
    let modelName = this.template.name.toLowerCase();
    let targetHeight = 1.9;

    if (this.level === 3) {
      modelName = this.template.evolvedName.toLowerCase();
      targetHeight = 2.6;
    } else if (this.level === 2) {
      modelName = this.template.midName.toLowerCase();
      targetHeight = 2.2;
    }

    PokemonModelFactory.loadAuthenticModel(modelName, targetHeight, () => this.template.createModel()).then((loaded) => {
      if (generation !== this.modelLoadGeneration) return;
      if (loaded && loaded.mesh !== this.animPokemon.mesh) {
        this.group.remove(this.animPokemon.mesh);
        this.animPokemon = loaded;
        this.group.add(this.animPokemon.mesh);
      }
    });
  }

  public setSelected(selected: boolean): void {
    this.rangeRing.visible = selected;
  }

  public updateRangeRing(): void {
    this.rangeRing.geometry.dispose();
    this.rangeRing.geometry = new THREE.RingGeometry(this.currentMove.range - 0.2, this.currentMove.range, 48);
  }

  public upgrade(): boolean {
    if (this.level === 1) {
      this.level = 2;
      this.name = this.template.midName;
      this.currentMove = MOVES[this.template.upgradeMoveId];
      this.totalInvested += this.template.upgradeCost;
      this.updateRangeRing();
      this.loadAuthenticModel();
      return true;
    } else if (this.level === 2) {
      this.level = 3;
      this.name = this.template.evolvedName;
      this.currentMove = MOVES[this.template.evolveMoveId];
      this.totalInvested += this.template.evolveCost;
      this.updateRangeRing();
      // Load evolved authentic model
      this.loadAuthenticModel();
      return true;
    }
    return false;
  }

  public getUpgradeCost(): number | null {
    if (this.level === 1) return this.template.upgradeCost;
    if (this.level === 2) return this.template.evolveCost;
    return null;
  }

  public getSellValue(): number {
    return Math.floor(this.totalInvested * 0.7);
  }

  public update(dt: number, creeps: Creep[], onFire: (tower: Tower, target: Creep) => void): void {
    const time = performance.now() * 0.001;

    // Handle attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= dt;
    }

    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer <= 0) {
        this.isAttackingAnim = false;
      }
    }

    // Find best target in range
    this.currentTarget = this.findTarget(creeps);

    if (this.currentTarget) {
      // Smoothly rotate toward target
      const lookPos = this.currentTarget.position.clone();
      lookPos.y = this.position.y;
      this.animPokemon.mesh.lookAt(lookPos);

      // Fire when off cooldown
      if (this.attackCooldown <= 0) {
        this.attackCooldown = 1.0 / this.currentMove.attackSpeed;
        this.isAttackingAnim = true;
        this.attackAnimTimer = 0.35;
        this.animPokemon.playMove?.(this.currentMove.name);
        onFire(this, this.currentTarget);
      }
    }

    // Update 3D model animation
    this.animPokemon.update(time, dt, this.isAttackingAnim ? 'attack' : 'idle');
  }

  private findTarget(creeps: Creep[]): Creep | null {
    let bestCreep: Creep | null = null;
    let bestMetric = -Infinity;

    for (const creep of creeps) {
      if (!creep.alive) continue;
      const dist = this.position.distanceTo(creep.position);
      if (dist > this.currentMove.range) continue;

      let metric = 0;
      switch (this.targetPriority) {
        case 'first':
          metric = creep.pathProgress; // Further along the track
          break;
        case 'last':
          metric = -creep.pathProgress;
          break;
        case 'strongest':
          metric = creep.hp;
          break;
        case 'weakest':
          metric = -creep.hp;
          break;
      }

      if (metric > bestMetric) {
        bestMetric = metric;
        bestCreep = creep;
      }
    }

    return bestCreep;
  }
}
