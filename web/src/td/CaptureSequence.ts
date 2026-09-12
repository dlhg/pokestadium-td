/**
 * CaptureSequence.ts — The Capture Set Piece
 *
 * A capture attempt is the game's biggest single moment, so it is staged like
 * one: the world drops into slow motion, the stadium lights dim to a single
 * spot, the camera swings into a low hero shot, and the ball gets the whole
 * screen for a beat sheet of throw → absorb → drop → wobble → verdict.
 *
 * The sequence owns only its own presentation. It publishes a `hud` snapshot
 * the UI reads, and a `worldTimeScale` the game multiplies into its delta, so
 * neither has to know the beat sheet.
 */
import * as THREE from 'three';
import { Creep } from './Creep';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumCamera } from '../engine/StadiumCamera';
import { StadiumAudio } from '../engine/StadiumAudio';
import { StadiumAnnouncer } from '../stadium/Announcer';

export type BallType = 'poke' | 'great' | 'ultra';
export type CapturePhase = 'windup' | 'throw' | 'absorb' | 'drop' | 'wobble' | 'verdict';

export interface CaptureStage {
  particles: ParticleSystem;
  camera: StadiumCamera;
  audio: StadiumAudio;
  announcer: StadiumAnnouncer;
}

/** Everything the cinematic overlay needs; mutated in place each frame. */
export interface CaptureHud {
  phase: CapturePhase;
  ballName: string;
  ballType: BallType;
  targetName: string;
  chance: number;
  /** Wobbles resolved so far, and how many the ball has to survive. */
  wobbles: number;
  totalWobbles: number;
  /** Rising 0..1 dread used for the vignette pulse and pip glow. */
  tension: number;
  /** 0..1 letterbox bar extension. */
  letterbox: number;
  verdict: 'caught' | 'broke' | null;
  caption: string;
}

const BALL_COLORS: Record<BallType, [number, number]> = {
  poke: [0xd90429, 0xffffff],
  great: [0x2468c7, 0xf14b3e],
  ultra: [0x1b1b20, 0xf3c532],
};
const BALL_NAMES: Record<BallType, string> = { poke: 'POKÉ BALL', great: 'GREAT BALL', ultra: 'ULTRA BALL' };
const BALL_GLOW: Record<BallType, number> = { poke: 0xff5566, great: 0x5fa8ff, ultra: 0xffd34d };

// Beat sheet, in real (undilated) seconds.
const T_THROW = 0.5;          // lights down, camera swings in, then the throw starts
const T_IMPACT = 1.05;        // ball reaches the target
const T_ABSORB_END = 1.75;    // target is inside, ball snaps shut
const T_SETTLE = 2.45;        // ball has fallen and stopped rolling
const WOBBLE_PERIOD = 0.85;
const WOBBLE_CLICK = 0.46;    // click lands partway through each wobble
const WOBBLE_COUNT = 3;
const T_LOCK = T_SETTLE + WOBBLE_COUNT * WOBBLE_PERIOD + 0.3;
const VERDICT_HOLD_SUCCESS = 1.9;
const VERDICT_HOLD_FAIL = 1.3;

const BALL_REST_Y = 0.34;

export class CaptureSequence {
  public readonly group = new THREE.Group();
  public readonly hud: CaptureHud;

  private ball: THREE.Group;
  private ballTop: THREE.Mesh;
  private ballBottom: THREE.Mesh;
  private ballLight: THREE.PointLight;
  private spotlight: THREE.SpotLight;
  private beam: THREE.Mesh;
  private flash: THREE.Mesh;

  private elapsed = 0;
  private readonly success: boolean;
  /** Index of the wobble the capture fails on, so near-misses read as near-misses. */
  private readonly breakWobble: number;
  private readonly verdictStart: number;
  private readonly duration: number;
  private readonly restPos: THREE.Vector3;
  private readonly throwFrom: THREE.Vector3;
  private readonly targetBaseScale: number;
  private readonly glow: number;

  private firedThrow = false;
  private firedImpact = false;
  private firedSettle = false;
  private firedVerdict = false;
  private clicksFired = 0;
  private sparkleIndex = -1;
  private trailTimer = 0;

