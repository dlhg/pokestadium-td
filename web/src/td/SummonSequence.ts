/**
 * SummonSequence.ts — The "I Choose You" deployment set piece.
 *
 * A placed tower exists immediately (so cost, occupancy and the roster stay
 * authoritative), but it remains deployment-locked while a Poké Ball arcs
 * over the pitch. The ball stops and opens in mid-air, throws a jagged tether
 * toward the pedestal, and sends the Pokémon back down it as living light —
 * the central conversion beat of CaptureSequence, played in the other
 * direction. Once the body has its own colours again, a short hero beat hands
 * control back to the player.
 */
import * as THREE from 'three';
import { EnergyForm } from '../engine/EnergyForm';
import { JaggedBeam } from '../engine/JaggedBeam';
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

const D_THROW = 0.62;
const D_BURST = 0.26;
const D_REVEAL = 0.9;
const D_READY = 1.0;
const END = D_THROW + D_BURST + D_REVEAL + D_READY;
const BALL_GLOW = 0x8deaff;
const BALL_RADIUS = 0.36;
const BALL_SHELL_OVERLAP = 0.025;
const BALL_MOUTH_AXIS = new THREE.Vector3(0, 1, 0);

export class SummonSequence {
  public readonly group = new THREE.Group();
  public readonly hud: SummonHud;

  private elapsed = 0;
  private readonly releasePos: THREE.Vector3;
  private readonly focus: THREE.Vector3;
  private readonly throwFrom: THREE.Vector3;
  private readonly beamAnchor: THREE.Vector3;
  private readonly shotAngle: number;
  private readonly ball: THREE.Group;
  private readonly ballTop: THREE.Mesh;
  private readonly ballBottom: THREE.Mesh;
  private readonly mouthGlow: THREE.Mesh;
  private readonly ballLight: THREE.PointLight;
  private readonly spotlight: THREE.SpotLight;
  private readonly beam: JaggedBeam;
  private readonly aimQuat = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();
  private readonly mouth = new THREE.Vector3();
  private readonly ride = new THREE.Vector3();
  private energy: EnergyForm | null = null;
  private energyMesh: THREE.Object3D | null = null;
  private trailTimer = 0;
  private crackleTimer = 0;
  private opened = false;
  private revealed = false;
  private materialized = false;
  private celebrated = false;
  private skipped = false;

  constructor(private tower: Tower, private stage: CaptureStage) {
    const height = tower.animPokemon.height ?? 2.2;
    this.focus = tower.position.clone().add(new THREE.Vector3(0, Math.max(1.1, height * 0.48), 0));
    this.beamAnchor = tower.position.clone().add(new THREE.Vector3(0, height * 0.45, 0));

    // Throw from the player's current side of the field so the arc reads as
    // coming over their shoulder in every camera mode. The destination is a
    // hovering release point, not the pedestal: the ball never masquerades as
    // the body it is about to emit.
    const fromCamera = stage.camera.camera.position.clone().sub(tower.position).setY(0);
    if (fromCamera.lengthSq() < 0.01) fromCamera.set(0, 0, 1);
    fromCamera.normalize();
    this.shotAngle = Math.atan2(fromCamera.x, fromCamera.z);
    const acrossCamera = new THREE.Vector3(-fromCamera.z, 0, fromCamera.x);
    this.releasePos = tower.position.clone()
      // The forming body travels toward the lens. Keeping the ball behind it
      // prevents the prop from eclipsing the silhouette halfway down the beam.
      .addScaledVector(fromCamera, -Math.max(0.9, height * 0.42))
      .addScaledVector(acrossCamera, Math.max(2.1, height * 0.7))
      .add(new THREE.Vector3(0, Math.max(1.9, height * 0.92), 0));
    this.throwFrom = this.releasePos.clone().addScaledVector(fromCamera, 8.5).add(new THREE.Vector3(0, 3.5, 0));
    this.aimQuat.setFromUnitVectors(BALL_MOUTH_AXIS, this.beamAnchor.clone().sub(this.releasePos).normalize());

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
    this.mouthGlow = this.ball.children[4] as THREE.Mesh;
    this.ball.position.copy(this.throwFrom);
    this.group.add(this.ball);

    this.ballLight = new THREE.PointLight(BALL_GLOW, 2.5, 9);
    this.ballLight.position.copy(this.throwFrom);
    this.group.add(this.ballLight);

    this.beam = new JaggedBeam(BALL_GLOW);
    this.group.add(this.beam.mesh);

    this.spotlight = new THREE.SpotLight(0xdffcff, 0, 30, Math.PI / 8, 0.5, 1.25);
    this.spotlight.position.copy(tower.position).add(new THREE.Vector3(0, 16, 3));
    this.spotlight.target.position.copy(this.focus);
    this.group.add(this.spotlight, this.spotlight.target);

    tower.setDeploymentLocked(true);
    // Lower the look-at point for this low hero angle: perspective makes the
    // grounded model's visual center sit below the generic cinematic focus.
    stage.camera.beginCinematic(this.focus, 8.2, 3.1, 0.2, this.shotAngle, -0.6);
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
    else if (this.elapsed < D_THROW + D_BURST) this.updateBurst(dt);
    else if (this.elapsed < D_THROW + D_BURST + D_REVEAL) this.updateReveal(dt);
    else this.updateReady();

    this.ballLight.position.copy(this.ball.position);
    return this.elapsed >= END;
  }

