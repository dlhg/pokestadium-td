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
import { StadiumArena, PedestalSlot } from '../stadium/StadiumArena';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumUI } from './StadiumUI';
import { Tower, TowerTemplate } from './Tower';
import { Creep } from './Creep';
import { Projectile } from './Projectile';
import { WaveManager } from './WaveManager';
import { getCombinedEffectiveness } from '../stadium/TypeMatrix';
import { MOVES } from '../stadium/MoveDatabase';

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
  private hoveredPedestal: PedestalSlot | null = null;
  private placementPreview: THREE.Group = new THREE.Group();
  private placementPreviewTemplateId: string | null = null;

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

    this.ui.onUpgradeTower = (tower) => {
      const cost = tower.getUpgradeCost();
      if (cost !== null && this.money >= cost) {
        this.money -= cost;
        const prevName = tower.name;
        tower.upgrade();
        this.audio.playDeploy();
        this.camera.shake(0.2);

        if (tower.level === 3) {
          this.announcer.trigger('tower_evolve', `${prevName} into ${tower.name}`);
        }
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

    this.ui.onChangeTargetPriority = (tower) => {
      const modes: ('first' | 'last' | 'strongest' | 'weakest')[] = ['first', 'strongest', 'weakest', 'last'];
      const nextIdx = (modes.indexOf(tower.targetPriority) + 1) % modes.length;
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
    const ped = this.arena.pedestals.find(p => p.id === tower.pedestalId);
    if (ped) {
      ped.occupied = false;
      ped.towerId = null;
    }
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
      if (this.selectedTower) {
        this.selectedTower.setSelected(false);
        this.selectedTower = null;
      }
      this.selectedTemplate = null;
      this.placementPreview.visible = false;
    }

    // Raycast pedestals for placement & selection
    const intersects = input.raycast(this.camera.camera, this.arena.pedestalMeshes);

    let currentPed: PedestalSlot | null = null;
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const pedId = hit.userData.pedestalId;
      currentPed = this.arena.pedestals.find(p => p.id === pedId) || null;
    }

    // Pedestal highlight logic
    if (this.hoveredPedestal && this.hoveredPedestal !== currentPed) {
      this.arena.setPedestalHighlight(this.hoveredPedestal.id, false);
      this.hoveredPedestal = null;
    }

    if (currentPed) {
      this.hoveredPedestal = currentPed;
      const canAfford = this.selectedTemplate ? this.money >= this.selectedTemplate.cost : true;
      const color = !currentPed.occupied ? (canAfford ? 0x00f0ff : 0xd90429) : 0xffd700;
      this.arena.setPedestalHighlight(currentPed.id, true, color);
      this.updatePlacementPreview(currentPed);

      // Handle Click on Pedestal
      if (input.clicked && !input.clickedOnUI) {
        if (!currentPed.occupied && this.selectedTemplate) {
          // Place Tower!
          if (this.money >= this.selectedTemplate.cost) {
            this.money -= this.selectedTemplate.cost;
            const tower = new Tower(this.selectedTemplate, currentPed.id, currentPed.position);
            this.renderer.scene.add(tower.group);
            this.towers.push(tower);

            currentPed.occupied = true;
            currentPed.towerId = tower.id;

            this.audio.playDeploy();
            this.particles.emitImpact(currentPed.position, 0x00f0ff, 25, 5);

            // Select placed tower
            if (this.selectedTower) this.selectedTower.setSelected(false);
            this.selectedTower = tower;
            tower.setSelected(true);

            this.selectedTemplate = null;
            this.placementPreview.visible = false;
          }
        } else if (currentPed.occupied && currentPed.towerId) {
          // Select existing tower
          const existing = this.towers.find(t => t.id === currentPed!.towerId);
          if (existing) {
            if (this.selectedTower) this.selectedTower.setSelected(false);
            this.selectedTower = existing;
            existing.setSelected(true);
            this.selectedTemplate = null;
            this.placementPreview.visible = false;
            this.audio.playSelect();
          }
        }
      }
    } else {
      this.placementPreview.visible = false;
    }

    if (!currentPed && input.clicked && !input.clickedOnUI) {
      // Clicked on empty space
      if (this.selectedTower) {
        this.selectedTower.setSelected(false);
        this.selectedTower = null;
      }
    }
  }

  private updatePlacementPreview(pedestal: PedestalSlot): void {
    const template = this.selectedTemplate;
    if (!template || pedestal.occupied) {
      this.placementPreview.visible = false;
      return;
    }

    const canAfford = this.money >= template.cost;
    const color = canAfford ? 0x00f0ff : 0xd90429;
    if (this.placementPreviewTemplateId !== template.id) {
      this.placementPreview.clear();
      const range = MOVES[template.initialMoveId].range;

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
        new THREE.RingGeometry(1.35, 1.65, 32),
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
    this.placementPreview.position.set(pedestal.position.x, 0.84, pedestal.position.z);
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
      tower.update(dt, this.creeps, (t, target) => {
        // Fire attack!
        this.audio.playAttack(t.currentMove.fxType);

        if (t.currentMove.fxType === 'hyper_beam') {
          // Instant beam attack
          const start = t.position.clone().add(new THREE.Vector3(0, 1.5, 0));
          const end = target.position.clone().add(new THREE.Vector3(0, 1.0, 0));
          this.particles.emitBeam(start, end, 0xffffff, 0.6, 0.35);
          this.camera.triggerActionCam(target.position, 1.6);
          const multiplier = getCombinedEffectiveness(t.currentMove.type, target.types);
          const died = target.takeDamage(Math.floor(t.currentMove.basePower * multiplier));
          if (died) this.handleCreepDefeat(target);
          this.audio.playHit(multiplier >= 2);
          if (multiplier >= 2) this.announcer.trigger('super_effective');
        } else {
          // Projectile attack
          const proj = new Projectile(t.currentMove, t.position, target, this.renderer.scene);
          this.projectiles.push(proj);
        }
      });
    });

    // Update Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const stillActive = p.update(
        dt,
        this.creeps,
        this.particles,
        this.audio,
        this.announcer,
        (deadCreep) => this.handleCreepDefeat(deadCreep)
      );
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
    let screenPos: { x: number; y: number; visible: boolean } | undefined;
    if (this.selectedTower) {
      screenPos = this.renderer.toScreenXY(this.selectedTower.position, this.camera.camera);
    }

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
      },
      screenPos
    );
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
