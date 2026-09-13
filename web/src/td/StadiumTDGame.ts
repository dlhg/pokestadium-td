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
  TARGET_PRIORITIES,
  TOWER_FOOTPRINT_RADIUS,
  TOWER_BASE_HEIGHT,
  highGroundRangeScale,
} from './Tower';
import { LANE_RIDE_HEIGHT } from './MapTerrain';
import { Creep } from './Creep';
import { Projectile } from './Projectile';
import { WaveManager, getMilestone } from './WaveManager';
import { MOVES } from '../stadium/MoveDatabase';
import { HitContext, playInstantDelivery, resolveMoveHit } from './MoveDelivery';
import { DEFAULT_STADIUM_MAP, type StadiumMap } from './MapCatalog';
import { BallType, CaptureSequence } from './CaptureSequence';
import { EvolutionSequence } from './EvolutionSequence';
import { setCinemaDim } from '../engine/CinemaDim';
import { speciesForCreepName } from './progression/Species';
import { createPokemon, displayName, OwnedPokemon, speciesOf, TrainerStore } from './progression/TrainerStore';
import { MatchProgress, XpAward } from './progression/MatchProgress';

/** Everything that can veto dropping the armed tower under the cursor. */
type PlacementBlockReason =
  | Exclude<BuildBlockReason, null>
  | 'overlaps_tower'
  | 'already_deployed'
  | 'too_expensive';

