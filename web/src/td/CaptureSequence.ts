/**
 * CaptureSequence.ts — The Capture Set Piece
 *
 * A capture attempt is the game's biggest single moment, so it is staged like
 * one: the world drops into slow motion, the stadium lights fall to a single
 * spot, the crowd holds its breath, and the camera swings into a low hero shot.
 *
 * The player still has one thing to do. The throw is a timing check, not a
 * click: a marker sweeps the release meter and where it stops decides how much
 * the odds move. Only then does the beat sheet run — throw, absorb, drop,
 * wobble, verdict.
 *
 * The sequence owns only its own presentation. It publishes a `hud` snapshot
 * the UI reads and a `worldTimeScale` the game multiplies into its delta, so
 * neither has to know the beat sheet.
 */
import * as THREE from 'three';
import { Creep } from './Creep';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumCamera } from '../engine/StadiumCamera';
import { StadiumAudio } from '../engine/StadiumAudio';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumArena } from '../stadium/StadiumArena';

export type BallType = 'poke' | 'great' | 'ultra';
export type CapturePhase = 'aim' | 'throw' | 'absorb' | 'drop' | 'wobble' | 'verdict';

export interface CaptureStage {
  particles: ParticleSystem;
  camera: StadiumCamera;
  audio: StadiumAudio;
  announcer: StadiumAnnouncer;
  arena: StadiumArena;
}

/** Release-meter state while the player is winding up the throw. */
export interface CaptureAim {
  /** Sweeping marker, 0..1 across the meter. */
  marker: number;
  zoneStart: number;
  zoneEnd: number;
  /** Where the player actually released, once they have. */
  released: number | null;
  /** Odds the release added or removed, as a signed fraction. */
  bonus: number;
  grade: 'perfect' | 'good' | 'wide' | null;
}

/** Everything the cinematic overlay needs; mutated in place each frame. */
export interface CaptureHud {
  phase: CapturePhase;
  ballName: string;
  ballType: BallType;
  targetName: string;
  /** Live odds: the base rate until the throw lands, then the adjusted rate. */
  chance: number;
  aim: CaptureAim | null;
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

/**
 * Rarer quarry earns a longer, tighter set piece: more wobbles to survive,
 * slower holds between them, and a narrower release window.
 */
const THREAT_PROFILE = {
  normal: { wobbles: 3, period: 0.85, zone: 0.26, sweep: 1.15 },
  elite: { wobbles: 3, period: 1.0, zone: 0.19, sweep: 1.4 },
  titan: { wobbles: 4, period: 1.15, zone: 0.13, sweep: 1.75 },
} as const;

// Beat offsets measured from the moment the ball leaves the hand.
const D_IMPACT = 0.55;
const D_ABSORB = 0.7;
const D_DROP = 0.7;
const D_LOCK_PAUSE = 0.3;
const WOBBLE_CLICK = 0.46;
const VERDICT_HOLD_SUCCESS = 1.9;
const VERDICT_HOLD_FAIL = 1.3;
const AIM_TIMEOUT = 3.4;
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
  private readonly profile: typeof THREAT_PROFILE[keyof typeof THREAT_PROFILE];
  private readonly baseChance: number;
  private readonly restPos: THREE.Vector3;
  private readonly throwFrom: THREE.Vector3;
  private readonly targetBaseScale: number;
  private readonly targetBaseY: number;
  private readonly glow: number;

  // Resolved at release, when the throw actually happens.
  private throwAt = 0;
  private success = false;
  private breakWobble = 0;
  private beats = { impact: 0, absorbEnd: 0, settle: 0, verdict: 0, end: 0 };

  private firedImpact = false;
  private firedSettle = false;
  private firedVerdict = false;
  private clicksFired = 0;
  private sparkleIndex = -1;
  private trailTimer = 0;

