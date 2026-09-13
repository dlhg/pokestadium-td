/**
 * Tower.ts — 3D Pokémon Tower Entity
 *
 * Manages tower stats, targeting AI, range rings, the attack cycle, and path
 * progression: a tower fires one basic attack, and the paths it buys into
 * reshape that attack (see TowerAttack.ts). It can commit to two paths at
 * most, and only one of them climbs to the top tier. A tower is one of the
 * player's own Pokémon, so its level gates which tiers can be bought, its
 * stats scale every attack, and it evolves in place when a knockout carries
 * it over a threshold.
 */

import * as THREE from 'three';
import { AnimatedPokemon, disposePokemonModel, PokemonModelFactory } from '../stadium/PokemonModels';
import { isGroundOnly, MoveDefinition } from '../stadium/MoveDatabase';
import { Creep } from './Creep';
import { LANE_RIDE_HEIGHT } from './MapTerrain';
import { PathTier, SpeciesDef } from './progression/Species';
import { SIGNATURES } from './Signatures';
import { AttackProfile, buildAttackProfile, MAX_PATHS_BOUGHT, SECONDARY_PATH_MAX_TIER } from './TowerAttack';
import { towerModifiers, TowerModifiers } from './progression/Stats';
import { displayName, formOf, OwnedPokemon, speciesOf, statsOf } from './progression/TrainerStore';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest';

export const TARGET_PRIORITIES: TargetPriority[] = ['first', 'strongest', 'weakest', 'last'];

/** Ground radius a tower occupies. Drives lane clearance and tower spacing. */
export const TOWER_FOOTPRINT_RADIUS = 1.6;

/** Height of the deploy pad a tower stands on, and so the tower's ground Y. */
export const TOWER_BASE_HEIGHT = 0.3;

/** Shared field-stone albedo: every tower uses one GPU texture. */
let deployPadStone: THREE.Texture | undefined;
function getDeployPadStone(): THREE.Texture | undefined {
  // Gameplay tests run this module in Node, where image-backed textures do not
  // exist. The tinted material remains a representative fallback there.
  if (typeof document === 'undefined') return undefined;
  if (!deployPadStone) {
    deployPadStone = new THREE.TextureLoader().load('/textures/league-granite.png');
    deployPadStone.colorSpace = THREE.SRGBColorSpace;
    deployPadStone.minFilter = THREE.LinearMipmapLinearFilter;
    deployPadStone.magFilter = THREE.NearestFilter;
  }
  return deployPadStone;
}

/** Range gained per unit a tower stands above its target, up to a summit-sized drop. */
export const HIGH_GROUND_RANGE_PER_UNIT = 0.04;
const HIGH_GROUND_MAX_DROP = 9;
export function highGroundRangeScale(towerGround: number, targetGround: number): number {
  return 1 + THREE.MathUtils.clamp(towerGround - targetGround, 0, HIGH_GROUND_MAX_DROP) * HIGH_GROUND_RANGE_PER_UNIT;
}

/**
 * Why a path's next tier can't be bought: it's topped out, the Pokémon is
 * under-leveled, the tower already committed to two other paths, or another
 * path has already claimed the top tier.
 */
export type UpgradeBlockReason = 'maxed' | 'needs_level' | 'path_closed' | 'tier_capped' | null;

/** What a single attack carries beyond its move, decided the moment it fires. */
export interface ShotInfo {
  /** Rage stacks and crits, multiplied together. */
  damageMultiplier: number;
  crit: boolean;
  /** This attack also drops the tower's lane hazard. */
  dropsHazard: boolean;
}

export class Tower {
  public id: string;
  /** The owned Pokémon itself, shared with the save — XP lands on it directly. */
  public readonly pokemon: OwnedPokemon;
  public readonly species: SpeciesDef;
  public position: THREE.Vector3;
  public targetPriority: TargetPriority = 'first';
  public totalInvested: number;

  /** Tiers bought on each path, in the species' path order. */
  public tiers: number[];
  /** The one attack this tower fires, rebuilt whenever a tier is bought. */
  public attack: AttackProfile;
  /** Attack-rate bonus from a nearby tower's aura, refreshed every frame by the game. */
  public rateBuff = 0;
  /** Signature PP left this round, by signature id. Refilled when a round starts. */
  public pp: Record<string, number> = {};
  /** A temporary attack-rate surge from a signature (Growth, Agility). */
  private surge = { bonus: 0, timer: 0 };
  /** Rate bonus built up by a spin-up attack, lost while idle. */
  private spin = 0;
  /** Seconds the tower sits out after a self-sacrificing signature. */
  private disabledTimer = 0;
  /** Set each frame when a spotter's aura or a reveal lets this tower aim at Phantoms. */
  public revealed = false;
  /** A Poké Ball entrance is still resolving; the model stays hidden and cannot attack. */
  public deploymentLocked = false;
  /** The evolution stage the on-screen model was built for. */
  private renderedStage: number;
  public modifiers: TowerModifiers;

  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;
  private rangeRing: THREE.Mesh;

