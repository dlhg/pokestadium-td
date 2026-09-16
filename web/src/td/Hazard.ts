/**
 * Hazard.ts — Patches Left on the Lane
 *
 * Spores, embers and the like that a tower drops under its target. A hazard
 * never aims, so it catches Phantoms; it sits on the ground, so Airborne
 * creeps pass over it. Each creep inside takes its damage over time and has
 * its status reapplied once a second while it stays.
 */

import * as THREE from 'three';
import { StatusEffectType } from '../stadium/MoveDatabase';
import { getCombinedEffectiveness, PokemonType, TYPE_COLORS, sporeStatusMultiplier } from '../stadium/TypeMatrix';
import { ARMOR_LIGHT_MULTIPLIER, Creep } from './Creep';
import type { Tower } from './Tower';

export type HazardId =
  | 'stun_spore' | 'sleep_powder' | 'ember_patch' | 'fire_spin_patch'
  | 'spore_trap' | 'spore_trap_big' | 'spore_cloud'
  | 'rock_tomb' | 'stone_wall' | 'rock_wall'
  | 'poison_powder' | 'toxic_powder' | 'toxic_cloud';

export interface HazardSpec {
  name: string;
  type: PokemonType;
  radius: number;
  duration: number;
  /** Base damage per second to each creep inside, scaled by the tower's damage stat. */
  damagePerSecond: number;
  status?: { effect: StatusEffectType; duration: number };
  /** Bulbasaur's spore kit: scale status duration by sporeStatusMultiplier instead of the base type chart. */
  sporeScaled?: boolean;
}

export const HAZARDS: Record<HazardId, HazardSpec> = {
  // Duration is kept under the 1s reapply interval so a standing creep gets
  // real gaps of freedom instead of a permanent lock.
  stun_spore: { name: 'Stun Spore', type: 'Grass', radius: 2.4, duration: 4, damagePerSecond: 0,
    status: { effect: 'paralyze', duration: 0.6 }, sporeScaled: true },
  sleep_powder: { name: 'Sleep Powder', type: 'Grass', radius: 3.0, duration: 5.5, damagePerSecond: 0,
    status: { effect: 'sleep', duration: 0.7 }, sporeScaled: true },
  ember_patch: { name: 'Embers', type: 'Fire', radius: 2.2, duration: 3, damagePerSecond: 10,
    status: { effect: 'burn', duration: 2.5 } },
  fire_spin_patch: { name: 'Fire Spin', type: 'Fire', radius: 2.6, duration: 3.5, damagePerSecond: 14,
    status: { effect: 'stun', duration: 0.7 } },
  // Paras: few traps, but they linger long enough to catch several waves of runners.
  spore_trap: { name: 'Spore Trap', type: 'Grass', radius: 2.2, duration: 12, damagePerSecond: 0,
    status: { effect: 'sleep', duration: 2.5 } },
  spore_trap_big: { name: 'Spore Trap', type: 'Grass', radius: 3.0, duration: 16, damagePerSecond: 0,
    status: { effect: 'sleep', duration: 3.2 } },
  spore_cloud: { name: 'Spore', type: 'Grass', radius: 5, duration: 8, damagePerSecond: 0,
    status: { effect: 'sleep', duration: 3.5 } },
  // Onix: stone that holds the lane shut while it stands.
  rock_tomb: { name: 'Rock Tomb', type: 'Rock', radius: 2.0, duration: 3, damagePerSecond: 4,
    status: { effect: 'stun', duration: 1.1 } },
  stone_wall: { name: 'Stone Wall', type: 'Rock', radius: 2.6, duration: 4.5, damagePerSecond: 6,
    status: { effect: 'stun', duration: 1.1 } },
  rock_wall: { name: 'Rock Wall', type: 'Rock', radius: 3.5, duration: 6, damagePerSecond: 10,
    status: { effect: 'stun', duration: 1.1 } },
  // Oddish: poison that stacks onto everything else holding the lane.
  poison_powder: { name: 'Poison Powder', type: 'Poison', radius: 2.4, duration: 4, damagePerSecond: 6,
    status: { effect: 'poison', duration: 5 } },
  toxic_powder: { name: 'Toxic Powder', type: 'Poison', radius: 2.8, duration: 5, damagePerSecond: 12,
    status: { effect: 'poison', duration: 8 } },
  toxic_cloud: { name: 'Toxic Cloud', type: 'Poison', radius: 5, duration: 8, damagePerSecond: 20,
    status: { effect: 'poison', duration: 10 } },
};

/** How often a creep standing in a hazard has its status reapplied. */
const STATUS_REAPPLY_INTERVAL = 1.0;

export class Hazard {
  public readonly spec: HazardSpec;
  public readonly position: THREE.Vector3;
  public readonly mesh: THREE.Mesh;
  private age = 0;
  private statusCooldowns = new Map<Creep, number>();

  constructor(id: HazardId, position: THREE.Vector3, private source: Tower | null, scene: THREE.Scene) {
    this.spec = HAZARDS[id];
    this.position = position.clone();
    const color = TYPE_COLORS[this.spec.type]?.num ?? 0xffffff;
    this.mesh = new THREE.Mesh(
      new THREE.CircleGeometry(this.spec.radius, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    // The lane ribbon rides 0.5 above the ground; sit just over it.
    this.mesh.position.set(this.position.x, this.position.y + 0.08, this.position.z);
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  public get active(): boolean {
    return this.age < this.spec.duration;
  }

  /** Returns false once the patch has burned out. */
  public update(dt: number, creeps: Creep[], onFaint: (creep: Creep) => void): boolean {
    if (dt <= 0) return true;
    this.age += dt;
    const damageScale = this.source?.modifiers.damage ?? 1;
    const statusScale = this.source?.modifiers.status ?? 1;

    for (const creep of creeps) {
      if (!creep.alive || creep.captureLocked || creep.hasTrait('airborne')) continue;
      if (Math.hypot(creep.position.x - this.position.x, creep.position.z - this.position.z) > this.spec.radius) continue;
      const effectiveness = getCombinedEffectiveness(this.spec.type, creep.types);
      if (effectiveness <= 0) continue;
      const sporeMult = this.spec.sporeScaled ? sporeStatusMultiplier(creep.types) : 1;
      if (sporeMult <= 0) continue;

      if (this.spec.damagePerSecond > 0) {
        const armor = creep.hasTrait('armored') ? ARMOR_LIGHT_MULTIPLIER : 1;
        const damage = this.spec.damagePerSecond * dt * effectiveness * armor * damageScale;
        if (creep.takeDamage(damage, this.source, true)) {
          onFaint(creep);
          continue;
        }
      }

      if (this.spec.status) {
        const ready = (this.statusCooldowns.get(creep) ?? 0) <= this.age;
        if (ready) {
          creep.applyStatus(this.spec.status.effect, this.spec.status.duration * statusScale * sporeMult, this.source);
          this.statusCooldowns.set(creep, this.age + STATUS_REAPPLY_INTERVAL);
        }
      }
    }

    const material = this.mesh.material as THREE.MeshBasicMaterial;
    const remaining = this.spec.duration - this.age;
    material.opacity = 0.42 * Math.min(1, remaining / 0.6) * (0.85 + Math.sin(this.age * 6) * 0.15);
    return this.active;
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