  constructor(private target: Creep, ballType: BallType, chance: number, private stage: CaptureStage) {
    this.baseChance = chance;
    this.glow = BALL_GLOW[ballType];
    this.profile = THREAT_PROFILE[target.threat];
    this.targetBaseScale = target.group.scale.x;
    this.targetBaseY = target.group.position.y;
    this.restPos = target.position.clone().setY(BALL_REST_Y);

    const zoneStart = 0.12 + Math.random() * (0.76 - this.profile.zone);
    this.hud = {
      phase: 'aim',
      ballName: BALL_NAMES[ballType],
      ballType,
      targetName: target.name.toUpperCase(),
      chance,
      aim: { marker: 0, zoneStart, zoneEnd: zoneStart + this.profile.zone, released: null, bonus: 0, grade: null },
      wobbles: 0,
      totalWobbles: this.profile.wobbles,
      tension: 0,
      letterbox: 0,
      verdict: null,
      caption: 'TIME YOUR THROW',
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

    stage.camera.beginCinematic(this.restPos, 9.5, 3.2, 0.3, this.clearestAngle());
    stage.arena.setCrowdMood(-1);
    stage.audio.duckCrowd(0.25, 0.5);
    stage.audio.playCaptureWindup();
  }

  public get awaitingRelease(): boolean {
    return this.hud.phase === 'aim';
  }

  /** The player's throw input. Locks in the odds and starts the beat sheet. */
  public release(): void {
    if (!this.awaitingRelease) return;
    const aim = this.hud.aim!;
    const centre = (aim.zoneStart + aim.zoneEnd) / 2;
    const halfZone = (aim.zoneEnd - aim.zoneStart) / 2;
    const offset = Math.abs(aim.marker - centre);

    // Dead centre is worth a quarter again on top of the odds; a wide throw costs.
    if (offset <= halfZone * 0.3) { aim.grade = 'perfect'; aim.bonus = 0.25; }
    else if (offset <= halfZone) { aim.grade = 'good'; aim.bonus = 0.12; }
    else { aim.grade = 'wide'; aim.bonus = -0.1; }

    aim.released = aim.marker;
    this.hud.chance = THREE.MathUtils.clamp(this.baseChance + aim.bonus, 0.05, 0.98);

    this.success = Math.random() < this.hud.chance;
    // A likelier catch tends to break late, so a lost 90% roll still gets its
    // last-wobble heartbreak instead of popping open immediately.
    const roll = Math.random();
    const last = this.profile.wobbles - 1;
    this.breakWobble = roll < 0.4 - this.hud.chance * 0.3 ? 0
      : roll < 0.78 - this.hud.chance * 0.2 ? Math.min(1, last)
      : last;

    this.throwAt = this.elapsed;
    const impact = this.throwAt + D_IMPACT;
    const absorbEnd = impact + D_ABSORB;
    const settle = absorbEnd + D_DROP;
    const lock = settle + this.profile.wobbles * this.profile.period + D_LOCK_PAUSE;
    const verdict = this.success
      ? lock
      : settle + this.breakWobble * this.profile.period + WOBBLE_CLICK + 0.16;
    this.beats = {
      impact, absorbEnd, settle, verdict,
      end: verdict + (this.success ? VERDICT_HOLD_SUCCESS : VERDICT_HOLD_FAIL),
    };

    this.hud.phase = 'throw';
    this.ball.visible = true;
    this.stage.audio.playCaptureThrow();
    this.stage.announcer.trigger('capture_throw', this.hud.targetName);
    if (aim.grade === 'perfect') this.stage.camera.punchZoom(6);
  }

  /** How fast the rest of the game should run right now: 1 is real time. */
  public get worldTimeScale(): number {
    const t = this.elapsed;
    if (this.awaitingRelease) {
      // Near-stopped while aiming, so the meter is the only thing moving.
      return THREE.MathUtils.lerp(1, 0.06, Math.min(1, t / 0.4));
    }
    if (t < this.beats.impact) return 0.3;
    if (t < this.beats.absorbEnd) return 0.1;
    if (t < this.beats.verdict) return 0.04;
    // Real time snaps back as the verdict lands, which is what sells the hit.
    const since = t - this.beats.verdict;
    return THREE.MathUtils.clamp(0.04 + since * (this.success ? 1.1 : 2.4), 0.04, 1);
  }

  /** Floodlight dimming, 0 = normal stadium lighting, 1 = blackout. */
  public get floodlightDim(): number {
    const fadeIn = THREE.MathUtils.clamp(this.elapsed / 0.5, 0, 1);
    const fadeOut = this.awaitingRelease
      ? 0
      : THREE.MathUtils.clamp((this.elapsed - this.beats.verdict) / 0.6, 0, 1);
    return 0.72 * fadeIn * (1 - fadeOut);
  }

  /** Returns the outcome once the whole set piece has played out. */
  public update(dt: number): boolean | null {
    this.elapsed += dt;
    const t = this.elapsed;

    const closing = this.awaitingRelease ? 0 : THREE.MathUtils.clamp((t - this.beats.verdict - 0.7) / 0.5, 0, 1);
    this.hud.letterbox = THREE.MathUtils.clamp(t / 0.35, 0, 1) * (1 - closing);
    this.spotlight.intensity = 18 * (this.floodlightDim / 0.72);

    if (this.awaitingRelease) this.updateAim(t, dt);
    else if (t < this.beats.impact) this.updateThrow(t, dt);
    else if (t < this.beats.absorbEnd) this.updateAbsorb(t);
    else if (t < this.beats.settle) this.updateDrop(t);
    else if (t < this.beats.verdict) this.updateWobble(t);
    else this.updateVerdict(t);

    this.ballLight.position.copy(this.ball.position);
    return !this.awaitingRelease && t >= this.beats.end ? this.success : null;
  }

  private updateAim(t: number, dt: number): void {
    const aim = this.hud.aim!;
    // Ping-pong sweep: the marker runs the meter and turns around at each end.
    const cycle = (t * this.profile.sweep) % 2;
    aim.marker = cycle <= 1 ? cycle : 2 - cycle;
    this.hud.tension = 0.3 + Math.min(0.25, t * 0.1);
    this.hud.caption = 'TIME YOUR THROW';

    // The target senses it coming and starts to brace.
    this.target.group.position.y = this.targetBaseY + Math.sin(t * 9) * 0.04;

    if (t >= AIM_TIMEOUT) this.release();
    else if (dt > 0 && Math.random() < dt * 0.6) this.stage.particles.emitTrail(this.restPos, this.glow, 0.4);
  }

  private updateThrow(t: number, dt: number): void {
    this.hud.phase = 'throw';
    const aim = this.hud.aim!;
    this.hud.caption = aim.grade === 'perfect' ? 'A PERFECT THROW!'
      : aim.grade === 'good' ? 'GOOD THROW!' : 'IT SAILS WIDE...';
    this.hud.tension = 0.4;

    const p = (t - this.throwAt) / D_IMPACT;
    const apex = this.target.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.ball.position.lerpVectors(this.throwFrom, apex, p * p * (3 - 2 * p));
    this.ball.position.y += Math.sin(p * Math.PI) * 3.2;
    this.ball.rotation.z += dt * 22;
    this.ballLight.intensity = 2.5;

    // Flinch away from the incoming ball.
    this.target.group.position.y = this.targetBaseY + Math.sin(t * 14) * 0.06 * p;
    this.target.group.rotation.z = Math.sin(t * 11) * 0.07 * p;

    this.trailTimer += dt;
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0;
      this.stage.particles.emitTrail(this.ball.position, this.glow, 0.7);
    }
  }