  private cooldown = 0;
  private attackCount = 0;
  private rageTarget: Creep | null = null;
  private rageStacks = 0;
  private isAttackingAnim: boolean = false;
  private attackAnimTimer: number = 0;
  /** Plays the freshly-evolved model's entrance clip instead of idle, briefly. */
  private entranceAnimTimer: number = 0;
  private modelLoadGeneration = 0;
  private destroyed = false;
  public currentTarget: Creep | null = null;

  constructor(pokemon: OwnedPokemon, pos: THREE.Vector3) {
    this.id = `tower_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.pokemon = pokemon;
    this.species = speciesOf(pokemon);
    this.renderedStage = pokemon.stage;
    this.modifiers = towerModifiers(statsOf(pokemon), pokemon.level);
    this.position = pos.clone();
    this.totalInvested = this.species.deployCost;
    this.tiers = this.species.paths.map(() => 0);
    this.attack = this.buildAttack();

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

  /** League field plinth, sized to the footprint the placement rules enforce. */
  private createBasePad(): THREE.Group {
    const pad = new THREE.Group();
    pad.position.y = -TOWER_BASE_HEIGHT / 2;

    // Keep the structural edge simple and chunky, like a low-poly piece of
    // arena kit. The separate top prevents the stone albedo stretching down it.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(
        TOWER_FOOTPRINT_RADIUS * 0.88,
        TOWER_FOOTPRINT_RADIUS,
        TOWER_BASE_HEIGHT,
        20
      ),
      new THREE.MeshStandardMaterial({ color: 0x52616b, metalness: 0.12, roughness: 0.82, flatShading: true })
    );
    disc.receiveShadow = true;
    disc.castShadow = true;
    pad.add(disc);

    // A stone footing sinks into the ground so a pad on a slope never floats.
    const footing = new THREE.Mesh(
      new THREE.CylinderGeometry(TOWER_FOOTPRINT_RADIUS, TOWER_FOOTPRINT_RADIUS * 1.08, 1.6, 20),
      new THREE.MeshLambertMaterial({ color: 0x766f62, flatShading: true })
    );
    footing.position.y = -TOWER_BASE_HEIGHT / 2 - 0.8;
    footing.receiveShadow = true;
    pad.add(footing);

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(TOWER_FOOTPRINT_RADIUS * 0.875, 20),
      new THREE.MeshStandardMaterial({
        map: getDeployPadStone(),
        color: 0xd8e0e2,
        metalness: 0.04,
        roughness: 0.92,
      })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = TOWER_BASE_HEIGHT / 2 + 0.004;
    top.receiveShadow = true;
    pad.add(top);

    // A recessed Poké Ball seal makes the plinth clearly player-authored while
    // leaving most of the natural stone visible around the Pokémon's feet.
    const sealRadius = TOWER_FOOTPRINT_RADIUS * 0.56;
    const sealY = TOWER_BASE_HEIGHT / 2 + 0.012;
    const red = new THREE.MeshBasicMaterial({ color: 0xb93a3f });
    const cream = new THREE.MeshBasicMaterial({ color: 0xe8dfc4 });
    const charcoal = new THREE.MeshBasicMaterial({ color: 0x27323a });
    for (const [material, start] of [[red, 0], [cream, Math.PI]] as const) {
      const half = new THREE.Mesh(new THREE.CircleGeometry(sealRadius, 16, start, Math.PI), material);
      half.rotation.x = -Math.PI / 2;
      half.position.y = sealY;
      pad.add(half);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(sealRadius * 2, 0.025, 0.13), charcoal);
    band.position.y = sealY + 0.006;
    pad.add(band);
    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(sealRadius * 0.22, sealRadius * 0.22, 0.032, 12),
      cream
    );
    button.position.y = sealY + 0.012;
    pad.add(button);
    const buttonRing = new THREE.Mesh(
      new THREE.TorusGeometry(sealRadius * 0.22, 0.045, 6, 16),
      charcoal
    );
    buttonRing.rotation.x = Math.PI / 2;
    buttonRing.position.y = sealY + 0.03;
    pad.add(buttonRing);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(TOWER_FOOTPRINT_RADIUS * 0.9, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xd4ad4f, metalness: 0.42, roughness: 0.38 })
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
   * true when the tower has evolved. Pass `deferModelSwap` when an
   * `EvolutionSequence` wants to stage the reveal itself — the caller must
   * then invoke `completeEvolutionSwap()` at the moment it wants the new
   * model to appear (typically hidden behind a flash).
   */
  public syncProgress(deferModelSwap = false): boolean {
    this.modifiers = towerModifiers(statsOf(this.pokemon), this.pokemon.level);
    if (this.pokemon.stage === this.renderedStage) return false;
    // Some forms fight differently (Magikarp → Gyarados).
    this.attack = this.buildAttack();
    this.updateRangeRing();
    if (!deferModelSwap) this.completeEvolutionSwap();
    return true;
  }

  /** Swaps in the model for the Pokémon's current stage. */
  public completeEvolutionSwap(): void {
    this.renderedStage = this.pokemon.stage;
    this.loadAuthenticModel();
    // Long enough to cover an authored entrance clip; harmless for the
    // procedural fallbacks, which just ignore the 'entrance' state.
    this.entranceAnimTimer = 1.8;
  }

  /** The move the tower fires right now, for placement previews and UI headlines. */
  public get primaryMove(): MoveDefinition {
    return this.attack.move;
  }

  /**
   * Paths in fold order: the secondary path first, the main path (most tiers,
   * earliest in the species on a tie) last, so its swaps win a crosspath.
   */
  private buildAttack(): AttackProfile {
    const order = this.species.paths
      .map((path, i) => ({ path, bought: this.tiers[i], i }))
      .filter(entry => entry.bought > 0)
      .sort((a, b) => a.bought - b.bought || b.i - a.i);
    const basic = this.species.formAttacks?.[this.pokemon.stage] ?? this.species.basicAttack;
    return buildAttackProfile(basic, order.map(entry =>
      entry.path.tiers.slice(0, entry.bought).flatMap(t => t.effects)));
  }

  public getNextTier(pathIdx: number): PathTier | null {
    const path = this.species.paths[pathIdx];
    const bought = this.tiers[pathIdx];
    return bought >= path.tiers.length ? null : path.tiers[bought];
  }

  public getUpgradeBlockReason(pathIdx: number): UpgradeBlockReason {
    const next = this.getNextTier(pathIdx);
    if (!next) return 'maxed';
    const others = this.tiers.filter((bought, i) => i !== pathIdx && bought > 0);
    if (this.tiers[pathIdx] === 0 && others.length >= MAX_PATHS_BOUGHT) return 'path_closed';
    if (this.tiers[pathIdx] + 1 > SECONDARY_PATH_MAX_TIER && others.some(bought => bought > SECONDARY_PATH_MAX_TIER)) {
      return 'tier_capped';
    }
    if ((next.requiresLevel ?? 0) > this.pokemon.level) return 'needs_level';
    return null;
  }

  /**
   * What buying this tier gives up for good, so the shop can warn first:
   * `closes` are paths shut when this becomes the second path bought into;
   * `caps` are bought paths held at tier 2 once this one claims the top tier.
   */
  public upgradeConsequences(pathIdx: number): { closes: number[]; caps: number[] } {
    const others = this.tiers.map((bought, i) => ({ bought, i })).filter(entry => entry.i !== pathIdx);
    const opened = others.filter(entry => entry.bought > 0);
    const closes = this.tiers[pathIdx] === 0 && opened.length === MAX_PATHS_BOUGHT - 1
      ? others.filter(entry => entry.bought === 0).map(entry => entry.i)
      : [];
    const caps = this.tiers[pathIdx] === SECONDARY_PATH_MAX_TIER
      ? opened.filter(entry => this.species.paths[entry.i].tiers.length > SECONDARY_PATH_MAX_TIER).map(entry => entry.i)
      : [];
    return { closes, caps };
  }

  public getUpgradeCost(pathIdx: number): number | null {
    const next = this.getNextTier(pathIdx);
    return next ? next.cost : null;
  }

  public buyUpgrade(pathIdx: number): boolean {
    const next = this.getNextTier(pathIdx);
    if (!next || this.getUpgradeBlockReason(pathIdx)) return false;

    this.tiers[pathIdx]++;
    this.totalInvested += next.cost;
    this.attack = this.buildAttack();
    // A freshly unlocked signature arrives ready to use.
    for (const id of this.attack.signatures) if (!(id in this.pp)) this.pp[id] = SIGNATURES[id].pp;
    this.updateRangeRing();
    return true;
  }

  /** Psychic and Ghost towers can aim at Phantoms, as can anything a path or a spotter lets see them. */
  public get seesPhantoms(): boolean {
    if (this.revealed || this.attack.seePhantoms) return true;
    const form = formOf(this.pokemon);
    return [form.type, form.secondaryType].some(type => type === 'Psychic' || type === 'Ghost');
  }

  /** Takes the tower out of the fight for a while (Self-Destruct). */
  public disable(seconds: number): void {
    this.disabledTimer = Math.max(this.disabledTimer, seconds);
    this.cooldown = 0;
  }

  public get disabled(): boolean {
    return this.disabledTimer > 0;
  }

  /** A move's range against one creep, stretched when the tower stands above it. */
  public reachAgainst(range: number, creep: Creep): number {
    return range * highGroundRangeScale(this.position.y - TOWER_BASE_HEIGHT, creep.position.y - LANE_RIDE_HEIGHT);
  }

  /** Tops every unlocked signature back up to full PP. */
  public refillPP(): void {
    this.pp = Object.fromEntries(this.attack.signatures.map(id => [id, SIGNATURES[id].pp]));
  }

  /** Attack-rate surge for `duration` seconds; a stronger surge replaces a weaker one. */
  public boost(bonus: number, duration: number): void {
    if (bonus >= this.surge.bonus || this.surge.timer <= 0) this.surge = { bonus, timer: duration };
  }

  /** The attack's reach — what the range ring shows, and how far auras spread. */
  public getMaxRange(): number {
    return this.attack.move.range;
  }

  private loadAuthenticModel(): void {
    const generation = ++this.modelLoadGeneration;
    const modelName = this.formName.toLowerCase();

    PokemonModelFactory.loadAuthenticModel(modelName, undefined, () => this.species.createModel()).then((loaded) => {
      if (generation !== this.modelLoadGeneration || this.destroyed) {
        disposePokemonModel(loaded);
        return;
      }
      if (loaded && loaded.mesh !== this.animPokemon.mesh) {
        disposePokemonModel(this.animPokemon);
        this.group.remove(this.animPokemon.mesh);
        this.animPokemon = loaded;
        this.group.add(this.animPokemon.mesh);
      }
      this.animPokemon.mesh.visible = !this.deploymentLocked;
    }).catch(() => {
      if (generation === this.modelLoadGeneration) this.animPokemon.mesh.visible = !this.deploymentLocked;
    });
  }

  /** Holds a freshly placed Pokémon inside its ball until the summon reveal. */
  public setDeploymentLocked(locked: boolean): void {
    this.deploymentLocked = locked;
    this.animPokemon.mesh.visible = !locked;
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

  /** Releases resources owned by this placed tower. Shared extracted assets stay cached. */
  public destroy(scene: THREE.Scene): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.modelLoadGeneration++;
    scene.remove(this.group);
    disposePokemonModel(this.animPokemon);
    this.group.remove(this.animPokemon.mesh);
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!disposedGeometries.has(mesh.geometry)) {
        mesh.geometry.dispose();
        disposedGeometries.add(mesh.geometry);
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    });
  }

  public update(
    dt: number,
    creeps: Creep[],
    onFire: (tower: Tower, target: Creep, attack: AttackProfile, shot: ShotInfo) => void,
  ): void {
    // A zero delta means the simulation is paused. In particular, a freshly
    // deployed tower has a ready cooldown and must not fire during that frame.
    if (dt <= 0 || this.deploymentLocked) return;

    const time = performance.now() * 0.001;

    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer <= 0) {
        this.isAttackingAnim = false;
      }
    }
    if (this.entranceAnimTimer > 0) this.entranceAnimTimer -= dt;

    if (this.surge.timer > 0) {
      this.surge.timer -= dt;
      if (this.surge.timer <= 0) this.surge.bonus = 0;
    }

    if (this.disabledTimer > 0) {
      this.disabledTimer -= dt;
      this.animPokemon.update(time, dt, 'idle');
      return;
    }

    const attack = this.attack;
    const move = attack.move;
    const targets = rankTargets(this, creeps, move, attack.multishot);
    const target = targets[0] ?? null;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      // Becoming ready with nobody in range is an idle state, not a bank of
      // missed attacks to unleash when the next creep enters range.
      if (!target && this.cooldown < 0) this.cooldown = 0;
    }
    if (attack.spinUp && !target) {
      // An idle spin-up tower winds down over about two seconds.
      this.spin = Math.max(0, this.spin - attack.spinUp.max * dt * 0.5);
    }

    if (target && this.cooldown <= 0) {
      const rate = move.attackSpeed * attack.rate * (1 + this.rateBuff + this.surge.bonus + this.spin) * this.modifiers.rate;
      // Add the interval to the overdue deadline so a slow frame does not
      // permanently lower the attack rate by discarding overshoot.
      this.cooldown += 1.0 / rate;
      this.isAttackingAnim = true;
      this.attackAnimTimer = 0.35;
      this.animPokemon.playMove?.(move.name);
      const shot = this.rollShot(target, creeps);
      for (const aimed of targets) onFire(this, aimed, attack, shot);
      if (attack.spinUp) this.spin = Math.min(attack.spinUp.max, this.spin + attack.spinUp.perShot);
    }

    this.currentTarget = target;

    if (target) {
      // Smoothly rotate toward whatever the tower is engaging
      const lookPos = target.position.clone();
      lookPos.y = this.position.y;
      this.animPokemon.mesh.lookAt(lookPos);
    }

    // Update 3D model animation
    const state = this.isAttackingAnim ? 'attack' : this.entranceAnimTimer > 0 ? 'entrance' : 'idle';
    this.animPokemon.update(time, dt, state);
  }

  /** Rage, crits, crowd and level power, and hazard timing for the attack about to fire. */
  private rollShot(target: Creep, creeps: Creep[]): ShotInfo {
    const { rage, crit, hazard, crowdPower, levelPower } = this.attack;
    this.attackCount++;
    let damageMultiplier = 1 + levelPower * this.pokemon.level;
    if (crowdPower) {
      const crowd = creeps.filter(creep => creep.alive
        && Math.hypot(creep.position.x - this.position.x, creep.position.z - this.position.z) <= this.getMaxRange()).length;
      damageMultiplier *= 1 + Math.min(crowdPower.max, crowdPower.perCreep * crowd);
    }
    if (rage) {
      this.rageStacks = target === this.rageTarget ? Math.min(rage.maxStacks, this.rageStacks + 1) : 0;
      this.rageTarget = target;
      damageMultiplier *= 1 + rage.perStack * this.rageStacks;
    }
    const critical = !!crit && Math.random() < crit.chance;
    if (critical) damageMultiplier *= crit!.multiplier;
    return {
      damageMultiplier,
      crit: critical,
      dropsHazard: !!hazard && this.attackCount % hazard.everyNth === 0,
    };
  }

  private findTarget(creeps: Creep[], move: MoveDefinition): Creep | null {
    return rankTargets(this, creeps, move, 1)[0] ?? null;
  }
}

/**
 * The best `count` creeps this tower may aim `move` at, by its target
 * priority. Fields and auras don't aim, so a Phantom can set them off;
 * ground-only moves pass under Airborne creeps, so they never trigger one.
 */
function rankTargets(
  tower: Pick<Tower, 'position' | 'targetPriority' | 'seesPhantoms' | 'reachAgainst'>,
  creeps: Creep[],
  move: MoveDefinition,
  count: number,
): Creep[] {
  const untargeted = move.delivery === 'field' || move.delivery === 'aura';
  const canTargetPhantoms = untargeted || tower.seesPhantoms;
  const groundOnly = isGroundOnly(move);
  const ranked: { creep: Creep; metric: number }[] = [];

  for (const creep of creeps) {
    if (!creep.alive || creep.captureLocked) continue;
    if (!canTargetPhantoms && creep.hasTrait('phantom')) continue;
    if (groundOnly && creep.hasTrait('airborne')) continue;
    // Reach is measured across the ground; standing above the lane extends it.
    const dist = Math.hypot(tower.position.x - creep.position.x, tower.position.z - creep.position.z);
    if (dist > tower.reachAgainst(move.range, creep)) continue;

    const metric = tower.targetPriority === 'first' ? creep.pathProgress
      : tower.targetPriority === 'last' ? -creep.pathProgress
      : tower.targetPriority === 'strongest' ? creep.hp
      : -creep.hp;
    ranked.push({ creep, metric });
  }

  ranked.sort((a, b) => b.metric - a.metric);
  return ranked.slice(0, Math.max(1, count)).map(entry => entry.creep);
}
