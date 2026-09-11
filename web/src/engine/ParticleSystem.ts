/**
 * ParticleSystem.ts — 3D Elemental Move Particle Engine
 *
 * Manages animated 3D particle bursts, elemental effects, impact sparks,
 * fire streams, lightning arcs, and laser beams.
 */

import * as THREE from 'three';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
  decay: number;
}

export class ParticleSystem {
  public group: THREE.Group = new THREE.Group();
  private particles: Particle[] = [];
  private maxParticles = 600;

  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  // Beam meshes (for Hyper Beam / Solar Beam)
  private beamMeshes: { mesh: THREE.Mesh; timer: number; maxTimer: number }[] = [];

  constructor() {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Create a circular particle texture procedurally
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

    const texture = new THREE.CanvasTexture(canvas);

    this.material = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
  }

  public emitImpact(pos: THREE.Vector3, colorHex: number, count: number = 18, speed: number = 6): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const spd = (0.5 + Math.random() * 0.8) * speed;

      this.particles.push({
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
        decay: 1.0,
      });
    }
  }

  public emitTrail(pos: THREE.Vector3, colorHex: number, size: number = 1.0): void {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
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
      decay: 1.0,
    });
  }

  public emitBeam(start: THREE.Vector3, end: THREE.Vector3, colorHex: number, radius: number = 0.4, duration: number = 0.3): void {
    const dist = start.distanceTo(end);
    const geom = new THREE.CylinderGeometry(radius * 0.6, radius, dist, 8);
    geom.translate(0, dist / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start);
    mesh.lookAt(end);

    this.group.add(mesh);
    this.beamMeshes.push({ mesh, timer: 0, maxTimer: duration });
  }

  public update(dt: number): void {
    // Update active beams
    for (let i = this.beamMeshes.length - 1; i >= 0; i--) {
      const b = this.beamMeshes[i];
      b.timer += dt;
      const progress = b.timer / b.maxTimer;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - progress);
      b.mesh.scale.set(1 + progress * 0.5, 1 + progress * 0.5, 1);
      if (b.timer >= b.maxTimer) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.beamMeshes.splice(i, 1);
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * 4.0; // Gravity
    }

    // Write back buffer attributes
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

      this.sizes[i] = p.size * alpha;
    }

    // Reset remaining slots
    for (let i = count; i < this.maxParticles; i++) {
      this.sizes[i] = 0;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }
}
