/**
 * Signatures.ts — Signature Moves the Player Calls
 *
 * Tier 3 of a path unlocks a signature move. The towers attack on their own;
 * a signature is the trainer stepping in: a button on the signature bar, a
 * handful of PP that refill every round, and a big effect for elites, Titans,
 * or saving a leak.
 *
 * Every signature is data: a name, PP, and one effect built from a small set
 * of kinds (strike a spot, sweep a line, hold everything in range, dive on the
 * toughest creep...). `castSignature` resolves the kinds; the table below
 * configures them per move.
 */

import * as THREE from 'three';
import { DamageStatus, MOVES, MoveDefinition, StatusEffectType } from '../stadium/MoveDatabase';
import { getCombinedEffectiveness, PokemonType, sporeStatusMultiplier, TYPE_COLORS } from '../stadium/TypeMatrix';
import { ParticleSystem } from '../engine/ParticleSystem';
import { StadiumCamera } from '../engine/StadiumCamera';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { Creep } from './Creep';
import type { HazardId } from './Hazard';
import { centerMass, creepsOnBeam, HitContext, strikeCreeps } from './MoveDelivery';
import type { Tower } from './Tower';

/**
 * instant  fires around the tower the moment it's pressed
 * point    the player clicks a spot on the pitch
 * line     the player clicks a direction from the tower
 * auto     picks its own target
 */
export type SignatureTargeting = 'instant' | 'point' | 'line' | 'auto';

/** A reach given as a multiple of the tower's own range, or the whole pitch. */
type Reach = number | 'map';

export type SignatureEffect =
  /** A blast at a clicked spot; `bombs` scatters several smaller ones around it. */
  | { kind: 'strikePoint'; move: MoveDefinition; radius: number; bombs?: number; fromSky?: boolean }
  /** A beam along a clicked direction; `duration` keeps it firing. */
  | { kind: 'strikeLine'; move: MoveDefinition; reach: Reach; duration?: number }
  /** Hits everything in reach of the tower; `disableSeconds` knocks the tower out after. */
  | { kind: 'strikeArea'; move: MoveDefinition; reach: Reach; disableSeconds?: number }
  /** A status on everything in reach. Creeps immune to `type` shrug it off. */
  | { kind: 'areaStatus'; status: StatusEffectType; duration: number; reach: Reach; grounded?: boolean; sporeScaled?: boolean }
  /** Shoves creeps back up the lane, with a hit. */
  | { kind: 'pushWave'; move: MoveDefinition; distance: number; reach: Reach; grounded?: boolean }
  | { kind: 'allyBoost'; bonus: number; duration: number }
  | { kind: 'selfBoost'; bonus: number; duration: number }
  /** Dives on the creep with the most HP the tower can see: a move, or a share of its HP. */
  | { kind: 'dive'; move: MoveDefinition; percent?: { share: number; bossShare: number } }
  /** Every creep carrying this damage-over-time takes what it has left, times `multiplier`, at once. */
  | { kind: 'cashDot'; effect: DamageStatus; multiplier: number }
  | { kind: 'dropHazard'; hazard: HazardId; radius: number }
  | { kind: 'gainMoney'; amount: number }
  /** Every tower can aim at Phantoms for a while. */
  | { kind: 'revealPhantoms'; duration: number };

export interface SignatureDef {
  id: string;
  name: string;
  type: PokemonType;
  pp: number;
  effect: SignatureEffect;
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
  addHazard: (hazard: HazardId, position: THREE.Vector3, tower: Tower) => void;
  addMoney: (amount: number) => void;
  revealPhantoms: (seconds: number) => void;
}

export function signatureTargeting(def: SignatureDef): SignatureTargeting {
  switch (def.effect.kind) {
    case 'strikePoint': case 'dropHazard': return 'point';
    case 'strikeLine': return 'line';
    case 'dive': return 'auto';
    default: return 'instant';
  }
}

/** Radius of a point signature's blast, for the aiming ring. */
export function signatureRadius(def: SignatureDef): number {
  const effect = def.effect;
  if (effect.kind === 'strikePoint') return effect.radius + (effect.bombs ? 2 : 0);
  if (effect.kind === 'dropHazard') return effect.radius;
  return 4;
}

