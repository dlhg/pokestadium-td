/**
 * Projectile.ts — 3D Animated Projectile
 *
 * Implements the `projectile` delivery archetype: a mesh that homes onto one
 * creep, trailing elemental particles, then hands off to the shared hit
 * resolver on contact. Every other archetype lands instantly and is drawn by
 * `MoveDelivery.playInstantDelivery` instead.
 */

import * as THREE from 'three';
import { MoveDefinition } from '../stadium/MoveDatabase';
import { Creep } from './Creep';
import { HitContext, HitExtras, moveColor, resolveMoveHit } from './MoveDelivery';
import type { Tower } from './Tower';

export class Projectile {
  public id: string;
  public move: MoveDefinition;
  public position: THREE.Vector3;
  public target: Creep;
  public active: boolean = true;
  public mesh: THREE.Mesh;

  private speed: number;

  constructor(
    move: MoveDefinition,
    startPos: THREE.Vector3,
    target: Creep,
    scene: THREE.Scene,
    /** The tower that fired it, credited with the hit. */
    private source: Tower | null = null,
    /** Rage, crits, chains and the like, fixed when the shot was fired. */
    private extras: HitExtras = {},
  ) {
    this.id = `proj_${Date.now()}_${Math.random()}`;
    this.move = move;
    this.position = startPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.target = target;
    this.speed = move.projectileSpeed;

    // Silhouette follows the move's element, so a bolt never reads as a leaf.
    const colorHex = moveColor(move);

    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;

    if (move.fxType === 'lightning') {
      geo = new THREE.TetrahedronGeometry(0.5);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true });
    } else if (move.fxType === 'flamethrower') {
      geo = new THREE.SphereGeometry(0.6, 8, 8);
      mat = new THREE.MeshBasicMaterial({ color: colorHex });
    } else if (move.fxType === 'water_stream') {
      geo = new THREE.ConeGeometry(0.4, 0.9, 6);
      mat = new THREE.MeshLambertMaterial({ color: colorHex });
    } else if (move.fxType === 'razor_leaf') {
      geo = new THREE.PlaneGeometry(0.7, 0.4);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    } else if (move.fxType === 'blizzard') {
      geo = new THREE.OctahedronGeometry(0.45);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true });
    } else if (move.fxType === 'shadow_ball') {
      geo = new THREE.IcosahedronGeometry(0.55, 0);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 });
    } else if (move.fxType === 'psychic_wave') {
      geo = new THREE.TorusGeometry(0.42, 0.16, 6, 12);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true });
    } else if (move.fxType === 'spore_cloud') {
      geo = new THREE.SphereGeometry(0.65, 6, 6);
      mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55 });
    } else if (move.fxType === 'earthquake') {
      geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
      mat = new THREE.MeshLambertMaterial({ color: colorHex });
    } else if (move.fxType === 'impact') {
      geo = new THREE.TetrahedronGeometry(0.42);
      mat = new THREE.MeshBasicMaterial({ color: colorHex });
    } else {
      geo = new THREE.SphereGeometry(0.5, 8, 8);
      mat = new THREE.MeshBasicMaterial({ color: colorHex });
    }

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);
  }

  /** Advances one step. Returns false once it has landed and should be reaped. */
  public update(dt: number, ctx: HitContext): boolean {
    if (!this.active) return false;
    // A dead target normally detonates its projectile immediately, but that
    // resolution still belongs to simulation time and must wait through pause.
    if (dt <= 0) return true;

    // Target point (center mass of creep)
    const targetPos = this.target.alive
      ? this.target.position.clone().add(new THREE.Vector3(0, 1.0, 0))
      : this.position.clone();

    const dist = this.position.distanceTo(targetPos);
    const step = this.speed * dt;

    ctx.particles.emitTrail(this.position, moveColor(this.move), 0.8);

    // Landing on a dead target still detonates, so splash is never wasted.
    if (dist <= step || !this.target.alive) {
      resolveMoveHit(this.move, this.target, ctx, this.source, null, this.extras);
      this.active = false;
      return false;
    }

    // Move along homing vector
    const dir = new THREE.Vector3().subVectors(targetPos, this.position).normalize();
    this.position.addScaledVector(dir, step);
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(targetPos);

    return true;
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
