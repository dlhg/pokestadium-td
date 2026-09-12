/**
 * Tower.ts — 3D Pokémon Tower Entity
 *
 * Manages tower stats, targeting AI, range rings, attack cycles, and the
 * move-shop progression: every tower owns three independent move lines that
 * are bought tier by tier, plus a separate evolution track that gates the
 * top tier of each line.
 */

import * as THREE from 'three';
import { AnimatedPokemon, PokemonModelFactory } from '../stadium/PokemonModels';
import { MoveDefinition, MOVES } from '../stadium/MoveDatabase';
import { PokemonType } from '../stadium/TypeMatrix';
import { Creep } from './Creep';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest';

export const TARGET_PRIORITIES: TargetPriority[] = ['first', 'strongest', 'weakest', 'last'];

/** One purchasable step within a move line. */
export interface MoveTier {
  moveId: string;
  cost: number;
  /** Evolution stage the tower must reach before this tier unlocks. */
  requiresStage?: number;
}

/** A line of escalating moves. Buying a tier replaces the line's active move. */
export interface MoveLine {
  id: string;
  label: string;
  tiers: MoveTier[];
}

export interface EvolutionStage {
  name: string;
  cost: number;
}

export interface TowerTemplate {
  id: string;
  name: string;
  type: PokemonType;
  cost: number;
  /** Exactly three lines: signature attack, coverage, control. */
  lines: MoveLine[];
  evolutions: EvolutionStage[];
  createModel: () => AnimatedPokemon;
  description: string;
}

const LINE_LABELS = ['SPECIAL', 'COVERAGE', 'CONTROL'];

function lines(
  special: MoveTier[],
  coverage: MoveTier[],
  control: MoveTier[],
): MoveLine[] {
  return [special, coverage, control].map((tiers, i) => ({
    id: LINE_LABELS[i].toLowerCase(),
    label: LINE_LABELS[i],
    tiers,
  }));
}

