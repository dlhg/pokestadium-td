/**
 * ParticleSystem.ts — 3D Elemental Move Particle Engine
 *
 * Manages animated 3D particle bursts, elemental impact sparks, directional
 * sprays, expanding ground shockwaves, drifting status auras, and beams.
 *
 * Everything is drawn as a single additive point cloud plus a handful of
 * short-lived meshes. The point shader honours a per-particle `size`
 * attribute, which THREE.PointsMaterial cannot do on its own.
 */

import * as THREE from 'three';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
  /** Downward pull per second. Sparks fall, spores and auras hang or rise. */
  gravity: number;
  /** Velocity retained per second. Below 1 the particle slows as it travels. */
  drag: number;
}

/** A mesh effect that fades over a fixed lifetime (beams, shockwave rings). */
interface TimedMesh {
  mesh: THREE.Mesh;
  timer: number;
  maxTimer: number;
  startOpacity: number;
  /** Scale multiplier reached at the end of the effect's life. */
  endScale: number;
  /** Rings grow across the ground plane; beams bloom on every axis. */
  flat: boolean;
}

const VERTEX_SHADER = `
  attribute float size;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D map;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor, 1.0) * tex;
  }
`;

export class ParticleSystem {
  public group: THREE.Group = new THREE.Group();
  private particles: Particle[] = [];
  private maxParticles = 900;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  private timedMeshes: TimedMesh[] = [];