  constructor(private target: Creep, ballType: BallType, chance: number, private stage: CaptureStage) {
    this.success = Math.random() < chance;
    this.glow = BALL_GLOW[ballType];
    this.targetBaseScale = target.group.scale.x;
    this.restPos = target.position.clone().setY(BALL_REST_Y);

    // A likelier catch tends to break late, so a lost 90% roll still gets its
    // third-wobble heartbreak instead of popping open immediately.
    const roll = Math.random();
    this.breakWobble = roll < 0.4 - chance * 0.3 ? 0 : roll < 0.78 - chance * 0.2 ? 1 : 2;
    this.verdictStart = this.success ? T_LOCK : T_SETTLE + this.breakWobble * WOBBLE_PERIOD + WOBBLE_CLICK + 0.16;
    this.duration = this.verdictStart + (this.success ? VERDICT_HOLD_SUCCESS : VERDICT_HOLD_FAIL);

    this.hud = {
      phase: 'windup',
      ballName: BALL_NAMES[ballType],
      ballType,
      targetName: target.name.toUpperCase(),
      chance,
      wobbles: 0,
      totalWobbles: WOBBLE_COUNT,
      tension: 0,
      letterbox: 0,
      verdict: null,
      caption: 'CAPTURE ATTEMPT',
    };

    // The throw comes in over the player's shoulder from outside the arena.
    const inward = this.restPos.clone().normalize();
    this.throwFrom = this.restPos.clone().addScaledVector(inward, 13).setY(5.5);

    this.ball = this.createBall(ballType);
    this.ballTop = this.ball.children[0] as THREE.Mesh;
    this.ballBottom = this.ball.children[1] as THREE.Mesh;
    this.ball.position.copy(this.throwFrom);
    this.ball.visible = false;
    this.group.add(this.ball);

    this.ballLight = new THREE.PointLight(this.glow, 0, 9);
    this.group.add(this.ballLight);

    // Single hard spot on the ball once the floodlights drop away.
    this.spotlight = new THREE.SpotLight(0xfff4d6, 0, 34, Math.PI / 9, 0.45, 1.4);
    this.spotlight.position.copy(this.restPos).add(new THREE.Vector3(0, 18, 2));
    this.spotlight.target.position.copy(this.restPos);
    this.group.add(this.spotlight, this.spotlight.target);

    // Suction funnel drawn from the target down into the ball's mouth.
    this.beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 2.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: this.glow, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.beam.visible = false;
    this.group.add(this.beam);

    this.flash = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xdffcff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.copy(this.restPos).setY(0.08);
    this.group.add(this.flash);

    stage.camera.beginCinematic(this.restPos, 9.5, 3.2, 0.3);
    stage.audio.duckCrowd(0.25, 0.5);
    stage.audio.playCaptureWindup();
  }

  /** How fast the rest of the game should run right now: 1 is real time. */
  public get worldTimeScale(): number {
    const t = this.elapsed;
    if (t < T_THROW) return THREE.MathUtils.lerp(1, 0.3, t / T_THROW);
    if (t < T_IMPACT) return 0.3;
    if (t < T_ABSORB_END) return 0.1;
    if (t < this.verdictStart) return 0.04;
    // Real time snaps back as the verdict lands, which is what sells the hit.
    const since = t - this.verdictStart;
    return THREE.MathUtils.clamp(0.04 + since * (this.success ? 1.1 : 2.4), 0.04, 1);
  }

  /** Floodlight dimming, 0 = normal stadium lighting, 1 = blackout. */
  public get floodlightDim(): number {
    const fadeIn = THREE.MathUtils.clamp(this.elapsed / T_THROW, 0, 1);
    const fadeOut = THREE.MathUtils.clamp((this.elapsed - this.verdictStart) / 0.6, 0, 1);
    return 0.72 * fadeIn * (1 - fadeOut);
  }

  /** Returns the outcome once the whole set piece has played out. */
  public update(dt: number): boolean | null {
    this.elapsed += dt;
    const t = this.elapsed;

    this.hud.letterbox = THREE.MathUtils.clamp(t / 0.35, 0, 1)
      * (1 - THREE.MathUtils.clamp((t - this.verdictStart - 0.7) / 0.5, 0, 1));
    this.spotlight.intensity = 18 * (this.floodlightDim / 0.72);

    if (t < T_THROW) this.updateWindup(t);
    else if (t < T_IMPACT) this.updateThrow(t, dt);
    else if (t < T_ABSORB_END) this.updateAbsorb(t);
    else if (t < T_SETTLE) this.updateDrop(t);
    else if (t < this.verdictStart) this.updateWobble(t);
    else this.updateVerdict(t);

    this.ballLight.position.copy(this.ball.position);
    return t >= this.duration ? this.success : null;
  }

  private updateWindup(t: number): void {
    this.hud.phase = 'windup';
    this.hud.caption = `${this.hud.ballName} · ${(this.hud.chance * 100).toFixed(0)}% CATCH RATE`;
    this.hud.tension = 0.25 * (t / T_THROW);
  }