export const TOWER_TEMPLATES: Record<string, TowerTemplate> = {
  pikachu: {
    id: 'pikachu',
    name: 'Pikachu',
    type: 'Electric',
    cost: 100,
    evolutions: [{ name: 'Raichu', cost: 300 }],
    lines: lines(
      [
        { moveId: 'thundershock', cost: 0 },
        { moveId: 'thunderbolt', cost: 140 },
        { moveId: 'thunder', cost: 320, requiresStage: 1 },
      ],
      [
        { moveId: 'quick_attack', cost: 90 },
        { moveId: 'dig', cost: 200 },
        { moveId: 'hyper_beam', cost: 420, requiresStage: 1 },
      ],
      [
        { moveId: 'thunder_wave', cost: 110 },
        { moveId: 'flash', cost: 190 },
        { moveId: 'body_slam', cost: 300 },
      ],
    ),
    createModel: () => PokemonModelFactory.createPikachu(),
    description: 'Rapid electric attacker. Dig answers the Ground types it cannot shock.',
  },
  charizard: {
    id: 'charizard',
    name: 'Charmander',
    type: 'Fire',
    cost: 130,
    evolutions: [
      { name: 'Charmeleon', cost: 180 },
      { name: 'Charizard', cost: 380 },
    ],
    lines: lines(
      [
        { moveId: 'ember', cost: 0 },
        { moveId: 'flamethrower', cost: 160 },
        { moveId: 'fire_blast', cost: 340, requiresStage: 2 },
      ],
      [
        { moveId: 'wing_attack', cost: 100 },
        { moveId: 'earthquake', cost: 240 },
        { moveId: 'hyper_beam', cost: 430, requiresStage: 2 },
      ],
      [
        { moveId: 'smokescreen', cost: 90 },
        { moveId: 'fire_spin', cost: 180 },
        { moveId: 'toxic', cost: 280 },
      ],
    ),
    createModel: () => PokemonModelFactory.createCharizard(),
    description: 'Searing fire attacker whose burns stack up over long waves.',
  },
  blastoise: {
    id: 'blastoise',
    name: 'Squirtle',
    type: 'Water',
    cost: 120,
    evolutions: [
      { name: 'Wartortle', cost: 170 },
      { name: 'Blastoise', cost: 360 },
    ],
    lines: lines(
      [
        { moveId: 'water_gun', cost: 0 },
        { moveId: 'surf', cost: 150 },
        { moveId: 'hydro_pump', cost: 330, requiresStage: 2 },
      ],
      [
        { moveId: 'bite', cost: 90 },
        { moveId: 'ice_beam', cost: 230 },
        { moveId: 'blizzard', cost: 420, requiresStage: 2 },
      ],
      [
        { moveId: 'bubble', cost: 80 },
        { moveId: 'clamp', cost: 170 },
        { moveId: 'toxic', cost: 280 },
      ],
    ),
    createModel: () => PokemonModelFactory.createBlastoise(),
    description: 'Heavy water artillery. The Ice line turns it into a wave-wide slow.',
  },
  venusaur: {
    id: 'venusaur',
    name: 'Bulbasaur',
    type: 'Grass',
    cost: 110,
    evolutions: [
      { name: 'Ivysaur', cost: 165 },
      { name: 'Venusaur', cost: 350 },
    ],
    lines: lines(
      [
        { moveId: 'vine_whip', cost: 0 },
        { moveId: 'razor_leaf', cost: 150 },
        { moveId: 'solar_beam', cost: 360, requiresStage: 2 },
      ],
      [
        { moveId: 'body_slam', cost: 110 },
        { moveId: 'earthquake', cost: 250 },
        { moveId: 'hyper_beam', cost: 430, requiresStage: 2 },
      ],
      [
        { moveId: 'stun_spore', cost: 90 },
        { moveId: 'sleep_powder', cost: 180 },
        { moveId: 'leech_seed', cost: 300 },
      ],
    ),
    createModel: () => PokemonModelFactory.createVenusaur(),
    description: 'Slicing leaves backed by the widest crowd control in the roster.',
  },
  gengar: {
    id: 'gengar',
    name: 'Gastly',
    type: 'Ghost',
    cost: 140,
    evolutions: [
      { name: 'Haunter', cost: 180 },
      { name: 'Gengar', cost: 370 },
    ],
    lines: lines(
      [
        { moveId: 'lick', cost: 0 },
        { moveId: 'night_shade', cost: 160 },
        { moveId: 'shadow_ball', cost: 330, requiresStage: 2 },
      ],
      [
        { moveId: 'sludge', cost: 100 },
        { moveId: 'psychic', cost: 260 },
        { moveId: 'hyper_beam', cost: 440, requiresStage: 2 },
      ],
      [
        { moveId: 'confuse_ray', cost: 100 },
        { moveId: 'hypnosis', cost: 200 },
        { moveId: 'toxic', cost: 300 },
      ],
    ),
    createModel: () => PokemonModelFactory.createGengar(),
    description: 'Ghostly entity whose Night Shade ignores elemental match-ups entirely.',
  },
  alakazam: {
    id: 'alakazam',
    name: 'Abra',
    type: 'Psychic',
    cost: 150,
    evolutions: [
      { name: 'Kadabra', cost: 190 },
      { name: 'Alakazam', cost: 390 },
    ],
    lines: lines(
      [
        { moveId: 'confusion', cost: 0 },
        { moveId: 'psybeam', cost: 170 },
        { moveId: 'psychic', cost: 350, requiresStage: 2 },
      ],
      [
        { moveId: 'seismic_toss', cost: 110 },
        { moveId: 'dig', cost: 240 },
        { moveId: 'hyper_beam', cost: 450, requiresStage: 2 },
      ],
      [
        { moveId: 'disable', cost: 90 },
        { moveId: 'hypnosis', cost: 200 },
        { moveId: 'toxic', cost: 300 },
      ],
    ),
    createModel: () => PokemonModelFactory.createAlakazam(),
    description: 'Long-range psychic control. Seismic Toss lands regardless of typing.',
  },
};

export type UpgradeBlockReason = 'maxed' | 'needs_evolution' | null;

export class Tower {
  public id: string;
  public template: TowerTemplate;
  public pedestalId: number;
  public position: THREE.Vector3;
  public targetPriority: TargetPriority = 'first';
  public totalInvested: number;

  /** Moves bought per line; the active move is at index tiers[i] - 1. */
  public tiers: number[] = [1, 0, 0];
  public evolutionStage: number = 0;

  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;
  private rangeRing: THREE.Mesh;

  /** Each line attacks on its own independent cooldown. */
  private cooldowns: number[] = [0, 0, 0];
  private isAttackingAnim: boolean = false;
  private attackAnimTimer: number = 0;
  private modelLoadGeneration = 0;
  public currentTarget: Creep | null = null;

