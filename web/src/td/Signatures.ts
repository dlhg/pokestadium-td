/**
 * Signatures.ts — Signature Moves the Player Calls
 *
 * Tier 3 of a path unlocks a signature move. The towers attack on their own;
 * a signature is the trainer stepping in: a button on the signature bar, a
 * handful of PP that refill every round, and a big effect for elites, Titans,
 * or saving a leak. Every signature is data plus one `cast` function.
 */

import * as THREE from 'three';
import { MOVES, MoveDefinition } from '../stadium/MoveDatabase';
import { getCombinedEffectiveness, PokemonType, TYPE_COLORS } from '../stadium/TypeMatrix';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumCamera } from '../engine/StadiumCamera';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { Creep } from './Creep';
import { centerMass, creepsOnBeam, HitContext, strikeCreeps } from './MoveDelivery';
import type { Tower } from './Tower';

/**
 * instant  fires around the tower the moment it's pressed
 * point    the player clicks a spot on the pitch
 * line     the player clicks a direction from the tower
 * auto     picks its own target
 */
export type SignatureTargeting = 'instant' | 'point' | 'line' | 'auto';

export interface SignatureDef {
  id: string;
  name: string;
  type: PokemonType;
  pp: number;
  targeting: SignatureTargeting;
  /** Radius of a point signature's blast, for the aiming preview. */
  radius?: number;
  description: string;
}

/** Anything a signature needs from the match to take effect. */
export interface SignatureContext {
  creeps: Creep[];
  towers: Tower[];
  hit: HitContext;
  particles: ParticleSystem;
  camera: StadiumCamera;
  announcer: StadiumAnnouncer;
  /** Whether a signature may cut to the action cam. */
  cinematicCuts: boolean;
  /** Runs `tick` every `interval` seconds of match time until `duration` is spent. */
  channel: (duration: number, interval: number, tick: () => void) => void;
}

export const SIGNATURES: Record<string, SignatureDef> = {
  spore_carpet: { id: 'spore_carpet', name: 'Spore Carpet', type: 'Grass', pp: 2, targeting: 'instant',
    description: 'Every grounded creep in range falls asleep for 4 s.' },
  solar_beam: { id: 'solar_beam', name: 'SolarBeam', type: 'Grass', pp: 1, targeting: 'line',
    description: 'A Heavy beam that runs the length of the pitch.' },
  growth: { id: 'growth', name: 'Growth', type: 'Grass', pp: 2, targeting: 'instant',
    description: 'Towers in range attack 50% faster for 8 s.' },
  fire_blast: { id: 'fire_blast', name: 'Fire Blast', type: 'Fire', pp: 1, targeting: 'point', radius: 7,
    description: 'A huge Heavy blast that burns everything it catches.' },
  blaze: { id: 'blaze', name: 'Blaze', type: 'Fire', pp: 1, targeting: 'instant',
    description: 'Every burning creep on the pitch takes its remaining burn at once.' },
  fly: { id: 'fly', name: 'Fly', type: 'Flying', pp: 2, targeting: 'auto',
    description: 'Dives on the creep with the most HP for a massive Heavy hit.' },
  hydro_pump: { id: 'hydro_pump', name: 'Hydro Pump', type: 'Water', pp: 1, targeting: 'line',
    description: 'A 3 s Heavy beam that pierces everything in its line.' },
  blizzard: { id: 'blizzard', name: 'Blizzard', type: 'Ice', pp: 1, targeting: 'instant',
    description: 'Freezes every creep in range solid for 3 s.' },
  surf: { id: 'surf', name: 'Surf', type: 'Water', pp: 2, targeting: 'instant',
    description: 'A wave washes grounded creeps back up the lane.' },
  thunder: { id: 'thunder', name: 'Thunder', type: 'Electric', pp: 2, targeting: 'point', radius: 5,
    description: 'A Heavy strike anywhere on the pitch that may paralyze.' },
  thunder_wave: { id: 'thunder_wave', name: 'Thunder Wave', type: 'Electric', pp: 1, targeting: 'instant',
    description: 'Paralyzes every creep in range for 4 s.' },
  agility: { id: 'agility', name: 'Agility', type: 'Psychic', pp: 2, targeting: 'instant',
    description: 'Triples the tower\'s attack rate for 5 s.' },
};

