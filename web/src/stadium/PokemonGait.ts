/**
 * PokemonGait.ts — procedural locomotion layered over authored idle clips.
 *
 * Stadium's battle animations never walk, so a moving Pokémon would otherwise
 * glide along playing its idle loop. This moves the model's root with a gait
 * chosen by body plan. The stride advances with distance travelled, not time,
 * so slowed, frozen, or stunned Pokémon visibly slow down or stop.
 */

import * as THREE from 'three';

export type BodyPlan = 'biped' | 'quadruped' | 'serpent' | 'hopper' | 'floater';

const PLAN_SPECIES: Record<BodyPlan, string[]> = {
  biped: [
    'Charmander', 'Charmeleon', 'Charizard', 'Squirtle', 'Wartortle', 'Blastoise', 'Pikachu', 'Raichu',
    'Sandshrew', 'Sandslash', 'Nidoqueen', 'Nidoking', 'Clefairy', 'Clefable', 'Gloom', 'Vileplume',
    'Venonat', 'Meowth', 'Psyduck', 'Golduck', 'Mankey', 'Primeape', 'Poliwhirl', 'Poliwrath', 'Kadabra',
    'Alakazam', 'Machop', 'Machoke', 'Machamp', 'Bellsprout', 'Graveler', 'Golem', 'Slowbro', 'Farfetchd',
    'Doduo', 'Dodrio', 'Gengar', 'Drowzee', 'Hypno', 'Exeggutor', 'Cubone', 'Marowak', 'Hitmonlee',
    'Hitmonchan', 'Lickitung', 'Rhydon', 'Chansey', 'Tangela', 'Kangaskhan', 'MrMime', 'Scyther', 'Jynx',
    'Electabuzz', 'Magmar', 'Pinsir', 'Kabutops', 'Snorlax', 'Dragonite', 'Mewtwo',
  ],
  quadruped: [
    'Bulbasaur', 'Ivysaur', 'Venusaur', 'Rattata', 'Raticate', 'NidoranF', 'Nidorina', 'NidoranM', 'Nidorino',
    'Vulpix', 'Ninetales', 'Paras', 'Parasect', 'Persian', 'Growlithe', 'Arcanine', 'Ponyta', 'Rapidash',
    'Slowpoke', 'Krabby', 'Kingler', 'Rhyhorn', 'Tauros', 'Eevee', 'Vaporeon', 'Jolteon', 'Flareon', 'Kabuto',
  ],
  serpent: [
    'Caterpie', 'Weedle', 'Ekans', 'Arbok', 'Grimer', 'Muk', 'Onix', 'Gyarados', 'Dratini', 'Dragonair',
  ],
  hopper: [
    'Metapod', 'Kakuna', 'Jigglypuff', 'Wigglytuff', 'Oddish', 'Poliwag', 'Weepinbell', 'Victreebel', 'Seel',
    'Dewgong', 'Shellder', 'Cloyster', 'Voltorb', 'Electrode', 'Exeggcute', 'Magikarp', 'Ditto', 'Omanyte',
    'Omastar',
  ],
  floater: [
    'Butterfree', 'Beedrill', 'Pidgey', 'Pidgeotto', 'Pidgeot', 'Spearow', 'Fearow', 'Zubat', 'Golbat',
    'Venomoth', 'Diglett', 'Dugtrio', 'Abra', 'Tentacool', 'Tentacruel', 'Geodude', 'Magnemite', 'Magneton',
    'Gastly', 'Haunter', 'Koffing', 'Weezing', 'Horsea', 'Seadra', 'Goldeen', 'Seaking', 'Staryu', 'Starmie',
    'Lapras', 'Porygon', 'Aerodactyl', 'Articuno', 'Zapdos', 'Moltres', 'Mew',
  ],
};

const BODY_PLANS = new Map<string, BodyPlan>();
for (const [plan, species] of Object.entries(PLAN_SPECIES) as [BodyPlan, string[]][]) {
  for (const name of species) BODY_PLANS.set(name.toLowerCase(), plan);
}

export function bodyPlanFor(species: string): BodyPlan {
  return BODY_PLANS.get(species.toLowerCase()) ?? 'biped';
}

/**
 * Ground covered by one full gait cycle: this many body heights, but never
 * less than `min` world units, so small fast creeps don't jitter.
 */
const STRIDES: Record<BodyPlan, { heights: number; min: number }> = {
  biped: { heights: 0.9, min: 2.2 },
  quadruped: { heights: 0.75, min: 2.0 },
  serpent: { heights: 1.6, min: 3.0 },
  hopper: { heights: 0.7, min: 2.4 },
  floater: { heights: 2.2, min: 4.0 },
};

/** How quickly the gait fades in when moving and out when stopped, per second. */
const BLEND_RATE = 8;
/** Used until the loaded model reports its real height. */
const DEFAULT_HEIGHT = 1.5;

export class PokemonGait {
  public plan: BodyPlan;
  public height = DEFAULT_HEIGHT;
  private phase = Math.random() * Math.PI * 2;
  private weight = 0;

  constructor(species: string) {
    this.plan = bodyPlanFor(species);
  }

  /** Advances the stride by `distance` and poses `target` for this frame. */
  public update(target: THREE.Object3D, distance: number, dt: number): void {
    const moving = distance > 1e-5 ? 1 : 0;
    this.weight += (moving - this.weight) * Math.min(1, dt * BLEND_RATE);
    const stride = STRIDES[this.plan];
    const strideLength = Math.max(stride.min, stride.heights * this.height);
    this.phase = (this.phase + (distance / strideLength) * Math.PI * 2) % (Math.PI * 2);

    const w = this.weight;
    const h = this.height;
    const p = this.phase;
    target.position.set(0, 0, 0);
    target.rotation.set(0, 0, 0);
    target.scale.set(1, 1, 1);
    if (w < 1e-3) return;

    switch (this.plan) {
      case 'biped': {
        // Two steps per cycle: rise over each planted foot, rock onto it.
        target.position.y = Math.abs(Math.sin(p)) * 0.07 * h * w;
        target.rotation.z = Math.sin(p) * 0.1 * w;
        target.rotation.x = 0.05 * w;
        break;
      }
      case 'quadruped': {
        // Trot: two bounces per cycle with the body rocking nose to tail.
        target.position.y = (0.5 - 0.5 * Math.cos(p * 2)) * 0.08 * h * w;
        target.rotation.x = Math.sin(p) * 0.09 * w;
        target.rotation.z = Math.sin(p * 2) * 0.02 * w;
        break;
      }
      case 'serpent': {
        // Slither: side-to-side undulation with the head leading the curve.
        target.position.x = Math.sin(p) * 0.12 * h * w;
        target.rotation.y = Math.cos(p) * 0.3 * w;
        target.rotation.z = Math.sin(p) * 0.05 * w;
        break;
      }
      case 'hopper': {
        // Two hops per cycle, squashing on each landing.
        const air = Math.abs(Math.sin(p));
        const landing = Math.pow(1 - air, 6) * w;
        target.position.y = air * 0.2 * h * w;
        target.scale.set(1 + landing * 0.08, 1 - landing * 0.14, 1 + landing * 0.08);
        break;
      }
      case 'floater': {
        // Drift: a gentle rise and fall, banking into the sway.
        target.position.y = (0.5 - 0.5 * Math.cos(p)) * 0.1 * h * w;
        target.rotation.z = Math.sin(p) * 0.06 * w;
        target.rotation.x = 0.06 * w;
        break;
      }
    }
  }
}