/** How far a line signature reaches from this tower, for the aiming strip. */
export function signatureLineReach(def: SignatureDef, tower: Tower): number {
  return def.effect.kind === 'strikeLine' ? resolveReach(def.effect.reach, tower) : 0;
}

/** The length of the pitch, as far as a map-wide signature is concerned. */
const MAP_REACH = 90;

function resolveReach(reach: Reach, tower: Tower): number {
  return reach === 'map' ? MAP_REACH : tower.getMaxRange() * reach;
}

/** A signature's own hit, built on an existing move so it reads and resolves like one. */
function hit(base: string, patch: Partial<MoveDefinition>): MoveDefinition {
  return { ...MOVES[base], statusEffect: 'none', statusChance: 0, statusDuration: 0, ...patch };
}

function def(id: string, name: string, type: PokemonType, pp: number, description: string, effect: SignatureEffect): SignatureDef {
  return { id, name, type, pp, effect, description };
}

export const SIGNATURES: Record<string, SignatureDef> = Object.fromEntries([
  // ---- Bulbasaur ----------------------------------------------------------
  def('spore_carpet', 'Spore Carpet', 'Grass', 2, 'Every grounded enemy in range falls asleep for 4 s.',
    { kind: 'areaStatus', status: 'sleep', duration: 4, reach: 1, grounded: true, sporeScaled: true }),
  def('solar_beam', 'SolarBeam', 'Grass', 1, 'A Heavy beam that runs the length of the pitch.',
    { kind: 'strikeLine', move: hit('solar_beam', { basePower: 220, heavy: true }), reach: 'map' }),
  def('growth', 'Growth', 'Grass', 2, 'Towers in range attack 50% faster for 8 s.',
    { kind: 'allyBoost', bonus: 0.5, duration: 8 }),
  // ---- Charmander ---------------------------------------------------------
  def('fire_blast', 'Fire Blast', 'Fire', 1, 'A huge Heavy blast that burns everything it catches.',
    { kind: 'strikePoint', radius: 7, move: hit('fire_blast', { basePower: 200, heavy: true, statusEffect: 'burn', statusChance: 1, statusDuration: 5 }) }),
  def('blaze', 'Blaze', 'Fire', 1, 'Every burning enemy on the pitch takes its remaining burn at once.',
    { kind: 'cashDot', effect: 'burn', multiplier: 1 }),
  def('fly', 'Fly', 'Flying', 2, 'Dives on the enemy with the most HP for a massive Heavy hit.',
    { kind: 'dive', move: hit('wing_attack', { name: 'Fly', basePower: 260, heavy: true }) }),
  // ---- Squirtle -----------------------------------------------------------
  def('hydro_pump', 'Hydro Pump', 'Water', 1, 'A 3 s Heavy beam that pierces everything in its line.',
    { kind: 'strikeLine', move: hit('hydro_pump', { basePower: 45, heavy: true }), reach: 1.6, duration: 3 }),
  def('blizzard', 'Blizzard', 'Ice', 1, 'Freezes every enemy in range solid for 3 s.',
    { kind: 'strikeArea', reach: 1, move: hit('blizzard', { basePower: 20, heavy: false, statusEffect: 'stun', statusChance: 1, statusDuration: 3 }) }),
  def('surf', 'Surf', 'Water', 2, 'A wave washes grounded enemies back up the lane.',
    { kind: 'pushWave', move: hit('surf', { basePower: 40, heavy: false }), distance: 6, reach: 1.5, grounded: true }),
  // ---- Pikachu ------------------------------------------------------------
  def('thunder', 'Thunder', 'Electric', 2, 'A Heavy strike anywhere on the pitch that may paralyze.',
    { kind: 'strikePoint', radius: 5, fromSky: true, move: hit('thunder', { basePower: 180, heavy: true, statusEffect: 'paralyze', statusChance: 0.5, statusDuration: 3 }) }),
  def('thunder_wave', 'Thunder Wave', 'Electric', 1, 'Paralyzes every enemy in range for 4 s. Ground types shrug it off.',
    { kind: 'areaStatus', status: 'paralyze', duration: 4, reach: 1 }),
  def('agility', 'Agility', 'Psychic', 2, 'Triples the tower\'s attack rate for 5 s.',
    { kind: 'selfBoost', bonus: 2, duration: 5 }),
  // ---- Abra ---------------------------------------------------------------
  def('psychic_storm', 'Psychic', 'Psychic', 1, 'A Heavy psychic blow to every enemy on the pitch.',
    { kind: 'strikeArea', reach: 'map', move: hit('psychic', { basePower: 90, heavy: true, delivery: 'aura' }) }),
  def('mass_hypnosis', 'Hypnosis', 'Psychic', 1, 'Every enemy on the pitch falls asleep for 4 s.',
    { kind: 'areaStatus', status: 'sleep', duration: 4, reach: 'map' }),
  def('teleport_strike', 'Teleport', 'Psychic', 2, 'Blinks behind the enemy with the most HP for a Heavy strike.',
    { kind: 'dive', move: hit('psychic', { name: 'Teleport', basePower: 240, heavy: true }) }),
  // ---- Gastly -------------------------------------------------------------
  def('mass_confuse', 'Confuse Ray', 'Ghost', 1, 'Every enemy in wide range stumbles backwards for 4 s.',
    { kind: 'areaStatus', status: 'confuse', duration: 4, reach: 1.5 }),
  def('shadow_ball_sig', 'Shadow Ball', 'Ghost', 2, 'A Heavy sphere of shadow that bursts where you aim.',
    { kind: 'strikePoint', radius: 5, move: hit('shadow_ball', { basePower: 170, heavy: true }) }),
  def('nightmare', 'Nightmare', 'Ghost', 1, 'Every enemy in range falls asleep for 4 s.',
    { kind: 'areaStatus', status: 'sleep', duration: 4, reach: 1.2 }),
  // ---- Rattata ------------------------------------------------------------
  def('super_fang', 'Super Fang', 'Normal', 2, 'Bites half the HP off the toughest enemy in sight. Bosses lose 10%.',
    { kind: 'dive', move: hit('bite', { name: 'Super Fang', basePower: 20 }), percent: { share: 0.5, bossShare: 0.1 } }),
  def('scurry', 'Scurry', 'Normal', 2, 'Attacks 150% faster for 8 s.',
    { kind: 'selfBoost', bonus: 1.5, duration: 8 }),
  def('treasure_hunt', 'Treasure Hunt', 'Normal', 1, 'Digs up $120 of prize money.',
    { kind: 'gainMoney', amount: 120 }),
  // ---- Pidgey -------------------------------------------------------------
  def('foresight', 'Foresight', 'Normal', 2, 'Every tower can aim at Phantoms for 10 s.',
    { kind: 'revealPhantoms', duration: 10 }),
  def('whirlwind', 'Whirlwind', 'Flying', 1, 'Blows every enemy in wide range back up the lane — flyers too.',
    { kind: 'pushWave', move: hit('gust', { basePower: 30 }), distance: 8, reach: 1.5 }),
  def('sky_attack', 'Sky Attack', 'Flying', 2, 'Dives on the enemy with the most HP for a Heavy hit.',
    { kind: 'dive', move: hit('wing_attack', { name: 'Sky Attack', basePower: 220, heavy: true }) }),
  // ---- Zubat --------------------------------------------------------------
  def('swoop', 'Air Cutter', 'Flying', 2, 'Dives on the enemy with the most HP for a Heavy hit.',
    { kind: 'dive', move: hit('wing_attack', { name: 'Air Cutter', basePower: 200, heavy: true }) }),
  def('screech', 'Screech', 'Normal', 1, 'Every enemy in range stumbles backwards for 3 s.',
    { kind: 'areaStatus', status: 'confuse', duration: 3, reach: 1.4 }),
  def('toxic_wave', 'Toxic', 'Poison', 1, 'Badly poisons every enemy in range for 10 s.',
    { kind: 'areaStatus', status: 'poison', duration: 10, reach: 1.2 }),
  // ---- Paras --------------------------------------------------------------
  def('spore', 'Spore', 'Grass', 2, 'Drops a wide cloud of sleep spores where you aim.',
    { kind: 'dropHazard', hazard: 'spore_cloud', radius: 5 }),
  def('mega_drain', 'Mega Drain', 'Grass', 1, 'Drains a burst of HP and poisons everything where you aim.',
    { kind: 'strikePoint', radius: 4, move: hit('absorb', { name: 'Mega Drain', basePower: 150, statusEffect: 'poison', statusChance: 1, statusDuration: 8 }) }),
  def('x_scissor', 'X-Scissor', 'Bug', 2, 'Dives on the enemy with the most HP for a Heavy slash.',
    { kind: 'dive', move: hit('fury_cutter', { name: 'X-Scissor', basePower: 240, heavy: true }) }),
  // ---- Geodude ------------------------------------------------------------
  def('rock_slide', 'Rock Slide', 'Rock', 2, 'Boulders crash down where you aim, stunning what they hit.',
    { kind: 'strikePoint', radius: 6, move: hit('rock_throw', { basePower: 180, heavy: true, groundOnly: false, statusEffect: 'stun', statusChance: 0.6, statusDuration: 1.5 }) }),
  def('earthquake_ring', 'Earthquake', 'Ground', 1, 'A Heavy quake through every grounded enemy in wide range.',
    { kind: 'strikeArea', reach: 1.6, move: hit('earthquake', { basePower: 200, heavy: true, delivery: 'field' }) }),
  def('double_edge', 'Double-Edge', 'Normal', 2, 'Rolls into the enemy with the most HP for a massive Heavy hit.',
    { kind: 'dive', move: hit('body_slam', { name: 'Double-Edge', basePower: 260, heavy: true }) }),
  // ---- Machop -------------------------------------------------------------
  def('dynamic_punch', 'DynamicPunch', 'Fighting', 2, 'A crushing Heavy punch on the toughest enemy that leaves it confused.',
    { kind: 'dive', move: hit('karate_chop', { name: 'DynamicPunch', basePower: 300, statusEffect: 'confuse', statusChance: 1, statusDuration: 3 }) }),
  def('bulk_up', 'Bulk Up', 'Fighting', 2, 'Attacks 150% faster for 8 s.',
    { kind: 'selfBoost', bonus: 1.5, duration: 8 }),
  def('submission', 'Submission', 'Fighting', 1, 'Hurls every enemy in wide range back up the lane.',
    { kind: 'pushWave', move: hit('seismic_toss', { name: 'Submission', basePower: 60 }), distance: 5, reach: 1.5 }),
  // ---- Onix ---------------------------------------------------------------
  def('rock_wall', 'Rock Wall', 'Rock', 2, 'Raises a wall of stone on the lane that holds enemies for 6 s.',
    { kind: 'dropHazard', hazard: 'rock_wall', radius: 3.5 }),
  def('mass_bind', 'Bind', 'Normal', 1, 'Pins every enemy in range in place for 3 s.',
    { kind: 'areaStatus', status: 'stun', duration: 3, reach: 1.2 }),
  def('onix_quake', 'Earthquake', 'Ground', 1, 'A Heavy quake through every grounded enemy in range.',
    { kind: 'strikeArea', reach: 1.2, move: hit('earthquake', { basePower: 220, heavy: true, delivery: 'field' }) }),
  // ---- Rhyhorn ------------------------------------------------------------
  def('mortar_quake', 'Earthquake', 'Ground', 1, 'A Heavy quake centred wherever you aim.',
    { kind: 'strikePoint', radius: 7, move: hit('earthquake', { basePower: 240, heavy: true, groundOnly: true }) }),
  def('barrage', 'Rock Blast', 'Rock', 2, 'Five boulders rain down around where you aim.',
    { kind: 'strikePoint', radius: 3, bombs: 5, move: hit('rock_mortar', { basePower: 90 }) }),
  def('horn_drill', 'Horn Drill', 'Normal', 1, 'A one-hit knockout on the toughest enemy in sight. Bosses lose 12%.',
    { kind: 'dive', move: hit('body_slam', { name: 'Horn Drill', basePower: 0 }), percent: { share: 1, bossShare: 0.12 } }),
  // ---- Voltorb ------------------------------------------------------------
  def('self_destruct', 'Self-Destruct', 'Normal', 1, 'A colossal Heavy blast around the tower, which is out for 10 s after.',
    { kind: 'strikeArea', reach: 2, disableSeconds: 10, move: hit('hyper_beam', { name: 'Self-Destruct', basePower: 300, heavy: true }) }),
  def('volt_wave', 'Thunder Wave', 'Electric', 1, 'Paralyzes every enemy in wide range for 4 s. Ground types shrug it off.',
    { kind: 'areaStatus', status: 'paralyze', duration: 4, reach: 1.5 }),
  def('charge', 'Charge', 'Electric', 2, 'Triples the tower\'s attack rate for 6 s.',
    { kind: 'selfBoost', bonus: 2, duration: 6 }),
  // ---- Ponyta -------------------------------------------------------------
  def('flame_charge', 'Flame Charge', 'Fire', 2, 'A blazing charge down a line that burns everything it passes.',
    { kind: 'strikeLine', reach: 2, move: hit('flamethrower', { name: 'Flame Charge', basePower: 150, heavy: true, statusEffect: 'burn', statusChance: 1, statusDuration: 4 }) }),
  def('inferno', 'Inferno', 'Fire', 1, 'Sets every enemy in wide range ablaze.',
    { kind: 'strikeArea', reach: 1.5, move: hit('fire_spin', { name: 'Inferno', basePower: 120, delivery: 'aura', statusEffect: 'burn', statusChance: 1, statusDuration: 6 }) }),
  def('stomp', 'Stomp', 'Normal', 2, 'A stamp that throws grounded enemies in range back up the lane.',
    { kind: 'pushWave', move: hit('body_slam', { name: 'Stomp', basePower: 50 }), distance: 4, reach: 1.2, grounded: true }),
  // ---- Oddish -------------------------------------------------------------
  def('toxic_cloud', 'Toxic Cloud', 'Poison', 2, 'Drops a wide cloud of toxic spores where you aim.',
    { kind: 'dropHazard', hazard: 'toxic_cloud', radius: 5 }),
  def('venoshock', 'Venoshock', 'Poison', 1, 'Every poisoned enemy takes double its remaining poison at once.',
    { kind: 'cashDot', effect: 'poison', multiplier: 2 }),
  def('sleep_powder_sig', 'Sleep Powder', 'Grass', 1, 'Every grounded enemy in wide range falls asleep for 4 s.',
    { kind: 'areaStatus', status: 'sleep', duration: 4, reach: 1.4, grounded: true }),
  // ---- Psyduck ------------------------------------------------------------
  def('migraine', 'Migraine', 'Psychic', 1, 'A Heavy psychic burst through everything in wide range.',
    { kind: 'strikeArea', reach: 1.8, move: hit('psychic', { name: 'Migraine', basePower: 180, heavy: true, delivery: 'aura' }) }),
  def('mass_confusion', 'Confusion', 'Psychic', 1, 'Every enemy in wide range stumbles backwards for 4 s.',
    { kind: 'areaStatus', status: 'confuse', duration: 4, reach: 1.5 }),
  def('future_sight', 'Future Sight', 'Psychic', 2, 'A Heavy psychic blast wherever you aim.',
    { kind: 'strikePoint', radius: 4, fromSky: true, move: hit('psychic', { name: 'Future Sight', basePower: 200, heavy: true }) }),
  // ---- Dratini ------------------------------------------------------------
  def('draco_meteor', 'Draco Meteor', 'Dragon', 1, 'A meteor of draconic energy, Heavy and huge, wherever you aim.',
    { kind: 'strikePoint', radius: 6, fromSky: true, move: hit('dragon_rage', { name: 'Draco Meteor', basePower: 260, heavy: true, ignoresType: false }) }),
  def('glare', 'Glare', 'Normal', 1, 'Paralyzes every enemy in wide range for 5 s.',
    { kind: 'areaStatus', status: 'paralyze', duration: 5, reach: 1.4 }),
  def('dragon_beam', 'Hyper Beam', 'Normal', 1, 'A Heavy beam that runs the length of the pitch.',
    { kind: 'strikeLine', reach: 'map', move: hit('hyper_beam', { basePower: 260, heavy: true }) }),
  // ---- Lapras -------------------------------------------------------------
  def('sheer_cold', 'Sheer Cold', 'Ice', 1, 'Freezes every enemy in wide range solid for 4 s.',
    { kind: 'areaStatus', status: 'stun', duration: 4, reach: 1.5 }),
  def('lullaby', 'Sing', 'Normal', 1, 'Every enemy in wide range falls asleep for 5 s.',
    { kind: 'areaStatus', status: 'sleep', duration: 5, reach: 1.5 }),
  def('ice_beam_sig', 'Ice Beam', 'Ice', 1, 'A Heavy freezing beam the length of the pitch.',
    { kind: 'strikeLine', reach: 'map', move: hit('ice_beam', { basePower: 200, heavy: true, statusEffect: 'freeze', statusChance: 1, statusDuration: 4 }) }),
  // ---- Exeggcute ----------------------------------------------------------
  def('egg_barrage', 'Egg Barrage', 'Normal', 2, 'Six eggs rain down around where you aim.',
    { kind: 'strikePoint', radius: 2.5, bombs: 6, move: hit('egg_bomb', { basePower: 80 }) }),
  def('psychic_all', 'Psychic', 'Psychic', 1, 'A psychic blow to every enemy on the pitch.',
    { kind: 'strikeArea', reach: 'map', move: hit('psychic', { basePower: 80, delivery: 'aura' }) }),
  def('stun_grove', 'Stun Spore', 'Grass', 1, 'Paralyzes every enemy in wide range for 4 s.',
    { kind: 'areaStatus', status: 'paralyze', duration: 4, reach: 1.5 }),
  // ---- Scyther ------------------------------------------------------------
  def('x_scissor_scyther', 'X-Scissor', 'Bug', 2, 'Dives on the enemy with the most HP for a massive Heavy slash.',
    { kind: 'dive', move: hit('fury_cutter', { name: 'X-Scissor', basePower: 280, heavy: true }) }),
  def('swords_dance', 'Swords Dance', 'Normal', 2, 'Triples the tower\'s attack rate for 6 s.',
    { kind: 'selfBoost', bonus: 2, duration: 6 }),
  def('razor_wind', 'Razor Wind', 'Normal', 1, 'A Heavy blade of wind down a long line.',
    { kind: 'strikeLine', reach: 2.5, move: hit('razor_leaf', { name: 'Razor Wind', type: 'Normal', basePower: 160, heavy: true }) }),
  // ---- Magikarp -----------------------------------------------------------
  def('gyarados_beam', 'Hyper Beam', 'Normal', 1, 'A Heavy beam that runs the length of the pitch.',
    { kind: 'strikeLine', reach: 'map', move: hit('hyper_beam', { basePower: 300, heavy: true }) }),
  def('tidal_wave', 'Surf', 'Water', 2, 'A tidal wave that washes grounded enemies far back up the lane.',
    { kind: 'pushWave', move: hit('surf', { basePower: 80 }), distance: 8, reach: 1.6, grounded: true }),
  def('roar', 'Roar', 'Normal', 1, 'Every enemy in wide range freezes in fear for 3 s.',
    { kind: 'areaStatus', status: 'stun', duration: 3, reach: 1.5 }),
].map(signature => [signature.id, signature]));