  private updateThrow(dt: number): void {
    this.hud.phase = 'throw';
    const p = THREE.MathUtils.clamp(this.elapsed / D_THROW, 0, 1);
    const eased = p * p * (3 - 2 * p);
    this.ball.position.lerpVectors(this.throwFrom, this.releasePos, eased);
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

  /** The shell turns toward the pedestal and throws the tether outward. */
  private updateBurst(dt: number): void {
    this.hud.phase = 'burst';
    this.hud.caption = `${this.hud.pokemonName}, I CHOOSE YOU!`;
    const p = THREE.MathUtils.clamp((this.elapsed - D_THROW) / D_BURST, 0, 1);
    const open = THREE.MathUtils.smoothstep(p, 0.08, 0.72);
    this.ball.position.copy(this.releasePos);

    if (!this.opened) {
      this.opened = true;
      this.spinQuat.copy(this.ball.quaternion);
      this.stage.audio.playSummonRelease();
      this.stage.camera.punchZoom(9);
      this.stage.camera.shake(0.38);
      this.stage.camera.setCinematicFraming(6.8, 2.5);
      // Freeze the established angle with the ball. Swinging to a generic
      // front view here can put the foreground shell directly over the beam.
      this.stage.camera.setCinematicAngle(this.shotAngle, 0);
      this.stage.particles.emitImpact(this.releasePos, 0xffffff, 12, 7);
      this.stage.particles.emitRing(this.tower.position, BALL_GLOW, 3.2, 0.55);
    }

    this.ball.quaternion.copy(this.spinQuat).slerp(this.aimQuat, open);
    this.setShellOpen(open);
    this.ballLight.intensity = 5 + open * 8;
    this.hud.flash = Math.sin(p * Math.PI);
    const reach = THREE.MathUtils.smoothstep(p, 0.3, 1);
    this.beam.update(dt, this.mouthPoint(), this.beamAnchor, this.stage.camera.camera.position, {
      width: 0.13 + reach * 0.08,
      jitter: 0.3,
      opacity: reach * 0.88,
      reach,
    });
  }

  /** Living light rides the tether away from the ball and becomes a body. */
  private updateReveal(dt: number): void {
    this.hud.phase = 'reveal';
    this.hud.caption = `${this.hud.pokemonName}, I CHOOSE YOU!`;
    const p = THREE.MathUtils.clamp((this.elapsed - D_THROW - D_BURST) / D_REVEAL, 0, 1);
    const travel = THREE.MathUtils.smoothstep(p, 0, 0.7);
    const grow = THREE.MathUtils.smoothstep(p, 0.04, 0.76);
    const scale = 0.05 + grow * 0.95;
    const fadeBeam = 1 - THREE.MathUtils.smoothstep(p, 0.68, 0.9);
    this.hud.flash = Math.max(0, 0.22 * (1 - p * 7));
    this.ball.position.copy(this.releasePos);
    this.ball.quaternion.copy(this.aimQuat);
    this.setShellOpen(1 - THREE.MathUtils.smoothstep(p, 0.72, 0.9));

    if (!this.revealed) {
      this.revealed = true;
      const mesh = this.tower.animPokemon.mesh;
      mesh.visible = true;
      this.energy = new EnergyForm(mesh, BALL_GLOW);
      this.energyMesh = mesh;
      this.energy.set(1, 0);
      this.stage.audio.playCry(this.tower.formName, this.tower.type);
      this.stage.particles.emitAura(this.releasePos, BALL_GLOW, 8, 0.55);
    }

    this.beam.update(dt, this.mouthPoint(), this.beamAnchor, this.stage.camera.camera.position, {
      width: 0.2 - travel * 0.06,
      jitter: 0.31 * (1 - travel * 0.35),
      opacity: 0.88 * fadeBeam,
    });

    const mesh = this.tower.animPokemon.mesh;
    // Tower can finish an asynchronous authentic-model load during the set
    // piece. Transfer the light treatment rather than letting the replacement
    // pop in with ordinary materials halfway down the tether.
    if (!this.materialized && this.energyMesh !== mesh) {
      this.energy?.release();
      this.energy = new EnergyForm(mesh, BALL_GLOW);
      this.energyMesh = mesh;
    }
    const point = this.beam.pointAt(travel, this.ride);
    // The model root is local to Tower.group; centre the scaled body on the
    // current point of the world-space bolt, ending exactly at its home pose.
    mesh.position.set(
      point.x - this.tower.position.x,
      point.y - this.tower.position.y - (this.tower.animPokemon.height ?? 2.2) * 0.45 * scale,
      point.z - this.tower.position.z,
    );
    mesh.scale.setScalar(scale);
    mesh.visible = true;
    this.energy?.set(1 - grow, THREE.MathUtils.smoothstep(p, 0, 0.14));

    this.crackleTimer += dt;
    if (this.crackleTimer >= 0.04 && fadeBeam > 0.1) {
      this.crackleTimer = 0;
      const spark = this.beam.pointAt(THREE.MathUtils.clamp(travel + (Math.random() - 0.5) * 0.24, 0, 1), this.mouth);
      this.stage.particles.emitTrail(spark, BALL_GLOW, 0.5);
    }

    if (p >= 0.78 && !this.materialized) {
      this.materialized = true;
      this.energy?.release();
      this.energy = null;
      this.energyMesh = null;
      mesh.position.set(0, 0, 0);
      mesh.scale.setScalar(1);
      this.stage.particles.emitGroundBurst(this.tower.position, 0xdffcff, 2.2, 24);
      this.stage.particles.emitAura(this.tower.position, BALL_GLOW, 22, 1.25);
    }

    this.ballLight.intensity = Math.max(0, 11 * fadeBeam);
    this.ball.visible = p < 0.94;
  }

  private updateReady(): void {
    this.hud.phase = 'ready';
    this.hud.flash = 0;
    this.hud.caption = `${this.hud.pokemonName} IS READY!`;
    this.ball.visible = false;
    this.beam.mesh.visible = false;
    this.makeTowerReady(true);
  }

  private makeTowerReady(celebrate: boolean): void {
    this.energy?.release();
    this.energy = null;
    this.energyMesh = null;
    this.tower.setDeploymentLocked(false);
    this.tower.animPokemon.mesh.visible = true;
    this.tower.animPokemon.mesh.scale.setScalar(1);
    this.tower.animPokemon.mesh.position.set(0, 0, 0);
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
    this.beam.dispose();
    scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object === this.beam.mesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
  }

  private mouthPoint(): THREE.Vector3 {
    return this.mouth.copy(BALL_MOUTH_AXIS)
      .applyQuaternion(this.ball.quaternion)
      .multiplyScalar(BALL_RADIUS * 0.22)
      .add(this.ball.position);
  }

  private setShellOpen(open: number): void {
    this.ballTop.position.y = open * 0.27 - BALL_SHELL_OVERLAP;
    this.ballBottom.position.y = -open * 0.09 + BALL_SHELL_OVERLAP;
    const glowMat = this.mouthGlow.material as THREE.MeshBasicMaterial;
    this.mouthGlow.visible = open > 0.01;
    this.mouthGlow.scale.setScalar(0.5 + open * 0.75);
    glowMat.opacity = Math.min(1, open * 1.3) * 0.85;
  }

  private createBall(): THREE.Group {
    const root = new THREE.Group();
    const shell = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell(0xd90429));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell(0xffffff));
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS + 0.001, 16, 2, 0, Math.PI * 2, Math.PI / 2 - 0.04, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.42, metalness: 0.12 }),
    );
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    button.position.z = BALL_RADIUS - 0.04;
    const mouthGlow = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 0.88, 12, 10),
      new THREE.MeshBasicMaterial({
        color: BALL_GLOW, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    mouthGlow.visible = false;
    root.add(top, bottom, band, button, mouthGlow);
    return root;
  }
}
