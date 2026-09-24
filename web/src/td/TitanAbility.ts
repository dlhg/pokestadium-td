/**
 * TitanAbility.ts — What a Titan Does Besides Walk
 *
 * Every course's final ends on a Titan with one ability of its own
 * (docs/match-length.md). The rule the abilities keep: enemies never touch the
 * player's towers. A Titan changes itself or the lane, so each ability tests
 * how the player built and placed — a single choke point gets jumped, a
 * control team gets hazed, a Light-hitting team can't crack a Barrier.
 *
 * Every ability shares one presentation baseline, the way signature moves do:
 * a telegraph (the Titan's own ROM attack clip, its cry, and a ring pulsing on
 * the ground under it), then the cast (an announcer call, the move's name over
 * the Titan, a flash, and a camera cut the first time, a shake after). Each
 * ability only adds its own effect on top.
 */

import * as THREE from 'three';
import { EnergyForm } from '../engine/EnergyForm';
import { JaggedBeam } from '../engine/JaggedBeam';
import type { ParticleSystem } from '../engine/ParticleSystem';
import type { StadiumAudio } from '../engine/StadiumAudio';
import type { StadiumCamera } from '../engine/StadiumCamera';
import type { StadiumAnnouncer } from '../stadium/Announcer';
import { TYPE_COLORS } from '../stadium/TypeMatrix';
import type { Creep, CreepConfig } from './Creep';
import { TITANS, type TitanAbilityId } from './Titans';

/** Everything an ability needs from the match. */
export interface TitanAbilityContext {
  scene: THREE.Scene;
  creeps: Creep[];
  particles: ParticleSystem;
  camera: StadiumCamera;
  announcer: StadiumAnnouncer;
  audio: StadiumAudio;
  /** The camera's position, for effects that turn to face it. */
  eye: THREE.Vector3;
  /** Whether an ability's first cast may cut to the action cam. */
  cinematicCuts: boolean;
  /** Puts a new creep on the lane where `leader` stands. */
  spawn: (config: CreepConfig, leader: Creep) => Creep;
  popup: (world: THREE.Vector3, text: string, color: string, size?: number) => void;
}

const up = (height: number) => new THREE.Vector3(0, height, 0);
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/**
 * An EnergyForm that follows the body it's on: the extracted model can finish
 * loading and replace the stand-in mid-effect, and a form left on the old body
 * would leave the new one solid.
 */
class BodyForm {
  private form: EnergyForm;
  private model: THREE.Object3D;

  constructor(private readonly titan: Creep, private readonly color: number) {
    this.model = titan.animPokemon.mesh;
    this.form = new EnergyForm(titan.body, color);
  }

  public set(charge: number, opacity: number): void {
    if (this.titan.animPokemon.mesh !== this.model) {
      this.form.release();
      this.model = this.titan.animPokemon.mesh;
      this.form = new EnergyForm(this.titan.body, this.color);
    }
    this.form.set(charge, opacity);
  }

  public release(): void {
    this.form.release();
  }
}

// ---------------------------------------------------------------------------
// The shared baseline
// ---------------------------------------------------------------------------

/** A flat ring on the ground under the Titan that swells while it winds up. */
class TelegraphRing {
  private readonly mesh: THREE.Mesh;

