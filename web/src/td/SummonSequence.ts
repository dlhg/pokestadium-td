/**
 * SummonSequence.ts — The "I Choose You" deployment set piece.
 *
 * A placed tower exists immediately (so cost, occupancy and the roster stay
 * authoritative), but it remains deployment-locked while a Poké Ball arcs
 * into the chosen spot. The ball opens in a hard flash, the Pokémon forms in
 * a column of light, and a short hero beat hands control back to the player.
 */
import * as THREE from 'three';
import { CaptureStage } from './CaptureSequence';
import { Tower } from './Tower';

export type SummonPhase = 'throw' | 'burst' | 'reveal' | 'ready';

export interface SummonHud {
  phase: SummonPhase;
  pokemonName: string;
  /** 0..1 letterbox bar extension. */
  letterbox: number;
  /** 0..1 full-screen release flash. */
  flash: number;
  caption: string;
  prompt: string;
}

const D_THROW = 0.68;
const D_BURST = 0.32;
const D_REVEAL = 0.86;
const D_READY = 1.05;
const END = D_THROW + D_BURST + D_REVEAL + D_READY;
const BALL_GLOW = 0x8deaff;

export class SummonSequence {
  public readonly group = new THREE.Group();
  public readonly hud: SummonHud;

  private elapsed = 0;
  private readonly landing: THREE.Vector3;
  private readonly focus: THREE.Vector3;
  private readonly throwFrom: THREE.Vector3;
  private readonly ball: THREE.Group;
  private readonly ballTop: THREE.Mesh;
  private readonly ballBottom: THREE.Mesh;
  private readonly ballLight: THREE.PointLight;
  private readonly spotlight: THREE.SpotLight;
  private readonly beam: THREE.Mesh;
  private readonly beamMaterial: THREE.MeshBasicMaterial;
  private trailTimer = 0;
  private opened = false;
  private revealed = false;
  private celebrated = false;
  private skipped = false;

