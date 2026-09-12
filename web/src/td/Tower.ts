/**
 * Tower.ts — 3D Pokémon Tower Entity
 *
 * Manages tower stats, targeting AI, range rings, attack cycles, and the
 * move-shop progression: every tower owns three independent move lines that
 * are bought tier by tier. A tower is one of the player's own Pokémon, so its
 * level gates which tiers can be bought, its stats scale every attack, and it
 * evolves in place when a knockout carries it over a threshold.
 */

import * as THREE from 'three';
import { AnimatedPokemon, PokemonModelFactory } from '../stadium/PokemonModels';
import { MoveDefinition, MOVES } from '../stadium/MoveDatabase';
import { Creep } from './Creep';
import { LANE_RIDE_HEIGHT } from './MapTerrain';
import { MoveTier, SpeciesDef } from './progression/Species';
import { towerModifiers, TowerModifiers } from './progression/Stats';
import { displayName, formOf, OwnedPokemon, speciesOf, statsOf } from './progression/TrainerStore';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest';

export const TARGET_PRIORITIES: TargetPriority[] = ['first', 'strongest', 'weakest', 'last'];

/** Ground radius a tower occupies. Drives lane clearance and tower spacing. */
export const TOWER_FOOTPRINT_RADIUS = 1.6;

/** Height of the deploy pad a tower stands on, and so the tower's ground Y. */
export const TOWER_BASE_HEIGHT = 0.3;

/** Range gained per unit a tower stands above its target, up to a summit-sized drop. */
export const HIGH_GROUND_RANGE_PER_UNIT = 0.04;
const HIGH_GROUND_MAX_DROP = 9;
export function highGroundRangeScale(towerGround: number, targetGround: number): number {
  return 1 + THREE.MathUtils.clamp(towerGround - targetGround, 0, HIGH_GROUND_MAX_DROP) * HIGH_GROUND_RANGE_PER_UNIT;
}

export type UpgradeBlockReason = 'maxed' | 'needs_level' | null;

export class Tower {
  public id: string;
  /** The owned Pokémon itself, shared with the save — XP lands on it directly. */
  public readonly pokemon: OwnedPokemon;
  public readonly species: SpeciesDef;
  public position: THREE.Vector3;
  public targetPriority: TargetPriority = 'first';
  public totalInvested: number;

  /** Moves bought per line; the active move is at index tiers[i] - 1. */
  public tiers: number[] = [1, 0, 0];
  /** The evolution stage the on-screen model was built for. */
  private renderedStage: number;
  public modifiers: TowerModifiers;

  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;
  private rangeRing: THREE.Mesh;

  /** Each line attacks on its own independent cooldown. */
  private cooldowns: number[] = [0, 0, 0];
  private isAttackingAnim: boolean = false;
  private attackAnimTimer: number = 0;
  private modelLoadGeneration = 0;
  public currentTarget: Creep | null = null;