/** A signature's own hit, built on an existing move so it reads and resolves like one. */
function signatureMove(base: string, patch: Partial<MoveDefinition>): MoveDefinition {
  return { ...MOVES[base], ...patch };
}

const SOLAR_BEAM = signatureMove('solar_beam', { basePower: 220, heavy: true, range: 80, pierce: undefined, statusEffect: 'none' });
const FIRE_BLAST = signatureMove('fire_blast', { basePower: 200, heavy: true, splashRadius: 7, statusChance: 1, statusDuration: 5 });
const FLY = signatureMove('wing_attack', { name: 'Fly', basePower: 260, heavy: true });
const HYDRO_PUMP = signatureMove('hydro_pump', { basePower: 45, heavy: true, pierce: undefined, statusEffect: 'none' });
const BLIZZARD = signatureMove('blizzard', { basePower: 20, heavy: false, statusEffect: 'stun', statusChance: 1, statusDuration: 3 });
const SURF = signatureMove('surf', { basePower: 40, heavy: false, statusEffect: 'none' });
const THUNDER = signatureMove('thunder', { basePower: 180, heavy: true, splashRadius: 5, statusChance: 0.5, statusDuration: 3 });

/** How far a Surf wave pushes creeps back. */
const SURF_PUSH = 6;

const colorOf = (def: SignatureDef) => TYPE_COLORS[def.type]?.num ?? 0xffffff;

function creepsInReach(tower: Tower, creeps: Creep[], range: number, grounded = false): Creep[] {
  return creeps.filter(creep => creep.alive && !creep.captureLocked
    && !(grounded && creep.hasTrait('airborne'))
    && Math.hypot(creep.position.x - tower.position.x, creep.position.z - tower.position.z) <= tower.reachAgainst(range, creep));
}

function cut(ctx: SignatureContext, focus: THREE.Vector3): void {
  if (ctx.cinematicCuts) ctx.camera.triggerActionCam(focus, 0.9);
  else ctx.camera.shake(0.4);
}

/**
 * Casts a signature. `aim` is the clicked ground point for `point` and `line`
 * signatures. Returns false when the cast had nothing to act on, so no PP is
 * spent.
 */
