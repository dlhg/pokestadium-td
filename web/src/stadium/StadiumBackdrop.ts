/**
 * StadiumBackdrop.ts — Low-poly atmosphere outside the tournament bowl.
 *
 * The backdrop is intentionally built from simple silhouettes instead of a
 * photographic cubemap. That keeps the horizon consistent with the faceted
 * course scenery and gives every venue its own place in the Kanto night.
 */

import * as THREE from 'three';
import type { StadiumMap } from '../td/MapCatalog';

type SkyPalette = {
  zenith: number;
  middle: number;
  horizon: number;
  cloud: number;
};

const SKY: Record<StadiumMap['theme'], SkyPalette> = {
  garden: { zenith: 0x050d22, middle: 0x15385d, horizon: 0xb06a76, cloud: 0x9eb5cc },
  canyon: { zenith: 0x100d29, middle: 0x3b285b, horizon: 0xc96f62, cloud: 0xb8a3c3 },
  river: { zenith: 0x06152c, middle: 0x19506c, horizon: 0x68a7a4, cloud: 0xb8d5d7 },
  industrial: { zenith: 0x050d18, middle: 0x1b2d3b, horizon: 0x8e634c, cloud: 0x8c9296 },
  plateau: { zenith: 0x080d27, middle: 0x273d72, horizon: 0x96a8c8, cloud: 0xc5cfdf },
};

type RidgeOptions = {
  radius: number;
  segments: number;
  low: number;
  high: number;
  color: number;
  base?: number;
  opacity?: number;
  jaggedness?: number;
};

export class StadiumBackdrop {
  public readonly group = new THREE.Group();

  private readonly cloudRing = new THREE.Group();
  private readonly starMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly beamMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly pulseLights: { mesh: THREE.Mesh; phase: number; base: number }[] = [];
  private readonly auroraMaterials: THREE.MeshBasicMaterial[] = [];
  private random: () => number;

  constructor(private readonly map: StadiumMap) {
    this.random = this.seededRandom(this.hash(map.id));
    this.group.name = `stadium-backdrop-${map.id}`;
    this.group.add(this.buildSky());
    this.buildStars();
    this.buildClouds();
    this.buildSearchlights();
    this.buildVenueHorizon();
  }

  public update(time: number): void {
    this.cloudRing.rotation.y = time * 0.0035;
    this.starMaterials.forEach((material, index) => {
      material.opacity = 0.48 + Math.sin(time * (0.55 + index * 0.17) + index * 2.1) * 0.17;
    });
    this.beamMaterials.forEach((material, index) => {
      material.opacity = 0.028 + Math.sin(time * 0.7 + index * 1.8) * 0.008;
    });
    this.pulseLights.forEach(({ mesh, phase, base }) => {
      const pulse = 0.68 + Math.sin(time * 1.7 + phase) * 0.32;
      mesh.scale.setScalar(base * pulse);
    });
    this.auroraMaterials.forEach((material, index) => {
      material.opacity = 0.055 + Math.sin(time * 0.3 + index * 1.9) * 0.018;
    });
  }

