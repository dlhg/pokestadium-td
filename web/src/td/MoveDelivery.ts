/**
 * MoveDelivery.ts — Move Delivery Archetypes & Shared Hit Resolution
 *
 * Every move lands through one of five archetypes (see `DeliveryType`), and
 * the archetype decides who gets caught in it: a beam pierces a line, a cone
 * sprays an arc, a field rings the caster. Only `projectile` spawns a
 * travelling mesh; the rest resolve the instant they are fired. Damage, armor,
 * type effectiveness and status all run through `resolveMoveHit`, so those
 * rules never fork per archetype.
 */

import * as THREE from 'three';
import { isDamageStatus, isGroundOnly, isHeavy, MoveDefinition, StatusEffectType } from '../stadium/MoveDatabase';
import { TYPE_COLORS, getCombinedEffectiveness, getEffectivenessLabel } from '../stadium/TypeMatrix';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumAudio } from '../engine/StadiumAudio';
import { StadiumCamera } from '../engine/StadiumCamera';
import { ARMOR_LIGHT_MULTIPLIER, Creep } from './Creep';
import type { ShotInfo, Tower } from './Tower';
import type { AttackProfile, BonusTarget } from './TowerAttack';

/** Half the width of a beam's hit corridor, in arena units. */
export const BEAM_HALF_WIDTH = 1.4;
/** Arc a cone covers when its move doesn't specify one, in degrees. */
export const DEFAULT_CONE_ANGLE = 70;
/** How far a chained hit can jump from one creep to the next. */
export const CHAIN_JUMP_RANGE = 5.5;
/** Damage share each chained jump carries. */
export const CHAIN_DAMAGE_SHARE = 0.7;

/** What a path-shaped attack adds to a hit beyond its move. */
export interface HitExtras {
  damageMultiplier?: number;
  crit?: boolean;
  onHitStatus?: { status: StatusEffectType; chance: number; duration: number } | null;
  chain?: number;
  knockback?: number;
  spreadStatusRadius?: number;
  bonusVs?: { target: BonusTarget; multiplier: number }[];
  percentDamage?: { share: number; bossShare: number } | null;
}

export function hitExtrasFor(attack: AttackProfile, shot: ShotInfo): HitExtras {
  return {
    damageMultiplier: shot.damageMultiplier,
    crit: shot.crit,
    onHitStatus: attack.onHitStatus,
    chain: attack.chain,
    knockback: attack.knockback,
    spreadStatusRadius: attack.spreadStatusRadius,
    bonusVs: attack.bonusVs,
    percentDamage: attack.percentDamage,
  };
}

/** Everything a landing move needs in order to apply itself and react. */
export interface HitContext {
  creeps: Creep[];
  particles: ParticleSystem;
  audio: StadiumAudio;
  onFaint: (creep: Creep) => void;
  /** Floating combat text at a world point — crits and type effectiveness. */
  popup: (worldPosition: THREE.Vector3, text: string, color: string) => void;
  /** Player setting: show super/not-very-effective popups, not just immunity. */
  showTypeEffectiveness: boolean;
}

/** Elemental colour a move's effects are tinted with. */
export function moveColor(move: MoveDefinition): number {
  return TYPE_COLORS[move.type]?.num ?? 0xffffff;
}

/** Chest height on a creep — where impacts and beams are aimed. */
export function centerMass(creep: Creep): THREE.Vector3 {
  return creep.position.clone().add(new THREE.Vector3(0, 1.0, 0));
}

/** A little above the tower itself, so a per-attacker popup reads as
 *  "this tower" rather than floating over whatever it's aimed at. */
function towerCallout(tower: Tower): THREE.Vector3 {
  return tower.position.clone().add(new THREE.Vector3(0, 1.4, 0));
}

/** Where a move fired from `source` at `target` is aimed, and how far it reaches. */
export interface MoveGeometry {
  origin: THREE.Vector3;
  /** Unit direction across the ground toward the target. */
  direction: THREE.Vector3;
  reach: number;
}

export function moveGeometry(move: MoveDefinition, source: Tower, target: Creep): MoveGeometry {
  const direction = new THREE.Vector3(target.position.x - source.position.x, 0, target.position.z - source.position.z);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  return {
    origin: source.position,
    direction: direction.normalize(),
    reach: source.reachAgainst(move.range, target),
  };
}

/**
 * Every creep a move catches. Projectiles and auras burst on the target;
 * beams, cones and fields are measured from the caster, so a sourceless hit
 * (tests, scripted effects) falls back to the target burst.
 */
