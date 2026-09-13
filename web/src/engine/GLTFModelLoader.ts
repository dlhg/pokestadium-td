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
   * Stadium's contact moves (Quick Attack, Tackle, Bite...) and many entrances
   * carry the body across the field to where the opponent stood, often ending
   * there. A tower never leaves its pad, so squash that ground travel into a
   * short lunge and walk it home over the clip's last quarter. Hops (vertical
   * travel) and limb motion are kept, and faints may still topple sideways.
   */
  private static tameRootMotion(scene: THREE.Group, animations: THREE.AnimationClip[], entry: ManifestPokemon): void {
    scene.updateMatrixWorld(true);
    const bones = new Set<THREE.Object3D>();
    scene.traverse((node) => {
      const skinned = node as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.bones.forEach((bone) => bones.add(bone));
    });
    // The body root is whichever translated node carries most of the skeleton.
    const carriesBody = (node: THREE.Object3D) => {
      let carried = 0;
      node.traverse((child) => { if (bones.has(child)) carried++; });
      return carried * 2 >= bones.size;
    };
    const bodySize = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const width = Math.max(bodySize.x, bodySize.z, 0.001);
    const threshold = width * 0.3;
    const cap = width * 0.25;
    const faint = new Set(entry.animations
      .filter((animation) => animation.contexts?.some((context) => context.startsWith('faint')))
      .map((animation) => animation.index));

    const toWorld = new THREE.Matrix3();
    const toLocal = new THREE.Matrix3();
    const offset = new THREE.Vector3();
    animations.forEach((clip, index) => {
      if (faint.has(index)) return;
      for (const track of clip.tracks) {
        if (!track.name.endsWith('.position') || track.values.length !== track.times.length * 3) continue;
        const node = scene.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
        if (!node?.parent || !carriesBody(node)) continue;
        toWorld.setFromMatrix4(node.parent.matrixWorld);
        toLocal.copy(toWorld).invert();
        const values = track.values;
        const [x0, y0, z0] = [values[0], values[1], values[2]];
        const worldOffsets = Array.from(track.times, (_, key) => offset
          .set(values[key * 3] - x0, values[key * 3 + 1] - y0, values[key * 3 + 2] - z0)
          .applyMatrix3(toWorld).clone());
        if (!worldOffsets.some((world) => Math.hypot(world.x, world.z) > threshold)) continue;
        const duration = track.times[track.times.length - 1] || 1;
        worldOffsets.forEach((world, key) => {
          const travel = Math.hypot(world.x, world.z);
          const homeward = THREE.MathUtils.smoothstep(track.times[key] / duration, 0.75, 1);
          const kept = travel > 0 ? (cap * Math.tanh(travel / cap) / travel) * (1 - homeward) : 0;
          offset.set(world.x * kept, world.y, world.z * kept).applyMatrix3(toLocal);
          values[key * 3] = x0 + offset.x;
          values[key * 3 + 1] = y0 + offset.y;
          values[key * 3 + 2] = z0 + offset.z;
        });
      }
    });
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
        pending = this.loader.loadAsync(url).then((gltf) => {
          this.tameRootMotion(gltf.scene, gltf.animations, entry);
          return { scene: gltf.scene, animations: gltf.animations };
        });
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
      // A second action on a copy of each attack clip, so a swing can cross-fade
      // into a fresh swing of the same move instead of snapping back to frame 0.
      const twins = new Map<THREE.AnimationAction, THREE.AnimationAction>();
      const twinOf = (action: THREE.AnimationAction) => {
        let twin = twins.get(action);
        if (!twin) twins.set(action, twin = mixer.clipAction(action.getClip().clone()));
        return twin;
      };
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
          // A swing already under way plays out; retargeting or a new shot
          // shouldn't cut it off mid-lunge. Hits, faints and entrances still can.
          const swinging = currentState === 'attack' && !!currentAction?.isRunning();
          if (swinging && (state === 'attack' || state === 'idle')) return;
          // Still firing once the last swing has finished: swing again.
          const again = state === 'attack' && currentState === 'attack';
          if (state === currentState && !again) return;
          currentState = state;
          let next = (state === 'attack' ? requestedAttack : actions[state]) || actions.idle;
          if (next && next === currentAction && again) next = twinOf(next);
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
