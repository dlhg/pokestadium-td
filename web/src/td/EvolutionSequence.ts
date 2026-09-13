/**
 * EvolutionSequence.ts — The Evolution Set Piece
 *
 * Mirrors `CaptureSequence`: evolving is the second biggest moment in a
 * match, so it gets the same treatment as a catch — the world drops into
 * slow motion, the lights fall, the camera swings into a tight hero shot on
 * the tower, and a beat sheet plays out: charge, flash, reveal.
 *
 * Unlike a capture, there is no player input to wait on. The tower glows and
 * builds a column of light while everything else on the pitch nearly stops,
 * a white flash hides the actual model swap, and the new form settles in as
 * real time snaps back.
 *
 * Same contract as `CaptureSequence`: it owns its own presentation, publishes
 * a `worldTimeScale` the game multiplies into its delta and a `floodlightDim`
 * the renderer reads, and a `hud` snapshot the UI reads directly (a dedicated
 * on-screen caption, since the announcer banner is a probabilistic bonus, not
 * the primary way this reads to the player).
 */
import * as THREE from 'three';
import { Tower } from './Tower';
import { CaptureStage } from './CaptureSequence';

export type EvolutionPhase = 'charge' | 'flash' | 'reveal';

export interface EvolutionHud {
  phase: EvolutionPhase;
  fromName: string;
  toName: string;
  /** 0..1 letterbox bar extension. */
  letterbox: number;
  /** 0..1 full-screen white-out, peaking as the model swaps. */
  flash: number;
  caption: string;
}

const D_CHARGE = 1.2;
const D_FLASH = 0.3;
const D_REVEAL = 1.6;
const D_HOLD = 0.35;
const GLOW_COLOR = 0xfff3c4;

/** Materials owned exclusively by a procedural fallback model are safe to tint in place. */
interface TintTarget {
  material: THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };
  baseColor: THREE.Color;
}

export class EvolutionSequence {
  public readonly group = new THREE.Group();
  public readonly hud: EvolutionHud;

  private elapsed = 0;
  private readonly beats: { flash: number; reveal: number; end: number };
  private readonly focus: THREE.Vector3;
  private readonly tintTargets: TintTarget[];

  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private glowLight: THREE.PointLight;

  private auraTimer = 0;
  private swapped = false;
  private firedFlash = false;
  private firedReveal = false;

  constructor(private tower: Tower, fromName: string, toName: string, private stage: CaptureStage) {
    this.beats = { flash: D_CHARGE, reveal: D_CHARGE + D_FLASH, end: D_CHARGE + D_FLASH + D_REVEAL + D_HOLD };
    this.hud = {
      phase: 'charge',
      fromName, toName,
      letterbox: 0,
      flash: 0,
      caption: `WHAT?! ${fromName.toUpperCase()} IS EVOLVING!`,
    };

    const height = tower.animPokemon.height ?? 2.2;
    this.focus = tower.position.clone().add(new THREE.Vector3(0, height * 0.5, 0));

    // Authentic GLB models share their materials across every clone of that
    // species on the pitch (SkeletonUtils.clone does not deep-clone
    // materials), so only the procedural fallback models — one fresh
    // material set per tower — are safe to tint directly.
    this.tintTargets = tower.animPokemon.mesh.userData.authenticStadiumAsset
      ? []
      : this.collectTintTargets(tower.animPokemon.mesh);

    const upright = new THREE.CylinderGeometry(0.55, 0.9, height * 2.4, 16, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: GLOW_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beam = new THREE.Mesh(upright, this.beamMat);
    this.beam.position.copy(tower.position).add(new THREE.Vector3(0, height * 1.2, 0));
    this.group.add(this.beam);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: GLOW_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 32), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.copy(tower.position).add(new THREE.Vector3(0, 0.1, 0));
    this.group.add(this.ring);

    this.glowLight = new THREE.PointLight(GLOW_COLOR, 0, 12);
    this.glowLight.position.copy(this.focus);
    this.group.add(this.glowLight);

    const angle = Math.atan2(-tower.position.x, -tower.position.z);
    stage.camera.beginCinematic(this.focus, 7.5, 2.6, 0.22, angle);
    stage.arena.setCrowdMood(-1);
    stage.audio.duckCrowd(0.3, 0.5);
    stage.audio.playEvolutionCharge();
  }

  /** How fast the rest of the game should run right now: 1 is real time. */
  public get worldTimeScale(): number {
    const t = this.elapsed;
    if (t < 0.35) return THREE.MathUtils.lerp(1, 0.05, t / 0.35);
    if (t < this.beats.reveal) return 0.05;
    const since = t - this.beats.reveal;
    return THREE.MathUtils.clamp(0.05 + since * 1.2, 0.05, 1);
  }

  /** Floodlight dimming, 0 = normal stadium lighting, 1 = blackout. */
  public get floodlightDim(): number {
    const fadeIn = THREE.MathUtils.clamp(this.elapsed / 0.4, 0, 1);
    const fadeOut = THREE.MathUtils.clamp((this.elapsed - this.beats.reveal - 0.6) / 0.6, 0, 1);
    return 0.68 * fadeIn * (1 - fadeOut);
  }