  private updateAbsorb(t: number): void {
    this.hud.phase = 'absorb';
    this.hud.caption = 'IT\'S IN THE BALL!';
    const p = (t - this.beats.impact) / D_ABSORB;
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

    // It struggles against the pull the whole way in, hardest at the start.
    const struggle = (1 - p) * 0.5;
    this.target.group.rotation.z = Math.sin(t * 38) * 0.22 * struggle;
    this.target.group.rotation.y += Math.sin(t * 27) * 0.06 * struggle;

    const shrink = Math.max(0.03, 1 - Math.pow(p, 0.7));
    this.target.group.scale.setScalar(this.targetBaseScale * shrink);
    this.target.group.position.y = this.targetBaseY + p * 0.5;
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
    this.target.group.rotation.z = 0;

    // Two decaying bounces onto the pitch.
    const p = (t - this.beats.absorbEnd) / D_DROP;
    const height = Math.abs(Math.cos(p * Math.PI * 2.5)) * 1.45 * Math.pow(1 - p, 2.1);
    this.ball.position.set(this.restPos.x, BALL_REST_Y + height, this.restPos.z);
    this.ball.rotation.z = Math.sin(p * 9) * 0.35 * (1 - p);
    this.ballLight.intensity = 1.6;

    if (!this.firedSettle && p > 0.9) {
      this.firedSettle = true;
      this.stage.audio.playCaptureLand();
      this.stage.camera.setCinematicFraming(this.target.threat === 'titan' ? 4.0 : 4.6, 1.5);
      this.stage.particles.emitGroundBurst(this.restPos, 0xdad3c4, 1.2, 14);
    }
  }