  constructor(private readonly titan: Creep, color: number) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.7, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.16;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    titan.group.add(this.mesh);
  }

  /** `charge` 0..1 across the wind-up; below zero hides the ring. */
  public set(charge: number): void {
    this.mesh.visible = charge >= 0;
    if (!this.mesh.visible) return;
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    // Grows from the Titan's feet to the edge of the telegraph and strobes
    // faster as it fills, so the moment it fires is readable at a glance.
    this.mesh.scale.setScalar(0.5 + charge * 1.1);
    material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(charge * charge * 18));
  }

  public dispose(): void {
    this.titan.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * One Titan's ability: a cooldown, a telegraph, the cast, and however long
 * the effect runs. Subclasses fill in the effect.
 */
abstract class TitanAbility {
  /** The move's name, as the announcer calls it. */
  protected abstract readonly moveName: string;
  /** Seconds before the first cast, and between casts. */
  protected firstDelay = 4;
  protected cooldown = 7;
  /** Seconds the telegraph runs before the cast lands. */
  protected windup = 0.85;
  /** Seconds the effect lasts once cast; 0 for one-shot effects. */
  protected duration = 0;

  protected readonly color: number;
  private readonly ring: TelegraphRing;
  private phase: 'cooldown' | 'windup' | 'active' = 'cooldown';
  private timer: number;
  private casts = 0;

  constructor(protected readonly titan: Creep) {
    this.color = TYPE_COLORS[titan.type]?.num ?? 0xffffff;
    this.ring = new TelegraphRing(titan, this.color);
    this.timer = 0;
  }

  /** Called once, right after construction, so subclass fields are ready. */
  public start(): void {
    this.timer = this.firstDelay;
  }

  public update(dt: number, ctx: TitanAbilityContext): void {
    if (dt <= 0 || !this.titan.alive || this.titan.captureLocked) return;
    this.passive(dt, ctx);

    this.timer -= dt;
    if (this.phase === 'cooldown') {
      if (this.timer <= 0 && this.ready(ctx)) this.beginWindup(ctx);
    } else if (this.phase === 'windup') {
      this.ring.set(1 - Math.max(0, this.timer) / this.windup);
      if (this.timer <= 0) this.cast(ctx);
    } else {
      this.tick(dt, 1 - Math.max(0, this.timer) / Math.max(1e-3, this.duration), ctx);
      if (this.timer <= 0) this.finish(ctx);
    }
  }

  /** Ends whatever is running at once — the Titan fainted, or a ball is closing on it. */
  public interrupt(ctx: TitanAbilityContext | null): void {
    this.ring.set(-1);
    if (this.phase === 'active') this.end(ctx);
    this.phase = 'cooldown';
    this.timer = this.cooldown;
  }

  public dispose(ctx: TitanAbilityContext | null): void {
    this.interrupt(ctx);
    this.cleanup(ctx);
    this.ring.dispose();
  }

  private beginWindup(ctx: TitanAbilityContext): void {
    this.phase = 'windup';
    this.timer = this.windup;
    // The Titan's own ROM attack clip is the tell, with its cry over it.
    this.titan.playPose('attack', this.windup + 0.25);
    ctx.audio.playCry(TITANS[this.titan.titanId!]?.name ?? this.titan.name, this.titan.type);
    this.ring.set(0);
  }

  private cast(ctx: TitanAbilityContext): void {
    this.ring.set(-1);
    const focus = this.titan.position.clone().add(up(this.titan.hudAnchorHeight * 0.5));
    ctx.announcer.trigger('titan_ability', `${this.titan.name.toUpperCase()} USED ${this.moveName.toUpperCase()}!`);
    ctx.popup(this.titan.position.clone().add(up(this.titan.hudAnchorHeight + 0.6)), this.moveName.toUpperCase(), hex(this.color), 26);
    ctx.particles.emitSignatureFlash(focus, this.color);
    ctx.audio.playSignatureCast();
    // The first cast of a match is worth a look; after that the player knows it.
    if (this.casts === 0 && ctx.cinematicCuts) ctx.camera.triggerActionCam(focus, 0.9);
    else ctx.camera.shake(this.casts === 0 ? 0.4 : 0.22);
    this.casts++;

    this.begin(ctx);
    if (this.duration > 0) {
      this.phase = 'active';
      this.timer = this.duration;
    } else {
      this.phase = 'cooldown';
      this.timer = this.cooldown;
    }
  }

  private finish(ctx: TitanAbilityContext): void {
    this.end(ctx);
    this.phase = 'cooldown';
    this.timer = this.cooldown;
  }

  /** Whether the ability wants to fire now that its cooldown is up. */
  protected ready(_ctx: TitanAbilityContext): boolean { return true; }
  /** Runs every frame the Titan is on the lane, whatever the phase. */
  protected passive(_dt: number, _ctx: TitanAbilityContext): void {}
  /** The effect lands. */
  protected abstract begin(ctx: TitanAbilityContext): void;
  /** Every frame the effect runs; `progress` 0..1 across `duration`. */
  protected tick(_dt: number, _progress: number, _ctx: TitanAbilityContext): void {}
  /** The effect ends, on time or interrupted. `ctx` is null when the match is being torn down. */
  protected end(_ctx: TitanAbilityContext | null): void {}
  /** Releases anything left in the scene. */
  protected cleanup(_ctx: TitanAbilityContext | null): void {}
}

// ---------------------------------------------------------------------------
// The abilities
// ---------------------------------------------------------------------------

/** Beedrill: calls Weedle down out of the trees around it. */
class CallSwarm extends TitanAbility {
  protected readonly moveName = 'Call Swarm';
  protected firstDelay = 3.5;
  protected cooldown = 7;
  private static readonly WEEDLE = 3;

  protected begin(ctx: TitanAbilityContext): void {
    for (let i = 0; i < CallSwarm.WEEDLE; i++) {
      const weedle = ctx.spawn({
        id: `swarm_${this.titan.id}_${Math.random().toString(36).slice(2, 6)}`,
        name: 'Weedle', type: 'Bug', secondaryType: 'Poison',
        // A share of the Titan: enough to split the towers' attention, never enough to matter alone.
        maxHp: Math.max(1, Math.round(this.titan.maxHp * 0.035)),
        speed: 4.8,
        reward: Math.max(1, Math.round(this.titan.reward * 0.02)),
        modelType: 'rattata',
        level: Math.max(2, this.titan.level - 8),
      }, this.titan);
      // Strung out just behind the Titan, each dropping in on its own streak.
      weedle.pushBack(1.4 + i * 1.3);
      const landing = weedle.position.clone();
      ctx.particles.emitBeam(landing.clone().add(up(9)), landing.clone().add(up(0.4)), 0x9ccc3a, 0.25, 0.35);
      ctx.particles.emitGroundBurst(landing, 0x9ccc3a, 1.6, 14);
    }
  }
}

/** Onix: dives underground for a stretch of lane, out of reach of everything. */
class Dig extends TitanAbility {
  protected readonly moveName = 'Dig';
  protected firstDelay = 5;
  protected cooldown = 9;
  protected windup = 0.8;
  protected duration = 2.6;
  private dust = 0;

  protected begin(ctx: TitanAbilityContext): void {
    this.titan.burrowed = true;
    this.dust = 0;
    ctx.particles.emitGroundBurst(this.titan.position, 0xa07a4a, 3.2, 40);
    ctx.audio.playStoneImpact(0.7);
  }

  protected tick(dt: number, progress: number, ctx: TitanAbilityContext): void {
    // Sinks fast, stays down, and bursts up at the end.
    const depth = progress < 0.15 ? progress / 0.15 : progress > 0.88 ? (1 - progress) / 0.12 : 1;
    this.titan.body.position.y = -depth * (this.titan.hudAnchorHeight + 1);
    this.dust -= dt;
    if (this.dust <= 0) {
      this.dust = 0.18;
      // A furrow of kicked-up earth is how the player tracks it underground.
      ctx.particles.emitGroundBurst(this.titan.position, 0x8a6a40, 1.4, 8);
    }
  }

  protected end(ctx: TitanAbilityContext | null): void {
    this.titan.burrowed = false;
    this.titan.body.position.y = 0;
    if (!ctx) return;
    this.titan.playPose('entrance', 0.8);
    ctx.particles.emitGroundBurst(this.titan.position, 0xa07a4a, 3.6, 46);
    ctx.particles.emitRing(this.titan.position, 0xc49a5c, 5, 0.5);
    ctx.camera.shake(0.35);
    ctx.audio.playStoneShatter(8, 0.8);
  }
}

/** Starmie: spins and recovers whenever it goes a few seconds without being hit. */
class Recover extends TitanAbility {
  protected readonly moveName = 'Recover';
  /** Seconds without a hit before it starts to heal. */
  private static readonly QUIET = 2.4;
  /** Share of max HP restored per second while it heals. */
  private static readonly RATE = 0.05;
  private healing = false;
  private sparkle = 0;

  protected ready(): boolean { return false; }
  protected begin(): void {}

  protected passive(dt: number, ctx: TitanAbilityContext): void {
    const quiet = this.titan.clock - this.titan.lastHitAt > Recover.QUIET;
    const hurt = this.titan.hp < this.titan.maxHp;
    if (quiet && hurt) {
      if (!this.healing) {
        // Called out each time it starts, so the player learns what stopped it.
        this.healing = true;
        ctx.popup(this.titan.position.clone().add(up(this.titan.hudAnchorHeight + 0.6)), 'RECOVER', '#ff9ad5', 24);
        ctx.announcer.trigger('titan_ability', `${this.titan.name.toUpperCase()} USED RECOVER!`);
        ctx.particles.emitRing(this.titan.position, 0xff9ad5, 4, 0.6);
      }
      this.titan.heal(this.titan.maxHp * Recover.RATE * dt);
      this.titan.body.rotation.y += dt * 9;
      this.sparkle -= dt;
      if (this.sparkle <= 0) {
        this.sparkle = 0.2;
        ctx.particles.emitAura(this.titan.position.clone().add(up(this.titan.hudAnchorHeight * 0.45)), 0xff9ad5, 10, 1.6);
      }
    } else {
      this.healing = false;
    }
  }
}

/** Zapdos: turns to lightning and jumps a stretch of lane in a crackling bolt. */
class LightningDash extends TitanAbility {
  protected readonly moveName = 'Agility';
  protected firstDelay = 4;
  protected cooldown = 7;
  protected windup = 0.8;
  protected duration = 0.35;
  /** Lane units jumped per dash. */
  private static readonly DISTANCE = 12;
  private beam: JaggedBeam | null = null;
  private form: BodyForm | null = null;
  private readonly from = new THREE.Vector3();
  /** Seconds the bolt lingers after the dash lands. */
  private afterglow = 0;

  protected begin(ctx: TitanAbilityContext): void {
    this.from.copy(this.titan.position).add(up(this.titan.hudAnchorHeight * 0.45));
    this.form = new BodyForm(this.titan, 0xfff27a);
    this.form.set(1, 0.9);
    if (!this.beam) {
      this.beam = new JaggedBeam(0xfff27a, 18, 30);
      // Additive light vanishes over a pale pitch like the Power Plant's floor;
      // a solid bolt reads on any ground.
      (this.beam.mesh.material as THREE.MeshBasicMaterial).blending = THREE.NormalBlending;
      ctx.scene.add(this.beam.mesh);
    }
    ctx.audio.playAttack('lightning');
  }

  protected tick(dt: number, _progress: number, ctx: TitanAbilityContext): void {
    this.titan.advance(LightningDash.DISTANCE * dt / this.duration);
    this.form?.set(1, 0.9);
    const to = this.titan.position.clone().add(up(this.titan.hudAnchorHeight * 0.45));
    this.beam?.update(dt, this.from, to, ctx.eye, { width: 0.9, jitter: 1.4, opacity: 1 });
    if (Math.random() < dt * 30) ctx.particles.emitTrail(to, 0xfff27a, 1.2);
  }

  protected end(ctx: TitanAbilityContext | null): void {
    this.form?.release();
    this.form = null;
    if (!ctx) return;
    this.afterglow = 0.5;
    ctx.particles.emitImpact(this.titan.position.clone().add(up(1)), 0xfff27a, 34, 9);
    ctx.particles.emitRing(this.titan.position, 0xfff27a, 4.5, 0.4);
  }

  protected passive(dt: number, ctx: TitanAbilityContext): void {
    if (this.afterglow <= 0 || !this.beam) return;
    this.afterglow -= dt;
    const to = this.titan.position.clone().add(up(this.titan.hudAnchorHeight * 0.45));
    this.beam.update(dt, this.from, to, ctx.eye, { width: 0.7, jitter: 1.1, opacity: Math.max(0, this.afterglow / 0.5) });
  }

  protected cleanup(ctx: TitanAbilityContext | null): void {
    if (!this.beam) return;
    ctx?.scene.remove(this.beam.mesh);
    this.beam.mesh.parent?.remove(this.beam.mesh);
    this.beam.dispose();
    this.beam = null;
  }
}

/** Moltres: leaves a trail of fire that hurries every creep walking in its wake. */
class FireTrail extends TitanAbility {
  protected readonly moveName = 'Fire Trail';
  /** Speed bonus for a creep standing in the flames. */
  private static readonly HASTE = 0.35;
  private static readonly RADIUS = 2.3;
  private static readonly LIFE = 5;
  private patches: { mesh: THREE.Mesh; age: number }[] = [];
  private drop = 0;
  private announced = false;

  protected ready(): boolean { return false; }
  protected begin(): void {}

  protected passive(dt: number, ctx: TitanAbilityContext): void {
    if (this.titan.alive) this.lay(dt, ctx);
    this.burn(dt, ctx);
  }

  /** Drops fresh flames under Moltres as it goes. */
  private lay(dt: number, ctx: TitanAbilityContext): void {
    if (!this.announced && this.titan.clock > 1.5) {
      this.announced = true;
      ctx.announcer.trigger('titan_ability', `${this.titan.name.toUpperCase()} LEAVES A TRAIL OF FIRE!`);
      ctx.popup(this.titan.position.clone().add(up(this.titan.hudAnchorHeight + 0.6)), 'FIRE TRAIL', '#ff8a2a', 26);
      ctx.camera.shake(0.25);
    }
    this.drop -= dt;
    if (this.drop <= 0) {
      this.drop = 0.5;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(FireTrail.RADIUS, 24),
        new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      mesh.rotation.x = -Math.PI / 2;
      // Under a flyer, on the lane — the trail is for the creeps behind it.
      const ground = this.titan.position.clone();
      mesh.position.set(ground.x, ground.y + 0.1, ground.z);
      mesh.renderOrder = 3;
      ctx.scene.add(mesh);
      this.patches.push({ mesh, age: 0 });
    }
  }

  /** Ages every patch and hurries the creeps standing in one. Runs on after Moltres falls. */
  public burn(dt: number, ctx: TitanAbilityContext): void {
    this.patches = this.patches.filter(patch => {
      patch.age += dt;
      const material = patch.mesh.material as THREE.MeshBasicMaterial;
      const left = FireTrail.LIFE - patch.age;
      material.opacity = 0.5 * Math.min(1, left / 0.8) * (0.8 + Math.sin(patch.age * 11 + patch.mesh.position.x) * 0.2);
      if (Math.random() < dt * 3) ctx.particles.emitTrail(patch.mesh.position.clone().add(up(0.4)), 0xff8a2a, 0.8);
      for (const creep of ctx.creeps) {
        if (creep === this.titan || !creep.alive || creep.isBoss) continue;
        if (Math.hypot(creep.position.x - patch.mesh.position.x, creep.position.z - patch.mesh.position.z) > FireTrail.RADIUS) continue;
        creep.haste = Math.max(creep.haste, FireTrail.HASTE);
      }
      if (left > 0) return true;
      this.removePatch(patch.mesh);
      return false;
    });
  }

  private removePatch(mesh: THREE.Mesh): void {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  protected cleanup(): void {
    for (const patch of this.patches) this.removePatch(patch.mesh);
    this.patches = [];
  }

  /** The flames outlive a fainted Moltres until they burn out. */
  public get lingering(): boolean {
    return this.patches.length > 0;
  }
}

/** Gengar: fades out of sight. No tower can aim at it, not even one that sees Phantoms. */
class Fade extends TitanAbility {
  protected readonly moveName = 'Shadow Fade';
  protected firstDelay = 4;
  protected cooldown = 8;
  protected windup = 0.7;
  protected duration = 3;
  private form: BodyForm | null = null;

  protected begin(ctx: TitanAbilityContext): void {
    this.titan.untargetable = true;
    this.form = new BodyForm(this.titan, 0x6b3fa0);
    this.form.set(0.7, 0.18);
    ctx.particles.emitAura(this.titan.position.clone().add(up(1.5)), 0x6b3fa0, 26, 2);
  }

  protected tick(_dt: number, progress: number): void {
    // Flickers at the edges of the fade so the player sees it coming back.
    const flicker = progress > 0.8 ? 0.25 + Math.abs(Math.sin(progress * 60)) * 0.35 : 0.18;
    this.form?.set(0.7, flicker);
  }

  protected end(ctx: TitanAbilityContext | null): void {
    this.titan.untargetable = false;
    this.form?.release();
    this.form = null;
    ctx?.particles.emitImpact(this.titan.position.clone().add(up(1.5)), 0x9b6bd0, 24, 6);
  }
}

/** Articuno: a freezing mist that wipes every status off itself and the creeps around it. */
class Haze extends TitanAbility {
  protected readonly moveName = 'Haze';
  protected firstDelay = 5;
  protected cooldown = 6;
  protected windup = 0.9;
  private static readonly RADIUS = 9;

  /** Only worth casting when something nearby is held or burning. */
  protected ready(ctx: TitanAbilityContext): boolean {
    return this.affected(ctx).some(creep => creep.damageStatus || creep.movementStatus);
  }

  private affected(ctx: TitanAbilityContext): Creep[] {
    return ctx.creeps.filter(creep => creep.alive && !creep.untouchable
      && Math.hypot(creep.position.x - this.titan.position.x, creep.position.z - this.titan.position.z) <= Haze.RADIUS);
  }

  protected begin(ctx: TitanAbilityContext): void {
    ctx.particles.emitRing(this.titan.position, 0xd8f4ff, Haze.RADIUS, 0.7);
    ctx.particles.emitGroundBurst(this.titan.position, 0xbfe9ff, Haze.RADIUS * 0.8, 50);
    for (const creep of this.affected(ctx)) {
      if (!creep.damageStatus && !creep.movementStatus) continue;
      creep.damageStatus = null;
      creep.movementStatus = null;
      ctx.particles.emitAura(creep.position.clone().add(up(1)), 0xd8f4ff, 10, 1);
    }
  }
}

/**
 * Mewtwo: a Barrier only Heavy hits wear down, and nothing gets through while
 * it stands. Break it and Mewtwo is open until it recovers and raises another.
 */
class Barrier extends TitanAbility {
  protected readonly moveName = 'Barrier';
  protected firstDelay = 0;
  /** Seconds Mewtwo stays open once its Barrier breaks. */
  protected cooldown = 8;
  protected windup = 1.2;
  /** The Barrier's strength, as a share of Mewtwo's max HP. */
  private static readonly STRENGTH = 0.2;
  /** HP Mewtwo recovers each time it raises a Barrier after the first. */
  private static readonly RECOVER = 0.1;
  private readonly shell: THREE.Mesh;
  private raised = 0;
  private lastStruck = -Infinity;
  private deflectCallout = 0;

  constructor(titan: Creep) {
    super(titan);
    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({
        color: 0xff7ad9, transparent: true, opacity: 0, wireframe: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.shell.visible = false;
    this.shell.renderOrder = 4;
    titan.group.add(this.shell);
  }

  /** Raises the next Barrier as soon as the last one is down. */
  protected ready(): boolean {
    return this.titan.barrier <= 0;
  }

  protected begin(ctx: TitanAbilityContext): void {
    if (this.raised > 0) this.titan.heal(this.titan.maxHp * Barrier.RECOVER);
    this.raised++;
    this.titan.barrier = this.titan.maxHp * Barrier.STRENGTH;
    this.shell.visible = true;
    ctx.particles.emitRing(this.titan.position, 0xff7ad9, 5, 0.5);
  }

  protected passive(dt: number, ctx: TitanAbilityContext): void {
    if (!this.shell.visible) return;
    const radius = this.titan.hudAnchorHeight * 0.55 + 0.6;
    this.shell.scale.setScalar(radius);
    this.shell.position.y = radius * 0.8;
    this.shell.rotation.y += dt * 0.8;
    const material = this.shell.material as THREE.MeshBasicMaterial;
    const strength = this.titan.barrier / (this.titan.maxHp * Barrier.STRENGTH);
    const struck = this.titan.clock - this.titan.barrierStruckAt < 0.12;
    material.opacity = (0.25 + strength * 0.4) * (struck ? 1.8 : 1);

    // Hits bouncing off say so, now and then — the player needs to learn Heavy.
    this.deflectCallout -= dt;
    if (this.titan.barrierStruckAt > this.lastStruck) {
      this.lastStruck = this.titan.barrierStruckAt;
      if (this.deflectCallout <= 0) {
        this.deflectCallout = 1.2;
        ctx.popup(this.titan.position.clone().add(up(radius * 1.6)), 'BARRIER — USE HEAVY HITS', '#ff9be6', 16);
      }
    }

    if (this.titan.barrier <= 0) {
      this.shell.visible = false;
      ctx.particles.emitImpact(this.titan.position.clone().add(up(radius * 0.8)), 0xff7ad9, 60, 11);
      ctx.announcer.trigger('titan_ability', `${this.titan.name.toUpperCase()}'S BARRIER IS BROKEN!`);
      ctx.popup(this.titan.position.clone().add(up(radius * 1.8)), 'BARRIER BROKEN!', '#ffffff', 26);
      ctx.camera.shake(0.45);
      ctx.audio.playStoneShatter(10, 1);
    }
  }

  protected cleanup(): void {
    this.titan.barrier = 0;
    this.titan.group.remove(this.shell);
    this.shell.geometry.dispose();
    (this.shell.material as THREE.Material).dispose();
  }
}

const ABILITIES: Record<TitanAbilityId, new (titan: Creep) => TitanAbility> = {
  call_swarm: CallSwarm,
  dig: Dig,
  recover: Recover,
  lightning_dash: LightningDash,
  fire_trail: FireTrail,
  fade: Fade,
  haze: Haze,
  barrier: Barrier,
};

// ---------------------------------------------------------------------------
// The match's roster of running abilities
// ---------------------------------------------------------------------------

export class TitanAbilities {
  private running = new Map<Creep, TitanAbility>();

  /** Gives a freshly spawned Titan its ability, if it has one. */
  public attach(creep: Creep): void {
    const id = creep.titanId ? TITANS[creep.titanId]?.ability : undefined;
    if (!id || this.running.has(creep)) return;
    const ability = new ABILITIES[id](creep);
    ability.start();
    this.running.set(creep, ability);
  }

  /** The ability a Titan is running, for tests and the dev panel. */
  public abilityOf(creep: Creep): TitanAbility | undefined {
    return this.running.get(creep);
  }

  /**
   * Runs every ability for one frame. Every creep's fire-trail haste is
   * cleared first, like the towers' slow auras, then refreshed by whichever
   * trails still burn.
   */
  public update(dt: number, ctx: TitanAbilityContext): void {
    if (dt <= 0) return;
    for (const creep of ctx.creeps) creep.haste = 0;
    for (const [creep, ability] of this.running) {
      if (creep.alive) {
        ability.update(dt, ctx);
        continue;
      }
      // Fainted, caught, or through the exit: effects end, lingering flames burn out first.
      if (ability instanceof FireTrail && ability.lingering) {
        ability.burn(dt, ctx);
        continue;
      }
      ability.dispose(ctx);
      this.running.delete(creep);
    }
  }

  /** A Poké Ball is closing on this Titan: whatever it was doing stops now. */
  public interrupt(creep: Creep, ctx: TitanAbilityContext | null): void {
    this.running.get(creep)?.interrupt(ctx);
  }

  /** Ends every ability and releases what they left in the scene. */
  public clear(): void {
    for (const ability of this.running.values()) ability.dispose(null);
    this.running.clear();
  }
}