  /** Returns true once the whole set piece has played out. */
  public update(dt: number): boolean {
    this.elapsed += dt;
    const t = this.elapsed;

    const closing = THREE.MathUtils.clamp((t - this.beats.reveal - 0.5) / 0.4, 0, 1);
    this.hud.letterbox = THREE.MathUtils.clamp(t / 0.3, 0, 1) * (1 - closing);
    this.glowLight.position.copy(this.focus);

    if (t < this.beats.flash) this.updateCharge(t);
    else if (t < this.beats.reveal) this.updateFlash(t);
    else this.updateReveal(t);

    return t >= this.beats.end;
  }

  private updateCharge(t: number): void {
    this.hud.phase = 'charge';
    const p = THREE.MathUtils.smoothstep(t / D_CHARGE, 0, 1);
    this.applyTint(p * 0.85);

    this.beamMat.opacity = p * 0.55;
    this.beam.scale.set(0.3 + p * 0.8, 1, 0.3 + p * 0.8);
    this.ringMat.opacity = p * 0.7;
    this.ring.scale.setScalar(1 + p * 3.5);
    this.glowLight.intensity = p * 5;

    this.auraTimer -= 1 / 60;
    if (this.auraTimer <= 0) {
      this.auraTimer = THREE.MathUtils.lerp(0.22, 0.05, p);
      this.stage.particles.emitAura(this.tower.position, GLOW_COLOR, Math.round(6 + p * 14), 0.8 + p * 0.6);
    }
  }

  private updateFlash(t: number): void {
    this.hud.phase = 'flash';
    const p = (t - this.beats.flash) / D_FLASH;
    this.hud.caption = `WHAT?! ${this.hud.fromName.toUpperCase()} IS EVOLVING!`;
    this.hud.flash = Math.sin(Math.min(1, p) * Math.PI);
    this.applyTint(1);
    this.glowLight.intensity = 6 + this.hud.flash * 6;

    if (!this.firedFlash) {
      this.firedFlash = true;
      this.stage.camera.punchZoom(10);
      this.stage.camera.shake(0.3);
      this.stage.audio.playEvolutionFlash();
      this.stage.particles.emitRing(this.tower.position, 0xffffff, 4.5, 0.8);
      this.stage.particles.emitGroundBurst(this.tower.position, GLOW_COLOR, 2.0, 22);
    }

    // The swap happens mid-flash, buried under the white-out.
    if (!this.swapped && p >= 0.5) {
      this.swapped = true;
      this.tower.completeEvolutionSwap();
    }
  }

  private updateReveal(t: number): void {
    this.hud.phase = 'reveal';
    const p = THREE.MathUtils.clamp((t - this.beats.reveal) / D_REVEAL, 0, 1);
    this.hud.flash = Math.max(0, 1 - p * 4);
    this.hud.caption = `${this.hud.fromName.toUpperCase()} EVOLVED INTO ${this.hud.toName.toUpperCase()}!`;

    // The new model settles in with a soft overshoot pop.
    const settle = THREE.MathUtils.clamp(p * 2.4, 0, 1);
    const pop = 1 + Math.sin(Math.min(1, settle) * Math.PI) * 0.12 * (1 - settle);
    this.tower.animPokemon.mesh.scale.setScalar(THREE.MathUtils.lerp(0.001, 1, THREE.MathUtils.smoothstep(settle, 0, 1)) * pop);

    this.beamMat.opacity = Math.max(0, 0.55 * (1 - p * 1.8));
    this.ringMat.opacity = Math.max(0, 0.7 * (1 - p * 1.8));
    this.ring.scale.setScalar(4.5 + p * 6);
    this.glowLight.intensity = Math.max(0, 8 * (1 - p * 1.6));

    if (!this.firedReveal && p > 0.02) {
      this.firedReveal = true;
      this.stage.audio.playFanfare();
      this.stage.arena.setCrowdMood(1);
      this.stage.audio.duckCrowd(1.6, 0.3);
      this.stage.particles.emitAura(this.tower.position, 0xffe46b, 26, 1.4);
    }
  }

  /** Lerps every collected material toward a hot white, from its cached base color. */
  private applyTint(amount: number): void {
    for (const target of this.tintTargets) {
      const mat = target.material;
      if (mat.color) mat.color.copy(target.baseColor).lerp(new THREE.Color(0xffffff), amount * 0.85);
      if (mat.emissive) {
        mat.emissive.setScalar(amount);
        if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 1 + amount * 3;
      }
    }
  }

  private collectTintTargets(root: THREE.Object3D): TintTarget[] {
    const seen = new Set<THREE.Material>();
    const targets: TintTarget[] = [];
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (seen.has(material)) continue;
        seen.add(material);
        const tintable = material as TintTarget['material'];
        if (tintable.color) targets.push({ material: tintable, baseColor: tintable.color.clone() });
      }
    });
    return targets;
  }

  public dispose(scene: THREE.Scene): void {
    this.stage.camera.releaseCinematic();
    this.stage.audio.duckCrowd(1, 1.2);
    this.stage.arena.setCrowdMood(0);
    this.tower.animPokemon.mesh.scale.setScalar(1);
    scene.remove(this.group);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose()); else material.dispose();
      }
    });
  }
}
