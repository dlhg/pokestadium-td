/**
 * CinemaDim.ts — Pushes everything that is not the subject of a set piece
 * into the dark.
 *
 * Rather than fading models out (which leaves them blended and floating) or
 * hiding them (which makes them teleport when they return), this darkens their
 * materials toward the shadow colour. Bystanders stay exactly where they are
 * and still read as silhouettes, so the arena keeps its shape while attention
 * stays on the one thing the camera is on. HP sprites do fade, because a
 * readable health bar on a bystander is exactly the distraction we are killing.
 */
import * as THREE from 'three';
import { ENERGY_FORM_FLAG } from './EnergyForm';

const SHADOW = new THREE.Color(0x05070d);
const BASE_COLOR = '__cinemaBaseColor';
const BASE_EMISSIVE = '__cinemaBaseEmissive';
const BASE_OPACITY = '__cinemaBaseOpacity';

type DimmableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  opacity: number;
};

const OWN_MATERIAL = '__cinemaOwnMaterial';
const BASE_TRANSPARENT = '__cinemaBaseTransparent';
const BASE_DEPTH_WRITE = '__cinemaBaseDepthWrite';

/**
 * `dim` darkens toward shadow (0 restores). `fade` additionally ghosts the
 * object out, for bystanders standing between the camera and the subject:
 * darkness removes the distraction, but only transparency clears the shot.
 */
export function setCinemaDim(root: THREE.Object3D, dim: number, fade: number = 0): void {
  const amount = THREE.MathUtils.clamp(dim, 0, 1);
  const ghost = THREE.MathUtils.clamp(fade, 0, 1);
  root.traverse(object => {
    const holder = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    if (!holder.material) return;
    // A model mid-conversion into energy is wearing a borrowed material that
    // its own set piece animates every frame. Dimming would fight it for the
    // colour, and the restore below would stamp the glow on as its base.
    if (object.userData[ENERGY_FORM_FLAG]) return;
    // Skinned GLB clones share materials across every model of a species, so
    // darkening one bystander in place would darken the capture target too.
    // Give each object its own copy the first time it is dimmed.
    if (amount > 0 && !object.userData[OWN_MATERIAL]) {
      holder.material = Array.isArray(holder.material)
        ? holder.material.map(material => material.clone())
        : holder.material.clone();
      object.userData[OWN_MATERIAL] = true;
    }
    // Never stamp base values onto a shared material: a later clone copies
    // userData through JSON, turning the saved Color into a bare hex number
    // that `Color.copy` reads as NaN, leaving that model permanently black.
    // An object that was never dimmed has nothing to restore anyway.
    if (!object.userData[OWN_MATERIAL]) return;
    const materials = Array.isArray(holder.material) ? holder.material : [holder.material];
    const isSprite = object instanceof THREE.Sprite;
    materials.forEach(material => {
      applyDim(material as DimmableMaterial, amount, isSprite);
      if (!isSprite && object.userData[OWN_MATERIAL]) applyFade(material as DimmableMaterial, ghost);
    });
  });
}

function applyFade(material: DimmableMaterial, ghost: number): void {
  if (material.userData[BASE_TRANSPARENT] === undefined) {
    material.userData[BASE_TRANSPARENT] = material.transparent;
    material.userData[BASE_DEPTH_WRITE] = material.depthWrite;
    material.userData[BASE_OPACITY] = material.opacity;
  }
  const wantTransparent = ghost > 0.01 || material.userData[BASE_TRANSPARENT];
  // Toggling transparency recompiles the shader, so only touch it on a change.
  if (material.transparent !== wantTransparent) {
    material.transparent = wantTransparent;
    material.needsUpdate = true;
  }
  material.depthWrite = ghost > 0.01 ? false : material.userData[BASE_DEPTH_WRITE];
  material.opacity = material.userData[BASE_OPACITY] * (1 - ghost * 0.88);
}

function applyDim(material: DimmableMaterial, amount: number, isSprite: boolean): void {
  if (isSprite) {
    // Sprites are already transparent, so fading costs no shader recompile.
    if (material.userData[BASE_OPACITY] === undefined) material.userData[BASE_OPACITY] = material.opacity;
    material.opacity = material.userData[BASE_OPACITY] * (1 - amount);
    return;
  }

  if (material.color) {
    if (!material.userData[BASE_COLOR]) material.userData[BASE_COLOR] = material.color.clone();
    material.color.copy(material.userData[BASE_COLOR]).lerp(SHADOW, amount * 0.9);
  }
  if (material.emissive) {
    if (!material.userData[BASE_EMISSIVE]) material.userData[BASE_EMISSIVE] = material.emissive.clone();
    material.emissive.copy(material.userData[BASE_EMISSIVE]).multiplyScalar(1 - amount);
  }
}