const colorOf = (signature: SignatureDef) => TYPE_COLORS[signature.type]?.num ?? 0xffffff;

function inReach(tower: Tower, creep: Creep, reach: Reach): boolean {
  if (reach === 'map') return true;
  const range = tower.getMaxRange() * reach;
  return Math.hypot(creep.position.x - tower.position.x, creep.position.z - tower.position.z) <= tower.reachAgainst(range, creep);
}

function targetable(creep: Creep, grounded = false): boolean {
  return creep.alive && !creep.captureLocked && !(grounded && creep.hasTrait('airborne'));
}

/**
 * The universal "this is a signature move" payoff (round 2 feedback
 * #28/33): every combat-effect signature gets this same baseline —
 * camera punch, a bright flash burst on top of the move's own particles,
 * and a shared stinger sound — before any hand-authored per-move
 * treatment (none exist yet) would layer on top of it.
 */
function cut(ctx: SignatureContext, focus: THREE.Vector3, color: number): void {
  if (ctx.cinematicCuts) ctx.camera.triggerActionCam(focus, 0.9);
  else ctx.camera.shake(0.4);
  ctx.camera.punchZoom(7);
  ctx.particles.emitSignatureFlash(focus, color);
  ctx.hit.audio.playSignatureCast();
}

const up = (height: number) => new THREE.Vector3(0, height, 0);