export function collectVictims(
  move: MoveDefinition,
  target: Creep,
  creeps: Creep[],
  geometry: MoveGeometry | null,
): Creep[] {
  const groundOnly = isGroundOnly(move);
  const hittable = (creep: Creep) => creep.alive && !creep.captureLocked && !(groundOnly && creep.hasTrait('airborne'));
  const shape = geometry ? move.delivery : 'projectile';

  switch (shape) {
    case 'beam':
      return creepsOnBeam(geometry!, creeps, move.pierce);

    case 'cone': {
      const { origin, direction, reach } = geometry!;
      const halfAngle = THREE.MathUtils.degToRad((move.coneAngle ?? DEFAULT_CONE_ANGLE) / 2);
      const minDot = Math.cos(halfAngle);
      return creeps.filter(creep => {
        if (!hittable(creep)) return false;
        const dx = creep.position.x - origin.x;
        const dz = creep.position.z - origin.z;
        const distance = Math.hypot(dx, dz);
        if (distance > reach) return false;
        // Anything standing on the caster is caught regardless of angle.
        return distance < 1 || (dx * direction.x + dz * direction.z) / distance >= minDot;
      });
    }

    case 'field': {
      const { origin, reach } = geometry!;
      return creeps.filter(creep => hittable(creep)
        && Math.hypot(creep.position.x - origin.x, creep.position.z - origin.z) <= reach);
    }

    default: {
      if (move.splashRadius > 0) {
        return creeps.filter(creep => hittable(creep) && creep.position.distanceTo(target.position) <= move.splashRadius);
      }
      return hittable(target) ? [target] : [];
    }
  }
}

/** Creeps along a beam's corridor, nearest first, stopping after `pierce` of them. */
export function creepsOnBeam(geometry: MoveGeometry, creeps: Creep[], pierce?: number): Creep[] {
  const { origin, direction, reach } = geometry;
  const caught: { creep: Creep; along: number }[] = [];
  for (const creep of creeps) {
    if (!creep.alive || creep.captureLocked) continue;
    const dx = creep.position.x - origin.x;
    const dz = creep.position.z - origin.z;
    const along = dx * direction.x + dz * direction.z;
    if (along < 0 || along > reach) continue;
    const across = Math.abs(dx * direction.z - dz * direction.x);
    if (across <= BEAM_HALF_WIDTH) caught.push({ creep, along });
  }
  caught.sort((a, b) => a.along - b.along);
  return caught.slice(0, pierce ?? caught.length).map(entry => entry.creep);
}

/** Damage a move deals to one creep before the caster's stats: type, then armor. */
export function hitDamage(move: MoveDefinition, victim: Creep): { damage: number; multiplier: number } {
  const multiplier = move.ignoresType ? 1 : getCombinedEffectiveness(move.type, victim.types);
  const armor = victim.hasTrait('armored') && !isHeavy(move) ? ARMOR_LIGHT_MULTIPLIER : 1;
  return { damage: move.basePower * multiplier * armor, multiplier };
}

/**
 * Applies a move: collects what its shape catches, then damage, status, and
 * the announcer's reaction for each, then any chains the attack carries.
 * `geometry` is omitted for projectiles, which have already travelled to the
 * target.
 */
export function resolveMoveHit(
  move: MoveDefinition,
  target: Creep,
  ctx: HitContext,
  source: Tower | null = null,
  geometry: MoveGeometry | null = null,
  extras: HitExtras = {},
): void {
  const color = moveColor(move);
  const hitList = collectVictims(move, target, ctx.creeps, geometry);
  if (!geometry || move.delivery === 'aura') {
    ctx.particles.emitImpact(centerMass(target), color, move.splashRadius > 0 ? 30 : 18, 7);
  } else {
    // Shaped hits flash on each creep they catch instead of one burst.
    for (const victim of hitList) ctx.particles.emitImpact(centerMass(victim), color, 8, 5);
  }

  const strikes = strikeCreeps(move, hitList, ctx, source, extras);
  const { struck } = strikes;

  // Chains leap from the last creep struck to the nearest one not yet hit.
  let from = target;
  for (let jump = 0; jump < (extras.chain ?? 0); jump++) {
    let next: Creep | null = null;
    let nearest = CHAIN_JUMP_RANGE;
    for (const creep of ctx.creeps) {
      if (struck.has(creep) || !creep.alive || creep.captureLocked) continue;
      const distance = creep.position.distanceTo(from.position);
      if (distance <= nearest) {
        nearest = distance;
        next = creep;
      }
    }
    if (!next) break;
    ctx.particles.emitBeam(centerMass(from), centerMass(next), color, 0.22, 0.25);
    const leap = strikeCreeps(move, [next], ctx, source, extras, CHAIN_DAMAGE_SHARE);
    leap.struck.forEach(creep => struck.add(creep));
    strikes.superEffective ||= leap.superEffective;
    from = next;
  }

  ctx.audio.playHit(strikes.superEffective);

  // A crit banner drowned out the far more frequent per-hit combat
  // popups (see strikeCreeps) for the same information; a small floating
  // callout is plenty for something this common.
  if (extras.crit) {
    ctx.popup(centerMass(target), 'CRITICAL HIT!', '#ffe766');
  }
}

/**
 * Damage, statuses, status spread and knockback for each creep a move has
 * already caught. Shared by ordinary attacks and signature moves, so both
 * obey type, armor and the caster's stats identically.
 */