  constructor() {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.createSpriteTexture() } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    // The cloud is rebuilt every frame from live particles only, so three's
    // own frustum test against a stale bounding sphere would wrongly cull it.
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Soft circular sprite, generated rather than loaded. */
  private createSpriteTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
  }

  private spawn(p: Particle): void {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push(p);
  }

  /** Radial burst of sparks. The default impact for every archetype. */
  public emitImpact(pos: THREE.Vector3, colorHex: number, count: number = 18, speed: number = 6): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const spd = (0.5 + Math.random() * 0.8) * speed;

      this.spawn({
        position: pos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4
        )),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(elevation) * spd,
          Math.sin(elevation) * spd + 1.5,
          Math.sin(angle) * Math.cos(elevation) * spd
        ),
        color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2),
        size: 0.8 + Math.random() * 1.2,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.3,
        gravity: 4.0,
        drag: 1.0,
      });
    }
  }

  /**
   * The universal "this is a signature move" payoff (round 2 feedback
   * #28/33): a bright, white-hot burst layered on top of whatever
   * per-move particles an effect already emits, plus a wide shockwave
   * ring — distinctly bigger and whiter than an ordinary impact so a
   * signature cast reads as a bigger moment at a glance.
   */
  public emitSignatureFlash(pos: THREE.Vector3, colorHex: number): void {
    const col = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.55);
    for (let i = 0; i < 36; i++) {
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const spd = (0.6 + Math.random()) * 11;

      this.spawn({
        position: pos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.6
        )),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(elevation) * spd,
          Math.sin(elevation) * spd + 2.5,
          Math.sin(angle) * Math.cos(elevation) * spd
        ),
        color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        size: 1.1 + Math.random() * 1.5,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.25,
        gravity: 3.0,
        drag: 1.0,
      });
    }
    this.emitRing(pos, 0xffffff, 3.2, 0.4);
  }

  /** Per-frame wake left behind a travelling projectile. */
  public emitTrail(pos: THREE.Vector3, colorHex: number, size: number = 1.0): void {
    this.spawn({
      position: pos.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2 + 0.5,
        (Math.random() - 0.5) * 1.2
      ),
      color: new THREE.Color(colorHex),
      size: size * (0.8 + Math.random() * 0.5),
      life: 0,
      maxLife: 0.25 + Math.random() * 0.2,
      gravity: 4.0,
      drag: 1.0,
    });
  }

  /**
   * Spray fanning from `origin` toward `target` — flamethrowers, blizzards,
   * spore clouds. Particles are timed to die around the target, so the spray
   * reads as reaching its mark without any travelling mesh.
   */
  public emitCone(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    colorHex: number,
    count: number = 26,
    spread: number = 0.32,
    gravity: number = 1.2,
  ): void {
    const col = new THREE.Color(colorHex);
    const toTarget = new THREE.Vector3().subVectors(target, origin);
    const distance = Math.max(0.001, toTarget.length());
    const dir = toTarget.divideScalar(distance);

    // Any two axes perpendicular to the spray, to scatter around it.
    const sideways = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const upward = new THREE.Vector3().crossVectors(dir, sideways).normalize();

    for (let i = 0; i < count; i++) {
      const reach = 0.7 + Math.random() * 0.5;
      const speed = (distance / 0.42) * reach;
      const jitter = sideways.clone()
        .multiplyScalar((Math.random() - 0.5) * spread)
        .addScaledVector(upward, (Math.random() - 0.5) * spread);

      this.spawn({
        position: origin.clone(),
        velocity: dir.clone().add(jitter).multiplyScalar(speed),
        color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.25),
        size: 1.1 + Math.random() * 1.3,
        life: 0,
        maxLife: 0.42 * reach,
        gravity,
        drag: 0.55,
      });
    }
  }

  /**
   * Slow motes blooming on a target — the control-move look for paralysis,
   * poison and sleep. Drifts upward instead of falling.
   */
  public emitAura(pos: THREE.Vector3, colorHex: number, count: number = 16, radius: number = 1.1): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = radius * (0.5 + Math.random() * 0.6);

      this.spawn({
        position: pos.clone().add(new THREE.Vector3(
          Math.cos(angle) * r,
          (Math.random() - 0.3) * radius,
          Math.sin(angle) * r
        )),
        velocity: new THREE.Vector3(
          Math.cos(angle) * 0.7,
          0.9 + Math.random() * 0.8,
          Math.sin(angle) * 0.7
        ),
        color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        size: 0.9 + Math.random() * 0.9,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.4,
        gravity: -0.6,
        drag: 0.9,
      });
    }
  }

  /** Dust kicked up around a ground impact, thrown outward and low. */
  public emitGroundBurst(pos: THREE.Vector3, colorHex: number, radius: number, count: number = 30): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = radius * (0.6 + Math.random() * 0.7);

      this.spawn({
        // Callers pass a creep's centreline, which rides 0.5 above its ground.
        position: new THREE.Vector3(pos.x, pos.y - 0.35, pos.z),
        velocity: new THREE.Vector3(
          Math.cos(angle) * spd,
          2.2 + Math.random() * 2.6,
          Math.sin(angle) * spd
        ),
        color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2),
        size: 1.2 + Math.random() * 1.4,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.35,
        gravity: 5.5,
        drag: 0.7,
      });
    }
  }

  /** Flat shockwave ring expanding across the pitch. */
  public emitRing(
    center: THREE.Vector3,
    colorHex: number,
    radius: number,
    duration: number = 0.55,
  ): void {
    const geom = new THREE.RingGeometry(Math.max(0.01, radius * 0.82), radius, 48);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Just clear of the lane ribbon so the wave stays readable over the track.
    mesh.position.set(center.x, center.y + 0.05, center.z);
    mesh.scale.setScalar(0.12);
    mesh.renderOrder = 3;

    this.group.add(mesh);
    this.timedMeshes.push({
      mesh, timer: 0, maxTimer: duration, startOpacity: 0.8, endScale: 1.0, flat: true,
    });
  }

  /** Instant line from caster to target, for beam archetypes. */
  public emitBeam(
    start: THREE.Vector3,
    end: THREE.Vector3,
    colorHex: number,
    radius: number = 0.4,
    duration: number = 0.3,
  ): void {
    const dist = start.distanceTo(end);
    const geom = new THREE.CylinderGeometry(radius * 0.6, radius, dist, 8);
    geom.translate(0, dist / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start);
    mesh.lookAt(end);

    this.group.add(mesh);
    this.timedMeshes.push({
      mesh, timer: 0, maxTimer: duration, startOpacity: 0.85, endScale: 1.5, flat: false,
    });
  }

  public update(dt: number): void {
    // Fade and grow the mesh effects, disposing them once spent.
    for (let i = this.timedMeshes.length - 1; i >= 0; i--) {
      const m = this.timedMeshes[i];
      m.timer += dt;
      const progress = Math.min(1, m.timer / m.maxTimer);

      (m.mesh.material as THREE.MeshBasicMaterial).opacity = m.startOpacity * (1 - progress);
      const scale = 0.12 + (m.endScale - 0.12) * progress;
      if (m.flat) {
        m.mesh.scale.set(scale, 1, scale);
      } else {
        m.mesh.scale.set(1 + progress * (m.endScale - 1), 1 + progress * (m.endScale - 1), 1);
      }

      if (m.timer >= m.maxTimer) {
        this.group.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        this.timedMeshes.splice(i, 1);
      }
    }

    // Advance particles, dropping the expired ones.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * p.gravity;
      if (p.drag !== 1.0) {
        p.velocity.multiplyScalar(Math.pow(p.drag, dt));
      }
    }

    // Write back buffer attributes. Alpha is folded into the colour because
    // additive blending reads brightness as opacity.
    const count = this.particles.length;
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const alpha = 1 - (p.life / p.maxLife);

      this.positions[i * 3 + 0] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;

      this.colors[i * 3 + 0] = p.color.r * alpha;
      this.colors[i * 3 + 1] = p.color.g * alpha;
      this.colors[i * 3 + 2] = p.color.b * alpha;

      this.sizes[i] = p.size;
    }

    // Only draw live particles; stale slots past `count` would otherwise
    // render at their last position forever.
    this.geometry.setDrawRange(0, count);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }
}
