/**
 * Creep.ts — 3D Invading Pokémon Entity
 *
 * Manages creep movement along the stadium track, health, status conditions,
 * and 3D floating health bar billboard.
 */

import * as THREE from 'three';
import { AnimatedPokemon, PokemonModelFactory } from '../stadium/PokemonModels';
import { PokemonType, TYPE_COLORS } from '../stadium/TypeMatrix';
import { StatusEffectType } from '../stadium/MoveDatabase';

export interface CreepConfig {
  id: string;
  name: string;
  type: PokemonType;
  secondaryType?: PokemonType;
  maxHp: number;
  speed: number;
  reward: number;
  isBoss?: boolean;
  modelType: 'rattata' | 'zubat' | 'geodude' | 'dragonair' | 'boss_titan';
  modelName?: string;
  titanType?: 'Onix' | 'Gyarados';
}

export class Creep {
  public id: string;
  public name: string;
  public type: PokemonType;
  public types: PokemonType[];
  public maxHp: number;
  public hp: number;
  public baseSpeed: number;
  public speed: number;
  public reward: number;
  public isBoss: boolean;
  public alive: boolean = true;
  public reachedEnd: boolean = false;
  public removalReady: boolean = false;

  public position: THREE.Vector3 = new THREE.Vector3();
  public group: THREE.Group = new THREE.Group();
  public animPokemon: AnimatedPokemon;

  // Path following
  private waypoints: THREE.Vector3[];
  private currentWpIdx: number = 0;
  public pathProgress: number = 0;

  // Status effects
  public status: StatusEffectType = 'none';
  public statusTimer: number = 0;
  private burnTickTimer: number = 0;
  private entranceTimer = 0.75;
  private hitAnimationTimer = 0;
  private faintAnimationTimer = 0;

  // 3D Billboard HP Bar
  private hpCanvas: HTMLCanvasElement;
  private hpCtx: CanvasRenderingContext2D;
  private hpTexture: THREE.CanvasTexture;
  private hpSprite: THREE.Sprite;

  constructor(config: CreepConfig, waypoints: THREE.Vector3[]) {
    this.id = `creep_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.name = config.name;
    this.type = config.type;
    this.types = config.secondaryType ? [config.type, config.secondaryType] : [config.type];
    this.maxHp = config.maxHp;
    this.hp = config.maxHp;
    this.baseSpeed = config.speed;
    this.speed = config.speed;
    this.reward = config.reward;
    this.isBoss = !!config.isBoss;
    this.waypoints = waypoints;

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

    this.group.add(this.animPokemon.mesh);

    // Asynchronously load authentic GLB model & animations
    const modelName = (config.modelName || config.name).toLowerCase()
      .replace('titan ', '').replace('boss ', '').trim();
    const targetHeight = config.isBoss ? 4.5 : 1.6;
    PokemonModelFactory.loadAuthenticModel(modelName, targetHeight, () => this.animPokemon).then((loaded) => {
      if (loaded && loaded.mesh !== this.animPokemon.mesh) {
        this.group.remove(this.animPokemon.mesh);
        this.animPokemon = loaded;
        this.group.add(this.animPokemon.mesh);
      }
    });

    // Initial position at first waypoint
    if (waypoints.length > 0) {
      this.position.copy(waypoints[0]);
      this.group.position.copy(this.position);
    }

    // 3D Billboard Sprite for HP Bar
    this.hpCanvas = document.createElement('canvas');
    this.hpCanvas.width = 128;
    this.hpCanvas.height = 32;
    this.hpCtx = this.hpCanvas.getContext('2d')!;
    this.hpTexture = new THREE.CanvasTexture(this.hpCanvas);

    const spriteMat = new THREE.SpriteMaterial({
      map: this.hpTexture,
      transparent: true,
      depthTest: false,
    });
    this.hpSprite = new THREE.Sprite(spriteMat);
    const barHeight = this.isBoss ? 4.5 : 2.6;
    this.hpSprite.position.set(0, barHeight, 0);
    this.hpSprite.scale.set(this.isBoss ? 4.0 : 2.5, this.isBoss ? 1.0 : 0.65, 1);
    this.group.add(this.hpSprite);

    this.updateHpBar();
  }

  public takeDamage(amount: number): boolean {
    if (!this.alive) return false;
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

  public applyStatus(effect: StatusEffectType, duration: number): void {
    if (effect === 'none' || !this.alive) return;
    this.status = effect;
    this.statusTimer = duration;
  }

  private updateHpBar(): void {
    const ctx = this.hpCtx;
    const w = this.hpCanvas.width;
    const h = this.hpCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background dark border box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
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
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 7, w - 8, h - 14);

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

    this.hpTexture.needsUpdate = true;
  }

  public update(dt: number, onDeath: (creep: Creep) => void): void {
    const time = performance.now() * 0.001;
    if (!this.alive) {
      if (!this.reachedEnd) {
        this.animPokemon.update(time, dt, 'faint');
        this.faintAnimationTimer -= dt;
        this.removalReady = this.faintAnimationTimer <= 0;
      }
      return;
    }

    // Handle Status Effects
    this.speed = this.baseSpeed;
    if (this.statusTimer > 0) {
      this.statusTimer -= dt;

      if (this.status === 'burn') {
        this.burnTickTimer += dt;
        if (this.burnTickTimer >= 0.5) {
          this.burnTickTimer = 0;
          if (this.takeDamage(this.maxHp * 0.04)) {
            onDeath(this);
            return;
          }
        }
      } else if (this.status === 'freeze') {
        this.speed = this.baseSpeed * 0.45; // 55% slow
      } else if (this.status === 'paralyze') {
        // Intermittent stutter
        if (Math.sin(time * 20) > 0.2) {
          this.speed = 0;
        } else {
          this.speed = this.baseSpeed * 0.6;
        }
      } else if (this.status === 'stun') {
        this.speed = 0;
      }

      if (this.statusTimer <= 0) {
        this.status = 'none';
      }
    }

    // Path Navigation along waypoints
    if (this.currentWpIdx < this.waypoints.length) {
      const targetWp = this.waypoints[this.currentWpIdx];
      const dist = this.position.distanceTo(targetWp);
      const step = this.speed * dt;

      if (dist <= step) {
        this.position.copy(targetWp);
        this.currentWpIdx++;
        this.pathProgress = this.currentWpIdx;

        if (this.currentWpIdx >= this.waypoints.length) {
          this.reachedEnd = true;
          this.alive = false;
        }
      } else {
        const dir = new THREE.Vector3().subVectors(targetWp, this.position).normalize();
        this.position.addScaledVector(dir, step);

        // Smooth look-at facing
        const lookPos = targetWp.clone();
        lookPos.y = this.position.y;
        this.animPokemon.mesh.lookAt(lookPos);
      }

      this.group.position.copy(this.position);
    }

    // Rendering follows combat state without changing movement or damage timing.
    this.entranceTimer -= dt;
    this.hitAnimationTimer -= dt;
    const animation = this.entranceTimer > 0
      ? 'entrance'
      : this.hitAnimationTimer > 0 ? 'hit' : 'walk';
    this.animPokemon.update(time, dt, animation);
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.hpTexture.dispose();
    this.hpSprite.material.dispose();
  }
}