  private buildSky(): THREE.Mesh {
    const palette = SKY[this.map.theme];
    const material = new THREE.ShaderMaterial({
      uniforms: {
        zenithColor: { value: new THREE.Color(palette.zenith) },
        middleColor: { value: new THREE.Color(palette.middle) },
        horizonColor: { value: new THREE.Color(palette.horizon) },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 zenithColor;
        uniform vec3 middleColor;
        uniform vec3 horizonColor;
        varying vec3 vDirection;
        void main() {
          float height = clamp(vDirection.y, 0.0, 1.0);
          vec3 lowSky = mix(horizonColor, middleColor, smoothstep(0.0, 0.24, height));
          vec3 sky = mix(lowSky, zenithColor, smoothstep(0.24, 0.88, height));
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(235, 32, 16), material);
    sky.position.y = -12;
    sky.renderOrder = -1000;
    sky.name = 'gradient-night-sky';
    return sky;
  }

  private buildStars(): void {
    const geometry = new THREE.OctahedronGeometry(0.42, 0);
    for (let layer = 0; layer < 2; layer++) {
      const material = new THREE.MeshBasicMaterial({
        color: layer ? 0xb8d9ff : 0xffedc2,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        fog: false,
      });
      const count = layer ? 48 : 36;
      const stars = new THREE.InstancedMesh(geometry, material, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const angle = this.random() * Math.PI * 2;
        const height = 43 + this.random() * 120;
        const radius = Math.sqrt(Math.max(0, 205 * 205 - height * height));
        const scale = 0.38 + this.random() * (layer ? 0.48 : 0.72);
        dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        dummy.scale.setScalar(scale);
        dummy.rotation.set(this.random() * 2, this.random() * 2, this.random() * 2);
        dummy.updateMatrix();
        stars.setMatrixAt(i, dummy.matrix);
      }
      stars.instanceMatrix.needsUpdate = true;
      stars.renderOrder = -900;
      stars.name = `stars-${layer}`;
      this.starMaterials.push(material);
      this.group.add(stars);
    }
  }

  private buildClouds(): void {
    const palette = SKY[this.map.theme];
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshBasicMaterial({
      color: palette.cloud,
      transparent: true,
      opacity: this.map.theme === 'industrial' ? 0.13 : 0.09,
      depthWrite: false,
      fog: false,
    });

    for (let clusterIndex = 0; clusterIndex < 9; clusterIndex++) {
      const angle = (clusterIndex / 9) * Math.PI * 2 + this.random() * 0.28;
      const radius = 135 + this.random() * 24;
      const cluster = new THREE.Group();
      cluster.position.set(Math.cos(angle) * radius, 32 + this.random() * 36, Math.sin(angle) * radius);
      cluster.rotation.y = -angle;
      const pieces = 3 + Math.floor(this.random() * 3);
      for (let i = 0; i < pieces; i++) {
        const puff = new THREE.Mesh(geometry, material);
        puff.position.set((i - (pieces - 1) / 2) * 7.5, this.random() * 2.2, (this.random() - 0.5) * 2);
        puff.scale.set(7 + this.random() * 5, 1.2 + this.random() * 1.3, 3 + this.random() * 3);
        puff.rotation.y = this.random();
        puff.renderOrder = -800;
        cluster.add(puff);
      }
      this.cloudRing.add(cluster);
    }
    this.cloudRing.name = 'slow-cloud-bands';
    this.group.add(this.cloudRing);
  }

  private buildSearchlights(): void {
    const colors = [0x80eaff, 0xffe88a, 0xc2a0ff, 0xff8295];
    colors.forEach((color, index) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.03,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 72, 8, 1, true), material);
      const angle = Math.PI * 0.25 + index * Math.PI * 0.5;
      beam.position.set(Math.cos(angle) * 48, 51, Math.sin(angle) * 48);
      beam.rotation.x = Math.PI;
      beam.rotation.y = -angle;
      beam.rotation.z = (index % 2 ? 1 : -1) * 0.09;
      beam.renderOrder = -200;
      beam.name = 'atmospheric-floodlight-beam';
      this.beamMaterials.push(material);
      this.group.add(beam);
    });
  }

  private buildVenueHorizon(): void {
    switch (this.map.theme) {
      case 'garden': this.buildGardenHorizon(); break;
      case 'canyon': this.buildCanyonHorizon(); break;
      case 'river': this.buildRiverHorizon(); break;
      case 'industrial': this.buildIndustrialHorizon(); break;
      case 'plateau': this.buildPlateauHorizon(); break;
    }
  }

