/**
 * StadiumTDGame.ts — Master 3D Pokémon Stadium Tower Defense Game Controller
 *
 * Orchestrates the colosseum arena, 3D Pokémon towers, invading creeps,
 * elemental projectiles, particles, dynamic announcer, and stadium UI.
 */

import * as THREE from 'three';
import { StadiumRenderer } from '../engine/StadiumRenderer';
import { StadiumCamera, CameraMode } from '../engine/StadiumCamera';
import { StadiumAudio } from '../engine/StadiumAudio';
import { ParticleSystem } from '../engine/ParticleSystem';
import { Input } from '../engine/Input';
import { StadiumArena, type BuildBlockReason } from '../stadium/StadiumArena';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumUI, type PlacementStatus } from './StadiumUI';
import {
  Tower,
  TowerTemplate,
  TARGET_PRIORITIES,
  TOWER_FOOTPRINT_RADIUS,
  TOWER_BASE_HEIGHT,
} from './Tower';
import { Creep } from './Creep';
import { Projectile } from './Projectile';
import { WaveManager } from './WaveManager';
import { MOVES } from '../stadium/MoveDatabase';
import { HitContext, playInstantDelivery, resolveMoveHit } from './MoveDelivery';

/** Everything that can veto dropping the armed tower under the cursor. */
type PlacementBlockReason =
  | Exclude<BuildBlockReason, null>
  | 'overlaps_tower'
  | 'too_expensive';

const PLACEMENT_BLOCK_LABELS: Record<PlacementBlockReason, string> = {
  too_expensive: 'NOT ENOUGH PRIZE MONEY',
  out_of_bounds: 'OUTSIDE THE ARENA',
  on_lane: 'TOO CLOSE TO THE LANE',
  restricted: 'NO-BUILD ZONE',
  overlaps_tower: 'ANOTHER POKÉMON IS THERE',
};

export class StadiumTDGame {
  public renderer!: StadiumRenderer;
  public camera!: StadiumCamera;
  public audio!: StadiumAudio;
  public particles!: ParticleSystem;
  public arena!: StadiumArena;
  public announcer!: StadiumAnnouncer;
  public waveManager!: WaveManager;
  public ui!: StadiumUI;

  // Economy & Lives
  public money: number = 420;
  public lives: number = 6;
  public gameSpeed: number = 1.0;
  public isPaused: boolean = false;
  public gameOver: boolean = false;
  public victory: boolean = false;

  // Entities
  public towers: Tower[] = [];
  public creeps: Creep[] = [];
  public projectiles: Projectile[] = [];

  // Selection states
  public selectedTemplate: TowerTemplate | null = null;
  public selectedTower: Tower | null = null;
  private placementPreview: THREE.Group = new THREE.Group();
  private placementPreviewTemplateId: string | null = null;
  private placementStatus: PlacementStatus | null = null;

  public init(canvas: HTMLCanvasElement, uiContainer: HTMLElement): void {
    this.renderer = new StadiumRenderer(canvas);
    this.camera = new StadiumCamera();
    this.audio = new StadiumAudio();
    this.particles = new ParticleSystem();
    this.arena = new StadiumArena();
    this.announcer = new StadiumAnnouncer();

    this.renderer.scene.add(this.arena.group);
    this.renderer.scene.add(this.particles.group);
    this.placementPreview.visible = false;
    this.renderer.scene.add(this.placementPreview);

    this.waveManager = new WaveManager(this.arena.waypoints, this.announcer);
    this.ui = new StadiumUI(uiContainer, this.announcer, this.camera);

    this.bindUIEvents();

    // Trigger opening announcer callout
    setTimeout(() => {
      this.announcer.trigger('battle_start');
    }, 600);
  }

