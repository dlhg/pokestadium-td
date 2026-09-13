/**
 * Creep.ts — 3D Invading Pokémon Entity
 *
 * Manages creep movement along the stadium track, health, status conditions,
 * and 3D floating health bar billboard.
 */

import * as THREE from 'three';
import { AnimatedPokemon, disposePokemonModel, PokemonModelFactory } from '../stadium/PokemonModels';
import { PokemonGait } from '../stadium/PokemonGait';
import { PokemonType, TYPE_COLORS } from '../stadium/TypeMatrix';
import { DamageStatus, isDamageStatus, MovementStatus, StatusEffectType } from '../stadium/MoveDatabase';
import type { Tower } from './Tower';
import { STATUS_CONTRIBUTION } from './progression/Stats';

/** A 0.4 grade stair roughly halves a creep's pace. */
const CLIMB_SLOWDOWN = 2.6;
/** Gap between the top of a loaded model and its HP bar. */
const HP_BAR_CLEARANCE = 0.7;
/** A creep at or below this share of its HP can be targeted with a ball. */
export const CATCH_HP_FRACTION = 0.35;
/** Canvas pixels below the HP bar reserved for trait badges. */
const TRAIT_STRIP_HEIGHT = 16;

/**
 * The three things a creep can be, each read straight off its typing so a
 * Pokémon player already knows them: flyers stay off the ground, ghosts can't
 * be aimed at, rocks shrug off light hits.
 */
export type CreepTrait = 'airborne' | 'phantom' | 'armored';

export const TRAIT_LABELS: Record<CreepTrait, string> = {
  airborne: 'AIRBORNE', phantom: 'PHANTOM', armored: 'ARMORED',
};

const TRAIT_BADGE_COLORS: Record<CreepTrait, string> = {
  airborne: TYPE_COLORS.Flying.hex, phantom: TYPE_COLORS.Ghost.hex, armored: TYPE_COLORS.Rock.hex,
};

export function traitsForTypes(types: PokemonType[]): CreepTrait[] {
  const traits: CreepTrait[] = [];
  if (types.includes('Flying')) traits.push('airborne');
  if (types.includes('Ghost')) traits.push('phantom');
  if (types.includes('Rock')) traits.push('armored');
  return traits;
}

/** Share of a Light hit that lands on an Armored creep. */
export const ARMOR_LIGHT_MULTIPLIER = 0.5;
/** Titans shake off control: stops become slows and every effect runs this long. */
export const TITAN_CONTROL_DURATION = 0.5;

/** A stronger hold displaces a weaker one; equal holds keep whichever lasts longer. */
const MOVEMENT_PRIORITY: Record<MovementStatus, number> = { freeze: 1, paralyze: 2, confuse: 2, stun: 3, sleep: 3 };
/** A confused creep stumbles back the way it came at this share of its speed. */
const CONFUSED_BACKSTEP = 0.5;

interface StatusSlot<T> { effect: T; timer: number; source: Tower | null }

export interface CreepConfig {
  id: string;
  name: string;
  type: PokemonType;
  secondaryType?: PokemonType;
  maxHp: number;
  speed: number;
  reward: number;
  isBoss?: boolean;
  threat?: 'normal' | 'elite' | 'titan';
  modelType: 'rattata' | 'zubat' | 'geodude' | 'dragonair' | 'boss_titan';
  modelName?: string;
  titanType?: 'Onix' | 'Gyarados';
  /** Assigned by the wave manager from the round and course difficulty. */
  level?: number;
}

export class Creep {
  public id: string;
  public name: string;
  public type: PokemonType;
  public types: PokemonType[];
  public readonly traits: CreepTrait[];
  public maxHp: number;
  public hp: number;
  public baseSpeed: number;
  public speed: number;
  public reward: number;
  public isBoss: boolean;
  public threat: 'normal' | 'elite' | 'titan';
  public modelType: CreepConfig['modelType'];
  public level: number;
  /**
   * Who helped bring this creep down: damage dealt plus a share of max HP for
   * each status landed. The knockout XP pool is split by these weights.
   */
  public contributors = new Map<Tower, number>();
  public alive: boolean = true;
  public reachedEnd: boolean = false;
  public removalReady: boolean = false;
  /** A Poké Ball is resolving against this target; it cannot move or be hit. */
  public captureLocked: boolean = false;

  public position: THREE.Vector3 = new THREE.Vector3();
  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;
  /** Turns toward the path so the gait can pose the model in its own frame. */
  private facing: THREE.Group = new THREE.Group();
  private gait: PokemonGait;
  private lastPosition = new THREE.Vector3();

