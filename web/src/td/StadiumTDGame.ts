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
import { StadiumUI, type CatchSlot, type PlacementStatus, type SignatureSlot } from './StadiumUI';
import {
  Tower,
  TARGET_PRIORITIES,
  TOWER_FOOTPRINT_RADIUS,
  TOWER_BASE_HEIGHT,
  highGroundRangeScale,
} from './Tower';
import { LANE_RIDE_HEIGHT } from './MapTerrain';
import { Creep, type CreepTrait } from './Creep';
import { Projectile } from './Projectile';
import { Hazard } from './Hazard';
import {
  castSignature, SIGNATURES, signatureLineReach, signatureRadius, signatureTargeting, type SignatureContext,
} from './Signatures';
import { WaveManager, getMilestone } from './WaveManager';
import { MOVES } from '../stadium/MoveDatabase';
import { TYPE_COLORS } from '../stadium/TypeMatrix';
import { HitContext, hitExtrasFor, moveGeometry, playInstantDelivery, resolveMoveHit } from './MoveDelivery';
import { DEFAULT_STADIUM_MAP, type StadiumMap } from './MapCatalog';
import { BALL_ORDER, BALL_PRICES, BallType, CaptureSequence } from './CaptureSequence';
import { EvolutionSequence } from './EvolutionSequence';
import { SummonSequence } from './SummonSequence';
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

/** A successful-capture prompt is informational, not a persistent mode hint. */
const CAPTURE_DEPLOY_HINT_DURATION = 5;