  private bindUIEvents(): void {
    this.ui.onSelectTemplate = (template) => {
      if (this.selectedTower) {
        this.selectedTower.setSelected(false);
        this.selectedTower = null;
      }
      this.selectedTemplate = template;
      this.placementPreviewTemplateId = null;
      this.placementPreview.visible = false;
      this.audio.playSelect();
    };

    this.ui.onUpgradeTower = (tower, lineIdx) => {
      const cost = tower.getUpgradeCost(lineIdx);
      if (cost === null || tower.getUpgradeBlockReason(lineIdx) !== null) return;
      if (this.money < cost) return;

      this.money -= cost;
      tower.buyUpgrade(lineIdx);
      this.audio.playDeploy();
      this.camera.shake(0.2);
    };

    this.ui.onEvolveTower = (tower) => {
      const next = tower.getNextEvolution();
      if (!next || this.money < next.cost) return;

      this.money -= next.cost;
      const prevName = tower.name;
      tower.evolve();
      this.audio.playDeploy();
      this.camera.shake(0.35);
      this.announcer.trigger('tower_evolve', `${prevName} into ${tower.name}`);
    };

    this.ui.onDeselectTower = () => {
      if (this.selectedTower) {
        this.selectedTower.setSelected(false);
        this.selectedTower = null;
      }
    };

    this.ui.onSellTower = (tower) => {
      const refund = tower.getSellValue();
      this.money += refund;
      this.removeTower(tower);
      this.audio.playSelect();
      if (this.selectedTower === tower) {
        this.selectedTower = null;
      }
    };

    this.ui.onChangeTargetPriority = (tower, dir) => {
      const modes = TARGET_PRIORITIES;
      const nextIdx = (modes.indexOf(tower.targetPriority) + dir + modes.length) % modes.length;
      tower.targetPriority = modes[nextIdx];
      this.audio.playSelect();
    };

    this.ui.onStartWave = () => {
      if (!this.waveManager.inWave) {
        this.waveManager.startNextWave();
        this.audio.playSelect();
      }
    };

    this.ui.onChangeSpeed = (speed) => {
      this.gameSpeed = speed;
      this.audio.playSelect();
    };

    this.ui.onChangeCamera = (mode: CameraMode) => {
      this.camera.setMode(mode);
      this.audio.playSelect();
    };
  }

  private removeTower(tower: Tower): void {
    this.renderer.scene.remove(tower.group);
    this.towers = this.towers.filter(t => t.id !== tower.id);
  }

  public handleInput(input: Input): void {
    // Hotkeys
    if (input.isKeyJustPressed('Digit1')) this.camera.setMode('tactical');
    if (input.isKeyJustPressed('Digit2')) this.camera.setMode('stadium');
    if (input.isKeyJustPressed('Digit3')) this.camera.setMode('action');
    if (input.isKeyJustPressed('Space')) this.isPaused = !this.isPaused;
    if (input.isKeyJustPressed('Escape') || input.rightClicked) {
      this.clearSelection();
    }

    // Free placement: the cursor's spot on the pitch is the candidate site.
    const ground = input.raycastGround(this.camera.camera, 0);

    // An armed template owns the cursor — clicks drop it, never select a tower.
    if (this.selectedTemplate) {
      this.updatePlacement(this.selectedTemplate, ground, input);
      return;
    }

    this.placementPreview.visible = false;
    this.placementStatus = null;

    if (input.clicked && !input.clickedOnUI) {
      const picked = this.pickTower(input, ground);
      if (picked !== this.selectedTower) {
        if (this.selectedTower) this.selectedTower.setSelected(false);
        this.selectedTower = picked;
        if (picked) {
          picked.setSelected(true);
          this.audio.playSelect();
        }
      }
    }
  }

  private clearSelection(): void {
    if (this.selectedTower) {
      this.selectedTower.setSelected(false);
      this.selectedTower = null;
    }
    this.selectedTemplate = null;
    this.placementStatus = null;
    this.placementPreview.visible = false;
  }

