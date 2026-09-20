/**
 * EnergyForm.ts — Turns a model into the light it is made of.
 *
 * A Poké Ball does not shrink a Pokémon, it converts it: the body becomes
 * energy, the energy travels, and the energy becomes a body again at the other
 * end. That conversion is this module — every mesh under a root swaps to an
 * unlit stand-in that burns from the body's own colours to the ball's, and
 * swaps back when released.
 *
 * It replaces each mesh's material *reference* rather than editing the
 * material, because extracted GLB models share one material set across every
 * clone of that species (see `CinemaDim`, which learned the same lesson the
 * hard way). Editing in place would light up every Pidgey on the pitch;
 * swapping the reference touches only this one.
 *
 * The swap itself is never watched directly — it happens under the white
 * flash of the shell cracking open, the same trick `EvolutionSequence` uses
 * to hide its model swap.
 */
import * as THREE from 'three';

/** Meshes wearing an energy material, so cinema dimming leaves them alone. */
export const ENERGY_FORM_FLAG = '__energyForm';

interface Swapped {
  object: THREE.Object3D & { material: THREE.Material | THREE.Material[] };
  original: THREE.Material | THREE.Material[];
  energy: THREE.MeshBasicMaterial[];
  /** Each stand-in's starting colour, so `set` stays a function of charge
   *  rather than of how many frames have gone by. */
  base: THREE.Color[];
}

export class EnergyForm {
  private swapped: Swapped[] = [];
  private readonly tint: THREE.Color;
  private released = false;

  /**
   * Engages immediately: build one and the model is already light. Sprites are
   * left alone — a health bar is not made of the Pokémon.
   */
  constructor(root: THREE.Object3D, color: number) {
    this.tint = new THREE.Color(color);
    root.traverse(object => {
      const holder = object as Swapped['object'];
      if (!holder.material || object instanceof THREE.Sprite) return;

      const originals = Array.isArray(holder.material) ? holder.material : [holder.material];
      const energy = originals.map(source => {
        const from = source as THREE.Material & { color?: THREE.Color; side?: THREE.Side };
        return new THREE.MeshBasicMaterial({
          // Start from the body's own colour so the first frame of light still
          // reads as this Pokémon, then burn toward the ball's tint.
          color: from.color ? from.color.clone() : new THREE.Color(0xffffff),
          transparent: true,
          opacity: 1,
          side: from.side ?? THREE.FrontSide,
          // Flat and opaque rather than additive: a model is dozens of
          // overlapping surfaces, and additively they stack into a shapeless
          // white blob that loses the one thing worth keeping — the silhouette.
          // The Pokémon has to still be recognisably itself while it is light.
          depthWrite: true,
        });
      });

      object.userData[ENERGY_FORM_FLAG] = true;
      this.swapped.push({
        object: holder,
        original: holder.material,
        energy,
        base: energy.map(material => material.color.clone()),
      });
      holder.material = Array.isArray(holder.material) ? energy : energy[0];
    });
  }

  /**
   * `charge` 0..1 burns the body's own colours away into the ball's tint;
   * `opacity` is how present the light still is, which the slurp fades as the
   * form is drawn down the beam.
   */
  public set(charge: number, opacity: number = 1): void {
    if (this.released) return;
    const amount = THREE.MathUtils.clamp(charge, 0, 1);
    const alpha = THREE.MathUtils.clamp(opacity, 0, 1);
    for (const entry of this.swapped) {
      entry.energy.forEach((material, index) => {
        // Not a snap to the tint: the body is visibly *becoming* light across
        // the beat, and at full charge nothing of its own colouring is left.
        material.color.copy(entry.base[index]).lerp(this.tint, amount);
        material.opacity = alpha;
      });
    }
  }

  /** Hands every mesh its real material back. Safe to call twice. */
  public release(): void {
    if (this.released) return;
    this.released = true;
    for (const entry of this.swapped) {
      entry.object.material = entry.original;
      delete entry.object.userData[ENERGY_FORM_FLAG];
      entry.energy.forEach(material => material.dispose());
    }
    this.swapped = [];
  }
}
