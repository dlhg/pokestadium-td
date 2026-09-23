/**
 * CaptureSequence.ts — The Capture Set Piece
 *
 * A capture attempt is the game's biggest single moment, so it is staged like
 * one: the world drops into slow motion, the stadium lights fall to a single
 * spot, the crowd holds its breath, and the camera swings into a low hero shot.
 *
 * The player still has one thing to do. The throw is a timing check, not a
 * click: a marker sweeps the release meter and where it stops decides how much
 * the odds move. Only then does the beat sheet run, and it runs the way the
 * anime does it:
 *
 *   throw → the ball *strikes* the Pokémon and rebounds, cracking open
 *         → it freezes mid-air, mouth turned back toward its quarry
 *         → the Pokémon becomes light, and a jagged tether snaps onto it
 *         → the light is dragged down the tether and swallowed
 *         → the shell slams shut, and the ball stays where it stopped
 *         → it ticks there, suspended, button flashing, while nobody knows
 *         → verdict, still in mid-air.
 *
 * The freeze is the whole trick: contact and rebound are fast and physical,
 * then everything stops and never restarts. The ball is airborne from the
 * rebound to the end and never touches the pitch — a catch simply stops
 * arguing and lifts away, and a break bursts where it hangs.
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
import { EnergyForm } from '../engine/EnergyForm';
import { JaggedBeam } from '../engine/JaggedBeam';
import { LANE_RIDE_HEIGHT } from './MapTerrain';

export type BallType = 'poke' | 'great' | 'ultra';
export const BALL_PRICES: Record<BallType, number> = { poke: 35, great: 85, ultra: 170 };
/** Picker order, which is also the 1–2–3 hotkey order. */
export const BALL_ORDER: readonly BallType[] = ['poke', 'great', 'ultra'];
export type CapturePhase =
  | 'aim' | 'throw' | 'strike' | 'hang' | 'absorb' | 'snap' | 'wobble' | 'verdict';

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
  /** 'sweep' repeats back and forth all window long; 'single' crosses the
   *  zone exactly once, for rarer quarry that shouldn't be this easy to read. */
  variant: 'sweep' | 'single';
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
  /** 1 at the start of the aim window, draining to 0 at the auto-release timeout. */
  aimTimeLeft: number;
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
 *
 * The zones were all wider and the sweeps all slower until playtesting found
 * the meter was not a check at all — a `good` throw was the default outcome
 * and `perfect` came up often enough that the odds read-out barely mattered.
 * Each zone lost roughly a third of its width and each sweep gained speed, so
 * the marker now crosses a normal zone in ~0.13s and a titan's in ~0.04s:
 * still readable, no longer free.
 */
const THREAT_PROFILE = {
  normal: { wobbles: 3, period: 0.7, zone: 0.18, sweep: 1.5 },
  elite: { wobbles: 3, period: 0.85, zone: 0.125, sweep: 1.95 },
  titan: { wobbles: 4, period: 1.0, zone: 0.085, sweep: 2.45 },
} as const;

// Beat lengths measured from the moment the ball leaves the hand. The whole
// run-up to the first wobble was already trimmed once for being a very
// frequent moment (round 2 feedback #18), so the anime beats added since had
// to buy their time back out of the beats either side of them: the flight and
// the drop are both shorter than they were, and the freeze costs almost
// nothing because the world is stopped inside it.
const D_FLIGHT = 0.36;
/** Rebound off the body, with the shell cracking open as it goes. */
const D_STRIKE = 0.2;
/** Stopped dead mid-air, turning its mouth back toward the target. */
const D_HANG = 0.14;
/** The tether reaches out, catches, and drinks. */
const D_ABSORB = 0.44;
/** Halves slam home. */
const D_SNAP = 0.1;
/** Closed and still suspended — the beat before the ticking starts. */
const D_HOLD = 0.24;
const D_LOCK_PAUSE = 0.2;
const WOBBLE_CLICK = 0.46;
const VERDICT_HOLD_SUCCESS = 1.3;
const VERDICT_HOLD_FAIL = 1.0;
const AIM_TIMEOUT = 3.4;
// Keep the ball's lowest point just above the pitch so terrain variation and
// shadowing do not make it visibly clip once it finally lands.
const BALL_REST_Y = 0.46;
const BALL_RADIUS = 0.34;
// The two shell halves need a little overlap at the equator. Exact tangency
// leaves a lighting/rasterization hairline during the closed part of capture.
const BALL_SHELL_OVERLAP = 0.025;
const CAMERA_ANGLE_SAMPLES = 32;
const CAMERA_OBSTACLE_MARGIN = 0.45;
/** The ball's mouth opens along its own +Y; aiming it means pointing that axis. */
const BALL_MOUTH_AXIS = new THREE.Vector3(0, 1, 0);
const UPRIGHT = new THREE.Quaternion();
/** Dark and hot ends of the centre button's undecided flashing. */
const BUTTON_DARK = new THREE.Color(0x4a1015);
const BUTTON_HOT = new THREE.Color(0xff3b3b);
const BUTTON_IDLE = new THREE.Color(0xffffff);
export class CaptureSequence {
  public readonly group = new THREE.Group();
  public readonly hud: CaptureHud;

  private ball: THREE.Group;
  private ballTop: THREE.Mesh;
  private ballBottom: THREE.Mesh;
  private button: THREE.Mesh;
  private buttonMat: THREE.MeshBasicMaterial;
  private mouthGlow: THREE.Mesh;
  private ballLight: THREE.PointLight;
  private spotlight: THREE.SpotLight;
  private beam: JaggedBeam;
  private flash: THREE.Mesh;
  private sparkle: THREE.Group;