  /** Mesh hit first, then a footprint-sized radius so small models stay clickable. */
  private pickTower(input: Input, ground: THREE.Vector3 | null): Tower | null {
    const hits = input.raycast(this.camera.camera, this.towers.map(t => t.group));
    for (const hit of hits) {
      const tower = this.findTowerFromObject(hit.object);
      if (tower) return tower;
    }

    if (!ground) return null;
    return this.towers.find(t =>
      Math.hypot(t.position.x - ground.x, t.position.z - ground.z) <= TOWER_FOOTPRINT_RADIUS
    ) ?? null;
  }

  private findTowerFromObject(object: THREE.Object3D | null): Tower | null {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const towerId = node.userData?.towerId;
      if (towerId) return this.towers.find(t => t.id === towerId) ?? null;
    }
    return null;
  }

  private updatePlacement(
    template: TowerTemplate,
    ground: THREE.Vector3 | null,
    input: Input,
  ): void {
    if (!ground) {
      this.placementPreview.visible = false;
      this.placementStatus = { valid: false, label: PLACEMENT_BLOCK_LABELS.out_of_bounds };
      return;
    }

    const blocked = this.getPlacementBlock(template, ground.x, ground.z);
    this.placementStatus = blocked
      ? { valid: false, label: PLACEMENT_BLOCK_LABELS[blocked] }
      : { valid: true, label: `PLACE ${template.name.toUpperCase()} · ESC TO CANCEL` };

    this.updatePlacementPreview(template, ground, !blocked);

    if (input.clicked && !input.clickedOnUI && !blocked) {
      this.placeTower(template, ground);
    }
  }

  private getPlacementBlock(
    template: TowerTemplate,
    x: number,
    z: number,
  ): PlacementBlockReason | null {
    if (this.money < template.cost) return 'too_expensive';

    const arenaBlock = this.arena.isBuildable(x, z, TOWER_FOOTPRINT_RADIUS);
    if (arenaBlock) return arenaBlock;

    const crowded = this.towers.some(t =>
      Math.hypot(t.position.x - x, t.position.z - z) < TOWER_FOOTPRINT_RADIUS * 2
    );
    return crowded ? 'overlaps_tower' : null;
  }

  private placeTower(template: TowerTemplate, ground: THREE.Vector3): void {
    const position = new THREE.Vector3(ground.x, TOWER_BASE_HEIGHT, ground.z);
    this.money -= template.cost;

    const tower = new Tower(template, position);
    this.renderer.scene.add(tower.group);
    this.towers.push(tower);

    this.audio.playDeploy();
    this.particles.emitImpact(position, 0x00f0ff, 25, 5);

    // Select the freshly placed tower so its move shop opens immediately.
    if (this.selectedTower) this.selectedTower.setSelected(false);
    this.selectedTower = tower;
    tower.setSelected(true);

    this.selectedTemplate = null;
    this.placementStatus = null;
    this.placementPreview.visible = false;
  }

  private updatePlacementPreview(
    template: TowerTemplate,
    point: THREE.Vector3,
    valid: boolean,
  ): void {
    const color = valid ? 0x00f0ff : 0xd90429;
    if (this.placementPreviewTemplateId !== template.id) {
      this.placementPreview.clear();
      const range = MOVES[template.lines[0].tiers[0].moveId].range;

      const rangeFill = new THREE.Mesh(
        new THREE.CircleGeometry(range, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.075,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      rangeFill.rotation.x = -Math.PI / 2;
      rangeFill.renderOrder = 4;
      this.placementPreview.add(rangeFill);

      const rangeRing = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0, range - 0.22), range, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      rangeRing.rotation.x = -Math.PI / 2;
      rangeRing.position.y = 0.015;
      rangeRing.renderOrder = 5;
      this.placementPreview.add(rangeRing);

      const footprint = new THREE.Mesh(
        new THREE.RingGeometry(TOWER_FOOTPRINT_RADIUS - 0.25, TOWER_FOOTPRINT_RADIUS, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.y = 0.03;
      footprint.renderOrder = 6;
      this.placementPreview.add(footprint);
      this.placementPreviewTemplateId = template.id;
    }

    this.placementPreview.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
        object.material.color.setHex(color);
      }
    });
    // Same clearance as the tower range ring: above the lane ribbon at y = 0.5.
    this.placementPreview.position.set(point.x, TOWER_BASE_HEIGHT + 0.35, point.z);
    this.placementPreview.visible = true;
  }

  public update(realDt: number, input: Input): void {
    if (this.gameOver) return;

    this.handleInput(input);

    const dt = this.isPaused ? 0 : realDt * this.gameSpeed;

    // Update Wave Manager
    this.waveManager.update(
      dt,
      this.creeps,
      (newCreep) => {
        this.renderer.scene.add(newCreep.group);
        this.creeps.push(newCreep);
      }
    );

    // Update Towers
    this.towers.forEach(tower => {
      tower.update(dt, this.creeps, (t, target, move) => {
        // Fire attack!
        this.audio.playAttack(move.fxType);

        if (move.delivery === 'projectile') {
          this.projectiles.push(new Projectile(move, t.position, target, this.renderer.scene));
          return;
        }

        // Every other archetype lands the moment it is fired: draw the
        // delivery, then resolve the hit once at the target.
        playInstantDelivery(move, t.position, target, this.particles, this.camera);
        resolveMoveHit(move, target, this.hitContext());
      });
    });

    // Update Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const stillActive = p.update(dt, this.hitContext());
      if (!stillActive) {
        p.destroy(this.renderer.scene);
        this.projectiles.splice(i, 1);
      }
    }

    // Update Creeps
    for (let i = this.creeps.length - 1; i >= 0; i--) {
      const c = this.creeps[i];
      c.update(dt, (deadCreep) => this.handleCreepDefeat(deadCreep));

      if (c.reachedEnd) {
        // Creep penetrated stadium defenses
        this.lives--;
        this.camera.shake(0.5);
        this.audio.playHit(true);
        this.announcer.trigger('life_lost');

        c.destroy(this.renderer.scene);
        this.creeps.splice(i, 1);

        if (this.lives <= 0) {
          this.lives = 0;
          this.gameOver = true;
          this.announcer.trigger('game_over');
        }
      } else if (!c.alive && c.removalReady) {
        c.destroy(this.renderer.scene);
        this.creeps.splice(i, 1);
      }
    }

    // Update Subsystems
    this.particles.update(dt);
    this.announcer.update(realDt);
    this.camera.update(realDt);
    this.renderer.update(realDt, this.waveManager.inWave ? 0.8 : 0.0);

    // Update Jumbotron display with current wave
    const currentWave = this.waveManager.getCurrentWave();
    if (currentWave) {
      this.arena.updateJumbotron(
        "POKÉMON STADIUM",
        currentWave.cupName,
        currentWave.round
      );
    }

    // Update UI
    this.ui.update(
      {
        money: this.money,
        lives: this.lives,
        cupName: currentWave?.cupName || 'POKE CUP',
        round: currentWave?.round || 1,
        inWave: this.waveManager.inWave,
        intermissionTimer: this.waveManager.intermissionTimer,
        gameSpeed: this.gameSpeed,
        cameraMode: this.camera.mode,
        selectedTower: this.selectedTower,
        selectedTemplate: this.selectedTemplate,
        placementStatus: this.placementStatus,
      }
    );
  }

  /** Everything the shared hit resolver needs to apply a move and react to it. */
  private hitContext(): HitContext {
    return {
      creeps: this.creeps,
      particles: this.particles,
      audio: this.audio,
      announcer: this.announcer,
      onFaint: (creep) => this.handleCreepDefeat(creep),
    };
  }

  private handleCreepDefeat(creep: Creep): void {
    this.money += creep.reward;
    this.particles.emitImpact(creep.position, 0xffd700, 20, 6);

    if (creep.isBoss) {
      this.announcer.trigger('boss_defeat');
      this.audio.playFanfare();
      this.camera.shake(0.8);
    } else if (Math.random() < 0.25) {
      this.announcer.trigger('creep_faint');
    }
  }

  public render(): void {
    this.renderer.render(this.camera.camera);
  }
}