  // Path following
  private waypoints: THREE.Vector3[];
  private currentWpIdx: number = 0;
  private remainingAtWaypoint: number[];
  /** Negative distance to the exit: comparable even on routes of different lengths. */
  public pathProgress: number = 0;

  // Status effects: one damage-over-time and one movement effect can stack.
  public damageStatus: StatusSlot<DamageStatus> | null = null;
  public movementStatus: StatusSlot<MovementStatus> | null = null;
  /** Share of speed taken by the strongest slow aura reaching this creep, refreshed each frame. */
  public auraSlow = 0;
  private burnTickTimer: number = 0;
  private entranceTimer = 0.75;
  private hitAnimationTimer = 0;
  private faintAnimationTimer = 0;
  private destroyed = false;

  // 3D Billboard HP Bar
  private hpCanvas: HTMLCanvasElement;
  private hpCtx: CanvasRenderingContext2D;
  private hpTexture: THREE.CanvasTexture;
  private hpSprite: THREE.Sprite;
  private threatAura: THREE.Mesh | null = null;
  private captureRing: THREE.Mesh;

  constructor(config: CreepConfig, waypoints: THREE.Vector3[]) {
    this.id = `creep_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.name = config.name;
    this.type = config.type;
    this.types = config.secondaryType ? [config.type, config.secondaryType] : [config.type];
    this.traits = traitsForTypes(this.types);
    this.maxHp = config.maxHp;
    this.hp = config.maxHp;
    this.baseSpeed = config.speed;
    this.speed = config.speed;
    this.reward = config.reward;
    this.modelType = config.modelType;
    this.level = config.level ?? 5;
    this.threat = config.threat || (config.isBoss ? 'titan' : 'normal');
    this.isBoss = this.threat === 'titan' || !!config.isBoss;
    this.waypoints = waypoints;
    this.remainingAtWaypoint = new Array(waypoints.length).fill(0);
    for (let i = waypoints.length - 2; i >= 0; i--) {
      this.remainingAtWaypoint[i] = this.remainingAtWaypoint[i + 1] + waypoints[i].distanceTo(waypoints[i + 1]);
    }
    this.pathProgress = -this.remainingAtWaypoint[0];

    // Instantiate Model
    switch (config.modelType) {
      case 'rattata':
        this.animPokemon = PokemonModelFactory.createRattata();
        break;
      case 'zubat':
        this.animPokemon = PokemonModelFactory.createZubat();
        break;
      case 'geodude':
        this.animPokemon = PokemonModelFactory.createGeodude();
        break;
      case 'dragonair':
        this.animPokemon = PokemonModelFactory.createDragonair();
        break;
      case 'boss_titan':
        this.animPokemon = PokemonModelFactory.createBossTitan(config.titanType || 'Onix');
        break;
      default:
        this.animPokemon = PokemonModelFactory.createRattata();
    }

    this.group.add(this.facing);
    this.facing.add(this.animPokemon.mesh);
    if (this.threat === 'elite') {
      this.addThreatAura(0x8ee7ff);
    } else if (this.threat === 'titan') {
      this.addThreatAura(0xffc52b);
    }

    // Asynchronously load authentic GLB model & animations
    const modelName = (config.modelName || config.name).toLowerCase()
      .replace('titan ', '').replace('boss ', '').trim();
    this.gait = new PokemonGait(modelName);
    PokemonModelFactory.loadAuthenticModel(modelName, undefined, () => this.animPokemon).then((loaded) => {
      if (this.destroyed) {
        disposePokemonModel(loaded);
        return;
      }
      if (loaded && loaded.mesh !== this.animPokemon.mesh) {
        disposePokemonModel(this.animPokemon);
        this.facing.remove(this.animPokemon.mesh);
        this.animPokemon = loaded;
        this.facing.add(this.animPokemon.mesh);
        if (loaded.height !== undefined) {
          this.hpSprite.position.y = loaded.height + HP_BAR_CLEARANCE;
          this.gait.height = loaded.height;
        }
      }
    });

    // Initial position at first waypoint
    if (waypoints.length > 0) {
      this.position.copy(waypoints[0]);
      this.group.position.copy(this.position);
    }
    this.lastPosition.copy(this.position);

    // 3D Billboard Sprite for HP Bar
    this.hpCanvas = document.createElement('canvas');
    this.hpCanvas.width = 128;
    // Trait badges get a strip of their own under the bar.
    this.hpCanvas.height = this.traits.length ? 32 + TRAIT_STRIP_HEIGHT : 32;
    this.hpCtx = this.hpCanvas.getContext('2d')!;
    this.hpTexture = new THREE.CanvasTexture(this.hpCanvas);

    const spriteMat = new THREE.SpriteMaterial({
      map: this.hpTexture,
      transparent: true,
      depthTest: false,
    });
    this.hpSprite = new THREE.Sprite(spriteMat);
    // Models share one world scale now, so threat tiers only enlarge their HUD.
    const hudScale = this.threat === 'titan' ? 1.8 : this.threat === 'elite' ? 1.35 : 1;
    const barHeight = this.threat === 'titan' ? 3.8 : this.threat === 'elite' ? 2.9 : 2.6;
    this.hpSprite.position.set(0, barHeight * hudScale, 0);
    const stripScale = this.hpCanvas.height / 32;
    this.hpSprite.scale.set((this.threat === 'titan' ? 4.0 : this.threat === 'elite' ? 3.0 : 2.5) * hudScale, (this.isBoss ? 1.0 : 0.65) * hudScale * stripScale, 1);
    this.group.add(this.hpSprite);

    this.captureRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9 * hudScale, 1.05 * hudScale, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.captureRing.rotation.x = -Math.PI / 2;
    this.captureRing.position.y = 0.08;
    this.captureRing.visible = false;
    this.group.add(this.captureRing);

    this.updateHpBar();
  }

  public hasTrait(trait: CreepTrait): boolean {
    return this.traits.includes(trait);
  }

  /** The most noticeable status, for anything that only cares about one. */
  public get status(): StatusEffectType {
    return this.movementStatus?.effect ?? this.damageStatus?.effect ?? 'none';
  }

  /**
   * Removes HP. `periodic` marks burn and poison ticks, which never wake a
   * sleeping creep; any direct hit does.
   */
  public takeDamage(amount: number, source: Tower | null = null, periodic = false): boolean {
    if (!this.alive || this.captureLocked) return false;
    if (!periodic && this.movementStatus?.effect === 'sleep') this.movementStatus = null;
    // Overkill earns nothing: only the HP actually removed counts.
    if (source) this.credit(source, Math.min(amount, this.hp));
    this.hp -= amount;
    this.hitAnimationTimer = 0.28;
    this.updateHpBar();

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.faintAnimationTimer = this.isBoss ? 1.4 : 0.85;
      this.hpSprite.visible = false;
      return true; // Just died
    }
    return false;
  }

  /** Returns true when the status took hold. */
  public applyStatus(effect: StatusEffectType, duration: number, source: Tower | null = null): boolean {
    if (effect === 'none' || !this.alive || this.captureLocked) return false;

    if (isDamageStatus(effect)) {
      this.damageStatus = { effect, timer: duration, source };
    } else {
      let hold: MovementStatus = effect;
      if (this.isBoss) {
        // Titans are never stopped outright, only slowed, and not for long.
        hold = 'freeze';
        duration *= TITAN_CONTROL_DURATION;
      }
      const current = this.movementStatus;
      if (current) {
        const gap = MOVEMENT_PRIORITY[hold] - MOVEMENT_PRIORITY[current.effect];
        if (gap < 0 || (gap === 0 && duration <= current.timer)) return false;
      }
      this.movementStatus = { effect: hold, timer: duration, source };
    }

    if (source) this.credit(source, this.maxHp * STATUS_CONTRIBUTION);
    return true;
  }

  /** Shoves the creep back along its route, never past where it started. */
  public pushBack(distance: number): void {
    if (!this.alive || this.captureLocked) return;
    let remaining = distance;
    while (remaining > 0 && this.currentWpIdx > 0) {
      const previous = this.waypoints[this.currentWpIdx - 1];
      const gap = this.position.distanceTo(previous);
      if (gap > remaining) {
        this.position.lerp(previous, remaining / gap);
        remaining = 0;
      } else {
        this.position.copy(previous);
        remaining -= gap;
        this.currentWpIdx--;
      }
    }
    if (this.currentWpIdx < this.waypoints.length) {
      this.pathProgress = -(this.position.distanceTo(this.waypoints[this.currentWpIdx]) + this.remainingAtWaypoint[this.currentWpIdx]);
    }
    this.group.position.copy(this.position);
  }

  private credit(source: Tower, amount: number): void {
    if (amount > 0) this.contributors.set(source, (this.contributors.get(source) ?? 0) + amount);
  }

  public get hpFraction(): number { return this.hp / this.maxHp; }

  /** Weak enough for a ball, and not already fainted or inside one. */
  public get catchable(): boolean {
    return this.alive && !this.captureLocked && this.hpFraction <= CATCH_HP_FRACTION;
  }

  /** Height above the creep's origin where screen tags should sit: just over the HP bar. */
  public get hudAnchorHeight(): number {
    return this.hpSprite.position.y + this.hpSprite.scale.y * 0.5;
  }

  public beginCapture(): void {
    this.captureLocked = true;
    this.hpSprite.visible = false;
  }

  public cancelCapture(): void {
    this.captureLocked = false;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.hpSprite.visible = true;
  }

  private updateHpBar(): void {
    const ctx = this.hpCtx;
    const w = this.hpCanvas.width;
    const h = 32;

    ctx.clearRect(0, 0, w, this.hpCanvas.height);

    // Background dark border box
    ctx.fillStyle = this.threat === 'titan' ? 'rgba(78, 35, 0, 0.9)' : this.threat === 'elite' ? 'rgba(20, 49, 78, 0.9)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 4, w, h - 8);

    // HP Bar Fill
    const pct = Math.max(0, this.hp / this.maxHp);
    let barColor = '#48FF48'; // Green > 50%
    if (pct < 0.2) {
      barColor = '#FF3333'; // Red < 20%
    } else if (pct < 0.5) {
      barColor = '#FFCC00'; // Yellow 20-50%
    }

    ctx.fillStyle = barColor;
    ctx.fillRect(4, 7, (w - 8) * pct, h - 14);

    // Outline
    ctx.strokeStyle = this.threat === 'titan' ? '#FFD34D' : this.threat === 'elite' ? '#8EE7FF' : '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 7, w - 8, h - 14);

    if (this.threat !== 'normal') {
      ctx.fillStyle = this.threat === 'titan' ? '#FFD34D' : '#8EE7FF';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(this.threat.toUpperCase(), w - 6, 14);
    }

    if (this.catchable) {
      ctx.fillStyle = '#ffe46b';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('CATCH!', 28, 14);
    }

    // Type badge color indicator dot
    const typeColor = TYPE_COLORS[this.type]?.hex || '#FFFFFF';
    ctx.fillStyle = typeColor;
    ctx.beginPath();
    ctx.arc(8, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    if (this.types.length > 1) {
      ctx.fillStyle = TYPE_COLORS[this.types[1]]?.hex || '#FFFFFF';
      ctx.beginPath();
      ctx.arc(18, h / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawTraitBadges(ctx, h);

    this.hpTexture.needsUpdate = true;
    this.captureRing.visible = this.catchable;
  }

  private drawTraitBadges(ctx: CanvasRenderingContext2D, top: number): void {
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gap = 3;
    const widths = this.traits.map(trait => ctx.measureText(TRAIT_LABELS[trait]).width + 8);
    let x = (this.hpCanvas.width - widths.reduce((sum, width) => sum + width + gap, -gap)) / 2;
    this.traits.forEach((trait, i) => {
      ctx.fillStyle = TRAIT_BADGE_COLORS[trait];
      ctx.fillRect(x, top + 1, widths[i], TRAIT_STRIP_HEIGHT - 3);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 1.5, widths[i] - 1, TRAIT_STRIP_HEIGHT - 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(TRAIT_LABELS[trait], x + widths[i] / 2, top + TRAIT_STRIP_HEIGHT / 2);
      x += widths[i] + gap;
    });
    ctx.textBaseline = 'alphabetic';
  }

  public update(dt: number, onDeath: (creep: Creep) => void): void {
    // Do not advance paths, status ticks, or faint timers while paused.
    if (dt <= 0) return;

    const time = performance.now() * 0.001;
    if (this.threatAura) {
      const pulse = 1 + Math.sin(time * (this.threat === 'titan' ? 4 : 3)) * 0.12;
      this.threatAura.scale.setScalar(pulse);
      (this.threatAura.material as THREE.MeshBasicMaterial).opacity = this.threat === 'titan' ? 0.58 : 0.42;
    }
    if (this.captureRing.visible) {
      const pulse = 1 + Math.sin(time * 8) * 0.12;
      this.captureRing.scale.setScalar(pulse);
      (this.captureRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(time * 8) * 0.22;
    }
    if (!this.alive) {
      if (!this.reachedEnd) {
        this.gait.update(this.animPokemon.mesh, 0, dt);
        this.animPokemon.update(time, dt, 'faint');
        this.faintAnimationTimer -= dt;
        this.removalReady = this.faintAnimationTimer <= 0;
      }
      return;
    }
    if (this.captureLocked) {
      this.gait.update(this.animPokemon.mesh, 0, dt);
      this.animPokemon.update(time, dt, 'hit');
      return;
    }

    // Handle Status Effects
    this.speed = this.baseSpeed;
    const dot = this.damageStatus;
    if (dot) {
      dot.timer -= dt;
      // Poison is weaker per tick than burn, but control moves apply it for far longer.
      const tickShare = dot.effect === 'burn' ? 0.04 : 0.018;
      this.burnTickTimer += dt;
      while (this.burnTickTimer >= 0.5) {
        this.burnTickTimer -= 0.5;
        if (this.takeDamage(this.maxHp * tickShare, dot.source, true)) {
          onDeath(this);
          return;
        }
      }
      if (dot.timer <= 0) {
        this.damageStatus = null;
        this.burnTickTimer = 0;
      }
    }

    const hold = this.movementStatus;
    if (hold) {
      hold.timer -= dt;
      if (hold.effect === 'freeze') {
        this.speed = this.baseSpeed * 0.45; // 55% slow
      } else if (hold.effect === 'paralyze') {
        // Intermittent stutter
        this.speed = Math.sin(time * 20) > 0.2 ? 0 : this.baseSpeed * 0.6;
      } else if (hold.effect === 'confuse') {
        this.speed = 0;
        this.pushBack(this.baseSpeed * CONFUSED_BACKSTEP * (1 - this.auraSlow) * dt);
      } else {
        this.speed = 0;
      }
      if (hold.timer <= 0) this.movementStatus = null;
    }
    this.speed *= 1 - this.auraSlow;

    // Spend the entire movement budget across sampled segments. Dense curves
    // must not slow creeps down by discarding leftover distance at every point.
    let step = this.speed * dt;
    while (this.currentWpIdx < this.waypoints.length) {
      const targetWp = this.waypoints[this.currentWpIdx];
      const dist = this.position.distanceTo(targetWp);
      // Climbing stairs costs pace: a stair's slope turns into a natural choke point.
      const climb = dist > 1e-4 ? Math.max(0, targetWp.y - this.position.y) / dist : 0;
      const pace = 1 / (1 + climb * CLIMB_SLOWDOWN);

      if (dist <= step * pace) {
        this.position.copy(targetWp);
        step -= dist / pace;
        this.currentWpIdx++;

        if (this.currentWpIdx >= this.waypoints.length) {
          this.reachedEnd = true;
          this.alive = false;
          this.pathProgress = 0;
        }
      } else {
        const dir = new THREE.Vector3().subVectors(targetWp, this.position).normalize();
        this.position.addScaledVector(dir, step * pace);

        // Smooth look-at facing
        const lookPos = targetWp.clone();
        lookPos.y = this.position.y;
        this.facing.lookAt(lookPos);
        break;
      }
    }
    if (!this.reachedEnd && this.currentWpIdx < this.waypoints.length) {
      this.pathProgress = -(this.position.distanceTo(this.waypoints[this.currentWpIdx]) + this.remainingAtWaypoint[this.currentWpIdx]);
    }
    this.group.position.copy(this.position);
    this.gait.update(this.animPokemon.mesh, this.position.distanceTo(this.lastPosition), dt);
    this.lastPosition.copy(this.position);

    // Rendering follows combat state without changing movement or damage timing.
    this.entranceTimer -= dt;
    this.hitAnimationTimer -= dt;
    const animation = this.entranceTimer > 0
      ? 'entrance'
      : this.hitAnimationTimer > 0 ? 'hit' : 'walk';
    this.animPokemon.update(time, dt, animation);
  }

  public destroy(scene: THREE.Scene): void {
    if (this.destroyed) return;
    this.destroyed = true;
    scene.remove(this.group);
    disposePokemonModel(this.animPokemon);
    this.hpTexture.dispose();
    this.hpSprite.material.dispose();
    this.captureRing.geometry.dispose();
    (this.captureRing.material as THREE.Material).dispose();
    this.threatAura?.geometry.dispose();
    (this.threatAura?.material as THREE.Material | undefined)?.dispose();
  }

  private addThreatAura(color: number): void {
    const aura = new THREE.Mesh(
      new THREE.TorusGeometry(this.threat === 'titan' ? 2.25 : 1.19, this.threat === 'titan' ? 0.09 : 0.07, 6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })
    );
    aura.rotation.x = Math.PI / 2;
    aura.position.y = this.threat === 'titan' ? 0.14 : 0.11;
    this.group.add(aura);
    this.threatAura = aura;
  }
}