/**
 * Casts a signature. `aim` is the clicked ground point for `point` and `line`
 * signatures. Returns false when the cast had nothing to act on, so no PP is
 * spent.
 */
export function castSignature(signature: SignatureDef, tower: Tower, aim: THREE.Vector3 | null, ctx: SignatureContext): boolean {
  const color = colorOf(signature);
  const effect = signature.effect;
  const statusScale = tower.modifiers.status;
  const ringRadius = (reach: Reach) => Math.min(resolveReach(reach, tower), 40);

  switch (effect.kind) {
    case 'strikePoint': {
      if (!aim) return false;
      const centres = effect.bombs
        ? Array.from({ length: effect.bombs }, (_, i) => {
            const angle = (i / effect.bombs!) * Math.PI * 2 + Math.random() * 0.6;
            const distance = 1 + Math.random() * 3;
            return aim.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
          })
        : [aim.clone()];
      const land = (centre: THREE.Vector3) => {
        const victims = ctx.creeps.filter(creep => targetable(creep, !!effect.move.groundOnly)
          && Math.hypot(creep.position.x - centre.x, creep.position.z - centre.z) <= effect.radius);
        if (effect.fromSky) ctx.particles.emitBeam(centre.clone().add(up(18)), centre, color, 0.9, 0.35);
        ctx.particles.emitRing(centre, color, effect.radius, 0.7);
        ctx.particles.emitGroundBurst(centre.clone().add(up(0.5)), color, effect.radius * 0.8, 50);
        ctx.particles.emitImpact(centre.clone().add(up(1)), color, 40, 10);
        strikeCreeps(effect.move, victims, ctx.hit, tower, { signature: true });
      };
      if (effect.bombs) {
        let next = 0;
        ctx.channel(effect.bombs * 0.15, 0.15, () => land(centres[next++ % centres.length]));
      } else {
        land(centres[0]);
      }
      cut(ctx, aim, color);
      return true;
    }

    case 'strikeLine': {
      if (!aim) return false;
      const direction = new THREE.Vector3(aim.x - tower.position.x, 0, aim.z - tower.position.z);
      if (direction.lengthSq() < 1e-6) return false;
      direction.normalize();
      const reach = resolveReach(effect.reach, tower);
      const casterTop = tower.position.clone().add(up(1.5));
      const fire = () => {
        const victims = creepsOnBeam({ origin: tower.position, direction, reach }, ctx.creeps);
        ctx.particles.emitBeam(casterTop, casterTop.clone().addScaledVector(direction, reach), color, effect.duration ? 0.8 : 1.3, 0.35);
        strikeCreeps(effect.move, victims, ctx.hit, tower, { signature: true });
      };
      if (effect.duration) {
        ctx.channel(effect.duration, 0.3, fire);
        ctx.camera.shake(0.3);
      } else {
        fire();
        cut(ctx, tower.position.clone().addScaledVector(direction, 10), color);
      }
      return true;
    }

    case 'strikeArea': {
      const grounded = effect.move.delivery === 'field' || !!effect.move.groundOnly;
      const victims = ctx.creeps.filter(creep => targetable(creep, grounded) && inReach(tower, creep, effect.reach));
      ctx.particles.emitRing(tower.position, color, ringRadius(effect.reach), 0.9);
      ctx.particles.emitGroundBurst(tower.position.clone().add(up(0.5)), color, ringRadius(effect.reach) * 0.6, 80);
      victims.forEach(creep => ctx.particles.emitImpact(centerMass(creep), color, 10, 6));
      strikeCreeps(effect.move, victims, ctx.hit, tower, { signature: true });
      if (effect.disableSeconds) tower.disable(effect.disableSeconds);
      cut(ctx, tower.position, color);
      return true;
    }

    case 'areaStatus': {
      ctx.particles.emitRing(tower.position, color, ringRadius(effect.reach), 0.9);
      for (const creep of ctx.creeps) {
        if (!targetable(creep, effect.grounded) || !inReach(tower, creep, effect.reach)) continue;
        // A type immune to the signature's element shrugs off its status too.
        if (getCombinedEffectiveness(signature.type, creep.types) <= 0) continue;
        const sporeMult = effect.sporeScaled ? sporeStatusMultiplier(creep.types) : 1;
        if (sporeMult <= 0) continue;
        creep.applyStatus(effect.status, effect.duration * statusScale * sporeMult, tower);
        ctx.particles.emitAura(centerMass(creep), color, 10, 1);
      }
      cut(ctx, tower.position, color);
      return true;
    }

    case 'pushWave': {
      const victims = ctx.creeps.filter(creep => targetable(creep, effect.grounded) && inReach(tower, creep, effect.reach));
      ctx.particles.emitRing(tower.position, color, ringRadius(effect.reach), 1.1);
      strikeCreeps(effect.move, victims, ctx.hit, tower, { signature: true });
      for (const creep of victims) if (!creep.isBoss) creep.pushBack(effect.distance);
      cut(ctx, tower.position, color);
      return true;
    }

    case 'allyBoost': {
      const range = tower.getMaxRange();
      ctx.particles.emitRing(tower.position, color, range, 0.9);
      for (const ally of ctx.towers) {
        if (Math.hypot(ally.position.x - tower.position.x, ally.position.z - tower.position.z) > range) continue;
        ally.boost(effect.bonus, effect.duration);
        ctx.particles.emitAura(ally.position.clone().add(up(1.2)), color, 14, 1.2);
      }
      return true;
    }

    case 'selfBoost': {
      tower.boost(effect.bonus, effect.duration);
      ctx.particles.emitAura(tower.position.clone().add(up(1.5)), color, 24, 1.4);
      return true;
    }

    case 'dive': {
      let prey: Creep | null = null;
      for (const creep of ctx.creeps) {
        if (!targetable(creep, !!effect.move.groundOnly)) continue;
        if (creep.hasTrait('phantom') && !tower.seesPhantoms) continue;
        if (!prey || creep.hp > prey.hp) prey = creep;
      }
      if (!prey) return false;
      ctx.particles.emitBeam(centerMass(prey).add(up(14)), centerMass(prey), color, 0.7, 0.3);
      ctx.particles.emitImpact(centerMass(prey), color, 40, 9);
      cut(ctx, prey.position, color);
      strikeCreeps(effect.move, [prey], ctx.hit, tower, { percentDamage: effect.percent ?? null, signature: true });
      return true;
    }

    case 'cashDot': {
      const afflicted = ctx.creeps.filter(creep => creep.alive && creep.damageStatus?.effect === effect.effect);
      if (!afflicted.length) return false;
      // What the status would still have dealt, all at once: its share of max HP every half second.
      const tickShare = effect.effect === 'burn' ? 0.04 : 0.018;
      for (const creep of afflicted) {
        const dot = creep.damageStatus!;
        const remaining = creep.maxHp * tickShare * Math.max(1, dot.timer / 0.5) * effect.multiplier;
        creep.damageStatus = null;
        ctx.particles.emitImpact(centerMass(creep), color, 24, 8);
        if (creep.takeDamage(remaining, dot.source ?? tower, true)) ctx.hit.onFaint(creep);
      }
      cut(ctx, tower.position, color);
      return true;
    }

    case 'dropHazard': {
      if (!aim) return false;
      ctx.addHazard(effect.hazard, aim, tower);
      ctx.particles.emitRing(aim, color, effect.radius, 0.8);
      ctx.camera.shake(0.3);
      return true;
    }

    case 'gainMoney': {
      ctx.addMoney(effect.amount);
      ctx.particles.emitImpact(tower.position.clone().add(up(1.5)), 0xffd700, 40, 7);
      return true;
    }

    case 'revealPhantoms': {
      ctx.revealPhantoms(effect.duration);
      ctx.particles.emitRing(tower.position, color, 30, 1.2);
      return true;
    }
  }
}