  constructor(private tower: Tower, private stage: CaptureStage) {
    const height = tower.animPokemon.height ?? 2.2;
    this.landing = tower.position.clone().add(new THREE.Vector3(0, 0.48, 0));
    this.focus = tower.position.clone().add(new THREE.Vector3(0, Math.max(1.1, height * 0.48), 0));

    // Throw from the player's current side of the field so the arc reads as
    // coming over their shoulder in every camera mode.
    const fromCamera = stage.camera.camera.position.clone().sub(this.landing).setY(0);
    if (fromCamera.lengthSq() < 0.01) fromCamera.set(0, 0, 1);
    fromCamera.normalize();
    this.throwFrom = this.landing.clone().addScaledVector(fromCamera, 8.5).add(new THREE.Vector3(0, 4.4, 0));

    this.hud = {
      phase: 'throw',
      pokemonName: tower.name.toUpperCase(),
      letterbox: 0,
      flash: 0,
      caption: `${tower.name.toUpperCase()}, I CHOOSE YOU!`,
      prompt: 'CLICK · SPACE · ESC TO SKIP',
    };

    this.ball = this.createBall();
    this.ballTop = this.ball.children[0] as THREE.Mesh;
    this.ballBottom = this.ball.children[1] as THREE.Mesh;
    this.ball.position.copy(this.throwFrom);
    this.group.add(this.ball);

    this.ballLight = new THREE.PointLight(BALL_GLOW, 2.5, 9);
    this.ballLight.position.copy(this.throwFrom);
    this.group.add(this.ballLight);

    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: BALL_GLOW,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1.02, Math.max(2.4, height * 1.35), 16, 1, true), this.beamMaterial);
    this.beam.position.copy(tower.position).add(new THREE.Vector3(0, Math.max(1.2, height * 0.68), 0));
    this.beam.visible = false;
    this.group.add(this.beam);

    this.spotlight = new THREE.SpotLight(0xdffcff, 0, 30, Math.PI / 8, 0.5, 1.25);
    this.spotlight.position.copy(tower.position).add(new THREE.Vector3(0, 16, 3));
    this.spotlight.target.position.copy(this.focus);
    this.group.add(this.spotlight, this.spotlight.target);

    tower.setDeploymentLocked(true);
    // Lower the look-at point for this low hero angle: perspective makes the
    // grounded model's visual center sit below the generic cinematic focus.
    stage.camera.beginCinematic(this.focus, 8.2, 3.1, 0.2, Math.atan2(fromCamera.x, fromCamera.z), -0.6);
    stage.arena.setCrowdMood(-0.6);
    stage.audio.duckCrowd(0.35, 0.3);
    stage.audio.playSummonThrow();
  }

  /** The rest of the battle almost stops while the entrance plays. */
  public get worldTimeScale(): number {
    if (this.skipped) return 1;
    if (this.elapsed < D_THROW) return THREE.MathUtils.lerp(0.25, 0.05, this.elapsed / D_THROW);
    if (this.elapsed < D_THROW + D_BURST + D_REVEAL) return 0.04;
    return THREE.MathUtils.lerp(0.04, 1, (this.elapsed - D_THROW - D_BURST - D_REVEAL) / D_READY);
  }

  /** Floodlight dimming, 0 = normal stadium lighting, 1 = blackout. */
  public get floodlightDim(): number {
    if (this.skipped) return 0;
    const inAmount = THREE.MathUtils.clamp(this.elapsed / 0.32, 0, 1);
    const outAmount = THREE.MathUtils.clamp((this.elapsed - D_THROW - D_BURST - D_REVEAL) / 0.65, 0, 1);
    return 0.62 * inAmount * (1 - outAmount);
  }

  /** Ends immediately while still leaving the Pokémon in a valid ready state. */
  public skip(): void {
    if (this.skipped) return;
    this.skipped = true;
    this.hud.phase = 'ready';
    this.hud.letterbox = 0;
    this.hud.flash = 0;
    this.makeTowerReady(false);
  }

  /** Returns true once the set piece has naturally ended or was skipped. */
  public update(dt: number): boolean {
    if (this.skipped) return true;
    this.elapsed += dt;
    const closing = THREE.MathUtils.clamp((this.elapsed - END + 0.45) / 0.35, 0, 1);
    this.hud.letterbox = THREE.MathUtils.clamp(this.elapsed / 0.24, 0, 1) * (1 - closing);
    this.spotlight.intensity = 16 * (this.floodlightDim / 0.62);

    if (this.elapsed < D_THROW) this.updateThrow(dt);
    else if (this.elapsed < D_THROW + D_BURST) this.updateBurst();
    else if (this.elapsed < D_THROW + D_BURST + D_REVEAL) this.updateReveal();
    else this.updateReady();

    this.ballLight.position.copy(this.ball.position);
    return this.elapsed >= END;
  }

  private updateThrow(dt: number): void {
    this.hud.phase = 'throw';
    const p = THREE.MathUtils.clamp(this.elapsed / D_THROW, 0, 1);
    const eased = p * p * (3 - 2 * p);
    this.ball.position.lerpVectors(this.throwFrom, this.landing, eased);
    this.ball.position.y += Math.sin(p * Math.PI) * 2.7;
    this.ball.rotation.x += dt * 12;
    this.ball.rotation.z += dt * 20;
    this.ballLight.intensity = 2.2 + p * 2.4;

    this.trailTimer += dt;
    if (this.trailTimer >= 0.025) {
      this.trailTimer = 0;
      this.stage.particles.emitTrail(this.ball.position, BALL_GLOW, 0.75);
    }
  }

  private updateBurst(): void {
    this.hud.phase = 'burst';
    this.hud.caption = `${this.hud.pokemonName}, I CHOOSE YOU!`;
    const p = THREE.MathUtils.clamp((this.elapsed - D_THROW) / D_BURST, 0, 1);
    this.ball.position.copy(this.landing);
    this.ball.rotation.set(0, 0, 0);
    this.ballTop.position.y = Math.sin(p * Math.PI * 0.5) * 0.46;
    this.ballBottom.position.y = -Math.sin(p * Math.PI * 0.5) * 0.12;
    this.ballLight.intensity = 5 + p * 8;
    this.hud.flash = Math.sin(p * Math.PI);
    this.beam.visible = true;
    this.beamMaterial.opacity = 0.12 + p * 0.24;

    if (!this.opened) {
      this.opened = true;
      this.stage.audio.playSummonRelease();
      this.stage.camera.punchZoom(9);
      this.stage.camera.shake(0.38);
      this.stage.camera.setCinematicFraming(6.8, 2.5);
      // Stadium models face +Z at rest. Swing onto that axis as the ball
      // opens, then hold it so the reveal reads as a true head-on hero shot.
      this.stage.camera.setCinematicAngle(0, 0);
      this.stage.particles.emitImpact(this.landing, 0xffffff, 34, 9);
      this.stage.particles.emitRing(this.tower.position, BALL_GLOW, 3.2, 0.55);
    }
  }

  private updateReveal(): void {
    this.hud.phase = 'reveal';
    this.hud.caption = `${this.hud.pokemonName}, I CHOOSE YOU!`;
    const p = THREE.MathUtils.clamp((this.elapsed - D_THROW - D_BURST) / D_REVEAL, 0, 1);
    const eased = THREE.MathUtils.smoothstep(p, 0, 1);
    this.hud.flash = Math.max(0, 0.24 * (1 - p * 6));

    if (!this.revealed) {
      this.revealed = true;
      this.stage.particles.emitAura(this.tower.position, BALL_GLOW, 28, 1.45);
      this.stage.particles.emitGroundBurst(this.tower.position, 0xdffcff, 2.2, 24);
      this.stage.audio.playCry(this.tower.formName, this.tower.type);
    }

    const mesh = this.tower.animPokemon.mesh;
    // Visible now, but still deployment-locked so it cannot attack under its
    // own entrance or contribute a passive aura before the hero beat lands.
    mesh.visible = true;
    mesh.scale.setScalar(Math.max(0.001, eased));
    mesh.position.y = (1 - eased) * 0.8;
    this.ball.visible = p < 0.28;
    this.ballLight.intensity = Math.max(0, 13 * (1 - p));
    this.beam.visible = p < 0.88;
    this.beamMaterial.opacity = Math.max(0, 0.34 * (1 - p));
  }

  private updateReady(): void {
    this.hud.phase = 'ready';
    this.hud.flash = 0;
    this.hud.caption = `${this.hud.pokemonName} IS READY!`;
    this.ball.visible = false;
    this.beam.visible = false;
    this.makeTowerReady(true);
  }

  private makeTowerReady(celebrate: boolean): void {
    this.tower.setDeploymentLocked(false);
    this.tower.animPokemon.mesh.visible = true;
    this.tower.animPokemon.mesh.scale.setScalar(1);
    this.tower.animPokemon.mesh.position.y = 0;
    if (!celebrate || this.celebrated) return;
    this.celebrated = true;
    this.stage.audio.playDeploy();
    this.stage.announcer.trigger('pokemon_deploy', this.tower.name);
    this.stage.arena.setCrowdMood(0.75);
    this.stage.audio.duckCrowd(1.35, 0.25);
    this.stage.camera.punchZoom(7);
    this.stage.particles.emitRing(this.tower.position, 0xffe46b, 4.2, 0.7);
  }

  public dispose(scene: THREE.Scene): void {
    this.makeTowerReady(false);
    this.stage.camera.releaseCinematic();
    this.stage.audio.duckCrowd(1, 0.8);
    this.stage.arena.setCrowdMood(0);
    scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
  }

  private createBall(): THREE.Group {
    const root = new THREE.Group();
    const shell = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.32 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell(0xd90429));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell(0xffffff));
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(0.381, 16, 2, 0, Math.PI * 2, Math.PI / 2 - 0.045, 0.09),
      shell(0x111722),
    );
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    button.position.z = 0.355;
    root.add(top, bottom, band, button);
    return root;
  }
}