  private elapsed = 0;
  private readonly profile: typeof THREAT_PROFILE[keyof typeof THREAT_PROFILE];
  private readonly baseChance: number;
  private readonly restPos: THREE.Vector3;
  private readonly restY: number;
  private readonly throwFrom: THREE.Vector3;
  private readonly targetBaseScale: number;
  private readonly targetBaseY: number;
  private readonly targetBaseRotY: number;
  private readonly targetHeight: number;
  private readonly glow: number;

  // Resolved at release, when the throw actually happens.
  private throwAt = 0;
  private success = false;
  private breakWobble = 0;
  private beats = { impact: 0, hang: 0, absorb: 0, snap: 0, hold: 0, settle: 0, verdict: 0, end: 0 };

  /** Contact point on the body's near surface, and where the rebound stops. */
  private readonly impactPoint = new THREE.Vector3();
  private readonly hangPos = new THREE.Vector3();
  /** Where the tether is pinned on the target, fixed once it catches. */
  private readonly beamAnchor = new THREE.Vector3();
  /** Quaternion that turns the ball's mouth back onto its quarry. */
  private readonly aimQuat = new THREE.Quaternion();
  /** Ball orientation at the instant the freeze begins, to turn away from. */
  private readonly spinQuat = new THREE.Quaternion();
  private readonly targetHome = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly focusScratch = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();

  private energy: EnergyForm | null = null;

  private firedStrike = false;
  private firedHang = false;
  private firedAbsorb = false;
  private firedSnap = false;
  private firedSuspend = false;
  private firedVerdict = false;
  private firedRematerialize = false;
  private clicksFired = 0;
  private sparkleIndex = -1;
  private trailTimer = 0;
  private crackleTimer = 0;

  /**
   * `forceSuccess` fixes the verdict without shortening the set piece: the
   * safety net for a new trainer's last ball still wobbles like any other throw.
   */
  constructor(private target: Creep, ballType: BallType, chance: number, private stage: CaptureStage, private forceSuccess = false) {
    this.baseChance = chance;
    this.glow = BALL_GLOW[ballType];
    this.profile = THREAT_PROFILE[target.threat];
    this.targetBaseScale = target.group.scale.x;
    this.targetBaseY = target.group.position.y;
    this.targetBaseRotY = target.group.rotation.y;
    // Recorded now rather than at the absorb beat: a skip jumps straight to
    // the verdict, and a break still has to put the Pokémon back somewhere.
    this.targetHome.copy(target.group.position);
    // Optional throughout: the headless regression harness stages a capture
    // against a bare target with no model at all, and every beat that needs a
    // body falls back to a middling one rather than throwing.
    this.targetHeight = target.animPokemon?.height ?? 1.8;
    // The ball settles on whatever ground the target stands on, terrace or meadow.
    this.restY = target.position.y - LANE_RIDE_HEIGHT + BALL_REST_Y;
    this.restPos = target.position.clone().setY(this.restY);

    const zoneStart = 0.12 + Math.random() * (0.76 - this.profile.zone);
    const variant: CaptureAim['variant'] = target.threat === 'normal' ? 'sweep' : 'single';
    this.hud = {
      phase: 'aim',
      ballName: BALL_NAMES[ballType],
      ballType,
      targetName: target.name.toUpperCase(),
      chance,
      aim: { marker: 0, zoneStart, zoneEnd: zoneStart + this.profile.zone, released: null, bonus: 0, grade: null, variant },
      wobbles: 0,
      totalWobbles: this.profile.wobbles,
      tension: 0,
      aimTimeLeft: 1,
      letterbox: 0,
      verdict: null,
      caption: 'TIME YOUR THROW',
    };

    // The throw comes in over the player's shoulder from outside the arena.
    const inward = this.restPos.clone().setY(0).normalize();
    this.throwFrom = this.restPos.clone().addScaledVector(inward, 13).setY(this.restY - BALL_REST_Y + 5.5);

    this.ball = this.createBall(ballType);
    this.ballTop = this.ball.children[0] as THREE.Mesh;
    this.ballBottom = this.ball.children[1] as THREE.Mesh;
    this.button = this.ball.children[3] as THREE.Mesh;
    this.buttonMat = this.button.material as THREE.MeshBasicMaterial;
    this.mouthGlow = this.ball.children[4] as THREE.Mesh;
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

    // The tether the light is dragged down. Rebuilt in place every frame.
    this.beam = new JaggedBeam(this.glow, 18);
    this.group.add(this.beam.mesh);

    this.flash = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xdffcff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.copy(this.restPos).setY(this.restY - BALL_REST_Y + 0.08);
    this.group.add(this.flash);

    this.sparkle = this.createSparkle();
    this.group.add(this.sparkle);

    stage.camera.beginCinematic(this.restPos, 9.5, 3.2, 0.3, this.clearestAngle());
    stage.arena.setCrowdMood(-1);
    stage.arena.setCrowdTension?.(true);
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

    // Dead centre is worth a quarter again on top of the odds; a wide throw
    // costs enough to be felt, since the meter is the only part of a capture
    // the player actually controls. `perfect` is the middle fifth of the zone
    // rather than its middle third — with the narrower zones it has to be
    // earned, not fallen into.
    if (offset <= halfZone * 0.2) { aim.grade = 'perfect'; aim.bonus = 0.25; }
    else if (offset <= halfZone) { aim.grade = 'good'; aim.bonus = 0.09; }
    else { aim.grade = 'wide'; aim.bonus = -0.18; }

    aim.released = aim.marker;
    // Capped short of certainty: even a perfect throw at a battered target
    // leaves the wobbles something to decide.
    this.hud.chance = THREE.MathUtils.clamp(this.baseChance + aim.bonus, 0.04, 0.93);

    this.success = this.forceSuccess || Math.random() < this.hud.chance;
    // A likelier catch tends to break late, so a lost 90% roll still gets its
    // last-wobble heartbreak instead of popping open immediately.
    const roll = Math.random();
    const last = this.profile.wobbles - 1;
    this.breakWobble = roll < 0.4 - this.hud.chance * 0.3 ? 0
      : roll < 0.78 - this.hud.chance * 0.2 ? Math.min(1, last)
      : last;

    this.planImpact();

    this.throwAt = this.elapsed;
    const impact = this.throwAt + D_FLIGHT;
    const hang = impact + D_STRIKE;
    const absorb = hang + D_HANG;
    const snap = absorb + D_ABSORB;
    const hold = snap + D_SNAP;
    const settle = hold + D_HOLD;
    const lock = settle + this.profile.wobbles * this.profile.period + D_LOCK_PAUSE;
    const verdict = this.success
      ? lock
      : settle + this.breakWobble * this.profile.period + WOBBLE_CLICK + 0.16;
    this.beats = {
      impact, hang, absorb, snap, hold, settle, verdict,
      end: verdict + (this.success ? VERDICT_HOLD_SUCCESS : VERDICT_HOLD_FAIL),
    };

    this.hud.phase = 'throw';
    this.ball.visible = true;
    this.stage.audio.playCaptureThrow();
    this.stage.announcer.trigger('capture_throw', this.hud.targetName);
    if (aim.grade === 'perfect') this.stage.camera.punchZoom(6);
  }

