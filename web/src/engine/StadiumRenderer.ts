/**
 * StadiumRenderer.ts — Authentic N64 3D Stadium Rendering Pipeline
 *
 * Sets up Three.js with colosseum lighting, directional shadows,
 * stadium floodlights, atmospheric arena fog, and 3D-to-2D projection.
 */

import * as THREE from 'three';
import { RetroFX } from './RetroFX';

export class StadiumRenderer {
  public canvas: HTMLCanvasElement;
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public floodlights: THREE.SpotLight[] = [];
  public floodlightTargets: THREE.Object3D[] = [];
  public width: number = 0;
  public height: number = 0;
  /** Scanlines, colour depth, CRT glass and other display effects. */
  public retro: RetroFX;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040c1a);
    const fog = new THREE.FogExp2(0x040c1a, 0.008);
    this.scene.fog = fog;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    this.initLighting();
    this.retro = new RetroFX(this.renderer, this.scene, fog.density);
  }

  private handleResize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
  }

  private initLighting(): void {
    // Ambient colosseum night sky fill
    const ambient = new THREE.AmbientLight(0x28426b, 1.2);
    this.scene.add(ambient);

    // Primary stadium overhead light
    const dirLight = new THREE.DirectionalLight(0xfff3db, 1.6);
    dirLight.position.set(20, 45, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 120;
    const d = 35;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Secondary colosseum rim light
    const rimLight = new THREE.DirectionalLight(0x4098d7, 0.9);
    rimLight.position.set(-25, 25, -25);
    this.scene.add(rimLight);

    // 4 Stadium Tower Floodlights (NW, NE, SW, SE)
    const corners = [
      { x: -28, z: -28, color: 0x00f0ff },
      { x: 28, z: -28, color: 0xffd700 },
      { x: 28, z: 28, color: 0x00f0ff },
      { x: -28, z: 28, color: 0xff4060 },
    ];

    corners.forEach(c => {
      const spot = new THREE.SpotLight(c.color, 1.8);
      spot.position.set(c.x, 32, c.z);
      spot.angle = Math.PI / 4.5;
      spot.penumbra = 0.55;
      spot.decay = 1.2;
      spot.distance = 90;
      spot.castShadow = true;
      spot.shadow.mapSize.width = 1024;
      spot.shadow.mapSize.height = 1024;

      const target = new THREE.Object3D();
      target.position.set(c.x * 0.2, 0, c.z * 0.2);
      this.scene.add(target);
      spot.target = target;

      this.scene.add(spot);
      this.floodlights.push(spot);
      this.floodlightTargets.push(target);
    });
  }

  /** 0 = full house lights, 1 = blackout. Set by set pieces that want a single spot. */
  public floodlightDim: number = 0;

  public update(dt: number, battleIntensity: number): void {
    // Subtle breathing/pulsing animation for stadium floodlights
    const time = performance.now() * 0.001;
    const dim = 1 - Math.min(1, Math.max(0, this.floodlightDim));
    this.floodlights.forEach((spot, idx) => {
      const baseIntensity = 1.8 + (battleIntensity * 1.2);
      spot.intensity = (baseIntensity + Math.sin(time * 2 + idx) * 0.3) * dim;
    });
  }

  public render(camera: THREE.Camera): void {
    this.retro.render(camera);
  }

  /**
   * Project a 3D world position into 2D viewport coordinates
   * Used for floating HP bars, damage numbers, and UI tags.
   */
  public toScreenXY(position: THREE.Vector3, camera: THREE.Camera): { x: number; y: number; visible: boolean } {
    const p = position.clone();
    p.project(camera);

    // If point is behind the camera near plane
    const visible = p.z < 1.0 && p.z > -1.0;

    const x = (p.x * 0.5 + 0.5) * this.width;
    const y = (-(p.y * 0.5) + 0.5) * this.height;

    return { x, y, visible };
  }
}
