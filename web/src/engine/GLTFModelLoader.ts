/** Loads locally extracted Pokemon Stadium models and their authored clips. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimatedPokemon, PokemonAnimationState } from '../stadium/PokemonModels';
import { worldScaleFor } from '../stadium/PokemonScale';

interface ManifestAnimation {
  index: number;
  name: string;
  contexts?: string[];
  moves?: string[];
}

interface ManifestPokemon {
  species: number;
  name: string;
  glb: string;
  /** Idle footprint (twice the farthest horizontal reach) and height, in native units. */
  size?: { footprint: number; height: number };
  animations: ManifestAnimation[];
}

interface StadiumManifest {
  romMd5: string;
  pokemon: ManifestPokemon[];
}

export class GLTFModelLoader {
  private static readonly baseUrl = '/generated/stadium/';
  private static loader = new GLTFLoader();
  private static manifestPromise: Promise<StadiumManifest | null> | null = null;
  private static cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

  private static loadManifest(): Promise<StadiumManifest | null> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.baseUrl}manifest.json`)
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null);
    }
    return this.manifestPromise;
  }

  private static rolesFor(animation: ManifestAnimation): PokemonAnimationState[] {
    const contexts = new Set(animation.contexts || []);
    const roles: PokemonAnimationState[] = [];
    if (contexts.has('idle')) roles.push('idle');
    if (contexts.has('attack_default')) roles.push('attack');
    if (contexts.has('flinch') || contexts.has('reaction_179')) roles.push('hit');
    if (contexts.has('faint')) roles.push('faint');
    if (contexts.has('entrance')) roles.push('entrance');
    return roles;
  }

  private static moveKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Loads a species at the shared world scale (see PokemonScale), so sizes stay
   * relative to each other. Pass `fitHeight` to stretch it to a fixed height
   * instead, for close-up displays that frame one Pokémon on its own.
   */
  public static async loadPokemonModel(name: string, fitHeight?: number): Promise<AnimatedPokemon | null> {
    const manifest = await this.loadManifest();
    const entry = manifest?.pokemon.find((pokemon) => pokemon.name.toLowerCase() === name.toLowerCase());
    if (!entry) return null;
    const url = `${this.baseUrl}${entry.glb}`;

    try {
      let pending = this.cache.get(url);
      if (!pending) {
        pending = this.loader.loadAsync(url).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
        this.cache.set(url, pending);
      }
      const cached = await pending;
      const clonedScene = cloneSkeleton(cached.scene) as THREE.Group;
      clonedScene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const textured = material as THREE.MeshStandardMaterial;
          if (textured.map) {
            textured.map.magFilter = THREE.NearestFilter;
            textured.map.minFilter = THREE.NearestFilter;
            textured.map.generateMipmaps = false;
            textured.map.needsUpdate = true;
          }
        }
      });

      let bounds = new THREE.Box3().setFromObject(clonedScene);
      const boundsHeight = Math.max(bounds.getSize(new THREE.Vector3()).y, 0.001);
      let scale: number;
      let height: number;
      if (fitHeight === undefined && entry.size) {
        scale = worldScaleFor(entry.size.footprint, entry.size.height, entry.species);
        height = entry.size.height * scale;
      } else {
        if (fitHeight === undefined) {
          console.warn('[GLTFModelLoader] manifest.json has no model sizes; re-run web/tools/stadium_pipeline/build.py');
        }
        height = fitHeight ?? 2.2;
        scale = height / boundsHeight;
      }
      clonedScene.scale.multiplyScalar(scale);
      bounds = new THREE.Box3().setFromObject(clonedScene);
      // Stadium authors levitating species (Geodude, Magnemite, Zubat) with the
      // body a full height or more above the origin. Keep that hover, capped at
      // one body height, instead of sitting them on the ground; close-ups stay grounded.
      const authoredHover = bounds.min.y > boundsHeight * scale;
      const hover = fitHeight === undefined && authoredHover ? Math.min(bounds.min.y, height) : 0;
      clonedScene.position.y -= bounds.min.y - hover;
      height += hover;

      const rootGroup = new THREE.Group();
      rootGroup.userData = { authenticStadiumAsset: true, species: entry.species, romMd5: manifest!.romMd5 };
      rootGroup.add(clonedScene);
      const mixer = new THREE.AnimationMixer(clonedScene);
      const actions: Record<string, THREE.AnimationAction> = {};
      const moveActions = new Map<string, THREE.AnimationAction>();
      for (const metadata of entry.animations) {
        const clip = cached.animations[metadata.index];
        if (!clip) continue;
        const action = mixer.clipAction(clip);
        for (const role of this.rolesFor(metadata)) {
          if (!actions[role]) actions[role] = action;
        }
        for (const moveName of metadata.moves || []) moveActions.set(this.moveKey(moveName), action);
      }
      const firstMove = entry.animations.find((animation) => animation.moves?.length);
      if (!actions.attack && firstMove && cached.animations[firstMove.index]) {
        actions.attack = mixer.clipAction(cached.animations[firstMove.index]);
      }
      if (!actions.idle && cached.animations[0]) actions.idle = mixer.clipAction(cached.animations[0]);
      actions.walk = actions.idle;
      console.info(`[GLTFModelLoader] Loaded extracted Stadium ${entry.name}: ${cached.animations.length} clips`);

      let currentState: PokemonAnimationState = 'idle';
      let currentAction = actions.idle || null;
      let requestedAttack = actions.attack || null;
      currentAction?.setLoop(THREE.LoopRepeat, Infinity).play();
      const parts: Record<string, THREE.Object3D> = {};
      clonedScene.traverse((node) => { if (node.name) parts[node.name] = node; });

      return {
        mesh: rootGroup,
        height,
        parts,
        mixer,
        actions,
        playMove(moveName: string) {
          requestedAttack = moveActions.get(GLTFModelLoader.moveKey(moveName)) || actions.attack || null;
        },
        update(_time: number, dt: number, state: PokemonAnimationState) {
          mixer.update(dt);
          if (state === currentState) return;
          currentState = state;
          const next = (state === 'attack' ? requestedAttack : actions[state]) || actions.idle;
          if (!next || next === currentAction) return;
          currentAction?.fadeOut(0.12);
          next.reset().fadeIn(0.12);
          const oneShot = state === 'attack' || state === 'hit' || state === 'faint' || state === 'entrance';
          next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
          next.clampWhenFinished = oneShot;
          next.play();
          currentAction = next;
        },
      };
    } catch (error) {
      this.cache.delete(url);
      console.warn(`[GLTFModelLoader] Could not load extracted Stadium model ${name}:`, error);
      return null;
    }
  }
}