  /**
   * Works out where the ball actually hits the body and where the rebound
   * carries it, once — everything from the strike to the drop is measured off
   * these two points, so the geometry has to be settled before the beat sheet
   * starts rather than recomputed against a target that is being eaten.
   */
  private planImpact(): void {
    const bodyCentre = this.bodyCentre(this.scratch.clone());
    const incoming = bodyCentre.clone().sub(this.throwFrom).normalize();
    const radius = THREE.MathUtils.clamp(this.targetHeight * 0.34, 0.3, 1.5);
    this.impactPoint.copy(bodyCentre).addScaledVector(incoming, -radius);

    // It comes off the body the way it went in, plus the lift and the sideways
    // kick that stop the rebound reading as a rewind of the throw. The distance
    // is measured in bodies, not metres: a fixed rebound that frames nicely off
    // an Onix leaves a Pidgey a speck at the far end of the shot.
    const back = new THREE.Vector3(-incoming.x, 0, -incoming.z).normalize();
    const lateral = new THREE.Vector3(-back.z, 0, back.x);
    // Generous on purpose: the ball is nearly as tall as a Pidgey, so a
    // rebound of one body length leaves less than a ball's width between the
    // two, and the tether strung across that gap has no room to read as
    // anything but glare. The freeze needs air in it.
    const reach = THREE.MathUtils.clamp(this.targetHeight * 1.5, 1.4, 3);
    this.hangPos.copy(this.impactPoint)
      .addScaledVector(back, reach)
      .addScaledVector(lateral, reach * 0.22)
      .add(new THREE.Vector3(0, reach * 0.55, 0));
    // Never let the freeze happen underground on a sloped terrace.
    this.hangPos.y = Math.max(this.hangPos.y, this.restY + 0.55);

    // Mouth-first, back down the line it just travelled.
    this.aimQuat.setFromUnitVectors(
      BALL_MOUTH_AXIS,
      this.impactPoint.clone().sub(this.hangPos).normalize(),
    );
  }