  constructor(pokemon: OwnedPokemon, pos: THREE.Vector3) {
    this.id = `tower_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.pokemon = pokemon;
    this.species = speciesOf(pokemon);
    this.renderedStage = pokemon.stage;
    this.modifiers = towerModifiers(statsOf(pokemon), pokemon.level);
    this.position = pos.clone();
    this.totalInvested = this.species.deployCost;

    this.group.position.copy(pos);
    // Lets a raycast against any child mesh resolve back to this tower.
    this.group.userData.towerId = this.id;

    // Free placement means a tower brings its own footing to wherever it lands.
    this.group.add(this.createBasePad());

    // Instantiate 3D Model
    this.animPokemon = this.species.createModel();
    // The procedural stand-in is much larger than the normalized GLB that
    // replaces it a few frames later, so keep it hidden until the load settles.
    this.animPokemon.mesh.visible = false;
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
    // Rides above the lane ribbon (y = 0.5) so the ring stays readable where it
    // crosses the track instead of being clipped by it.
    this.rangeRing.position.y = 0.35;
    this.rangeRing.visible = false;
    this.group.add(this.rangeRing);

    // Asynchronously load authentic GLB model & animations
    this.loadAuthenticModel();
  }

  /** Metallic deploy pad, sized to the footprint the placement rules enforce. */
  private createBasePad(): THREE.Group {
    const pad = new THREE.Group();
    pad.position.y = -TOWER_BASE_HEIGHT / 2;

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(
        TOWER_FOOTPRINT_RADIUS * 0.88,
        TOWER_FOOTPRINT_RADIUS,
        TOWER_BASE_HEIGHT,
        20
      ),
      new THREE.MeshStandardMaterial({ color: 0x1d2d44, metalness: 0.7, roughness: 0.35 })
    );
    disc.receiveShadow = true;
    disc.castShadow = true;
    pad.add(disc);

    // A stone footing sinks into the ground so a pad on a slope never floats.
    const footing = new THREE.Mesh(
      new THREE.CylinderGeometry(TOWER_FOOTPRINT_RADIUS, TOWER_FOOTPRINT_RADIUS * 1.08, 1.6, 20),
      new THREE.MeshLambertMaterial({ color: 0x8a8272, flatShading: true })
    );
    footing.position.y = -TOWER_BASE_HEIGHT / 2 - 0.8;
    footing.receiveShadow = true;
    pad.add(footing);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(TOWER_FOOTPRINT_RADIUS * 0.9, 0.07, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TOWER_BASE_HEIGHT / 2;
    pad.add(rim);

    return pad;
  }

  /** The nickname when there is one, otherwise the current form's name. */
  public get name(): string {
    return displayName(this.pokemon);
  }

  /** The current form's species name — what the model and type follow. */
  public get formName(): string {
    return formOf(this.pokemon).name;
  }

  public get level(): number {
    return this.pokemon.level;
  }

  /**
   * Picks up level and evolution changes made to the owned Pokémon. Returns
   * true when the tower evolved and swapped its model.
   */
  public syncProgress(): boolean {
    this.modifiers = towerModifiers(statsOf(this.pokemon), this.pokemon.level);
    if (this.pokemon.stage === this.renderedStage) return false;
    this.renderedStage = this.pokemon.stage;
    this.loadAuthenticModel();
    return true;
  }

  /** The move a given line currently fires, or null if the line is unbought. */
  public getActiveMove(lineIdx: number): MoveDefinition | null {
    const bought = this.tiers[lineIdx];
    if (!bought) return null;
    return MOVES[this.species.lines[lineIdx].tiers[bought - 1].moveId];
  }

  public getKnownMoves(): MoveDefinition[] {
    return this.species.lines
      .map((_, i) => this.getActiveMove(i))
      .filter((m): m is MoveDefinition => m !== null);
  }

  /** The primary attack, used for placement previews and UI headlines. */
  public get primaryMove(): MoveDefinition {
    return this.getActiveMove(0) ?? MOVES[this.species.lines[0].tiers[0].moveId];
  }

  public getNextTier(lineIdx: number): MoveTier | null {
    const line = this.species.lines[lineIdx];
    const bought = this.tiers[lineIdx];
    return bought >= line.tiers.length ? null : line.tiers[bought];
  }

  public getUpgradeBlockReason(lineIdx: number): UpgradeBlockReason {
    const next = this.getNextTier(lineIdx);
    if (!next) return 'maxed';
    if ((next.requiresLevel ?? 0) > this.pokemon.level) return 'needs_level';
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

  /** Widest reach across every known move — what the range ring shows. */
  public getMaxRange(): number {
    return this.getKnownMoves().reduce((max, m) => Math.max(max, m.range), 0);
  }

  private loadAuthenticModel(): void {
    const generation = ++this.modelLoadGeneration;
    const modelName = this.formName.toLowerCase();

    PokemonModelFactory.loadAuthenticModel(modelName, undefined, () => this.species.createModel()).then((loaded) => {
      if (generation !== this.modelLoadGeneration) return;
      if (loaded && loaded.mesh !== this.animPokemon.mesh) {
        this.group.remove(this.animPokemon.mesh);
        this.animPokemon = loaded;
        this.group.add(this.animPokemon.mesh);
      }
      this.animPokemon.mesh.visible = true;
    }).catch(() => {
      if (generation === this.modelLoadGeneration) this.animPokemon.mesh.visible = true;
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

    for (let i = 0; i < this.species.lines.length; i++) {
      const move = this.getActiveMove(i);
      if (!move) continue;

      if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;

      const target = this.findTarget(creeps, move.range);
      if (i === 0 || !primaryTarget) primaryTarget = primaryTarget ?? target;

      if (target && this.cooldowns[i] <= 0) {
        this.cooldowns[i] = 1.0 / (move.attackSpeed * this.modifiers.rate);
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
      if (!creep.alive || creep.captureLocked) continue;
      // Reach is measured across the ground; standing above the lane extends it.
      const dist = Math.hypot(this.position.x - creep.position.x, this.position.z - creep.position.z);
      const towerGround = this.position.y - TOWER_BASE_HEIGHT;
      if (dist > range * highGroundRangeScale(towerGround, creep.position.y - LANE_RIDE_HEIGHT)) continue;

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