  private buildGardenHorizon(): void {
    this.addRidge({ radius: 118, segments: 40, low: 7, high: 14, color: 0x18364a, jaggedness: 0.45 });
    const geometry = new THREE.ConeGeometry(5.8, 19, 5);
    const material = new THREE.MeshBasicMaterial({ color: 0x102d32, fog: false });
    const trees = new THREE.InstancedMesh(geometry, material, 64);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2 + (this.random() - 0.5) * 0.07;
      const radius = 82 + this.random() * 20;
      const scale = 0.65 + this.random() * 0.8;
      dummy.position.set(Math.cos(angle) * radius, 7 + 9.5 * scale, Math.sin(angle) * radius);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = this.random() * Math.PI;
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
    trees.name = 'viridian-tree-line';
    this.group.add(trees);
    this.addHorizonLights(44, 76, 106, 0xffd882, 0.25);
  }

  private buildCanyonHorizon(): void {
    this.addRidge({ radius: 128, segments: 36, low: 22, high: 53, color: 0x32284c, jaggedness: 1 });
    this.addRidge({ radius: 96, segments: 42, low: 12, high: 29, color: 0x3f3045, jaggedness: 0.82 });
    this.addMoon(new THREE.Vector3(-118, 82, -82), 18, 0xffd5ae, 0.94);
    this.addHorizonLights(20, 82, 104, 0xd9b7ff, 0.3);
  }