const PLACEMENT_BLOCK_LABELS: Record<PlacementBlockReason, string> = {
  too_expensive: 'NOT ENOUGH PRIZE MONEY',
  out_of_bounds: 'OUTSIDE THE ARENA',
  on_lane: 'TOO CLOSE TO THE LANE',
  restricted: 'NO-BUILD ZONE',
  water: 'WATER · PLACE ON THE BANK',
  too_steep: 'TOO STEEP · FIND LEVEL GROUND',
  overlaps_tower: 'ANOTHER POKÉMON IS THERE',
  already_deployed: 'ALREADY ON THE FIELD',
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
  public store!: TrainerStore;
  private progress!: MatchProgress;

  // Economy & Lives
  public money: number = 420;
  public lives: number = 6;
  public balls: Record<BallType, number> = { poke: 3, great: 0, ultra: 0 };
  public gameSpeed: number = 1.0;
  public isPaused: boolean = false;
  public gameOver: boolean = false;
  public victory: boolean = false;
  public map: StadiumMap = DEFAULT_STADIUM_MAP;
  public isChoosingMap = true;
  private pauseMenuOpen = false;

  // Entities
  public towers: Tower[] = [];
  public creeps: Creep[] = [];
  public projectiles: Projectile[] = [];

  /** The team this match was started with, plus anything caught during it. */
  public roster: OwnedPokemon[] = [];
  /** True from a match's first frame until its XP and records are banked. */
  private matchActive = false;
  /** The nickname prompt holds the match; only it may release the pause it took. */
  private namingHold = false;
  /** Dev panel: every throw catches. */
  public devAlwaysCatch = false;

  // Selection states
  public selectedMember: OwnedPokemon | null = null;
  public selectedTower: Tower | null = null;
  private placementPreview: THREE.Group = new THREE.Group();
  private placementPreviewTemplateId: string | null = null;
  private placementStatus: PlacementStatus | null = null;
  private selectedBall: BallType | null = null;
  private captureHint: string | null = null;
  private capture: { sequence: CaptureSequence; target: Creep; ball: BallType } | null = null;
  private evolution: { sequence: EvolutionSequence } | null = null;
  /** Queued so simultaneous evolutions (a multi-way knockout) play one at a time. */
  private evolutionQueue: { tower: Tower; fromName: string; toName: string }[] = [];
  private cinemaDim = 0;
  private cinemaDimApplied = false;
  private cinemaFades = new Map<THREE.Object3D, number>();
  private readonly shotBounds = new THREE.Box3();
  private readonly shotHit = new THREE.Vector3();

  public init(canvas: HTMLCanvasElement, uiContainer: HTMLElement, store: TrainerStore): void {
    this.store = store;
    this.progress = new MatchProgress(store);
    this.renderer = new StadiumRenderer(canvas);
    this.camera = new StadiumCamera();
    this.audio = new StadiumAudio();
    this.particles = new ParticleSystem();
    this.arena = new StadiumArena(this.map);
    this.announcer = new StadiumAnnouncer();

    this.renderer.scene.add(this.arena.group);
    this.renderer.scene.add(this.particles.group);
    this.placementPreview.visible = false;
    this.renderer.scene.add(this.placementPreview);

    this.waveManager = new WaveManager(this.arena.routes, this.announcer, this.map.difficulty);
    this.ui = new StadiumUI(uiContainer, this.announcer, this.camera, store);

    this.bindUIEvents();

  }

  private bindUIEvents(): void {
    this.ui.onOpenMaps = () => {
      this.clearSelection();
      this.isChoosingMap = true;
      // A lost match has nothing to resume.
      this.ui.setMapSelectVisible(true, !this.gameOver);
    };
    this.ui.onRetryMap = () => this.loadMap(this.map);
    this.ui.onResumeMap = () => { this.isChoosingMap = false; };
    this.ui.onResumeGame = () => {
      this.pauseMenuOpen = false;
      this.isPaused = false;
      this.ui.setPauseVisible(false);
      this.audio.playSelect();
    };
    this.ui.onQuitToMenu = () => {
      const report = this.finishMatch();
      this.clearSelection();
      this.selectedBall = null;
      this.captureHint = null;
      this.pauseMenuOpen = false;
      this.isPaused = true;
      this.ui.setPauseVisible(false);
      this.isChoosingMap = true;
      this.ui.showMatchReport(report, this.map.name, () => this.ui.setMapSelectVisible(true, false));
      this.audio.playSelect();
    };
    this.ui.onSelectMap = (map) => this.loadMap(map);
    this.ui.onSelectMember = (member) => {
      if (this.selectedTower) {
        this.selectedTower.setSelected(false);
        this.selectedTower = null;
      }
      this.selectedMember = member;
      this.placementPreviewTemplateId = null;
      this.placementPreview.visible = false;
      this.audio.playSelect();
    };
    this.ui.onSelectBall = (ball) => {
      this.clearSelection();
      this.selectedBall = ball;
      this.captureHint = ball ? `CAPTURE MODE · CLICK A GOLD CATCH! RING · ESC TO CANCEL` : null;
      this.audio.playSelect();
    };
    this.ui.onBuyBall = (ball) => {
      const cost: Record<BallType, number> = { poke: 35, great: 85, ultra: 170 };
      if (this.waveManager.inWave || this.money < cost[ball]) return;
      this.money -= cost[ball];
      this.balls[ball]++;
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
      if (!this.waveManager.inWave && !this.pauseMenuOpen && !this.namingHold) {
        // Space can pause without opening the pause sheet. Starting a match is
        // an explicit request to resume play, otherwise the HUD says the match
        // is running while the spawn queue remains frozen indefinitely.
        this.isPaused = false;
        this.waveManager.startNextWave();
        this.audio.playSelect();
        this.audio.startMusic();
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

  public loadMap(map: StadiumMap): void {
    this.finishMatch();
    this.map = map;
    this.clearSelection();
    this.towers.forEach(tower => this.renderer.scene.remove(tower.group));
    this.creeps.forEach(creep => creep.destroy(this.renderer.scene));
    this.projectiles.forEach(projectile => projectile.destroy(this.renderer.scene));
    this.towers = [];
    this.creeps = [];
    this.projectiles = [];
    this.renderer.scene.remove(this.arena.group);
    this.arena.dispose();
    this.arena = new StadiumArena(map);
    this.renderer.scene.add(this.arena.group);
    this.waveManager = new WaveManager(this.arena.routes, this.announcer, this.map.difficulty);
    this.money = 420;
    this.lives = 6;
    // A brand-new trainer gets extra balls to build a team with.
    this.balls = { poke: this.store.data.matchesPlayed === 0 ? 5 : 3, great: 0, ultra: 0 };
    this.selectedBall = null;
    this.captureHint = null;
    this.abortCapture();
    this.abortEvolution();
    this.roster = [...this.store.team];
    this.roster.forEach(member => member.record.matches++);
    this.progress.start(this.roster);
    this.store.data.matchesPlayed++;
    this.store.commit();
    this.matchActive = true;
    this.ui.setRoster(this.roster);
    this.gameOver = false;
    this.victory = false;
    this.ui.hideDefeat();
    this.pauseMenuOpen = false;
    this.ui.setPauseVisible(false);
    this.isPaused = false;
    this.isChoosingMap = false;
    this.gameSpeed = 1;
    this.camera.setMode('tactical');
    this.particles.update(60);
    this.ui.setMapSelectVisible(false);
    this.audio.playSelect();
    this.announcer.trigger('battle_start');
  }

  /**
   * Banks the match: course record, XP already applied to the owned Pokémon,
   * and a save. Idempotent, so every exit path can call it. Returns the report.
   */
  private finishMatch() {
    if (!this.matchActive) return [];
    this.matchActive = false;
    // The wave index only advances on a clear, so it is the count of rounds won.
    this.store.recordMap(this.map.id, this.waveManager.currentWaveIndex, this.victory);
    this.store.commit();
    return this.progress.report();
  }

  /** Saves progress mid-match without ending it — page hide, dev tools. */
  public saveProgress(): void {
    this.store.commit();
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
    if (input.isKeyJustPressed('Space') && !this.pauseMenuOpen) this.isPaused = !this.isPaused;
    if (input.isKeyJustPressed('Escape')) {
      if (this.pauseMenuOpen) {
        this.ui.onResumeGame();
        return;
      }
      const dismissedSelection = Boolean(this.selectedMember || this.selectedTower || this.selectedBall);
      this.clearSelection();
      this.selectedBall = null;
      this.captureHint = null;
      if (!dismissedSelection) {
        this.pauseMenuOpen = true;
        this.isPaused = true;
        this.ui.setPauseVisible(true);
      }
      return;
    }
    if (input.rightClicked) {
      this.clearSelection();
      this.selectedBall = null;
      this.captureHint = null;
    }

    // Free placement: the cursor's spot on the pitch is the candidate site.
    const ground = this.arena.terrain.raycast(input.pointerRay(this.camera.camera));

    if (this.selectedBall) {
      if (input.clicked && !input.clickedOnUI) this.tryCapture(this.pickCreep(input, ground));
      return;
    }

    // An armed Pokémon owns the cursor — clicks drop it, never select a tower.
    if (this.selectedMember) {
      this.updatePlacement(this.selectedMember, ground, input);
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
    this.selectedMember = null;
    this.placementStatus = null;
    this.placementPreview.visible = false;
  }

  private pickCreep(input: Input, ground: THREE.Vector3 | null): Creep | null {
    const hit = input.raycast(this.camera.camera, this.creeps.map(creep => creep.group));
    for (const intersection of hit) {
      for (let node: THREE.Object3D | null = intersection.object; node; node = node.parent) {
        const creep = this.creeps.find(candidate => candidate.group === node);
        if (creep) return creep;
      }
    }
    if (!ground) return null;
    const nearby = this.creeps.filter(c => c.alive && !c.captureLocked && c.position.distanceToSquared(ground) <= 5.1);
    return nearby.sort((a, b) => a.position.distanceToSquared(ground) - b.position.distanceToSquared(ground))[0] ?? null;
  }

  /**
   * Everything that is not the capture target fades into the dark for the
   * duration of the cutscene, then comes back exactly as it was. Bystanders are
   * darkened rather than hidden so they never teleport when the lights return.
   */
  private updateCinemaDim(realDt: number): void {
    const target = this.capture?.target ?? null;
    this.cinemaDim = target
      ? Math.min(0.85, this.cinemaDim + realDt * 2.6)
      : Math.max(0, this.cinemaDim - realDt * 2.2);
    if (this.cinemaDim === 0 && !this.cinemaDimApplied) return;

    const eye = this.camera.camera.position;
    const subject = target ? target.position.clone().add(new THREE.Vector3(0, 0.1, 0)) : null;
    const bystanders = [
      ...this.creeps.filter(creep => creep !== target).map(creep => creep.group),
      ...this.towers.map(tower => tower.group),
    ];
    const sightline = subject ? new THREE.Ray(eye.clone(), subject.clone().sub(eye).normalize()) : null;
    const sightDistance = subject ? subject.distanceTo(eye) : 0;
    bystanders.forEach(root => {
      const blocking = sightline ? this.blocksShot(root, sightline, sightDistance) : false;
      const fade = THREE.MathUtils.damp(this.cinemaFades.get(root) ?? 0, blocking ? 1 : 0, 8, realDt);
      this.cinemaFades.set(root, fade);
      setCinemaDim(root, this.cinemaDim, fade * (this.cinemaDim / 0.85));
    });
    if (target) setCinemaDim(target.group, 0);
    this.cinemaDimApplied = this.cinemaDim > 0;
    if (!this.cinemaDimApplied) this.cinemaFades.clear();
  }

  /**
   * True when a bystander's body crosses the sightline from the camera to the
   * subject. Tested against the model's bounds rather than its origin, since a
   * long-bodied titan can lie across the shot with its root well clear of it.
   */
  private blocksShot(root: THREE.Object3D, sightline: THREE.Ray, sightDistance: number): boolean {
    this.shotBounds.setFromObject(root).expandByScalar(0.25);
    if (this.shotBounds.containsPoint(sightline.origin)) return true;
    const hit = sightline.intersectBox(this.shotBounds, this.shotHit);
    // Anything level with or behind the subject cannot block it.
    return hit !== null && hit.distanceTo(sightline.origin) < sightDistance - 0.6;
  }

  /** The capture set piece currently on screen, if any. */
  public get activeCapture(): CaptureSequence | null {
    return this.capture?.sequence ?? null;
  }

  /** Public so the headless shot harness can stage an evolution set piece. */
  public forceEvolution(tower: Tower, fromName: string, toName: string): void {
    this.evolutionQueue.push({ tower, fromName, toName });
    this.pumpEvolutionQueue();
  }

  /** Tears down an evolution set piece in progress, and drops anything still queued. */
  private abortEvolution(): void {
    if (this.evolution) {
      this.evolution.sequence.dispose(this.renderer.scene);
      this.evolution = null;
    }
    this.evolutionQueue = [];
  }

  /** Tears down a set piece in progress, returning the camera and the house lights. */
  private abortCapture(): void {
    if (this.capture) {
      this.capture.sequence.dispose(this.renderer.scene);
      this.capture.target.cancelCapture();
      this.capture = null;
    }
    this.renderer.floodlightDim = 0;
  }

  /** Public so the headless shot harness can stage a capture set piece. */
  public tryCapture(target: Creep | null): void {
    const ball = this.selectedBall;
    // A fainted Pokemon remains in the scene for its defeat animation, but it
    // is no longer a legal capture target and must not consume a ball.
    if (!ball || !target || !target.alive || target.captureLocked) return;
    if (target.hpFraction > 0.35) {
      this.captureHint = `WEAKEN ${target.name.toUpperCase()} UNTIL ITS HP BAR SAYS CATCH!`;
      return;
    }
    if (this.balls[ball] <= 0) return;
    this.balls[ball]--;
    const ballBonus: Record<BallType, number> = { poke: 0, great: 0.20, ultra: 0.42 };
    const statusBonus = target.status === 'stun' || target.status === 'freeze' ? 0.22 : target.status !== 'none' ? 0.12 : 0;
    const rarityPenalty = target.threat === 'titan' ? 0.42 : target.threat === 'elite' ? 0.18 : 0;
    // Trainer's luck: every miss since the last catch sweetens the next throw.
    const luck = this.store.captureLuckBonus;
    const chance = THREE.MathUtils.clamp(0.28 + (1 - target.hpFraction) * 0.45 + ballBonus[ball] + statusBonus - rarityPenalty + luck, 0.08, 0.95);
    const ballsLeft = this.balls.poke + this.balls.great + this.balls.ultra;
    const guaranteed = this.devAlwaysCatch || this.store.shouldGuaranteeCatch(ballsLeft, target.threat);
    target.beginCapture();
    const sequence = new CaptureSequence(target, ball, chance, {
      particles: this.particles,
      camera: this.camera,
      audio: this.audio,
      announcer: this.announcer,
      arena: this.arena,
    }, guaranteed);
    this.renderer.scene.add(sequence.group);
    this.capture = { sequence, target, ball };
    this.selectedBall = null;
    // The cinematic overlay carries the read-out from here; the corner hint returns with the verdict.
    this.captureHint = null;
  }

  private finishCapture(success: boolean, target: Creep, ball: BallType): void {
    if (success) {
      this.renderer.scene.remove(target.group);
      this.creeps = this.creeps.filter(creep => creep !== target);
      target.destroy(this.renderer.scene);
      this.store.data.captureLuck = 0;
      const caught = this.addCaughtPokemon(target, ball);
      this.store.commit();
      this.money += Math.ceil(target.reward * 1.5);
      this.captureHint = `CAUGHT ${target.name.replace(/^Titan /, '').toUpperCase()}! READY TO DEPLOY`;
      this.announcer.trigger('capture_success', target.name);
      this.audio.playFanfare();
      if (caught) this.promptNickname(caught);
    } else {
      this.store.data.captureLuck++;
      this.store.commit();
      target.cancelCapture();
      this.captureHint = `${target.name.toUpperCase()} BROKE FREE!`;
      this.announcer.trigger('capture_failed', target.name);
      this.audio.playHit(false);
    }
  }

  /** The catch joins the collection for good and can be deployed this match as a bonus slot. */
  private addCaughtPokemon(creep: Creep, ball: BallType): OwnedPokemon | null {
    const match = speciesForCreepName(creep.name);
    if (!match) return null;
    const pokemon = createPokemon(match.speciesId, creep.level, {
      kind: 'caught', mapId: this.map.id, round: this.waveManager.round, ball, at: Date.now(),
    }, { stage: match.stage });
    this.store.add(pokemon);
    this.roster.push(pokemon);
    this.progress.track(pokemon, true);
    this.ui.setRoster(this.roster);
    return pokemon;
  }

  /** The trophy card asks for a nickname; the match waits for the answer. */
  private promptNickname(pokemon: OwnedPokemon): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.namingHold = true;
    }
    this.ui.showCaptureTrophy(pokemon, (name) => {
      if (name !== null) this.store.rename(pokemon.uid, name);
      this.ui.setRoster(this.roster);
      if (this.namingHold) {
        this.namingHold = false;
        this.isPaused = false;
      }
    });
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
    member: OwnedPokemon,
    ground: THREE.Vector3 | null,
    input: Input,
  ): void {
    if (!ground) {
      this.placementPreview.visible = false;
      this.placementStatus = { valid: false, label: PLACEMENT_BLOCK_LABELS.out_of_bounds };
      return;
    }

    const blocked = this.getPlacementBlock(member, ground.x, ground.z);
    this.placementStatus = blocked
      ? { valid: false, label: PLACEMENT_BLOCK_LABELS[blocked] }
      : { valid: true, label: `PLACE ${displayName(member).toUpperCase()}${this.highGroundNote(ground)} · ESC TO CANCEL` };

    this.updatePlacementPreview(member, ground, !blocked);

    if (input.clicked && !input.clickedOnUI && !blocked) {
      this.placeTower(member, ground);
    }
  }

  private getPlacementBlock(
    member: OwnedPokemon,
    x: number,
    z: number,
  ): PlacementBlockReason | null {
    // One tower per owned Pokémon: two Pikachu towers means catching two Pikachu.
    if (this.isDeployed(member)) return 'already_deployed';
    if (this.money < speciesOf(member).deployCost) return 'too_expensive';

    const arenaBlock = this.arena.isBuildable(x, z, TOWER_FOOTPRINT_RADIUS);
    if (arenaBlock) return arenaBlock;

    const crowded = this.towers.some(t =>
      Math.hypot(t.position.x - x, t.position.z - z) < TOWER_FOOTPRINT_RADIUS * 2
    );
    return crowded ? 'overlaps_tower' : null;
  }

  public isDeployed(member: OwnedPokemon): boolean {
    return this.towers.some(tower => tower.pokemon === member);
  }

  private placeTower(member: OwnedPokemon, ground: THREE.Vector3): void {
    const position = new THREE.Vector3(ground.x, this.padHeight(ground.x, ground.z), ground.z);
    this.money -= speciesOf(member).deployCost;

    const tower = new Tower(member, position);
    this.renderer.scene.add(tower.group);
    this.towers.push(tower);

    this.audio.playDeploy();
    this.particles.emitImpact(position, 0x00f0ff, 25, 5);

    // Select the freshly placed tower so its move shop opens immediately.
    if (this.selectedTower) this.selectedTower.setSelected(false);
    this.selectedTower = tower;
    tower.setSelected(true);

    this.selectedMember = null;
    this.placementStatus = null;
    this.placementPreview.visible = false;
  }

  /** A pad rests on the highest ground under its footprint; its footing fills the rest. */
  private padHeight(x: number, z: number): number {
    return this.arena.terrain.footprint(x, z, TOWER_FOOTPRINT_RADIUS).high + TOWER_BASE_HEIGHT;
  }

  /** Tells the player what a raised site is worth against the lowest stretch of lane. */
  private highGroundNote(point: THREE.Vector3): string {
    if (this.arena.terrain.flat) return '';
    const laneFloor = Math.min(...this.arena.routes.flat().map(p => p.y - LANE_RIDE_HEIGHT));
    const bonus = Math.round((highGroundRangeScale(this.padHeight(point.x, point.z) - TOWER_BASE_HEIGHT, laneFloor) - 1) * 100);
    return bonus >= 5 ? ` · HIGH GROUND +${bonus}% RANGE BELOW` : '';
  }

  private updatePlacementPreview(
    member: OwnedPokemon,
    point: THREE.Vector3,
    valid: boolean,
  ): void {
    const color = valid ? 0x00f0ff : 0xd90429;
    if (this.placementPreviewTemplateId !== member.uid) {
      this.placementPreview.clear();
      const range = MOVES[speciesOf(member).lines[0].tiers[0].moveId].range;

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
      this.placementPreviewTemplateId = member.uid;
    }

    this.placementPreview.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
        object.material.color.setHex(color);
      }
    });
    // Same clearance as the tower range ring: above the lane ribbon at y = 0.5.
    this.placementPreview.position.set(point.x, this.padHeight(point.x, point.z) + 0.35, point.z);
    this.placementPreview.visible = true;
  }

  public update(realDt: number, input: Input): void {
    if (this.isChoosingMap) {
      this.camera.update(realDt);
      this.renderer.update(realDt, 0);
      return;
    }
    if (this.gameOver) {
      // The simulation stops, but the lights, camera and any capture dim still settle.
      this.renderer.floodlightDim = Math.max(0, this.renderer.floodlightDim - realDt * 1.5);
      this.updateCinemaDim(realDt);
      this.announcer.update(realDt);
      this.camera.update(realDt);
      this.renderer.update(realDt, 0);
      return;
    }

    this.camera.handleInput(input, realDt);
    // A capture set piece owns the screen: no placing, selling, or selecting
    // mid-throw. The one input it does take is the throw itself.
    if (this.capture) {
      if (this.capture.sequence.awaitingRelease && (input.clicked || input.isKeyJustPressed('Space'))) {
        this.capture.sequence.release();
      }
    } else if (!this.evolution) {
      this.handleInput(input);
    }

    // A capture or evolution set piece runs in real time while it drags the
    // rest of the world into slow motion. At most one of these is ever
    // active, but multiplying both scales is harmless if that ever changes.
    const captureScale = this.capture ? this.capture.sequence.worldTimeScale : 1;
    const evolutionScale = this.evolution ? this.evolution.sequence.worldTimeScale : 1;
    const dt = this.isPaused ? 0 : realDt * this.gameSpeed * captureScale * evolutionScale;

    // Update Wave Manager
    if (dt > 0) this.waveManager.update(
      dt,
      this.creeps,
      (newCreep) => {
        this.renderer.scene.add(newCreep.group);
        this.creeps.push(newCreep);
      },
      (round) => this.handleRoundCleared(round)
    );

    // Update Towers
    this.towers.forEach(tower => {
      tower.update(dt, this.creeps, (t, target, move) => {
        // Fire attack!
        this.audio.playAttack(move.fxType);

        if (move.delivery === 'projectile') {
          this.projectiles.push(new Projectile(move, t.position, target, this.renderer.scene, t));
          return;
        }

        // Every other archetype lands the moment it is fired: draw the
        // delivery, then resolve the hit once at the target.
        playInstantDelivery(move, t.position, target, this.particles, this.camera);
        resolveMoveHit(move, target, this.hitContext(), t);
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
          this.abortCapture();
          this.abortEvolution();
          this.clearSelection();
          const report = this.finishMatch();
          this.ui.showDefeat(this.map.name, this.waveManager.round, this.waveManager.winRound, report);
        }
      } else if (!c.alive && c.removalReady) {
        c.destroy(this.renderer.scene);
        this.creeps.splice(i, 1);
      }
    }

    this.renderer.floodlightDim = this.capture
      ? this.capture.sequence.floodlightDim
      : this.evolution
      ? this.evolution.sequence.floodlightDim
      : Math.max(0, this.renderer.floodlightDim - realDt * 1.5);
    this.updateCinemaDim(realDt);

    if (this.capture) {
      const result = this.capture.sequence.update(realDt);
      if (result !== null) {
        const activeCapture = this.capture;
        this.capture = null;
        activeCapture.sequence.dispose(this.renderer.scene);
        this.finishCapture(result, activeCapture.target, activeCapture.ball);
      }
    }

    if (this.evolution) {
      const done = this.evolution.sequence.update(realDt);
      if (done) {
        this.evolution.sequence.dispose(this.renderer.scene);
        this.evolution = null;
      }
    }
    this.pumpEvolutionQueue();

    // Update Subsystems
    this.particles.update(dt);
    this.announcer.update(realDt);
    this.camera.update(realDt);
    this.arena.update(performance.now() * 0.001, this.camera.camera.position, realDt);
    this.renderer.update(realDt, this.waveManager.inWave ? 0.8 : 0.0);

    // Update Jumbotron display with current wave
    const currentWave = this.waveManager.getCurrentWave();
    if (this.capture) {
      const hud = this.capture.sequence.hud;
      this.arena.updateJumbotron(hud.targetName, 'CAPTURE ATTEMPT', hud.wobbles);
    } else if (this.evolution) {
      this.arena.updateJumbotron(this.evolution.sequence.hud.toName, 'EVOLUTION', currentWave.round);
    } else {
      this.arena.updateJumbotron(
        this.map.name.toUpperCase(),
        currentWave.cupName,
        currentWave.round
      );
    }

    // Update UI
    this.ui.update(
      {
        money: this.money,
        lives: this.lives,
        balls: this.balls,
        selectedBall: this.selectedBall,
        captureHint: this.captureHint,
        captureCinema: this.capture?.sequence.hud ?? null,
        evolutionCinema: this.evolution?.sequence.hud ?? null,
        cupName: currentWave.cupName,
        round: currentWave.round,
        winRound: this.waveManager.winRound,
        freeplay: this.waveManager.isFreeplay,
        inWave: this.waveManager.inWave,
        intermissionTimer: this.waveManager.intermissionTimer,
        gameSpeed: this.gameSpeed,
        cameraMode: this.camera.mode,
        selectedTower: this.selectedTower,
        selectedMember: this.selectedMember,
        deployed: new Set(this.towers.map(tower => tower.pokemon.uid)),
        placementStatus: this.placementStatus,
        mapName: this.map.name,
        mapStrategy: this.map.strategy,
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

  /** Milestone payouts, and the win itself — which never stops the run. */
  private handleRoundCleared(round: number): void {
    this.applyXp(this.progress.awardWaveClear(this.towers));
    // Autosave per wave: closing the tab loses at most the wave in progress.
    this.store.recordMap(this.map.id, round, round >= this.waveManager.winRound);
    this.store.commit();

    const milestone = getMilestone(round, this.waveManager.winRound);
    if (milestone) {
      this.money += milestone.money;
      for (const [ball, count] of Object.entries(milestone.balls) as [BallType, number][]) {
        this.balls[ball] += count;
      }
      this.ui.showMilestone(milestone);
    }

    if (round === this.waveManager.winRound) {
      this.victory = true;
      this.announcer.trigger('victory');
      this.audio.playFanfare();
      this.camera.shake(0.6);
    } else if (milestone) {
      this.audio.playFanfare();
    }
  }

  private handleCreepDefeat(creep: Creep): void {
    this.money += creep.reward;
    this.applyXp(this.progress.awardKnockout(creep, this.towers));
    this.particles.emitImpact(creep.position, 0xffd700, 20, 6);

    if (creep.threat === 'titan') {
      this.announcer.trigger('boss_defeat');
      this.audio.playFanfare();
      this.camera.shake(0.8);
    } else if (creep.threat === 'elite') {
      this.announcer.trigger('elite_defeat', creep.name);
      this.camera.shake(0.35);
    } else if (Math.random() < 0.25) {
      this.announcer.trigger('creep_faint');
    }
  }

  /** Level-ups flash on the tower; evolutions queue the cinematic set piece. */
  private applyXp(awards: XpAward[]): void {
    for (const { tower, result } of awards) {
      if (result.levelsGained <= 0) continue;
      if (tower.syncProgress(true)) {
        this.evolutionQueue.push({ tower, fromName: result.evolvedFrom!, toName: tower.formName });
        this.announcer.trigger('tower_evolve', (tower.pokemon.nickname ?? result.evolvedFrom!).toUpperCase());
      } else {
        const lift = tower.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        this.particles.emitImpact(lift, 0xffd700, 16, 4);
        this.announcer.trigger('level_up', `${tower.name.toUpperCase()} GREW TO LV ${tower.level}`);
      }
    }
  }

  /** Starts the next queued evolution once the pitch is clear for one. */
  private pumpEvolutionQueue(): void {
    if (this.evolution || this.evolutionQueue.length === 0) return;
    const { tower, fromName, toName } = this.evolutionQueue.shift()!;
    const sequence = new EvolutionSequence(tower, fromName, toName, {
      particles: this.particles,
      camera: this.camera,
      audio: this.audio,
      announcer: this.announcer,
      arena: this.arena,
    });
    this.renderer.scene.add(sequence.group);
    this.evolution = { sequence };
  }

  /** Re-reads every placed tower's owned Pokémon after an out-of-band change (dev panel). */
  public syncTowers(): void {
    this.towers.forEach(tower => tower.syncProgress());
    this.ui.setRoster(this.roster);
  }

  public get inMatch(): boolean {
    return this.matchActive;
  }

  public render(): void {
    this.renderer.render(this.camera.camera);
  }
}