export function strikeCreeps(
  move: MoveDefinition,
  victims: Creep[],
  ctx: HitContext,
  source: Tower | null,
  extras: HitExtras = {},
  share = 1,
): { struck: Set<Creep>; superEffective: boolean } {
  const mods = source?.modifiers ?? { damage: 1, rate: 1, status: 1 };
  const color = moveColor(move);
  const struck = new Set<Creep>();
  let superEffective = false;

  for (const victim of victims) {
    struck.add(victim);
    const { damage, multiplier } = hitDamage(move, victim);
    if (multiplier >= 2.0) superEffective = true;

    // Immunity gets a popup unconditionally — it is the one matchup a hit
    // gives zero other feedback for. Super/not-very-effective are the
    // deeper type-chart breakdown, so they stay behind the opt-in setting.
    if (multiplier <= 0) {
      const { label, color: effColor } = getEffectivenessLabel(multiplier);
      // Anchored at the attacking tower, not the victim: when several
      // towers hit the same creep at once, a victim-anchored popup can't
      // say which one whiffed (round 2 feedback #21). Falls back to the
      // victim when a hit has no single source tower (e.g. some AOE effects).
      ctx.popup(source ? towerCallout(source) : centerMass(victim), label, effColor);
    } else if (ctx.showTypeEffectiveness && multiplier !== 1) {
      const { label, color: effColor } = getEffectivenessLabel(multiplier);
      ctx.popup(centerMass(victim), label, effColor);
    }

    let bonus = 1;
    for (const { target, multiplier: extra } of extras.bonusVs ?? []) {
      const applies = target === 'boss' ? victim.threat !== 'normal'
        : target === 'held' ? victim.movementStatus !== null
        : victim.hasTrait(target);
      if (applies) bonus *= extra;
    }
    // A share of what the creep has left, on top of the hit — unless its type is immune.
    const percent = extras.percentDamage && multiplier > 0
      ? victim.hp * (victim.isBoss ? extras.percentDamage.bossShare : extras.percentDamage.share) * share
      : 0;
    const died = victim.takeDamage(Math.floor(damage * share * mods.damage * (extras.damageMultiplier ?? 1) * bonus + percent), source);
    if (died) {
      ctx.onFaint(victim);
      continue;
    }
    // Elemental immunity blocks the whole move, including its secondary
    // effect. A capture target is also protected from splash while locked.
    if (multiplier <= 0 || victim.captureLocked) continue;

    const statuses = [
      { status: move.statusEffect, chance: move.statusChance, duration: move.statusDuration },
      ...(extras.onHitStatus ? [extras.onHitStatus] : []),
    ];
    for (const { status, chance, duration } of statuses) {
      if (status === 'none' || Math.random() >= Math.min(1, chance * mods.status)) continue;
      const landed = victim.applyStatus(status, duration * mods.status, source);
      if (landed && extras.spreadStatusRadius && !isDamageStatus(status)) {
        for (const neighbour of ctx.creeps) {
          if (neighbour === victim || !neighbour.alive || neighbour.captureLocked) continue;
          if (neighbour.position.distanceTo(victim.position) > extras.spreadStatusRadius) continue;
          neighbour.applyStatus(status, duration * mods.status, source);
          ctx.particles.emitAura(centerMass(neighbour), color, 6, 0.8);
        }
      }
    }

    if (extras.knockback && !victim.isBoss) victim.pushBack(extras.knockback);
  }

  return { struck, superEffective };
}

/**
 * Draws the four archetypes that need no travelling mesh, sized to what they
 * actually hit. Visuals and camera only — the caller resolves the hit.
 *
 * `projectile` is absent by design: it is the one archetype with a lifetime,
 * so it is owned by the Projectile entity instead.
 */
export function playInstantDelivery(
  move: MoveDefinition,
  geometry: MoveGeometry,
  target: Creep,
  particles: ParticleSystem,
  camera: StadiumCamera,
): void {
  const color = moveColor(move);
  const casterPos = geometry.origin.clone().add(new THREE.Vector3(0, 1.5, 0));
  const targetPos = centerMass(target);
  // Beams and cones are drawn out to full reach, since that is what they hit.
  const reachPos = casterPos.clone().addScaledVector(geometry.direction, geometry.reach);
  reachPos.y = targetPos.y;

  switch (move.delivery) {
    case 'beam': {
      particles.emitBeam(casterPos, reachPos, color, 0.55, 0.32);
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
      const halfAngle = THREE.MathUtils.degToRad((move.coneAngle ?? DEFAULT_CONE_ANGLE) / 2);
      particles.emitCone(casterPos, reachPos, color, 40, Math.tan(halfAngle) * 2, gravity);
      camera.shake(0.1);
      break;
    }

    case 'field': {
      // Rings the caster, so it reads from the tactical camera looking down.
      particles.emitRing(geometry.origin, color, geometry.reach, 0.55);
      particles.emitGroundBurst(geometry.origin.clone().add(new THREE.Vector3(0, 0.5, 0)), color, geometry.reach * 0.6, 40);
      camera.shake(Math.min(0.75, 0.25 + move.basePower / 220));
      break;
    }

    case 'aura': {
      particles.emitAura(targetPos, color, 18, Math.max(1.0, move.splashRadius * 0.5));
      break;
    }
  }
}