export function castSignature(def: SignatureDef, tower: Tower, aim: THREE.Vector3 | null, ctx: SignatureContext): boolean {
  const color = colorOf(def);
  const range = tower.getMaxRange();
  const casterTop = tower.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const status = tower.modifiers.status;

  switch (def.id) {
    case 'spore_carpet': {
      ctx.particles.emitRing(tower.position, color, range, 0.9);
      for (const creep of creepsInReach(tower, ctx.creeps, range, true)) {
        creep.applyStatus('sleep', 4 * status, tower);
        ctx.particles.emitAura(centerMass(creep), color, 10, 1);
      }
      return true;
    }

    case 'growth': {
      ctx.particles.emitRing(tower.position, color, range, 0.9);
      for (const ally of ctx.towers) {
        if (Math.hypot(ally.position.x - tower.position.x, ally.position.z - tower.position.z) > range) continue;
        ally.boost(0.5, 8);
        ctx.particles.emitAura(ally.position.clone().add(new THREE.Vector3(0, 1.2, 0)), color, 14, 1.2);
      }
      return true;
    }

    case 'agility': {
      tower.boost(2, 5);
      ctx.particles.emitAura(casterTop, color, 24, 1.4);
      return true;
    }

    case 'solar_beam':
    case 'hydro_pump': {
      if (!aim) return false;
      const direction = new THREE.Vector3(aim.x - tower.position.x, 0, aim.z - tower.position.z);
      if (direction.lengthSq() < 1e-6) return false;
      direction.normalize();
      const move = def.id === 'solar_beam' ? SOLAR_BEAM : HYDRO_PUMP;
      const reach = def.id === 'solar_beam' ? SOLAR_BEAM.range : range * 1.6;
      const fire = () => {
        const victims = creepsOnBeam({ origin: tower.position, direction, reach }, ctx.creeps);
        const end = casterTop.clone().addScaledVector(direction, reach);
        ctx.particles.emitBeam(casterTop, end, color, def.id === 'solar_beam' ? 1.3 : 0.8, 0.35);
        strikeCreeps(move, victims, ctx.hit, tower);
      };
      if (def.id === 'solar_beam') {
        fire();
        cut(ctx, tower.position.clone().addScaledVector(direction, 10));
      } else {
        ctx.channel(3, 0.3, fire);
        ctx.camera.shake(0.3);
      }
      return true;
    }

    case 'fire_blast':
    case 'thunder': {
      if (!aim) return false;
      const move = def.id === 'fire_blast' ? FIRE_BLAST : THUNDER;
      const victims = ctx.creeps.filter(creep => creep.alive && !creep.captureLocked
        && Math.hypot(creep.position.x - aim.x, creep.position.z - aim.z) <= move.splashRadius);
      if (def.id === 'thunder') {
        ctx.particles.emitBeam(aim.clone().add(new THREE.Vector3(0, 18, 0)), aim, color, 0.9, 0.35);
      }
      ctx.particles.emitRing(aim, color, move.splashRadius, 0.7);
      ctx.particles.emitGroundBurst(aim.clone().add(new THREE.Vector3(0, 0.5, 0)), color, move.splashRadius * 0.8, 60);
      ctx.particles.emitImpact(aim.clone().add(new THREE.Vector3(0, 1, 0)), color, 50, 10);
      strikeCreeps(move, victims, ctx.hit, tower);
      cut(ctx, aim);
      return true;
    }

    case 'blaze': {
      const burning = ctx.creeps.filter(creep => creep.alive && creep.damageStatus?.effect === 'burn');
      if (!burning.length) return false;
      for (const creep of burning) {
        const burn = creep.damageStatus!;
        // What the burn would still have dealt, all at once: 4% max HP every half second.
        const remaining = creep.maxHp * 0.04 * Math.max(1, burn.timer / 0.5);
        creep.damageStatus = null;
        ctx.particles.emitImpact(centerMass(creep), color, 24, 8);
        if (creep.takeDamage(remaining, burn.source ?? tower, true)) ctx.hit.onFaint(creep);
      }
      ctx.camera.shake(0.45);
      return true;
    }

    case 'fly': {
      let prey: Creep | null = null;
      for (const creep of ctx.creeps) {
        if (!creep.alive || creep.captureLocked) continue;
        if (creep.hasTrait('phantom') && !tower.seesPhantoms) continue;
        if (!prey || creep.hp > prey.hp) prey = creep;
      }
      if (!prey) return false;
      ctx.particles.emitBeam(centerMass(prey).add(new THREE.Vector3(0, 14, 0)), centerMass(prey), color, 0.7, 0.3);
      ctx.particles.emitImpact(centerMass(prey), color, 40, 9);
      cut(ctx, prey.position);
      strikeCreeps(FLY, [prey], ctx.hit, tower);
      return true;
    }

    case 'blizzard': {
      ctx.particles.emitRing(tower.position, color, range, 0.9);
      ctx.particles.emitGroundBurst(tower.position.clone().add(new THREE.Vector3(0, 0.5, 0)), color, range * 0.7, 80);
      const victims = creepsInReach(tower, ctx.creeps, range);
      victims.forEach(creep => ctx.particles.emitAura(centerMass(creep), 0xe8f8ff, 10, 1));
      strikeCreeps(BLIZZARD, victims, ctx.hit, tower);
      return true;
    }

    case 'surf': {
      const reach = range * 1.5;
      ctx.particles.emitRing(tower.position, color, reach, 1.1);
      const victims = creepsInReach(tower, ctx.creeps, reach, true);
      strikeCreeps(SURF, victims, ctx.hit, tower);
      for (const creep of victims) if (!creep.isBoss) creep.pushBack(SURF_PUSH);
      ctx.camera.shake(0.35);
      return true;
    }

    case 'thunder_wave': {
      ctx.particles.emitRing(tower.position, color, range, 0.7);
      for (const creep of creepsInReach(tower, ctx.creeps, range)) {
        // Ground types shrug off electricity entirely, as they always have.
        if (getCombinedEffectiveness('Electric', creep.types) <= 0) continue;
        creep.applyStatus('paralyze', 4 * status, tower);
        ctx.particles.emitAura(centerMass(creep), color, 8, 0.9);
      }
      return true;
    }
  }
  return false;
}
