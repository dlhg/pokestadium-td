/**
 * JaggedBeam.ts — A crackling energy tether between two points.
 *
 * The capture beam in the anime is not a clean cone of light: it is a bolt,
 * kinked and restless, that snaps onto its target and holds. This draws that —
 * a camera-facing ribbon whose centreline is broken into segments and thrown
 * sideways by a jitter that re-rolls a few dozen times a second, so the bolt
 * strobes between shapes instead of smoothly wobbling.
 *
 * The geometry is allocated once and rewritten in place every frame; nothing
 * here allocates per frame, since it runs inside a near-frozen set piece where
 * a garbage collection pause would be plainly visible.
 *
 * Also useful for electric moves — it is deliberately unaware of Poké Balls.
 */
import * as THREE from 'three';

/** Rolls of the dice per second. Slow enough to read as discrete snaps. */
const DEFAULT_STROBE = 26;

export interface JaggedBeamParams {
  /** Half-width at the fattest point, in world units. */
  width: number;
  /** How far the centreline can stray from the straight line, in world units. */
  jitter: number;
  opacity: number;
  /** 0 keeps the bolt inside `start`..`end`; 1 lets it reach the full span. */
  reach?: number;
}

export class JaggedBeam {
  public readonly mesh: THREE.Mesh;

  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  /** Current jittered centreline, world space, reused by `pointAt`. */
  private readonly centre: THREE.Vector3[];
  /** Unit-scale lateral offsets, re-rolled on the strobe. */
  private readonly offsets: THREE.Vector2[];

  private strobeTimer = 0;

  private readonly axis = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly point = new THREE.Vector3();

  constructor(color: number, private readonly segments: number = 16, private readonly strobe: number = DEFAULT_STROBE) {
    const vertices = (segments + 1) * 2;
    this.positions = new Float32Array(vertices * 3);
    this.centre = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this.offsets = Array.from({ length: segments + 1 }, () => new THREE.Vector2());
    this.reseed();

    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(index);

    this.material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Rewritten from scratch each frame, so a cached bounding sphere would
    // cull it the moment the bolt moved off its first position.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  /**
   * Redraws the bolt between two points. `eye` is the camera position, which
   * the ribbon turns to face so it never thins out to a line.
   */
  public update(dt: number, start: THREE.Vector3, end: THREE.Vector3, eye: THREE.Vector3, params: JaggedBeamParams): void {
    this.strobeTimer += dt;
    const interval = 1 / this.strobe;
    if (this.strobeTimer >= interval) {
      this.strobeTimer %= interval;
      this.reseed();
    }

    this.material.opacity = params.opacity;
    this.mesh.visible = params.opacity > 0.002;
    if (!this.mesh.visible) return;

    const reach = params.reach ?? 1;
    this.axis.subVectors(end, start);
    const span = this.axis.length();
    if (span < 1e-4) { this.mesh.visible = false; return; }
    this.axis.divideScalar(span);

    // Build a frame around the bolt: `side` faces the camera edge-on so the
    // ribbon always presents its face, `up` completes the basis for 3D kinks.
    this.view.subVectors(eye, start).normalize();
    this.side.crossVectors(this.axis, this.view);
    if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0); else this.side.normalize();
    this.up.crossVectors(this.axis, this.side).normalize();

    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      // The bolt is pinned at both ends and loosest in the middle; a bolt that
      // wandered at its tips would look unattached to what it is holding.
      const slack = Math.sin(t * Math.PI);
      const offset = this.offsets[i];
      this.centre[i]
        .copy(start)
        .addScaledVector(this.axis, span * reach * t)
        .addScaledVector(this.side, offset.x * params.jitter * slack)
        .addScaledVector(this.up, offset.y * params.jitter * slack);

      const halfWidth = params.width * (0.35 + slack * 0.65);
      const base = i * 6;
      this.positions[base] = this.centre[i].x + this.side.x * halfWidth;
      this.positions[base + 1] = this.centre[i].y + this.side.y * halfWidth;
      this.positions[base + 2] = this.centre[i].z + this.side.z * halfWidth;
      this.positions[base + 3] = this.centre[i].x - this.side.x * halfWidth;
      this.positions[base + 4] = this.centre[i].y - this.side.y * halfWidth;
      this.positions[base + 5] = this.centre[i].z - this.side.z * halfWidth;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * A point along the bolt's current kinked path, 0 at `start` and 1 at `end`.
   * Travelling along this instead of the straight line is what makes something
   * look like it is being dragged *down the bolt* rather than past it.
   */
  public pointAt(t: number, out: THREE.Vector3 = this.point): THREE.Vector3 {
    const clamped = THREE.MathUtils.clamp(t, 0, 1) * this.segments;
    const low = Math.floor(clamped);
    const high = Math.min(this.segments, low + 1);
    return out.lerpVectors(this.centre[low], this.centre[high], clamped - low);
  }

  public setColor(color: number): void {
    this.material.color.setHex(color);
  }

  private reseed(): void {
    for (let i = 0; i <= this.segments; i++) {
      this.offsets[i].set(Math.random() * 2 - 1, Math.random() * 2 - 1);
    }
    // Pin the tips: the ends belong to the ball and the target, not the noise.
    this.offsets[0].set(0, 0);
    this.offsets[this.segments].set(0, 0);
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
