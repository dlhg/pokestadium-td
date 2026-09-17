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
  slug: string;
  glb: string;
  /** Idle footprint (twice the farthest horizontal reach) and height, in native units. */
  size?: { footprint: number; height: number };
  animations: ManifestAnimation[];
}

interface StadiumManifest {
  romMd5: string;
  pokemon: ManifestPokemon[];
  extra: ManifestPokemon[];
}

export class GLTFModelLoader {
  private static readonly baseUrl = '/generated/stadium/';
  private static loader = new GLTFLoader();
  private static manifestPromise: Promise<StadiumManifest | null> | null = null;
  private static cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

  private static loadManifest(): Promise<StadiumManifest | null> {
    if (!this.manifestPromise) {
      const url = `${this.baseUrl}manifest.json`;
      const fallback = (reason: string) => {
        console.warn(`[GLTFModelLoader] Using procedural models: ${reason}. `
          + 'Put the Pokemon Stadium (USA) Rev 2 ROM in baseroms/us/ and run `npm run extract:stadium` from web/ (see web/ROM_ASSETS.md).');
        return null;
      };
      // Vite answers a missing file with index.html and a 200, so a bad parse means "not extracted" too.
      this.manifestPromise = fetch(url)
        .then(async (response) => {
          if (!response.ok) return fallback(`${url} returned HTTP ${response.status}`);
          try {
            return JSON.parse(await response.text()) as StadiumManifest;
          } catch {
            return fallback(`${url} is missing (the server returned something other than JSON)`);
          }
        })
        .catch((error) => fallback(`${url} could not be fetched (${error})`));
    }
    return this.manifestPromise;
  }

  /**
   * A dropped connection (dev-server HMR reload, a brief Wi-Fi blip, the
   * browser's per-origin connection limit bumping a request out) surfaces as
   * a generic `TypeError: Failed to fetch` and is usually gone a moment
   * later; a real 404 or malformed-GLB parse failure throws a different
   * error and won't recover, so only the network case gets retried.
   */
  private static async loadGLTF(url: string): ReturnType<GLTFLoader['loadAsync']> {
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.loader.loadAsync(url);
      } catch (error) {
        if (!(error instanceof TypeError) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  }

  private static prepareMesh(scene: THREE.Group): void {
    scene.traverse((child) => {
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
  }

  /**
   * Species whose battle clips never walk get a second, standalone model
   * spliced in just for the `walk` state: a separate extracted asset (its own
   * skeleton, so its clip can't be retargeted onto the battle rig) shown in
   * place of the battle model while moving. Rattata's battle model (43 bones)
   * has no run cycle -- Stadium never needed one for a Pokemon that just
   * stands and swings -- but the "Run! Rattata, Run!" minigame's own Rattata
   * rig (34 bones, extra model x174) does, as clip `run` (see build.py).
   */
  private static readonly runOverlays: Record<string, string> = { rattata: 'x174_model' };

  private static async loadRunOverlay(
    slug: string, targetHeight: number
  ): Promise<{ scene: THREE.Group; mixer: THREE.AnimationMixer; action: THREE.AnimationAction } | null> {
    const manifest = await this.loadManifest();
    const entry = manifest?.extra.find((model) => model.slug === slug);
    if (!entry) return null;
    const url = `${this.baseUrl}${entry.glb}`;
    try {
      let pending = this.cache.get(url);
      if (!pending) {
        pending = this.loadGLTF(url).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
        this.cache.set(url, pending);
      }
      const cached = await pending;
      const scene = cloneSkeleton(cached.scene) as THREE.Group;
      this.prepareMesh(scene);

      const bounds = new THREE.Box3().setFromObject(scene);
      const boundsHeight = Math.max(bounds.getSize(new THREE.Vector3()).y, 0.001);
      scene.scale.multiplyScalar(targetHeight / boundsHeight);
      const grounded = new THREE.Box3().setFromObject(scene);
      scene.position.y -= grounded.min.y;

      const runClip = entry.animations.find((animation) => animation.name === 'run');
      const clip = runClip && cached.animations[runClip.index];
      if (!clip) return null;
      const mixer = new THREE.AnimationMixer(scene);
      const action = mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity);
      return { scene, mixer, action };
    } catch (error) {
      this.cache.delete(url);
      console.warn(`[GLTFModelLoader] Could not load run overlay ${slug}:`, error);
      return null;
    }
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
        pending = this.loadGLTF(url).then((gltf) => {
          this.tameRootMotion(gltf.scene, gltf.animations, entry);
          return { scene: gltf.scene, animations: gltf.animations };
        });
        this.cache.set(url, pending);
      }
      const cached = await pending;
      const clonedScene = cloneSkeleton(cached.scene) as THREE.Group;
      this.prepareMesh(clonedScene);

      let bounds = new THREE.Box3().setFromObject(clonedScene);
      const boundsHeight = Math.max(bounds.getSize(new THREE.Vector3()).y, 0.001);
      let scale: number;
      let height: number;
      if (fitHeight === undefined && entry.size) {
        scale = worldScaleFor(entry.size.height, entry.species);
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

      const overlaySlug = this.runOverlays[name.toLowerCase()];
      const overlay = overlaySlug ? await this.loadRunOverlay(overlaySlug, height) : null;
      if (overlay) {
        overlay.scene.visible = false;
        rootGroup.add(overlay.scene);
      }

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
          // The run overlay is a wholly separate skeleton, so it gets shown
          // and driven in place of the battle model rather than through its
          // animation mixer/action machinery below.
          if (overlay) {
            const running = state === 'walk';
            if (running !== overlay.scene.visible) {
              overlay.scene.visible = running;
              clonedScene.visible = !running;
              if (running) overlay.action.reset().play();
            }
            if (running) {
              overlay.mixer.update(dt);
              return;
            }
          }
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
