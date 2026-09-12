/**
 * MoveDelivery.ts — Move Delivery Archetypes & Shared Hit Resolution
 *
 * Every move lands through one of five archetypes (see `DeliveryType`). Only
 * `projectile` spawns a travelling mesh; the rest resolve the instant they are
 * fired and differ purely in how they are drawn and how hard they shake the
 * arena. Damage, splash and status application are identical across all five
 * and live in `resolveMoveHit`, so the rules never fork per archetype.
 */

import * as THREE from 'three';
import { MoveDefinition } from '../stadium/MoveDatabase';
import { TYPE_COLORS, getCombinedEffectiveness } from '../stadium/TypeMatrix';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumAudio } from '../engine/StadiumAudio';
import { StadiumCamera } from '../engine/StadiumCamera';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { Creep } from './Creep';
import type { Tower } from './Tower';

/** Everything a landing move needs in order to apply itself and react. */
export interface HitContext {
  creeps: Creep[];
  particles: ParticleSystem;
  audio: StadiumAudio;
  announcer: StadiumAnnouncer;
  onFaint: (creep: Creep) => void;
}

/** Elemental colour a move's effects are tinted with. */
export function moveColor(move: MoveDefinition): number {
  return TYPE_COLORS[move.type]?.num ?? 0xffffff;
}

/** Chest height on a creep — where impacts and beams are aimed. */
function centerMass(creep: Creep): THREE.Vector3 {
  return creep.position.clone().add(new THREE.Vector3(0, 1.0, 0));
}

/**
 * Applies a move at `target`: impact burst, splash sweep, damage, status, and
 * the announcer's reaction. Shared by every archetype, so a splash move hits
 * its whole radius whether it arrived by projectile, beam or shockwave.
 */
export function resolveMoveHit(
  move: MoveDefinition,
  target: Creep,
  ctx: HitContext,
  source: Tower | null = null,
): void {
  // The caster's level and stats scale every hit; a sourceless hit is neutral.
  const mods = source?.modifiers ?? { damage: 1, rate: 1, status: 1 };
  const color = moveColor(move);
  ctx.particles.emitImpact(centerMass(target), color, move.splashRadius > 0 ? 30 : 18, 7);

  // Splash sweeps everything near the target; single-target needs it alive.
  const hitList: Creep[] = [];
  if (move.splashRadius > 0) {
    for (const creep of ctx.creeps) {
      if (creep.alive && creep.position.distanceTo(target.position) <= move.splashRadius) {
        hitList.push(creep);
      }
    }
  } else if (target.alive) {
    hitList.push(target);
  }

  let hasSuperEffective = false;

  for (const victim of hitList) {
    const multiplier = move.ignoresType
      ? 1
      : getCombinedEffectiveness(move.type, victim.types);
    if (multiplier >= 2.0) hasSuperEffective = true;

    const died = victim.takeDamage(Math.floor(move.basePower * multiplier * mods.damage), source);

    if (!died && move.statusEffect !== 'none' && Math.random() < Math.min(1, move.statusChance * mods.status)) {
      victim.applyStatus(move.statusEffect, move.statusDuration * mods.status, source);
    }

    if (died) ctx.onFaint(victim);
  }

  ctx.audio.playHit(hasSuperEffective);

  if (hasSuperEffective && Math.random() < 0.4) {
    ctx.announcer.trigger('super_effective');
  }
}

/**
 * Draws the four archetypes that need no travelling mesh. Visuals and camera
 * only — the caller resolves the hit separately.
 *
 * `projectile` is absent by design: it is the one archetype with a lifetime,
 * so it is owned by the Projectile entity instead.
 */
export function playInstantDelivery(
  move: MoveDefinition,
  origin: THREE.Vector3,
  target: Creep,
  particles: ParticleSystem,
  camera: StadiumCamera,
): void {
  const color = moveColor(move);
  const casterPos = origin.clone().add(new THREE.Vector3(0, 1.5, 0));
  const targetPos = centerMass(target);

  switch (move.delivery) {
    case 'beam': {
      particles.emitBeam(casterPos, targetPos, color, 0.55, 0.32);
      // Only the finishers earn a camera cut; lesser beams just thump.
      if (move.basePower >= 120) {
        camera.triggerActionCam(target.position, 1.6);
      } else {
        camera.shake(0.18);
      }
      break;
    }

    case 'cone': {
      // Powders and gases hang in the air; flame and ice fall away.
      const gravity = move.fxType === 'spore_cloud' ? -0.25 : 1.2;
      particles.emitCone(casterPos, targetPos, color, 30, 0.34, gravity);
      camera.shake(0.1);
      break;
    }

    case 'field': {
      // Ground-centred, so it reads from the tactical camera looking down.
      const radius = Math.max(2, move.splashRadius);
      particles.emitRing(target.position, color, radius, 0.55);
      particles.emitGroundBurst(target.position, color, radius * 0.8, 34);
      camera.shake(Math.min(0.75, 0.25 + move.basePower / 220));
      break;
    }

    case 'aura': {
      particles.emitAura(targetPos, color, 18, Math.max(1.0, move.splashRadius * 0.5));
      break;
    }
  }
}