  /** Middle of the target's body in world space — what the ball aims at. */
  private bodyCentre(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.target.position).setY(this.target.position.y + this.targetHeight * 0.45);
  }

  /**
   * Framing for the contact-through-conversion beats. A stadium-scale shot is
   * wrong here: the subject is a ball and one Pokémon a body's length apart,
   * and how big that pair is depends entirely on what was thrown at.
   *
   * The floor on both numbers is not timidity. Towers are not authored
   * scenery, so `clearestAngle` cannot steer around them, and the game ghosts
   * whatever blocks the shot instead — push the lens close enough and a
   * ghosted Geodude two metres away becomes a screenful of translucent
   * polygons with the actual set piece somewhere behind it.
   */
  private get closeFraming(): { distance: number; height: number } {
    return {
      distance: THREE.MathUtils.clamp(5 + this.targetHeight * 1.8, 6.6, 10),
      height: THREE.MathUtils.clamp(1.8 + this.targetHeight * 0.6, 2.3, 4),
    };
  }

  /** Eases the cinematic onto the midpoint of the ball and its quarry. */
  private focusOnPair(dt: number, other: THREE.Vector3, rate: number): void {
    this.stage.camera.setCinematicFocus(
      this.focusScratch.copy(this.ball.position).lerp(other, 0.5),
      1 - Math.exp(-rate * dt),
    );
  }

  /** The point on the shell where the tether leaves the open mouth. */
  private mouthPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(BALL_MOUTH_AXIS)
      .applyQuaternion(this.ball.quaternion)
      .multiplyScalar(BALL_RADIUS * 0.9)
      .add(this.ball.position);
  }

  /** How fast the rest of the game should run right now: 1 is real time. */
  public get worldTimeScale(): number {
    const t = this.elapsed;
    if (this.awaitingRelease) {
      // Near-stopped while aiming, so the meter is the only thing moving.
      return THREE.MathUtils.lerp(1, 0.06, Math.min(1, t / 0.4));
    }
    if (t < this.beats.impact) return 0.3;
    // Contact is the one fast, physical beat in the whole sequence.
    if (t < this.beats.hang) return 0.12;
    // Then the world stops outright, and stays stopped through the conversion.
    if (t < this.beats.absorb) return 0.012;
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

  /** Jumps straight to the verdict beat. The outcome is already rolled the
   *  instant the throw releases (see `release`), so everything after that is
   *  presentation only — nothing left to decide, just to watch or not. Has
   *  no effect while still awaiting release; that's a real decision, not an
   *  animation to skip past. */
  public skip(): void {
    if (this.awaitingRelease) return;
    this.elapsed = Math.max(this.elapsed, this.beats.end);
    // The skipped beats own the conversion; without this the target would be
    // left wearing borrowed light for the rest of the match.
    this.restoreTarget();
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
    else if (t < this.beats.hang) this.updateStrike(t, dt);
    else if (t < this.beats.absorb) this.updateHang(t, dt);
    else if (t < this.beats.snap) this.updateAbsorb(t, dt);
    else if (t < this.beats.hold) this.updateSnap(t);
    else if (t < this.beats.settle) this.updateHold(t);
    else if (t < this.beats.verdict) this.updateWobble(t);
    else this.updateVerdict(t, dt);

    this.ballLight.position.copy(this.ball.position);
    return !this.awaitingRelease && t >= this.beats.end ? this.success : null;
  }

  private updateAim(t: number, dt: number): void {
    const aim = this.hud.aim!;
    if (aim.variant === 'sweep') {
      // Ping-pong sweep: the marker runs the meter and turns around at each end.
      const cycle = (t * this.profile.sweep) % 2;
      aim.marker = cycle <= 1 ? cycle : 2 - cycle;
    } else {
      // Single crossing: rarer quarry gets exactly one pass through the zone,
      // timed to land right as the window would otherwise auto-release.
      aim.marker = Math.min(1, t / AIM_TIMEOUT);
    }
    this.hud.tension = 0.3 + Math.min(0.25, t * 0.1);
    this.hud.aimTimeLeft = THREE.MathUtils.clamp(1 - t / AIM_TIMEOUT, 0, 1);
    this.hud.caption = aim.variant === 'single' ? 'ONE SHOT — TIME IT PERFECTLY' : 'TIME YOUR THROW';

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

    // Straight at the body now, not at a hover point above it: the whole
    // sequence hangs off the ball and the Pokémon actually touching.
    const p = (t - this.throwAt) / D_FLIGHT;
    this.ball.position.lerpVectors(this.throwFrom, this.impactPoint, p * p * (3 - 2 * p));
    this.ball.position.y += Math.sin(p * Math.PI) * 2.6;
    this.ball.rotation.z += dt * 22;
    this.ballLight.intensity = 2.5;
    this.buttonMat.color.copy(BUTTON_IDLE);

    // Flinch away from the incoming ball.
    this.target.group.position.y = this.targetBaseY + Math.sin(t * 14) * 0.06 * p;
    this.target.group.rotation.z = Math.sin(t * 11) * 0.07 * p;

    this.trailTimer += dt;
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0;
      this.stage.particles.emitTrail(this.ball.position, this.glow, 0.7);
    }
  }

  /**
   * Contact. The ball rebounds off the body and decelerates into the freeze,
   * cracking open on the way out — the shell opening is caused by the hit
   * rather than politely waiting until the ball has parked itself.
   */
  private updateStrike(t: number, dt: number): void {
    this.hud.phase = 'strike';
    this.hud.caption = 'DIRECT HIT!';
    const p = (t - this.beats.impact) / D_STRIKE;
    this.hud.tension = 0.45 + p * 0.08;

    if (!this.firedStrike) {
      this.firedStrike = true;
      this.stage.audio.playCaptureStrike();
      this.stage.camera.shake(0.5);
      this.stage.camera.punchZoom(6);
      const framing = this.closeFraming;
      this.stage.camera.setCinematicFraming(framing.distance, framing.height);
      // The world freezes a breath after this lands, so whatever is emitted
      // here hangs in the air for the rest of the beat. A few bright sparks
      // caught mid-flight read as stopped time; a white cloud reads as fog.
      this.stage.particles.emitImpact(this.impactPoint, this.glow, 8, 9);
      this.stage.particles.emitRing(this.restPos, this.glow, 2.4, 0.45);
    }

    // Ease-out: it leaves the body fast and arrives at the freeze with nothing
    // left, so the stop reads as momentum running out rather than a cut.
    const travel = 1 - Math.pow(1 - p, 2.4);
    this.ball.position.lerpVectors(this.impactPoint, this.hangPos, travel);
    this.ball.rotation.z += dt * 16 * (1 - p);

    // Hinge lets go over the first two thirds of the rebound.
    const open = THREE.MathUtils.smoothstep(p, 0.12, 0.75);
    this.setShellOpen(open);
    this.ballLight.intensity = 2.5 + open * 3;

    const strikeFlash = this.flash.material as THREE.MeshBasicMaterial;
    strikeFlash.opacity = 0.7 * (1 - p);
    this.flash.scale.setScalar(1 + p * 5);

    // Knocked back by the hit, recovering into a brace.
    const recoil = Math.max(0, 1 - p * 1.6);
    this.target.group.rotation.z = Math.sin(t * 30) * 0.16 * recoil;
    this.target.group.position.y = this.targetBaseY + recoil * 0.12;

    this.focusOnPair(dt, this.impactPoint, 6);
  }

  /**
   * The freeze. Nothing moves except the ball turning its open mouth back
   * onto its quarry and the light building inside it.
   */
  private updateHang(t: number, dt: number): void {
    this.hud.phase = 'hang';
    this.hud.caption = 'IT HANGS THERE...';
    const p = (t - this.beats.hang) / D_HANG;
    this.hud.tension = 0.55;

    if (!this.firedHang) {
      this.firedHang = true;
      // Whatever tumble the rebound left it in is the pose it turns away from.
      this.spinQuat.copy(this.ball.quaternion);
    }
    this.ball.position.copy(this.hangPos);
    this.ball.quaternion.copy(this.spinQuat).slerp(this.aimQuat, THREE.MathUtils.smoothstep(p, 0, 0.85));
    this.setShellOpen(1);

    // The mouth lights up from the inside.
    this.ballLight.intensity = 4 + p * 2.5;
    this.buttonMat.color.copy(BUTTON_IDLE).lerp(BUTTON_HOT, p * 0.5);
    if (dt > 0 && Math.random() < dt * 22) {
      this.stage.particles.emitTrail(this.mouthPoint(this.mouth), this.glow, 0.55);
    }
    this.focusOnPair(dt, this.bodyCentre(this.scratch), 6);
  }

  /**
   * The conversion. The body becomes light under a flash, a jagged tether
   * snaps onto it, and the light is dragged down that tether into the mouth —
   * it travels along the bolt's actual kinked path, which is what makes it
   * read as being drunk in rather than merely shrinking.
   */
  private updateAbsorb(t: number, dt: number): void {
    this.hud.phase = 'absorb';
    this.hud.caption = 'IT\'S DRAWN IN!';
    const p = (t - this.beats.absorb) / D_ABSORB;
    this.hud.tension = 0.58 + p * 0.07;

    if (!this.firedAbsorb) {
      this.firedAbsorb = true;
      this.targetHome.copy(this.target.group.position);
      this.bodyCentre(this.beamAnchor);
      // The swap to light happens under this flash, never in plain sight.
      this.energy = this.lightForm();
      this.stage.audio.playCaptureBeam();
      this.stage.audio.playCaptureAbsorb();
      this.stage.camera.punchZoom(4);
      this.stage.particles.emitImpact(this.beamAnchor, this.glow, 6, 5);
    }

    this.ball.position.copy(this.hangPos);
    this.ball.quaternion.copy(this.aimQuat);
    this.setShellOpen(1);

    // The bolt reaches out over the first fifth of the beat, then holds.
    const reach = THREE.MathUtils.clamp(p / 0.2, 0, 1);
    const travel = THREE.MathUtils.smoothstep(p, 0.22, 1);
    this.beam.update(dt, this.mouthPoint(this.mouth), this.beamAnchor, this.stage.camera.camera.position, {
      width: 0.18 + (1 - travel) * 0.07,
      jitter: 0.32 * (0.5 + (1 - travel) * 0.5),
      opacity: 0.9 * Math.min(1, reach * 2) * (1 - Math.pow(travel, 3) * 0.35),
      reach,
    });

    // Riding the bolt's own centreline, from the far end down into the mouth.
    const shrink = Math.max(0.04, 1 - Math.pow(travel, 0.75));
    const ride = this.beam.pointAt(1 - travel, this.scratch);
    this.target.group.position.set(
      ride.x,
      ride.y - this.targetHeight * 0.45 * shrink,
      ride.z,
    );
    this.target.group.scale.setScalar(this.targetBaseScale * shrink);
    this.target.group.visible = travel < 0.97;

    // It fights the pull hardest right after the tether catches.
    const struggle = Math.max(0, 1 - travel * 1.4);
    this.target.group.rotation.z = Math.sin(t * 38) * 0.26 * struggle;
    this.target.group.rotation.y += Math.sin(t * 27) * 0.07 * struggle;
    this.energy?.set(THREE.MathUtils.clamp(reach + travel * 0.8, 0, 1), 1 - Math.pow(travel, 4) * 0.5);

    // Crackle running down the tether, densest where the light currently is.
    this.crackleTimer += dt;
    if (this.crackleTimer > 0.032) {
      this.crackleTimer = 0;
      const spark = this.beam.pointAt(THREE.MathUtils.clamp(1 - travel + (Math.random() - 0.5) * 0.3, 0, 1), this.mouth);
      this.stage.particles.emitTrail(spark, this.glow, 0.5);
    }

    (this.flash.material as THREE.MeshBasicMaterial).opacity = 0;
    // Bright enough to light the pitch under it, dim enough that the tether
    // and the light riding it are still the brightest things in the shot.
    this.ballLight.intensity = 4.5 - travel * 1.2;
    this.buttonMat.color.copy(BUTTON_IDLE).lerp(BUTTON_HOT, 0.5 + travel * 0.4);

    // The camera follows the light in: the midpoint of the pair slides onto
    // the ball on its own as the Pokémon travels, no handover needed.
    this.focusOnPair(dt, this.target.group.visible ? this.target.group.position : this.ball.position, 4);
  }

  /** The halves slam home, still mid-air, and the tether whips out. */
  private updateSnap(t: number): void {
    this.hud.phase = 'snap';
    this.hud.caption = 'THE BALL SNAPS SHUT!';
    const p = (t - this.beats.snap) / D_SNAP;
    this.hud.tension = 0.65;

    if (!this.firedSnap) {
      this.firedSnap = true;
      this.restoreTarget();
      this.target.group.visible = false;
      this.beam.mesh.visible = false;
      this.stage.audio.playCaptureSnap();
      this.stage.camera.shake(0.28);
      this.stage.camera.punchZoom(5);
      this.stage.particles.emitRing(this.restPos, 0xffffff, 3.0, 0.4);
      this.stage.particles.emitImpact(this.ball.position, this.glow, 10, 7);
    }

    this.ball.position.copy(this.hangPos);
    this.ball.quaternion.copy(this.aimQuat);
    this.setShellOpen(Math.pow(1 - p, 2.2));
    this.ballLight.intensity = 9 * (1 - p) + 1.5;
  }

  /**
   * Closed, lit, and still hanging. This is also where the camera takes up its
   * final position — every reframe happens now, while the ball is motionless,
   * so that nothing but the ball is moving once the ticking starts.
   */
  private updateHold(t: number): void {
    this.hud.phase = 'snap';
    this.hud.caption = 'IT HOLDS IN THE AIR...';
    const p = (t - this.beats.hold) / D_HOLD;
    this.hud.tension = 0.58;

    if (!this.firedSuspend) {
      this.firedSuspend = true;
      const distance = this.target.threat === 'titan' ? 5.2 : 4.8;
      // The angle search works off ground level, which is what its terrace and
      // scenery clearance tests are written against; the ball hangs more or
      // less over that spot, so the answer holds for the airborne shot too.
      this.stage.camera.setCinematicAngle(this.clearestAngle(distance, 1.8), 0);
      this.stage.camera.setCinematicFraming(distance, 1.8);
      this.stage.camera.setCinematicFocus(this.hangPos);
    }

    this.ball.position.copy(this.hangPos);
    this.setShellOpen(0);
    this.ballLight.intensity = 3 - p * 1.4;
    this.buttonMat.color.copy(BUTTON_HOT);
  }

  /**
   * The ticking. It happens in mid-air, where the freeze left the ball: with
   * nothing holding it up, every jolt is something inside pushing against the
   * shell, and the ball has nowhere to put that but sideways.
   */
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
    // Kicked about its hanging point, recoiling up and back as it tilts.
    this.ball.position.set(
      this.hangPos.x + swing * dir * (0.22 + index * 0.07),
      this.hangPos.y + swing * 0.12,
      this.hangPos.z,
    );
    this.ballLight.intensity = 1.6 + swing * 2.4;
    // The button burns brightest at the top of each swing: the ball is arguing
    // with what is inside it, and that argument is the only thing on screen.
    this.buttonMat.color.copy(BUTTON_DARK).lerp(BUTTON_HOT, 0.25 + swing * 0.75);

    if (this.clicksFired <= index && local >= WOBBLE_CLICK) {
      this.clicksFired = index + 1;
      this.hud.wobbles = this.clicksFired;
      this.stage.audio.playCaptureWobble(index);
      this.stage.camera.shake(0.1 + index * 0.05);
      this.stage.particles.emitImpact(this.ball.position, this.glow, 5, 2.4);
    }
  }

  private updateVerdict(t: number, dt: number): void {
    this.hud.phase = 'verdict';
    const p = t - this.beats.verdict;

    if (!this.firedVerdict) {
      this.firedVerdict = true;
      this.hud.verdict = this.success ? 'caught' : 'broke';
      this.hud.wobbles = this.success ? this.profile.wobbles : this.clicksFired;
      this.beam.mesh.visible = false;
      this.stage.camera.punchZoom(this.success ? 12 : 14);
      const distance = this.success ? 8.5 : 7;
      const height = this.success ? 3.6 : 2.6;
      // A catch keeps the angle the hold beat chose, because the subject has
      // not moved and will not. A break changes subject to the Pokémon
      // reassembling on the ground, so that one does need re-aiming.
      if (!this.success) this.stage.camera.setCinematicAngle(this.clearestAngle(distance, height), 0);
      this.stage.camera.setCinematicFraming(distance, height);
      this.stage.camera.shake(this.success ? 0.4 : 0.8);
      this.stage.audio.duckCrowd(this.success ? 1.9 : 0.55, 0.25);
      // The stands erupt on a catch; a break lands as a groan and a brief,
      // visibly disappointed slump before the match atmosphere returns.
      this.stage.arena.setCrowdMood(this.success ? 1 : -0.65);
      this.stage.arena.setCrowdTension?.(false);
      if (!this.success) this.stage.arena.showCrowdDisappointment?.();
      if (this.success) {
        this.stage.audio.playCaptureLock();
        this.stage.particles.emitRing(this.hangPos, 0xffe46b, 4.2, 0.8);
        this.stage.particles.emitAura(this.hangPos, 0xffe46b, 30, 1.6);
      } else {
        this.stage.audio.playCaptureBreak();
        // The shell bursts where it hangs; the dust belongs to the ground the
        // Pokémon is about to be standing on again.
        this.stage.particles.emitImpact(this.hangPos, 0xffffff, 40, 12);
        this.stage.particles.emitGroundBurst(this.restPos, this.glow, 2.4, 26);
      }
    }

    // Eased, never snapped: a catch keeps the suspended ball, a break hands
    // the shot to the Pokémon landing back on its feet.
    this.stage.camera.setCinematicFocus(this.success ? this.hangPos : this.restPos, 1 - Math.exp(-4 * dt));

    // The verdict word owns the centre of the screen; the caption plays support.
    this.hud.caption = this.success
      ? `${this.hud.targetName} JOINS THE ROSTER!`
      : `${this.hud.targetName} SLIPPED THE BALL!`;
    this.hud.tension = Math.max(0, 1 - p);

    if (this.success) this.updateLock(p);
    else this.updateBreak(p, dt);
  }

  /**
   * The catch. The ball never comes down: it hangs exactly where the freeze
   * left it, stops arguing with what is inside it, throws its star, and takes
   * itself away. A drop to the pitch would hand the moment back to physics at
   * the one beat that belongs entirely to the verdict.
   */
  private updateLock(p: number): void {
    const lift = Math.max(0, p - 0.55);
    this.ball.rotation.z = 0;
    this.ball.position.set(this.hangPos.x, this.hangPos.y + lift * lift * 3.2, this.hangPos.z);

    this.ballLight.color.setHex(0xffe46b);
    this.ballLight.intensity = 4 + Math.sin(p * 22) * 2.6;
    // The flashing stops. That, and the stillness, is the whole confirmation.
    this.buttonMat.color.copy(BUTTON_HOT).lerp(BUTTON_IDLE, THREE.MathUtils.clamp(p / 0.25, 0, 1));

    this.updateSparkle(p);

    const sparkle = Math.floor(p * 14);
    if (sparkle !== this.sparkleIndex) {
      this.sparkleIndex = sparkle;
      this.stage.particles.emitTrail(this.ball.position, 0xffe46b, 1.1);
    }
    const fade = THREE.MathUtils.clamp((p - 0.9) / 0.45, 0, 1);
    this.ball.visible = fade < 1;
    this.setBallOpacity(1 - fade);
  }

  private updateBreak(p: number, dt: number): void {
    // Burst: halves fly apart and the light comes back out the way it went in,
    // rebuilding itself into a body before it shakes the ball off, defiant.
    const burst = Math.min(1, p / 0.35);
    this.ballTop.position.y = burst * 1.6 - BALL_SHELL_OVERLAP;
    this.ballBottom.position.y = -burst * 0.4 + BALL_SHELL_OVERLAP;
    this.ball.rotation.z += burst * 0.3;
    this.ball.visible = p < 0.45;
    this.ballLight.intensity = 8 * (1 - burst);
    this.buttonMat.color.copy(BUTTON_HOT).lerp(BUTTON_DARK, burst);

    if (!this.firedRematerialize) {
      this.firedRematerialize = true;
      this.energy = this.lightForm();
      this.target.group.visible = true;
    }

    // Light pours back out of the shell and reassembles at its own feet.
    const rebuild = THREE.MathUtils.clamp(p / 0.22, 0, 1);
    if (rebuild < 1) {
      const from = this.scratch.copy(this.ball.position).setY(this.ball.position.y - this.targetHeight * 0.2);
      this.target.group.position.lerpVectors(from, this.targetHome, THREE.MathUtils.smoothstep(rebuild, 0, 1));
      this.target.group.scale.setScalar(this.targetBaseScale * (0.12 + rebuild * 0.88));
      this.energy?.set(1 - rebuild * 0.6, 1);
      this.beam.update(dt, this.mouthPoint(this.mouth), this.target.group.position, this.stage.camera.camera.position, {
        width: 0.12, jitter: 0.3, opacity: 0.7 * (1 - rebuild),
      });
      return;
    }

    if (this.energy) {
      // One last flash to hide the swap back to real materials, mirroring the
      // one that hid the swap away from them.
      this.stage.particles.emitImpact(this.target.group.position, 0xffffff, 16, 5);
      this.restoreTarget();
      this.beam.mesh.visible = false;
    }

    const since = p - 0.22;
    const bounce = 1 + Math.sin(Math.min(1, since / 0.5) * Math.PI) * 0.35;
    this.target.group.scale.setScalar(this.targetBaseScale * bounce);
    this.target.group.position.copy(this.targetHome);
    // A hard shake-off that decays over the first half second.
    const defiance = Math.max(0, 1 - since / 0.55);
    this.target.group.rotation.z = Math.sin(since * 46) * 0.3 * defiance;
    this.target.group.position.y = this.targetHome.y + Math.abs(Math.sin(since * 16)) * 0.35 * defiance;
  }

  /**
   * Both halves swing off the equator; 0 is shut, 1 is wide open. They part
   * less far than the gap between them suggests, because the gap is filled:
   * an open Poké Ball is a mouth full of light, and two shells drifting apart
   * over empty air just look like a broken toy.
   */
  private setShellOpen(open: number): void {
    this.ballTop.position.y = open * 0.26 - BALL_SHELL_OVERLAP;
    this.ballBottom.position.y = -open * 0.09 + BALL_SHELL_OVERLAP;
    const glowMat = this.mouthGlow.material as THREE.MeshBasicMaterial;
    this.mouthGlow.visible = open > 0.01;
    this.mouthGlow.scale.setScalar(0.5 + open * 0.75);
    glowMat.opacity = Math.min(1, open * 1.3) * 0.85;
  }

  /** Steady red blink of the undecided button, `period` seconds per cycle. */
  private flashButton(t: number, period: number): void {
    const phase = (t % period) / period;
    const lit = Math.max(0, Math.sin(phase * Math.PI));
    this.buttonMat.color.copy(BUTTON_DARK).lerp(BUTTON_HOT, lit);
  }

  /** Converts the target's model to light, if it has one to convert. */
  private lightForm(): EnergyForm | null {
    const mesh = this.target.animPokemon?.mesh;
    return mesh ? new EnergyForm(mesh, this.glow) : null;
  }

  /** Gives the target its own materials, scale and pose back. */
  private restoreTarget(): void {
    this.energy?.release();
    this.energy = null;
    this.target.group.scale.setScalar(this.targetBaseScale);
    this.target.group.rotation.z = 0;
    this.target.group.rotation.y = this.targetBaseRotY;
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

  /** The four-point star that pops off a confirmed catch. */
  private createSparkle(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff6c9, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const spoke = new THREE.PlaneGeometry(0.16, 2.6);
    const across = new THREE.Mesh(spoke, mat);
    const upright = new THREE.Mesh(spoke, mat);
    across.rotation.z = Math.PI / 2;
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), mat);
    group.add(across, upright, core);
    group.visible = false;
    group.renderOrder = 5;
    return group;
  }

  private updateSparkle(p: number): void {
    const mat = (this.sparkle.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    // Just after the click rather than on it: the star is the confirmation
    // arriving, and it needs the click to have been heard first.
    const life = (p - 0.15) / 0.5;
    this.sparkle.visible = life > 0 && life < 1;
    if (!this.sparkle.visible) { mat.opacity = 0; return; }
    this.sparkle.position.copy(this.ball.position).add(new THREE.Vector3(0, 0.3, 0));
    this.sparkle.quaternion.copy(this.stage.camera.camera.quaternion);
    this.sparkle.scale.setScalar(0.35 + Math.sin(Math.min(1, life * 1.6) * Math.PI * 0.5) * 1.1);
    mat.opacity = Math.pow(1 - life, 1.6);
  }

  /**
   * Orbit start angle. The camera sits on the pitch-centre side of the target
   * and looks outward: a capture near the rim would otherwise open the shot
   * inside the grandstand wall behind it.
   */
  private clearestAngle(distance: number = 9.5, height: number = 3.2): number {
    const preferred = Math.atan2(-this.restPos.x, -this.restPos.z);
    const eye = new THREE.Vector3();
    let bestAngle = preferred;
    let bestScore = -Infinity;

    for (let sample = 0; sample < CAMERA_ANGLE_SAMPLES; sample++) {
      // Search symmetrically away from the pitch-centre side so the familiar
      // composition wins whenever it is clear.
      const step = sample === 0 ? 0 : Math.ceil(sample / 2) * (sample % 2 ? 1 : -1);
      const angle = preferred + step * Math.PI * 2 / CAMERA_ANGLE_SAMPLES;
      this.stage.camera.cinematicPositionAt(this.restPos, distance, height, angle, eye);
      const clearance = Math.min(2, this.captureSightlineClearance(eye));
      const angleCost = Math.abs(step) * Math.PI * 2 / CAMERA_ANGLE_SAMPLES * 0.18;
      const score = clearance - angleCost;
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }
    return bestAngle;
  }

  /** Minimum clearance beneath the view ray; negative means scenery blocks the ball. */
  private captureSightlineClearance(eye: THREE.Vector3): number {
    const subject = this.restPos.clone().add(new THREE.Vector3(0, 0.18, 0));
    const dx = subject.x - eye.x;
    const dz = subject.z - eye.z;
    const lengthSq = dx * dx + dz * dz;
    let clearance = Infinity;

    for (const obstacle of this.stage.arena.getNoBuildZones()) {
      const projection = lengthSq > 0
        ? THREE.MathUtils.clamp(((obstacle.x - eye.x) * dx + (obstacle.z - eye.z) * dz) / lengthSq, 0, 1)
        : 0;
      const nearestX = eye.x + dx * projection;
      const nearestZ = eye.z + dz * projection;
      clearance = Math.min(
        clearance,
        Math.hypot(obstacle.x - nearestX, obstacle.z - nearestZ) - obstacle.radius - CAMERA_OBSTACLE_MARGIN,
      );
    }

    // A low hero shot can also disappear into the face of a raised terrace.
    // Stop before the endpoint: the ball is expected to sit just above its own ground.
    for (let sample = 1; sample <= 12; sample++) {
      const t = sample / 15;
      const x = THREE.MathUtils.lerp(eye.x, subject.x, t);
      const z = THREE.MathUtils.lerp(eye.z, subject.z, t);
      const rayY = THREE.MathUtils.lerp(eye.y, subject.y, t);
      clearance = Math.min(clearance, rayY - this.stage.arena.terrain.heightAt(x, z) - 0.12);
    }
    return clearance;
  }

  public dispose(scene: THREE.Scene): void {
    this.stage.camera.releaseCinematic();
    this.stage.audio.duckCrowd(1, 1.2);
    this.stage.arena.setCrowdMood(0);
    this.stage.arena.setCrowdTension?.(false);
    this.restoreTarget();
    this.target.group.rotation.z = 0;
    // Its whole position, not just the height: the conversion carries it up
    // the tether, and a skip or an aborted match can leave it there.
    this.target.group.position.copy(this.targetHome);
    this.beam.dispose();
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
    const topHalf = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell(top));
    const bottomHalf = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell(bottom));
    // The equatorial seam is paint on the shell, not a raised rubber torus.
    // A shallow sphere segment follows the ball's curvature and only sits
    // 0.001 units above it, avoiding both the bulky silhouette and z-fighting.
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS + 0.001, 16, 2, 0, Math.PI * 2, Math.PI / 2 - 0.04, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.42, metalness: 0.12 }),
    );
    // Its own material, never shared: the button is the ball's tell, and the
    // sequence repaints it every frame from the strike onward.
    const button = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: BUTTON_IDLE.clone() }),
    );
    button.position.z = 0.32;
    // The light held between the halves. Additive and depth-free so it reads
    // through whichever shell is between it and the camera.
    const mouthGlow = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 0.88, 12, 10),
      new THREE.MeshBasicMaterial({
        color: this.glow, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    mouthGlow.visible = false;
    // Order matters: update() drives children[0], [1] as the halves, [3] as
    // the button and [4] as the glow between them.
    root.add(topHalf, bottomHalf, band, button, mouthGlow);
    return root;
  }
}