  constructor(template: TowerTemplate, pedestalId: number, pos: THREE.Vector3) {
    this.id = `tower_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.template = template;
    this.pedestalId = pedestalId;
    this.position = pos.clone();
    this.totalInvested = template.cost;

    this.group.position.copy(pos);

    // Instantiate 3D Model
    this.animPokemon = template.createModel();
    this.group.add(this.animPokemon.mesh);

    // Range Ring Visual Indicator (Hidden until selected)
    const range = this.getMaxRange();
    const ringGeo = new THREE.RingGeometry(range - 0.15, range, 48);
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

  /** Display name follows the evolution track. */
  public get name(): string {
    if (this.evolutionStage === 0) return this.template.name;
    return this.template.evolutions[this.evolutionStage - 1].name;
  }

  /** The move a given line currently fires, or null if the line is unbought. */
  public getActiveMove(lineIdx: number): MoveDefinition | null {
    const bought = this.tiers[lineIdx];
    if (!bought) return null;
    return MOVES[this.template.lines[lineIdx].tiers[bought - 1].moveId];
  }

  public getKnownMoves(): MoveDefinition[] {
    return this.template.lines
      .map((_, i) => this.getActiveMove(i))
      .filter((m): m is MoveDefinition => m !== null);
  }

  /** The primary attack, used for placement previews and UI headlines. */
  public get primaryMove(): MoveDefinition {
    return this.getActiveMove(0) ?? MOVES[this.template.lines[0].tiers[0].moveId];
  }

  public getNextTier(lineIdx: number): MoveTier | null {
    const line = this.template.lines[lineIdx];
    const bought = this.tiers[lineIdx];
    return bought >= line.tiers.length ? null : line.tiers[bought];
  }

  public getUpgradeBlockReason(lineIdx: number): UpgradeBlockReason {
    const next = this.getNextTier(lineIdx);
    if (!next) return 'maxed';
    if ((next.requiresStage ?? 0) > this.evolutionStage) return 'needs_evolution';
    return null;
  }

  public getUpgradeCost(lineIdx: number): number | null {
    const next = this.getNextTier(lineIdx);
    return next ? next.cost : null;
  }

  public buyUpgrade(lineIdx: number): boolean {
    const next = this.getNextTier(lineIdx);
    if (!next || this.getUpgradeBlockReason(lineIdx)) return false;

    this.tiers[lineIdx]++;
    this.totalInvested += next.cost;
    this.updateRangeRing();
    return true;
  }

  public getNextEvolution(): EvolutionStage | null {
    return this.evolutionStage >= this.template.evolutions.length
      ? null
      : this.template.evolutions[this.evolutionStage];
  }

  public evolve(): boolean {
    const next = this.getNextEvolution();
    if (!next) return false;

    this.evolutionStage++;
    this.totalInvested += next.cost;
    this.loadAuthenticModel();
    return true;
  }

  /** Widest reach across every known move — what the range ring shows. */
  public getMaxRange(): number {
    return this.getKnownMoves().reduce((max, m) => Math.max(max, m.range), 0);
  }

  private loadAuthenticModel(): void {
    const generation = ++this.modelLoadGeneration;
    const targetHeight = [1.9, 2.2, 2.6][Math.min(this.evolutionStage, 2)];
    const modelName = this.name.toLowerCase();

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
    const range = this.getMaxRange();
    this.rangeRing.geometry.dispose();
    this.rangeRing.geometry = new THREE.RingGeometry(Math.max(0, range - 0.2), range, 48);
  }

  public getSellValue(): number {
    return Math.floor(this.totalInvested * 0.7);
  }

  public update(
    dt: number,
    creeps: Creep[],
    onFire: (tower: Tower, target: Creep, move: MoveDefinition) => void,
  ): void {
    const time = performance.now() * 0.001;

    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer <= 0) {
        this.isAttackingAnim = false;
      }
    }

    // Each line acquires its own target and fires on its own cooldown, so a
    // fully-bought tower genuinely attacks three times over.
    let primaryTarget: Creep | null = null;

    for (let i = 0; i < this.template.lines.length; i++) {
      const move = this.getActiveMove(i);
      if (!move) continue;

      if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;

      const target = this.findTarget(creeps, move.range);
      if (i === 0 || !primaryTarget) primaryTarget = primaryTarget ?? target;

      if (target && this.cooldowns[i] <= 0) {
        this.cooldowns[i] = 1.0 / move.attackSpeed;
        this.isAttackingAnim = true;
        this.attackAnimTimer = 0.35;
        this.animPokemon.playMove?.(move.name);
        onFire(this, target, move);
      }
    }

    this.currentTarget = primaryTarget;

    if (primaryTarget) {
      // Smoothly rotate toward whatever the tower is engaging
      const lookPos = primaryTarget.position.clone();
      lookPos.y = this.position.y;
      this.animPokemon.mesh.lookAt(lookPos);
    }

    // Update 3D model animation
    this.animPokemon.update(time, dt, this.isAttackingAnim ? 'attack' : 'idle');
  }

  private findTarget(creeps: Creep[], range: number): Creep | null {
    let bestCreep: Creep | null = null;
    let bestMetric = -Infinity;

    for (const creep of creeps) {
      if (!creep.alive) continue;
      const dist = this.position.distanceTo(creep.position);
      if (dist > range) continue;

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
