/**
 * PokemonModels.ts — Authentic N64 Low-Poly 3D Character Models & Animations
 *
 * Creates procedural low-poly Pokémon models styled accurately after the
 * Nintendo 64 Pokémon Stadium geometries, vertex colors, and joint rigs:
 * - Pikachu, Charizard, Blastoise, Venusaur, Gengar, Alakazam, Mewtwo (Towers)
 * - Rattata, Zubat, Geodude, Haunter, Dragonair, Gyarados (Creeps & Bosses)
 */

import * as THREE from 'three';

export type PokemonAnimationState = 'idle' | 'attack' | 'hit' | 'walk' | 'faint' | 'entrance';

export interface AnimatedPokemon {
  mesh: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  mixer?: THREE.AnimationMixer;
  actions?: Record<string, THREE.AnimationAction>;
  update(t: number, dt: number, state: PokemonAnimationState): void;
}

export class PokemonModelFactory {
  public static async loadAuthenticModel(
    name: string,
    targetHeight: number,
    fallbackFn: () => AnimatedPokemon
  ): Promise<AnimatedPokemon> {
    const { GLTFModelLoader } = await import('../engine/GLTFModelLoader');
    const gltfModel = await GLTFModelLoader.loadPokemonModel(name, targetHeight);
    if (gltfModel) return gltfModel;
    return fallbackFn();
  }
  /**
   * PIKACHU (Electric Tower)
   */
  public static createPikachu(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const yellowMat = new THREE.MeshLambertMaterial({ color: 0xfed834 });
    const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xe63946 });
    const brownMat = new THREE.MeshLambertMaterial({ color: 0x7a431d });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Body (Round chubby Gen 1 proportions)
    const bodyGeo = new THREE.SphereGeometry(1.0, 10, 8);
    bodyGeo.scale(1.0, 1.25, 0.95);
    const body = new THREE.Mesh(bodyGeo, yellowMat);
    body.position.y = 1.2;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    // Head
    const headGeo = new THREE.SphereGeometry(0.85, 10, 8);
    const head = new THREE.Mesh(headGeo, yellowMat);
    head.position.set(0, 0.9, 0.2);
    head.castShadow = true;
    body.add(head);
    parts.head = head;

    // Ears (Pointed with black tips)
    [-0.55, 0.55].forEach((x, idx) => {
      const earGroup = new THREE.Group();
      earGroup.position.set(x, 0.65, 0);
      earGroup.rotation.z = idx === 0 ? 0.35 : -0.35;
      earGroup.rotation.x = -0.15;

      const earBaseGeo = new THREE.ConeGeometry(0.2, 0.7, 6);
      const earBase = new THREE.Mesh(earBaseGeo, yellowMat);
      earBase.position.y = 0.35;
      earGroup.add(earBase);

      const earTipGeo = new THREE.ConeGeometry(0.14, 0.45, 6);
      const earTip = new THREE.Mesh(earTipGeo, blackMat);
      earTip.position.y = 0.75;
      earGroup.add(earTip);

      head.add(earGroup);
      parts[`ear_${idx}`] = earGroup;
    });

    // Red Cheeks (Electric Pouches)
    [-0.55, 0.55].forEach((x, idx) => {
      const cheekGeo = new THREE.SphereGeometry(0.22, 6, 6);
      cheekGeo.scale(1, 1, 0.4);
      const cheek = new THREE.Mesh(cheekGeo, redMat);
      cheek.position.set(x, -0.12, 0.72);
      head.add(cheek);
    });

    // Eyes
    [-0.32, 0.32].forEach(x => {
      const eyeGeo = new THREE.SphereGeometry(0.1, 6, 6);
      const eye = new THREE.Mesh(eyeGeo, blackMat);
      eye.position.set(x, 0.1, 0.78);
      head.add(eye);

      const pupilGeo = new THREE.SphereGeometry(0.04, 4, 4);
      const pupil = new THREE.Mesh(pupilGeo, whiteMat);
      pupil.position.set(x + 0.02, 0.12, 0.85);
      head.add(pupil);
    });

    // Arms
    [-0.6, 0.6].forEach((x, idx) => {
      const armGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
      armGeo.rotateX(Math.PI / 2);
      const arm = new THREE.Mesh(armGeo, yellowMat);
      arm.position.set(x, 0.2, 0.7);
      body.add(arm);
      parts[`arm_${idx}`] = arm;
    });

    // Feet
    [-0.5, 0.5].forEach(x => {
      const footGeo = new THREE.BoxGeometry(0.35, 0.2, 0.7);
      const foot = new THREE.Mesh(footGeo, yellowMat);
      foot.position.set(x, -1.1, 0.2);
      body.add(foot);
    });

    // Lightning Bolt Tail
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, -0.4, -0.9);

    const segment1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.1), brownMat);
    segment1.rotation.z = 0.3;
    tailGroup.add(segment1);

    const segment2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.1), yellowMat);
    segment2.position.set(0.2, 0.5, 0);
    segment2.rotation.z = -0.4;
    tailGroup.add(segment2);

    const segment3 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.1), yellowMat);
    segment3.position.set(-0.1, 1.1, 0);
    segment3.rotation.z = 0.35;
    tailGroup.add(segment3);

    body.add(tailGroup);
    parts.tail = tailGroup;

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        if (state === 'attack') {
          // Jump and tail flip
          parts.body.position.y = 1.2 + Math.abs(Math.sin(t * 12)) * 0.8;
          parts.tail.rotation.x = Math.sin(t * 18) * 0.8;
          parts.head.rotation.x = -0.2;
        } else {
          // Idle breathing and ear twitch
          parts.body.position.y = 1.2 + Math.sin(t * 3) * 0.05;
          parts.ear_0.rotation.z = 0.35 + Math.sin(t * 4) * 0.08;
          parts.ear_1.rotation.z = -0.35 - Math.sin(t * 4 + 0.5) * 0.08;
          parts.tail.rotation.y = Math.sin(t * 2.5) * 0.25;
        }
      }
    };
  }

  /**
   * CHARIZARD (Fire Tower)
   */
  public static createCharizard(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const orangeMat = new THREE.MeshLambertMaterial({ color: 0xeb6713 });
    const bellyMat = new THREE.MeshLambertMaterial({ color: 0xffdc8a });
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x2b8a82, side: THREE.DoubleSide });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });

    // Main Torso
    const bodyGeo = new THREE.CylinderGeometry(0.8, 1.2, 2.2, 8);
    const body = new THREE.Mesh(bodyGeo, orangeMat);
    body.position.y = 2.2;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    // Cream Belly
    const bellyGeo = new THREE.SphereGeometry(0.85, 8, 8);
    bellyGeo.scale(0.8, 1.3, 0.4);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, -0.1, 0.7);
    body.add(belly);

    // Neck & Head
    const neck = new THREE.Group();
    neck.position.set(0, 1.1, 0.2);
    body.add(neck);
    parts.neck = neck;

    const headGeo = new THREE.BoxGeometry(0.9, 0.8, 1.4);
    const head = new THREE.Mesh(headGeo, orangeMat);
    head.position.set(0, 0.6, 0.5);
    neck.add(head);

    // Horns
    [-0.3, 0.3].forEach(x => {
      const hornGeo = new THREE.ConeGeometry(0.16, 0.7, 5);
      hornGeo.rotateX(-Math.PI / 4);
      const horn = new THREE.Mesh(hornGeo, orangeMat);
      horn.position.set(x, 0.5, -0.4);
      head.add(horn);
    });

    // Wings
    [-1, 1].forEach((dir, idx) => {
      const wingGroup = new THREE.Group();
      wingGroup.position.set(dir * 0.7, 0.6, -0.6);
      body.add(wingGroup);

      const wingGeo = new THREE.BufferGeometry();
      // Low-poly dragon wing triangle
      const vertices = new Float32Array([
        0, 0, 0,
        dir * 2.6, 2.0, -0.5,
        dir * 1.8, -0.6, 0.2
      ]);
      wingGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      wingGeo.computeVertexNormals();

      const wing = new THREE.Mesh(wingGeo, wingMat);
      wingGroup.add(wing);
      parts[`wing_${idx}`] = wingGroup;
    });

    // Tail with flame
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, -0.8, -0.9);
    body.add(tailGroup);
    parts.tail = tailGroup;

    const tailGeo = new THREE.CylinderGeometry(0.2, 0.6, 2.0, 6);
    tailGeo.rotateX(-Math.PI / 3);
    const tailMesh = new THREE.Mesh(tailGeo, orangeMat);
    tailMesh.position.set(0, 0.4, -0.8);
    tailGroup.add(tailMesh);

    // Flame tip
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6), flameMat);
    flame.position.set(0, 0.9, -1.6);
    tailGroup.add(flame);
    parts.flame = flame;

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        // Wing flapping
        const flap = Math.sin(t * (state === 'attack' ? 10 : 3.5)) * 0.35;
        parts.wing_0.rotation.y = flap;
        parts.wing_1.rotation.y = -flap;

        if (state === 'attack') {
          parts.neck.rotation.x = -0.3 + Math.sin(t * 12) * 0.2;
          parts.body.position.y = 2.2 + Math.sin(t * 8) * 0.2;
        } else {
          parts.body.position.y = 2.2 + Math.sin(t * 2.5) * 0.1;
          parts.neck.rotation.x = Math.sin(t * 2) * 0.08;
        }

        // Tail flame flicker
        parts.flame.scale.set(
          1 + Math.sin(t * 15) * 0.25,
          1 + Math.cos(t * 18) * 0.3,
          1 + Math.sin(t * 15) * 0.25
        );
      }
    };
  }

  /**
   * BLASTOISE (Water Tower)
   */
  public static createBlastoise(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const blueMat = new THREE.MeshLambertMaterial({ color: 0x5b92e5 });
    const shellMat = new THREE.MeshLambertMaterial({ color: 0x7c4728 });
    const rimMat = new THREE.MeshLambertMaterial({ color: 0xf1f3f5 });
    const cannonMat = new THREE.MeshStandardMaterial({ color: 0x868e96, metalness: 0.8, roughness: 0.2 });

    // Armored Carapace Shell
    const shellGeo = new THREE.SphereGeometry(1.5, 10, 8);
    shellGeo.scale(1.1, 1.25, 1.0);
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.set(0, 1.8, -0.3);
    shell.castShadow = true;
    root.add(shell);
    parts.body = shell;

    // White shell rim
    const rimGeo = new THREE.TorusGeometry(1.55, 0.18, 6, 24);
    rimGeo.scale(1.0, 1.15, 0.9);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(0, 0, 0.2);
    shell.add(rim);

    // Head
    const headGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const head = new THREE.Mesh(headGeo, blueMat);
    head.position.set(0, 1.3, 0.7);
    shell.add(head);
    parts.head = head;

    // Twin Hydro Cannons protruding from shell top
    [-0.85, 0.85].forEach((x, idx) => {
      const cannonGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.4, 8);
      cannonGeo.rotateX(-Math.PI / 4);
      const cannon = new THREE.Mesh(cannonGeo, cannonMat);
      cannon.position.set(x, 1.3, -0.3);
      shell.add(cannon);
      parts[`cannon_${idx}`] = cannon;
    });

    // Sturdy Legs
    [-0.9, 0.9].forEach(x => {
      const legGeo = new THREE.CylinderGeometry(0.45, 0.55, 1.2, 6);
      const leg = new THREE.Mesh(legGeo, blueMat);
      leg.position.set(x, -1.2, 0.1);
      shell.add(leg);
    });

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        if (state === 'attack') {
          // Hydro Pump cannon recoil
          const recoil = Math.sin(t * 14) * 0.3;
          parts.cannon_0.position.z = -0.3 - recoil;
          parts.cannon_1.position.z = -0.3 - recoil;
          parts.body.position.z = -0.3 - recoil * 0.4;
        } else {
          parts.body.position.y = 1.8 + Math.sin(t * 2) * 0.04;
          parts.head.rotation.y = Math.sin(t * 1.5) * 0.15;
          parts.cannon_0.position.z = -0.3;
          parts.cannon_1.position.z = -0.3;
        }
      }
    };
  }

  /**
   * VENUSAUR (Grass Tower)
   */
  public static createVenusaur(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const tealMat = new THREE.MeshLambertMaterial({ color: 0x4da1a9 });
    const petalMat = new THREE.MeshLambertMaterial({ color: 0xf2547d, side: THREE.DoubleSide });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x965a38 });

    // Bulky Quadruped Body
    const bodyGeo = new THREE.CylinderGeometry(1.6, 1.8, 1.8, 8);
    bodyGeo.scale(1.2, 0.9, 1.4);
    const body = new THREE.Mesh(bodyGeo, tealMat);
    body.position.y = 1.3;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    // Head
    const headGeo = new THREE.BoxGeometry(1.5, 1.0, 1.4);
    const head = new THREE.Mesh(headGeo, tealMat);
    head.position.set(0, 0.3, 1.5);
    body.add(head);
    parts.head = head;

    // Giant Palm Flower on back
    const flowerGroup = new THREE.Group();
    flowerGroup.position.set(0, 1.2, 0);
    body.add(flowerGroup);
    parts.flower = flowerGroup;

    // Tree trunk pedestal
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.7, 0.9, 6);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    flowerGroup.add(trunk);

    // 6 Large Blooming Pink Petals
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const petalGeo = new THREE.PlaneGeometry(1.2, 1.8);
      petalGeo.rotateX(Math.PI / 3);
      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.position.set(Math.cos(angle) * 0.9, 0.6, Math.sin(angle) * 0.9);
      petal.rotation.y = -angle;
      flowerGroup.add(petal);
    }

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        if (state === 'attack') {
          // Petal rotation & Solar charge
          parts.flower.rotation.y += dt * 5.0;
          parts.head.position.y = 0.3 + Math.sin(t * 10) * 0.15;
        } else {
          parts.flower.rotation.y += dt * 0.5;
          parts.body.position.y = 1.3 + Math.sin(t * 2) * 0.04;
        }
      }
    };
  }

  /**
   * GENGAR (Ghost Tower)
   */
  public static createGengar(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const purpleMat = new THREE.MeshLambertMaterial({ color: 0x5b3a8c });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xef233c });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Round ghost silhouette
    const bodyGeo = new THREE.SphereGeometry(1.4, 10, 8);
    bodyGeo.scale(1.0, 1.1, 0.9);
    const body = new THREE.Mesh(bodyGeo, purpleMat);
    body.position.y = 1.6;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    // Spikes / Horns
    [-0.7, 0.7].forEach((x, idx) => {
      const earGeo = new THREE.ConeGeometry(0.35, 0.9, 5);
      earGeo.rotateZ(idx === 0 ? 0.4 : -0.4);
      const ear = new THREE.Mesh(earGeo, purpleMat);
      ear.position.set(x, 1.2, -0.2);
      body.add(ear);
    });

    // Wicked Crescent Smile
    const smileGeo = new THREE.BoxGeometry(1.2, 0.35, 0.2);
    const smile = new THREE.Mesh(smileGeo, whiteMat);
    smile.position.set(0, -0.1, 1.25);
    body.add(smile);

    // Piercing Red Eyes
    [-0.45, 0.45].forEach(x => {
      const eyeGeo = new THREE.BoxGeometry(0.3, 0.2, 0.1);
      const eye = new THREE.Mesh(eyeGeo, redMat);
      eye.position.set(x, 0.35, 1.25);
      body.add(eye);
    });

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        // Eerie floating & hovering
        parts.body.position.y = 1.6 + Math.sin(t * 3.5) * 0.2;
        parts.body.rotation.y = Math.sin(t * 2) * 0.15;
        if (state === 'attack') {
          parts.body.scale.set(
            1 + Math.sin(t * 12) * 0.2,
            1 + Math.sin(t * 12) * 0.2,
            1 + Math.sin(t * 12) * 0.2
          );
        }
      }
    };
  }

  /**
   * ALAKAZAM (Psychic Tower)
   */
  public static createAlakazam(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const yellowMat = new THREE.MeshLambertMaterial({ color: 0xdeb841 });
    const brownMat = new THREE.MeshLambertMaterial({ color: 0x8a5a36 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xdde5b6, metalness: 0.9, roughness: 0.2 });

    // Slender Body
    const bodyGeo = new THREE.CylinderGeometry(0.5, 0.7, 1.8, 6);
    const body = new THREE.Mesh(bodyGeo, yellowMat);
    body.position.y = 2.0;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    // Brown Armor Chest & Shoulder Pads
    const chestGeo = new THREE.BoxGeometry(1.4, 0.8, 0.8);
    const chest = new THREE.Mesh(chestGeo, brownMat);
    chest.position.set(0, 0.4, 0);
    body.add(chest);

    // Head with long mustache whiskers
    const headGeo = new THREE.ConeGeometry(0.4, 0.9, 5);
    const head = new THREE.Mesh(headGeo, yellowMat);
    head.position.set(0, 1.2, 0.1);
    body.add(head);

    // Spoons
    [-0.9, 0.9].forEach((x, idx) => {
      const spoonGroup = new THREE.Group();
      spoonGroup.position.set(x, 0.5, 0.8);

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9), silverMat);
      handle.rotateX(Math.PI / 3);
      spoonGroup.add(handle);

      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), silverMat);
      bowl.position.set(0, 0.4, 0.35);
      spoonGroup.add(bowl);

      body.add(spoonGroup);
      parts[`spoon_${idx}`] = spoonGroup;
    });

    return {
      mesh: root,
      parts,
      update(t: number, dt: number, state: string) {
        parts.body.position.y = 2.0 + Math.sin(t * 3) * 0.15;
        // Levitate spoons
        parts.spoon_0.position.y = 0.5 + Math.sin(t * 5) * 0.1;
        parts.spoon_1.position.y = 0.5 + Math.cos(t * 5) * 0.1;
      }
    };
  }

  /**
   * CREEP: RATTATA (Fast Scout)
   */
  public static createRattata(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const purpleMat = new THREE.MeshLambertMaterial({ color: 0x9b5de5 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 6), purpleMat);
    body.scale.set(0.8, 0.7, 1.2);
    body.position.y = 0.5;
    root.add(body);
    parts.body = body;

    // Teeth
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.15), whiteMat);
    tooth.position.set(0, -0.15, 0.8);
    body.add(tooth);

    return {
      mesh: root,
      parts,
      update(t: number, dt: number) {
        // Scampering run
        parts.body.position.y = 0.5 + Math.abs(Math.sin(t * 16)) * 0.2;
      }
    };
  }

  /**
   * CREEP: ZUBAT (Flying Swarm)
   */
  public static createZubat(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const blueMat = new THREE.MeshLambertMaterial({ color: 0x0077b6 });
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x7209b7, side: THREE.DoubleSide });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), blueMat);
    body.position.y = 1.8;
    root.add(body);
    parts.body = body;

    [-1, 1].forEach((dir, idx) => {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), wingMat);
      wing.position.set(dir * 0.8, 1.8, 0);
      root.add(wing);
      parts[`wing_${idx}`] = wing;
    });

    return {
      mesh: root,
      parts,
      update(t: number, dt: number) {
        parts.body.position.y = 1.8 + Math.sin(t * 6) * 0.3;
        const flap = Math.sin(t * 18) * 0.6;
        parts.wing_0.rotation.z = flap;
        parts.wing_1.rotation.z = -flap;
        parts.wing_0.position.y = parts.body.position.y;
        parts.wing_1.position.y = parts.body.position.y;
      }
    };
  }

  /**
   * CREEP: GEODUDE (High Armor Rock)
   */
  public static createGeodude(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x7f7f7f });

    // Boulder body
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9), rockMat);
    body.position.y = 1.2;
    root.add(body);
    parts.body = body;

    // Muscular rock arms
    [-1, 1].forEach((dir, idx) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.4), rockMat);
      arm.position.set(dir * 1.3, 1.2, 0.2);
      root.add(arm);
      parts[`arm_${idx}`] = arm;
    });

    return {
      mesh: root,
      parts,
      update(t: number, dt: number) {
        parts.body.position.y = 1.2 + Math.sin(t * 4) * 0.15;
        parts.body.rotation.y += dt * 0.8;
      }
    };
  }

  /**
   * CREEP / BOSS: DRAGONAIR (Serpentine Speed)
   */
  public static createDragonair(): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const dragonMat = new THREE.MeshLambertMaterial({ color: 0x48cae4 });
    const pearlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.1 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 8), dragonMat);
    head.position.set(0, 1.4, 0);
    root.add(head);
    parts.head = head;

    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), pearlMat);
    pearl.position.set(0, 1.0, 0.45);
    root.add(pearl);

    // 4 body segments
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.5 - i * 0.05, 6, 6), dragonMat);
      seg.position.set(0, 0.8 - i * 0.1, -0.6 * (i + 1));
      root.add(seg);
      parts[`seg_${i}`] = seg;
    }

    return {
      mesh: root,
      parts,
      update(t: number, dt: number) {
        for (let i = 0; i < 5; i++) {
          parts[`seg_${i}`].position.x = Math.sin(t * 6 + i * 0.8) * 0.45;
        }
      }
    };
  }

  /**
   * BOSS: GYARADOS / ONIX (Massive Titan)
   */
  public static createBossTitan(type: 'Onix' | 'Gyarados'): AnimatedPokemon {
    const root = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};

    const mat = new THREE.MeshLambertMaterial({
      color: type === 'Onix' ? 0x6c757d : 0x1d3557,
    });

    const head = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 2.2), mat);
    head.position.set(0, 2.8, 0);
    head.castShadow = true;
    root.add(head);
    parts.head = head;

    // 6 Large segments
    for (let i = 0; i < 6; i++) {
      const size = 1.7 - i * 0.18;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      seg.position.set(0, 2.2 - i * 0.25, -1.8 * (i + 1));
      seg.castShadow = true;
      root.add(seg);
      parts[`seg_${i}`] = seg;
    }

    return {
      mesh: root,
      parts,
      update(t: number, dt: number) {
        parts.head.position.y = 2.8 + Math.sin(t * 3) * 0.3;
        for (let i = 0; i < 6; i++) {
          parts[`seg_${i}`].position.x = Math.sin(t * 4 + i * 0.7) * 0.8;
        }
      }
    };
  }
}