  private updateWobble(t: number): void {
    this.hud.phase = 'wobble';
    const index = Math.floor((t - this.beats.settle) / this.profile.period);
    const local = (t - this.beats.settle) - index * this.profile.period;
    this.hud.wobbles = Math.min(this.profile.wobbles, this.clicksFired);
    this.hud.tension = 0.6 + 0.1 * (index + 1);
    this.hud.caption = ['ONE...', 'TWO...', 'THREE...', 'FOUR...'][Math.min(3, index)];

    // Swing out, snap back, then hold dead still — the stillness is the tension.
    const swing = local < 0.5 ? Math.sin((local / 0.5) * Math.PI) : 0;
    const dir = index % 2 === 0 ? 1 : -1;
    this.ball.rotation.z = swing * dir * (0.5 + index * 0.16);
    this.ball.position.set(
      this.restPos.x + swing * dir * (0.2 + index * 0.06),
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
    const p = t - this.beats.verdict;

    if (!this.firedVerdict) {
      this.firedVerdict = true;
      this.hud.verdict = this.success ? 'caught' : 'broke';
      this.hud.wobbles = this.success ? this.profile.wobbles : this.clicksFired;
      this.stage.camera.punchZoom(this.success ? 12 : 14);
      this.stage.camera.setCinematicFraming(this.success ? 8.5 : 7, this.success ? 3.6 : 2.6);
      this.stage.camera.shake(this.success ? 0.4 : 0.8);
      this.stage.audio.duckCrowd(this.success ? 1.9 : 1.1, 0.25);
      // The stands erupt on a catch and deflate into a murmur on a break.
      this.stage.arena.setCrowdMood(this.success ? 1 : -0.35);
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

    if (this.success) this.updateLock(p);
    else this.updateBreak(p);
  }

  private updateLock(p: number): void {
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
  }

  private updateBreak(p: number): void {
    // Burst: halves fly apart and the target shakes itself off, defiant.
    const burst = Math.min(1, p / 0.35);
    this.ballTop.position.y = burst * 1.6;
    this.ballBottom.position.y = -burst * 0.4;
    this.ball.rotation.z += burst * 0.3;
    this.ball.visible = p < 0.45;
    this.ballLight.intensity = 8 * (1 - burst);

    const reappear = THREE.MathUtils.clamp(p / 0.18, 0.05, 1);
    const bounce = 1 + Math.sin(Math.min(1, p / 0.5) * Math.PI) * 0.35;
    this.target.group.scale.setScalar(this.targetBaseScale * Math.min(bounce, reappear * bounce));
    // A hard shake-off that decays over the first half second.
    const defiance = Math.max(0, 1 - p / 0.55);
    this.target.group.rotation.z = Math.sin(p * 46) * 0.3 * defiance;
    this.target.group.position.y = this.targetBaseY + Math.abs(Math.sin(p * 16)) * 0.35 * defiance;
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

  /**
   * Orbit start angle. The camera sits on the pitch-centre side of the target
   * and looks outward: a capture near the rim would otherwise open the shot
   * inside the grandstand wall behind it.
   */
  private clearestAngle(): number {
    return Math.atan2(-this.restPos.x, -this.restPos.z);
  }

  public dispose(scene: THREE.Scene): void {
    this.stage.camera.releaseCinematic();
    this.stage.audio.duckCrowd(1, 1.2);
    this.stage.arena.setCrowdMood(0);
    this.target.group.rotation.z = 0;
    this.target.group.position.y = this.targetBaseY;
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