/** Course select, starter select and team select share one loop. */
const MENU_MUSIC = 'pokemon_select';
const CAPTURE_JINGLE = 'pikachu_learned_surf';

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
  public selectedBall: BallType = 'poke';
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
  public hazards: Hazard[] = [];
  /** Seconds left on a signature that lets every tower aim at Phantoms. */
  private phantomRevealTimer = 0;
  /** Signatures that keep firing for a while after the button press (Hydro Pump). */
  private channels: { remaining: number; interval: number; timer: number; tick: () => void }[] = [];
  /** A `point` or `line` signature waiting for the player to click where it goes. */
  private aiming: { tower: Tower; signatureId: string } | null = null;
  private aimPreview: THREE.Group = new THREE.Group();
  private aimPreviewKind: string | null = null;
  /** Signatures may cut to the action cam unless the player turned it off. */
  private signatureCuts = true;
  /** Poké Ball deployment entrances are on unless the player opts out. */
  private summonCinematics = true;

  /** The team this match was started with, plus anything caught during it. */
  public roster: OwnedPokemon[] = [];
  /** True from a match's first frame until its XP and records are banked. */
  private matchActive = false;
  /** Whether this match's battle loop has started, so resuming from a menu restores it. */
  private battleMusicOn = false;
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
  private captureHint: string | null = null;
  private captureHintTimer = 0;
  private timedCaptureHint: string | null = null;
  private capture: { sequence: CaptureSequence; target: Creep; ball: BallType } | null = null;
  private evolution: { sequence: EvolutionSequence } | null = null;
  private summon: { sequence: SummonSequence; tower: Tower } | null = null;
  /** Queued so simultaneous evolutions (a multi-way knockout) play one at a time. */
  private evolutionQueue: { tower: Tower; fromName: string; toName: string }[] = [];
  private traitsIntroduced = new Set<CreepTrait>();
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
    this.aimPreview.visible = false;
    this.renderer.scene.add(this.aimPreview);

    this.waveManager = new WaveManager(this.arena.walkRoutes, this.announcer, this.map.difficulty, this.arena.walkLifts);
    this.ui = new StadiumUI(uiContainer, this.announcer, this.camera, store);

    this.bindUIEvents();
    // The game opens on starter or course select. Browsers hold audio until the
    // first gesture, so resume the context then and the requested loop starts.
    this.audio.playMusic(MENU_MUSIC);
    const unlockAudio = () => {
      this.audio.prepare();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.signatureCuts = readSignatureCutsSetting();
    this.ui.setSignatureCuts(this.signatureCuts);
    this.summonCinematics = readSummonCinematicsSetting();
    this.ui.setSummonCinematics(this.summonCinematics);
    this.ui.setAudioVolumes(this.audio.getMusicVolume(), this.audio.getSfxVolume());

  }

  private bindUIEvents(): void {
    this.ui.onOpenMaps = () => {
      this.clearSelection();
      this.isChoosingMap = true;
      // A lost match has nothing to resume.
      this.ui.setMapSelectVisible(true, !this.gameOver);
    };
    this.ui.onRetryMap = () => this.loadMap(this.map);
    this.ui.onResumeMap = () => {
      this.isChoosingMap = false;
      if (this.battleMusicOn) this.audio.startMusic();
      else this.audio.stopMusic();
    };
    this.ui.onMenuShown = () => this.audio.playMusic(MENU_MUSIC);
    this.ui.onResumeGame = () => {
      this.pauseMenuOpen = false;
      this.isPaused = false;
      this.ui.setPauseVisible(false);
      this.audio.playSelect();
    };
    this.ui.onQuitToMenu = () => {
      const report = this.finishMatch();
      this.clearSelection();
      this.captureHint = null;
      this.pauseMenuOpen = false;
      this.isPaused = true;
      this.ui.setPauseVisible(false);
      this.isChoosingMap = true;
      this.audio.playMusic(MENU_MUSIC);
      this.ui.showMatchReport(report, this.map.name, () => this.ui.setMapSelectVisible(true, false));
      this.audio.playSelect();
    };
    this.ui.onSelectMap = (map) => this.loadMap(map);
    this.ui.onToggleSignatureCuts = () => {
      this.signatureCuts = !this.signatureCuts;
      writeSignatureCutsSetting(this.signatureCuts);
      this.ui.setSignatureCuts(this.signatureCuts);
      this.audio.playSelect();
    };
    this.ui.onToggleSummonCinematics = () => {
      this.summonCinematics = !this.summonCinematics;
      writeSummonCinematicsSetting(this.summonCinematics);
      this.ui.setSummonCinematics(this.summonCinematics);
      this.audio.playSelect();
    };
    this.ui.onMusicVolumeChange = value => this.audio.setMusicVolume(value);
    this.ui.onSfxVolumeChange = value => this.audio.setSfxVolume(value);
    this.ui.onCastSignature = (tower, signatureId) => this.requestSignature(tower, signatureId);
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
    this.ui.onCatch = (creep) => this.tryCapture(creep, this.selectedBall);
    this.ui.onSelectBall = (ball) => {
      if (this.balls[ball] <= 0) return;
      this.selectedBall = ball;
      this.audio.playSelect();
    };
    this.ui.onBuyBall = (ball) => {
      if (this.waveManager.inWave || this.money < BALL_PRICES[ball]) return;
      this.money -= BALL_PRICES[ball];
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
        this.battleMusicOn = true;
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
    this.abortSummon();
    this.towers.forEach(tower => tower.destroy(this.renderer.scene));
    this.creeps.forEach(creep => creep.destroy(this.renderer.scene));
    this.projectiles.forEach(projectile => projectile.destroy(this.renderer.scene));
    this.hazards.forEach(hazard => hazard.destroy(this.renderer.scene));
    this.channels = [];
    this.aiming = null;
    this.phantomRevealTimer = 0;
    this.towers = [];
    this.creeps = [];
    this.projectiles = [];
    this.hazards = [];
    this.renderer.scene.remove(this.arena.group);
    this.arena.dispose();
    this.arena = new StadiumArena(map);
    this.renderer.scene.add(this.arena.group);
    this.waveManager = new WaveManager(this.arena.walkRoutes, this.announcer, this.map.difficulty, this.arena.walkLifts);
    this.money = 420;
    this.lives = 6;
    // A brand-new trainer gets extra balls to build a team with.
    this.balls = { poke: this.store.data.matchesPlayed === 0 ? 5 : 3, great: 0, ultra: 0 };
    this.selectedBall = 'poke';
    this.captureHint = null;
    this.abortCapture();
    this.abortEvolution();
    this.traitsIntroduced.clear();
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
    // Menu music ends with the menus; the battle loop starts with the first wave.
    this.battleMusicOn = false;
    this.audio.stopMusic();
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
    if (this.aiming?.tower === tower) {
      this.aiming = null;
      this.captureHint = null;
    }
    tower.destroy(this.renderer.scene);
    this.towers = this.towers.filter(t => t.id !== tower.id);
  }

  public handleInput(input: Input): void {
    // Hotkeys: C cycles the camera, Q catches the nearest-to-exit catchable
    // Pokémon with the selected ball, and 1–9 call signature moves in bar order.
    if (input.isKeyJustPressed('KeyC')) {
      const modes: CameraMode[] = ['tactical', 'stadium', 'action'];
      this.camera.setMode(modes[(modes.indexOf(this.camera.mode) + 1) % modes.length]);
    }
    if (input.isKeyJustPressed('KeyQ')) {
      const catchable = this.catchableCreeps();
      if (catchable.length) this.tryCapture(catchable[0], this.selectedBall);
    }
    this.signatureSlots().slice(0, 9).forEach((slot, i) => {
      if (input.isKeyJustPressed(`Digit${i + 1}`)) this.requestSignature(slot.tower, slot.def.id);
    });
    if (input.isKeyJustPressed('Space') && !this.pauseMenuOpen) this.isPaused = !this.isPaused;
    if (input.isKeyJustPressed('Escape')) {
      if (this.pauseMenuOpen) {
        this.ui.onResumeGame();
        return;
      }
      const dismissedSelection = Boolean(this.selectedMember || this.selectedTower || this.aiming);
      this.aiming = null;
      this.clearSelection();
      this.captureHint = null;
      if (!dismissedSelection) {
        this.pauseMenuOpen = true;
        this.isPaused = true;
        this.ui.setPauseVisible(true);
      }
      return;
    }
    if (input.rightClicked) {
      this.aiming = null;
      this.clearSelection();
      this.captureHint = null;
    }

    // Free placement: the cursor's spot on the pitch is the candidate site.
    const ground = this.arena.terrain.raycast(input.pointerRay(this.camera.camera));

    if (this.aiming) {
      this.updateAim(ground, input);
      return;
    }
    this.aimPreview.visible = false;

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

  /** The Poké Ball entrance currently playing, if any. */
  public get activeSummon(): SummonSequence | null {
    return this.summon?.sequence ?? null;
  }

  private finishSummon(): void {
    if (!this.summon) return;
    const { sequence, tower } = this.summon;
    this.summon = null;
    sequence.dispose(this.renderer.scene);
    if (this.towers.includes(tower)) this.selectPlacedTower(tower);
  }

  /** Tears down a deployment entrance without selecting its soon-to-be-removed tower. */
  private abortSummon(): void {
    if (!this.summon) return;
    this.summon.sequence.dispose(this.renderer.scene);
    this.summon = null;
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

  /** Weakened, free Pokémon a ball can be thrown at, nearest the exit first. */
  private catchableCreeps(): Creep[] {
    return this.creeps.filter(creep => creep.catchable).sort((a, b) => b.pathProgress - a.pathProgress);
  }

  /** Odds a ball would catch this Pokémon right now, before the release meter. */
  private captureChance(target: Creep, ball: BallType): number {
    const ballBonus: Record<BallType, number> = { poke: 0, great: 0.20, ultra: 0.42 };
    const held = target.movementStatus?.effect;
    const statusBonus = held === 'stun' || held === 'sleep' || held === 'freeze' ? 0.22 : target.status !== 'none' ? 0.12 : 0;
    const rarityPenalty = target.threat === 'titan' ? 0.42 : target.threat === 'elite' ? 0.18 : 0;
    // Trainer's luck: every miss since the last catch sweetens the next throw.
    const luck = this.store.captureLuckBonus;
    return THREE.MathUtils.clamp(0.28 + (1 - target.hpFraction) * 0.45 + ballBonus[ball] + statusBonus - rarityPenalty + luck, 0.08, 0.95);
  }

  /** Public so the headless shot harness can stage a capture set piece. */
  public tryCapture(target: Creep | null, ball: BallType): void {
    // A fainted Pokemon remains in the scene for its defeat animation, but it
    // is no longer a legal capture target and must not consume a ball.
    if (!target?.catchable || this.balls[ball] <= 0) return;
    if (this.capture || this.evolution || this.summon) return;
    this.balls[ball]--;
    const chance = this.captureChance(target, ball);
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
      this.timedCaptureHint = this.captureHint;
      this.captureHintTimer = CAPTURE_DEPLOY_HINT_DURATION;
      this.announcer.trigger('capture_success', target.name);
      if (!this.audio.playJingle(CAPTURE_JINGLE)) this.audio.playFanfare();
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

    this.selectedMember = null;
    this.placementStatus = null;
    this.placementPreview.visible = false;

    if (this.summonCinematics) {
      this.startSummon(tower);
    } else {
      this.audio.playDeploy();
      this.particles.emitImpact(position, 0x00f0ff, 25, 5);
      this.selectPlacedTower(tower);
    }
  }

  /** Selects a deployment only after its entrance hands control back. */
  private selectPlacedTower(tower: Tower): void {
    if (this.selectedTower) this.selectedTower.setSelected(false);
    this.selectedTower = tower;
    tower.setSelected(true);
  }

  private startSummon(tower: Tower): void {
    const sequence = new SummonSequence(tower, {
      particles: this.particles,
      camera: this.camera,
      audio: this.audio,
      announcer: this.announcer,
      arena: this.arena,
    });
    this.renderer.scene.add(sequence.group);
    this.summon = { sequence, tower };
  }

  /** Public so the headless shot harness can stage the deployment set piece. */
  public forceSummon(tower: Tower): void {
    this.abortSummon();
    this.startSummon(tower);
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
      const range = MOVES[speciesOf(member).basicAttack].range;

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
    this.updateTimedCaptureHint(realDt);
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
    // Cinematics own the screen. A deployment takes any deliberate click,
    // Space, or Escape as a skip; capture keeps its timing-check input.
    if (this.summon) {
      if (input.clicked || input.isKeyJustPressed('Space') || input.isKeyJustPressed('Escape')) {
        this.summon.sequence.skip();
      }
    } else if (this.capture) {
      // A UI click is the one that picked the ball; it must not also release the meter.
      if (this.capture.sequence.awaitingRelease && ((input.clicked && !input.clickedOnUI) || input.isKeyJustPressed('Space'))) {
        this.capture.sequence.release();
      }
    } else if (!this.evolution) {
      this.handleInput(input);
    }

    // Procedural grass is cosmetic and yields to the tower's physical pad.
    // The arena caches this footprint set, so unchanged frames cost no traversal.
    this.arena.clearGroundPropsBelow?.(this.towers.map(tower => tower.position), TOWER_FOOTPRINT_RADIUS);

    // A capture or evolution set piece runs in real time while it drags the
    // rest of the world into slow motion. At most one of these is ever
    // active, but multiplying both scales is harmless if that ever changes.
    const captureScale = this.capture ? this.capture.sequence.worldTimeScale : 1;
    const evolutionScale = this.evolution ? this.evolution.sequence.worldTimeScale : 1;
    const summonScale = this.summon ? this.summon.sequence.worldTimeScale : 1;
    const dt = this.isPaused ? 0 : realDt * this.gameSpeed * captureScale * evolutionScale * summonScale;

    // Update Wave Manager
    if (dt > 0) this.waveManager.update(
      dt,
      this.creeps,
      (newCreep) => {
        this.renderer.scene.add(newCreep.group);
        this.creeps.push(newCreep);
        this.introduceTraits(newCreep);
      },
      (round) => this.handleRoundCleared(round)
    );

    // Auras are passive: refresh who is slowed and who is sped up before anyone acts.
    this.applyAuras();

    // Update Towers
    this.towers.forEach(tower => {
      tower.update(dt, this.creeps, (t, target, attack, shot) => {
        // Fire attack!
        const move = attack.move;
        this.audio.playAttack(move.fxType);
        const extras = hitExtrasFor(attack, shot);

        if (shot.dropsHazard && attack.hazard) {
          this.hazards.push(new Hazard(attack.hazard.hazard, target.position, t, this.renderer.scene));
        }

        if (move.delivery === 'projectile') {
          this.projectiles.push(new Projectile(move, t.position, target, this.renderer.scene, t, extras));
          return;
        }

        // Every other archetype lands the moment it is fired: draw the
        // delivery, then resolve everything its shape catches.
        const geometry = moveGeometry(move, t, target);
        playInstantDelivery(move, geometry, target, this.particles, this.camera);
        resolveMoveHit(move, target, this.hitContext(), t, geometry, extras);
      });
    });

    if (this.phantomRevealTimer > 0) this.phantomRevealTimer = Math.max(0, this.phantomRevealTimer - dt);

    // Update channelled signatures
    for (let i = this.channels.length - 1; i >= 0; i--) {
      const channel = this.channels[i];
      channel.timer -= dt;
      while (channel.timer <= 0 && channel.remaining > 0) {
        channel.tick();
        channel.timer += channel.interval;
        channel.remaining -= channel.interval;
      }
      if (channel.remaining <= 0) this.channels.splice(i, 1);
    }

    // Update Hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hazard = this.hazards[i];
      if (!hazard.update(dt, this.creeps, (creep) => this.handleCreepDefeat(creep))) {
        hazard.destroy(this.renderer.scene);
        this.hazards.splice(i, 1);
      }
    }

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
          this.abortSummon();
          this.abortCapture();
          this.abortEvolution();
          this.clearSelection();
          const report = this.finishMatch();
          this.ui.showDefeat(this.map.name, this.waveManager.round, this.waveManager.winRound, report);
          // Defeat is a single transition. Any other creeps that crossed on
          // this frame are cleared by retry/loadMap and must not overwrite it.
          break;
        }
      } else if (!c.alive && c.removalReady) {
        c.destroy(this.renderer.scene);
        this.creeps.splice(i, 1);
      }
    }

    this.renderer.floodlightDim = this.summon
      ? this.summon.sequence.floodlightDim
      : this.capture
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

    if (this.summon) {
      const done = this.summon.sequence.update(realDt);
      if (done) this.finishSummon();
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
    if (this.summon) {
      this.arena.updateJumbotron(this.summon.sequence.hud.pokemonName, 'I CHOOSE YOU!', currentWave.round);
    } else if (this.capture) {
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
        catchables: this.catchSlots(),
        selectedBall: this.selectedBall,
        captureHint: this.captureHint,
        captureCinema: this.capture?.sequence.hud ?? null,
        evolutionCinema: this.evolution?.sequence.hud ?? null,
        summonCinema: this.summon?.sequence.hud ?? null,
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
        signatures: this.signatureSlots(),
      }
    );
  }

  /** Screen anchors and live odds for every catchable Pokémon. */
  private catchSlots(): CatchSlot[] {
    return this.catchableCreeps().map(creep => {
      const anchor = creep.group.position.clone();
      anchor.y += creep.hudAnchorHeight;
      const { x, y, visible } = this.renderer.toScreenXY(anchor, this.camera.camera);
      const odds = {} as Record<BallType, number>;
      BALL_ORDER.forEach(ball => { odds[ball] = this.captureChance(creep, ball); });
      return { creep, x, y, onScreen: visible, odds };
    });
  }

  private updateTimedCaptureHint(realDt: number): void {
    if (this.captureHintTimer <= 0) return;

    this.captureHintTimer = Math.max(0, this.captureHintTimer - realDt);
    if (this.captureHintTimer > 0) return;

    if (this.captureHint === this.timedCaptureHint) this.captureHint = null;
    this.timedCaptureHint = null;
  }

  /** Every signature on the pitch, in placement order — the bar and the 1–9 hotkeys. */
  private signatureSlots(): SignatureSlot[] {
    return this.towers.flatMap(tower => tower.attack.signatures.map(id => ({
      tower,
      def: SIGNATURES[id],
      pp: tower.pp[id] ?? 0,
      aiming: this.aiming?.tower === tower && this.aiming.signatureId === id,
    })));
  }

  /** A button or hotkey press: instant signatures fire now, aimed ones wait for a click. */
  private requestSignature(tower: Tower, signatureId: string): void {
    if (this.gameOver || this.capture || this.evolution || this.summon || this.isPaused) return;
    if ((tower.pp[signatureId] ?? 0) <= 0 || !this.towers.includes(tower)) return;
    const def = SIGNATURES[signatureId];
    const targeting = signatureTargeting(def);
    if (targeting === 'point' || targeting === 'line') {
      const same = this.aiming?.tower === tower && this.aiming.signatureId === signatureId;
      this.clearSelection();
      this.aiming = same ? null : { tower, signatureId };
      this.captureHint = same ? null : `${def.name.toUpperCase()} · CLICK ${targeting === 'point' ? 'A SPOT' : 'A DIRECTION'} · ESC TO CANCEL`;
      this.audio.playSelect();
      return;
    }
    this.fireSignature(tower, signatureId, null);
  }

  private fireSignature(tower: Tower, signatureId: string, aim: THREE.Vector3 | null): void {
    const def = SIGNATURES[signatureId];
    if (!castSignature(def, tower, aim, this.signatureContext())) {
      this.captureHint = `${def.name.toUpperCase()} HAS NOTHING TO HIT`;
      return;
    }
    tower.pp[signatureId]--;
    tower.animPokemon.playMove?.(def.name);
    this.announcer.trigger('signature', `${tower.name.toUpperCase()}, ${def.name.toUpperCase()}!`);
    this.audio.playAttack(tower.primaryMove.fxType);
  }

  /** Shows where an aimed signature will land and fires it on click. */
  private updateAim(ground: THREE.Vector3 | null, input: Input): void {
    const { tower, signatureId } = this.aiming!;
    const def = SIGNATURES[signatureId];
    if (!this.towers.includes(tower)) {
      this.aiming = null;
      this.captureHint = null;
      return;
    }
    if (!ground) {
      this.aimPreview.visible = false;
      return;
    }
    const color = TYPE_COLORS[def.type]?.num ?? 0xffffff;
    if (this.aimPreviewKind !== signatureId) {
      this.aimPreview.clear();
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      const radius = signatureRadius(def);
      const geometry = signatureTargeting(def) === 'point'
        ? new THREE.RingGeometry(radius - 0.35, radius, 48).rotateX(-Math.PI / 2)
        : new THREE.PlaneGeometry(2.8, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 6;
      this.aimPreview.add(mesh);
      this.aimPreviewKind = signatureId;
    }
    if (signatureTargeting(def) === 'point') {
      this.aimPreview.position.set(ground.x, ground.y + 0.4, ground.z);
      this.aimPreview.rotation.set(0, 0, 0);
      this.aimPreview.scale.setScalar(1);
    } else {
      // A strip from the tower toward the cursor, as long as the beam reaches.
      const length = signatureLineReach(def, tower);
      this.aimPreview.position.set(tower.position.x, tower.position.y + 0.4, tower.position.z);
      this.aimPreview.rotation.set(0, Math.atan2(ground.x - tower.position.x, ground.z - tower.position.z), 0);
      this.aimPreview.scale.set(1, 1, length);
    }
    this.aimPreview.visible = true;

    if (input.clicked && !input.clickedOnUI && !this.isPaused) {
      this.aiming = null;
      this.captureHint = null;
      this.aimPreview.visible = false;
      this.fireSignature(tower, signatureId, ground);
    }
  }

  private signatureContext(): SignatureContext {
    return {
      creeps: this.creeps,
      towers: this.towers,
      hit: this.hitContext(),
      particles: this.particles,
      camera: this.camera,
      announcer: this.announcer,
      cinematicCuts: this.signatureCuts,
      channel: (duration, interval, tick) => {
        tick();
        this.channels.push({ remaining: duration - interval, interval, timer: interval, tick });
      },
      addHazard: (hazard, position, tower) => this.hazards.push(new Hazard(hazard, position, tower, this.renderer.scene)),
      addMoney: (amount) => { this.money += amount; },
      revealPhantoms: (seconds) => { this.phantomRevealTimer = Math.max(this.phantomRevealTimer, seconds); },
    };
  }

  /** Slow auras reach creeps in a tower's range; rate auras reach towers in it. */
  private applyAuras(): void {
    for (const creep of this.creeps) creep.auraSlow = 0;
    for (const tower of this.towers) {
      tower.rateBuff = 0;
      tower.revealed = this.phantomRevealTimer > 0;
    }
    for (const source of this.towers) {
      if (source.deploymentLocked) continue;
      const { slowAura, rateAura, revealAura } = source.attack;
      if (revealAura) {
        for (const tower of this.towers) {
          if (Math.hypot(tower.position.x - source.position.x, tower.position.z - source.position.z) <= source.getMaxRange()) {
            tower.revealed = true;
          }
        }
      }
      if (!slowAura && !rateAura) continue;
      const range = source.getMaxRange();
      if (slowAura) {
        for (const creep of this.creeps) {
          if (!creep.alive) continue;
          if (Math.hypot(creep.position.x - source.position.x, creep.position.z - source.position.z) > source.reachAgainst(range, creep)) continue;
          creep.auraSlow = Math.max(creep.auraSlow, creep.isBoss ? slowAura * 0.5 : slowAura);
        }
      }
      if (rateAura) {
        for (const tower of this.towers) {
          if (Math.hypot(tower.position.x - source.position.x, tower.position.z - source.position.z) > range) continue;
          tower.rateBuff = Math.max(tower.rateBuff, rateAura);
        }
      }
    }
  }

  /** The first creep with a trait each match gets the announcer's explanation. */
  private introduceTraits(creep: Creep): void {
    for (const trait of creep.traits) {
      if (this.traitsIntroduced.has(trait)) continue;
      this.traitsIntroduced.add(trait);
      this.announcer.trigger(`trait_${trait}`);
      return; // One banner at a time; a second trait gets its turn on the next spawn.
    }
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
    // PP is per round: every signature is ready again for the next one.
    this.towers.forEach(tower => tower.refillPP());
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
    // Bounty towers are paid for every knockout they helped with.
    for (const tower of creep.contributors.keys()) {
      if (tower.attack.bounty && this.towers.includes(tower)) this.money += tower.attack.bounty;
    }
    this.spreadSeed(creep);
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

  /** A creep that faints while seeded by a Spreading Roots tower passes the seed on. */
  private spreadSeed(fallen: Creep): void {
    const seed = fallen.damageStatus;
    const seeder = seed?.effect === 'poison' ? seed.source : null;
    const radius = seeder?.attack.seedJumpRadius ?? 0;
    if (!seeder || !radius) return;
    let nearest: Creep | null = null;
    let best = radius;
    for (const creep of this.creeps) {
      if (creep === fallen || !creep.alive || creep.captureLocked) continue;
      const distance = creep.position.distanceTo(fallen.position);
      if (distance <= best) {
        best = distance;
        nearest = creep;
      }
    }
    if (!nearest) return;
    nearest.applyStatus('poison', Math.max(4, seed!.timer), seeder);
    this.particles.emitBeam(fallen.position.clone().setY(fallen.position.y + 1), nearest.position.clone().setY(nearest.position.y + 1), 0x78c850, 0.18, 0.4);
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
    if (this.evolution || this.summon || this.evolutionQueue.length === 0) return;
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

const SIGNATURE_CUTS_KEY = 'pokestadium.signatureCuts';
const SUMMON_CINEMATICS_KEY = 'pokestadium.summonCinematics';

function readSignatureCutsSetting(): boolean {
  try {
    return localStorage.getItem(SIGNATURE_CUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSignatureCutsSetting(enabled: boolean): void {
  try {
    localStorage.setItem(SIGNATURE_CUTS_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage can be unavailable (private windows); the setting just won't stick.
  }
}

function readSummonCinematicsSetting(): boolean {
  try {
    return localStorage.getItem(SUMMON_CINEMATICS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSummonCinematicsSetting(enabled: boolean): void {
  try {
    localStorage.setItem(SUMMON_CINEMATICS_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage can be unavailable (private windows); the setting just won't stick.
  }
}