  private buildRiverHorizon(): void {
    this.addRidge({ radius: 126, segments: 48, low: 5, high: 12, color: 0x17414c, jaggedness: 0.35 });
    const water = new THREE.Mesh(
      new THREE.RingGeometry(60, 148, 64),
      new THREE.MeshBasicMaterial({ color: 0x2f7891, transparent: true, opacity: 0.24, fog: false, side: THREE.DoubleSide }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 2.1;
    water.name = 'cerulean-distant-water';
    this.group.add(water);
    for (let i = 0; i < 3; i++) {
      const mist = new THREE.Mesh(
        new THREE.TorusGeometry(82 + i * 14, 0.7 + i * 0.25, 4, 64),
        new THREE.MeshBasicMaterial({ color: 0xc7e6e4, transparent: true, opacity: 0.1 - i * 0.018, fog: false }),
      );
      mist.rotation.x = Math.PI / 2;
      mist.position.y = 8 + i * 2.2;
      mist.name = 'river-mist-band';
      this.group.add(mist);
    }
    this.addMoon(new THREE.Vector3(112, 66, -112), 13, 0xe8fff2, 0.82);
    this.addHorizonLights(38, 86, 122, 0xffe6a4, 0.32);
  }

  private buildIndustrialHorizon(): void {
    this.addRidge({ radius: 127, segments: 40, low: 4, high: 10, color: 0x172834, jaggedness: 0.25 });
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterial = new THREE.MeshBasicMaterial({ color: 0x14212b, fog: false });
    const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, 52);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 52; i++) {
      const angle = (i / 52) * Math.PI * 2 + this.random() * 0.035;
      const radius = 91 + this.random() * 16;
      const width = 3 + this.random() * 6;
      const height = 6 + this.random() * 22;
      dummy.position.set(Math.cos(angle) * radius, height * 0.5 + 4, Math.sin(angle) * radius);
      dummy.scale.set(width, height, 3.5 + this.random() * 5);
      dummy.rotation.y = -angle;
      dummy.updateMatrix();
      buildings.setMatrixAt(i, dummy.matrix);
    }
    buildings.instanceMatrix.needsUpdate = true;
    buildings.name = 'power-plant-skyline';
    this.group.add(buildings);

    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + 0.22;
      const radius = 86 + (i % 2) * 16;
      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.45, 18 + (i % 3) * 5, 6),
        new THREE.MeshBasicMaterial({ color: 0x26343b, fog: false }),
      );
      stack.position.set(Math.cos(angle) * radius, 13, Math.sin(angle) * radius);
      this.group.add(stack);
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.7, 0),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb052 : 0xff4050, fog: false }),
      );
      beacon.position.copy(stack.position).setY(23 + (i % 3) * 2.5);
      this.pulseLights.push({ mesh: beacon, phase: i * 0.9, base: 1 });
      this.group.add(beacon);
    }
    this.addHorizonLights(70, 82, 113, 0xffc34e, 0.48);
  }

  private buildPlateauHorizon(): void {
    this.addRidge({ radius: 142, segments: 36, low: 30, high: 70, color: 0x344665, jaggedness: 1 });
    this.addRidge({ radius: 108, segments: 42, low: 18, high: 44, color: 0x29384e, jaggedness: 0.9 });
    this.addRidge({ radius: 86, segments: 48, low: 10, high: 25, color: 0x233340, jaggedness: 0.65 });
    this.addMoon(new THREE.Vector3(-104, 92, -120), 12, 0xe5edff, 0.76);
    this.buildAurora();
    this.addHorizonLights(26, 84, 111, 0xffd469, 0.36);
  }

  private buildAurora(): void {
    const colors = [0x69ffd2, 0x8faaff, 0xc280ff];
    colors.forEach((color, index) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const width = 74 - index * 10;
      const shape = new THREE.PlaneGeometry(width, 17 + index * 3, 12, 1);
      const positions = shape.getAttribute('position') as THREE.BufferAttribute;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex);
        positions.setY(vertex, positions.getY(vertex) + Math.sin(x * 0.12 + index * 1.7) * 5);
      }
      positions.needsUpdate = true;
      const ribbon = new THREE.Mesh(shape, material);
      const angle = -0.7 + index * 1.85;
      ribbon.position.set(Math.sin(angle) * 165, 74 + index * 6, Math.cos(angle) * 165);
      ribbon.lookAt(0, ribbon.position.y - 9, 0);
      ribbon.renderOrder = -500;
      ribbon.name = 'indigo-aurora-ribbon';
      this.auroraMaterials.push(material);
      this.group.add(ribbon);
    });
  }

  private addRidge(options: RidgeOptions): void {
    const { radius, segments, low, high, color, base = -8, opacity = 1, jaggedness = 0.7 } = options;
    const positions: number[] = [];
    const indices: number[] = [];
    let previousHeight = low + this.random() * (high - low);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const target = low + this.random() * (high - low);
      const height = THREE.MathUtils.lerp(previousHeight, target, jaggedness);
      previousHeight = height;
      positions.push(Math.cos(angle) * radius, base, Math.sin(angle) * radius);
      positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      if (i < segments) {
        const vertex = i * 2;
        indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const ridge = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      fog: false,
    }));
    ridge.name = 'faceted-horizon-ridge';
    this.group.add(ridge);
  }

  private addMoon(position: THREE.Vector3, size: number, color: number, opacity: number): void {
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(size, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false }),
    );
    moon.position.copy(position);
    moon.lookAt(0, position.y * 0.25, 0);
    moon.name = 'low-poly-moon';
    moon.renderOrder = -700;
    this.group.add(moon);
  }

  private addHorizonLights(count: number, inner: number, outer: number, color: number, chance: number): void {
    const geometry = new THREE.OctahedronGeometry(0.32, 0);
    const material = new THREE.MeshBasicMaterial({ color, fog: false });
    const lights = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.12;
      const radius = inner + this.random() * (outer - inner);
      const visible = this.random() < chance;
      dummy.position.set(Math.cos(angle) * radius, 5 + this.random() * 13, Math.sin(angle) * radius);
      dummy.scale.setScalar(visible ? 0.7 + this.random() : 0.001);
      dummy.updateMatrix();
      lights.setMatrixAt(i, dummy.matrix);
    }
    lights.instanceMatrix.needsUpdate = true;
    lights.name = 'distant-venue-lights';
    this.group.add(lights);
  }

  private hash(value: string): number {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  private seededRandom(seed: number): () => number {
    let state = seed || 1;
    return () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
  }
}