  private updateThrow(t: number, dt: number): void {
    this.hud.phase = 'throw';
    this.hud.caption = 'THE THROW!';
    this.hud.tension = 0.35;
    if (!this.firedThrow) {
      this.firedThrow = true;
      this.ball.visible = true;
      this.stage.audio.playCaptureThrow();
      this.stage.announcer.trigger('capture_throw', this.hud.targetName);
    }

    const p = (t - T_THROW) / (T_IMPACT - T_THROW);
    const apex = this.target.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.ball.position.lerpVectors(this.throwFrom, apex, p * p * (3 - 2 * p));
    this.ball.position.y += Math.sin(p * Math.PI) * 3.2;
    this.ball.rotation.z += dt * 22;
    this.ballLight.intensity = 2.5;

    this.trailTimer += dt;
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0;
      this.stage.particles.emitTrail(this.ball.position, this.glow, 0.7);
    }
  }

  private updateAbsorb(t: number): void {
    this.hud.phase = 'absorb';
    this.hud.caption = 'IT\'S IN THE BALL!';
    const p = (t - T_IMPACT) / (T_ABSORB_END - T_IMPACT);
    this.hud.tension = 0.45 + p * 0.1;

    if (!this.firedImpact) {
      this.firedImpact = true;
      this.stage.audio.playCaptureAbsorb();
      this.stage.camera.shake(0.45);
      this.stage.camera.punchZoom(9);
      this.stage.camera.setCinematicFraming(6.4, 2.1);
      this.stage.particles.emitImpact(this.target.position, 0xffffff, 26, 7);
      this.stage.particles.emitRing(this.restPos, this.glow, 2.6, 0.5);
    }

    // Ball hangs open above the target while the target streams into it.
    const hover = this.target.position.clone().add(new THREE.Vector3(0, 0.55 + (1 - p) * 0.9, 0));
    this.ball.position.copy(hover);
    this.ball.rotation.z = THREE.MathUtils.lerp(this.ball.rotation.z % (Math.PI * 2), 0, p);

    // Halves swing apart, then snap shut over the final quarter of the beat.
    const open = p < 0.75 ? Math.sin(Math.min(1, p / 0.55) * Math.PI * 0.5) : (1 - (p - 0.75) / 0.25);
    this.ballTop.position.y = open * 0.42;
    this.ballBottom.position.y = -open * 0.12;

    const shrink = Math.max(0.03, 1 - Math.pow(p, 0.7));
    this.target.group.scale.setScalar(this.targetBaseScale * shrink);
    this.target.group.visible = p < 0.9;

    this.beam.visible = p < 0.9;
    if (this.beam.visible) {
      const top = this.target.position.clone().add(new THREE.Vector3(0, 1.1 * shrink, 0));
      const mouth = this.ball.position;
      this.beam.position.lerpVectors(mouth, top, 0.5);
      this.beam.scale.set(shrink * 1.1 + 0.15, Math.max(0.2, top.distanceTo(mouth)) / 2.2, shrink * 1.1 + 0.15);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - p * 0.5);
      if (Math.random() < 0.6) this.stage.particles.emitTrail(top, this.glow, 0.5);
    }

    const flashMat = this.flash.material as THREE.MeshBasicMaterial;
    flashMat.opacity = 0.9 * (1 - p);
    this.flash.scale.setScalar(1 + p * 9);
    this.ballLight.intensity = 6 * (1 - p * 0.6);
  }

  private updateDrop(t: number): void {
    this.hud.phase = 'drop';
    this.hud.caption = 'AND IT FALLS...';
    this.hud.tension = 0.55;
    this.beam.visible = false;
    this.target.group.visible = false;

    // Two decaying bounces onto the pitch.
    const p = (t - T_ABSORB_END) / (T_SETTLE - T_ABSORB_END);
    const drop = 1.45;
    const height = Math.abs(Math.cos(p * Math.PI * 2.5)) * drop * Math.pow(1 - p, 2.1);
    this.ball.position.set(this.restPos.x, BALL_REST_Y + height, this.restPos.z);
    this.ball.rotation.z = Math.sin(p * 9) * 0.35 * (1 - p);
    this.ballLight.intensity = 1.6;

    if (!this.firedSettle && p > 0.9) {
      this.firedSettle = true;
      this.stage.audio.playCaptureLand();
      this.stage.camera.setCinematicFraming(4.6, 1.5);
      this.stage.particles.emitGroundBurst(this.restPos, 0xdad3c4, 1.2, 14);
    }
  }

  private updateWobble(t: number): void {
    this.hud.phase = 'wobble';
    const index = Math.floor((t - T_SETTLE) / WOBBLE_PERIOD);
    const local = (t - T_SETTLE) - index * WOBBLE_PERIOD;
    this.hud.wobbles = Math.min(WOBBLE_COUNT, this.clicksFired);
    this.hud.tension = 0.6 + 0.13 * (index + 1);
    this.hud.caption = ['ONE...', 'TWO...', 'THREE...'][Math.min(2, index)];

    // Swing out, snap back, then hold dead still — the stillness is the tension.
    const swing = local < 0.5 ? Math.sin((local / 0.5) * Math.PI) : 0;
    const dir = index % 2 === 0 ? 1 : -1;
    const amplitude = 0.2 + index * 0.06;
    this.ball.rotation.z = swing * dir * (0.5 + index * 0.16);
    this.ball.position.set(
      this.restPos.x + swing * dir * amplitude,
      BALL_REST_Y + swing * 0.1,
      this.restPos.z,
    );
    this.ballLight.intensity = 1.2 + swing * 2.4;

    if (this.clicksFired <= index && local >= WOBBLE_CLICK) {
      this.clicksFired = index + 1;
      this.hud.wobbles = this.clicksFired;
      this.stage.audio.playCaptureWobble(index);
      this.stage.camera.shake(0.1 + index * 0.05);
      this.stage.particles.emitImpact(this.restPos, this.glow, 5, 2.4);
    }
  }

  private updateVerdict(t: number): void {
    this.hud.phase = 'verdict';
    const p = t - this.verdictStart;

    if (!this.firedVerdict) {
      this.firedVerdict = true;
      this.hud.verdict = this.success ? 'caught' : 'broke';
      this.hud.wobbles = this.success ? WOBBLE_COUNT : this.clicksFired;
      this.stage.camera.punchZoom(this.success ? 12 : 14);
      this.stage.camera.setCinematicFraming(this.success ? 8.5 : 7, this.success ? 3.6 : 2.6);
      this.stage.camera.shake(this.success ? 0.4 : 0.8);
      this.stage.audio.duckCrowd(this.success ? 1.9 : 1.1, 0.25);
      if (this.success) {
        this.stage.audio.playCaptureLock();
        this.stage.particles.emitRing(this.restPos, 0xffe46b, 4.2, 0.8);
        this.stage.particles.emitAura(this.restPos, 0xffe46b, 30, 1.6);
      } else {
        this.stage.audio.playCaptureBreak();
        this.stage.particles.emitImpact(this.restPos, 0xffffff, 40, 12);
        this.stage.particles.emitGroundBurst(this.restPos, this.glow, 2.4, 26);
        this.target.group.visible = true;
      }
    }

    // The verdict word owns the centre of the screen; the caption plays support.
    this.hud.caption = this.success
      ? `${this.hud.targetName} JOINS THE ROSTER!`
      : `${this.hud.targetName} SLIPPED THE BALL!`;
    this.hud.tension = Math.max(0, 1 - p);

    if (this.success) {
      // Locked: the ball settles, pulses gold, then lifts away in triumph.
      const lift = Math.max(0, p - 0.55);
      this.ball.rotation.z = 0;
      this.ball.position.set(this.restPos.x, BALL_REST_Y + lift * lift * 2.6, this.restPos.z);
      this.ballLight.color.setHex(0xffe46b);
      this.ballLight.intensity = 4 + Math.sin(p * 22) * 2.6;
      const sparkle = Math.floor(p * 14);
      if (sparkle !== this.sparkleIndex) {
        this.sparkleIndex = sparkle;
        this.stage.particles.emitTrail(this.ball.position, 0xffe46b, 1.1);
      }
      const fade = THREE.MathUtils.clamp((p - 0.9) / 0.7, 0, 1);
      this.ball.visible = fade < 1;
      this.setBallOpacity(1 - fade);
    } else {
      // Burst: halves fly apart and the target snaps back to full size.
      const burst = Math.min(1, p / 0.35);
      this.ballTop.position.y = burst * 1.6;
      this.ballBottom.position.y = -burst * 0.4;
      this.ball.rotation.z += burst * 0.3;
      this.ball.visible = p < 0.45;
      this.ballLight.intensity = 8 * (1 - burst);
      const bounce = 1 + Math.sin(Math.min(1, p / 0.5) * Math.PI) * 0.35;
      this.target.group.scale.setScalar(this.targetBaseScale * Math.min(bounce, THREE.MathUtils.clamp(p / 0.18, 0.05, 1) * bounce));
    }
  }

  private setBallOpacity(opacity: number): void {
    this.ball.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        material.transparent = opacity < 1;
        material.opacity = opacity;
      }
    });
  }

  public dispose(scene: THREE.Scene): void {
    this.stage.camera.releaseCinematic();
    this.stage.audio.duckCrowd(1, 1.2);
    scene.remove(this.group);
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach(m => m.dispose()); else material.dispose();
      }
    });
  }

  private createBall(type: BallType): THREE.Group {
    const [top, bottom] = BALL_COLORS[type];
    const root = new THREE.Group();
    const shell = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3 });
    const topHalf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell(top));
    const bottomHalf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell(bottom));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 20), new THREE.MeshBasicMaterial({ color: 0x151922 }));
    band.rotation.x = Math.PI / 2;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    button.position.z = 0.32;
    // Order matters: update() drives children[0] and children[1] as the halves.
    root.add(topHalf, bottomHalf, band, button);
    return root;
  }
}
