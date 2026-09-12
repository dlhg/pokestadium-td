/**
 * Projectile.ts — 3D Animated Projectile & Damage Resolution
 *
 * Handles projectile physics, homing trajectories, elemental particle trails,
 * collision detection, area splash, and type damage calculation.
 */

import * as THREE from 'three';
import { MoveDefinition } from '../stadium/MoveDatabase';
import { TYPE_COLORS, getCombinedEffectiveness } from '../stadium/TypeMatrix';
import { Creep } from './Creep';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumAudio } from '../engine/StadiumAudio';
import { StadiumAnnouncer } from '../stadium/Announcer';

export class Projectile {
  public id: string;
  public move: MoveDefinition;
  public position: THREE.Vector3;
  public target: Creep;
  public active: boolean = true;
  public mesh: THREE.Mesh;

  private speed: number;
  private splashRadius: number;

  constructor(
    move: MoveDefinition,
    startPos: THREE.Vector3,
    target: Creep,
    scene: THREE.Scene
  ) {
    this.id = `proj_${Date.now()}_${Math.random()}`;
    this.move = move;
    this.position = startPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.target = target;
    this.speed = move.projectileSpeed;
    this.splashRadius = move.splashRadius;

    // Create 3D projectile geometry based on move type
    const colorHex = TYPE_COLORS[move.type]?.num || 0xffffff;

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

  public update(
    dt: number,
    creeps: Creep[],
    particles: ParticleSystem,
    audio: StadiumAudio,
    announcer: StadiumAnnouncer,
    onCreepFaint: (creep: Creep) => void
  ): boolean {
    if (!this.active) return false;

    // Target point (center mass of creep)
    const targetPos = this.target.alive
      ? this.target.position.clone().add(new THREE.Vector3(0, 1.0, 0))
      : this.position.clone();

    const dist = this.position.distanceTo(targetPos);
    const step = this.speed * dt;

    // Emit trail particle
    const colHex = TYPE_COLORS[this.move.type]?.num || 0xffffff;
    particles.emitTrail(this.position, colHex, 0.8);

    if (dist <= step || !this.target.alive) {
      // Impact!
      this.resolveImpact(creeps, particles, audio, announcer, onCreepFaint);
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

  private resolveImpact(
    creeps: Creep[],
    particles: ParticleSystem,
    audio: StadiumAudio,
    announcer: StadiumAnnouncer,
    onCreepFaint: (creep: Creep) => void
  ): void {
    const impactPos = this.target.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    const colHex = TYPE_COLORS[this.move.type]?.num || 0xffffff;

    // Visual impact burst
    particles.emitImpact(impactPos, colHex, this.splashRadius > 0 ? 30 : 18, 7);

    // Calculate targets in damage radius
    const hitList: Creep[] = [];
    if (this.splashRadius > 0) {
      for (const c of creeps) {
        if (c.alive && c.position.distanceTo(this.target.position) <= this.splashRadius) {
          hitList.push(c);
        }
      }
    } else {
      if (this.target.alive) {
        hitList.push(this.target);
      }
    }

    let hasSuperEffective = false;

    for (const victim of hitList) {
      const mult = this.move.ignoresType ? 1 : getCombinedEffectiveness(this.move.type, victim.types);
      if (mult >= 2.0) hasSuperEffective = true;

      const damage = Math.floor(this.move.basePower * mult);
      const died = victim.takeDamage(damage);

      // Status effect chance
      if (this.move.statusEffect !== 'none' && Math.random() < this.move.statusChance) {
        victim.applyStatus(this.move.statusEffect, this.move.statusDuration);
      }

      if (died) {
        onCreepFaint(victim);
      }
    }

    audio.playHit(hasSuperEffective);

    if (hasSuperEffective && Math.random() < 0.4) {
      announcer.trigger('super_effective');
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
