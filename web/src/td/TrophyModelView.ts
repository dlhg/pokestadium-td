/**
 * TrophyModelView.ts — the catch card's little 3D stage.
 *
 * Owns one small transparent WebGL canvas that is reused for every catch:
 * the new roster Pokémon plays its Stadium send-out ("entrance") clip, then
 * settles into its idle loop on a slow turntable sway.
 */

import * as THREE from 'three';
import { AnimatedPokemon, PokemonAnimationState, PokemonModelFactory } from '../stadium/PokemonModels';

const MODEL_HEIGHT = 2.2;

export class TrophyModelView {
  public readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private pivot = new THREE.Group();
  private pokemon: AnimatedPokemon | null = null;
  private generation = 0;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private entranceEnds = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'trophy-canvas';

    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1a2a44, 1.5));
    const key = new THREE.DirectionalLight(0xfff3db, 2.2);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xf6c437, 1.4);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);
    this.scene.add(this.pivot);
    this.frameCamera(MODEL_HEIGHT);
  }

  /** Loads the species onto the stage and starts the entrance → idle loop. */
  public show(name: string, fallback: () => AnimatedPokemon): void {
    this.clearModel();
    const generation = ++this.generation;
    this.start();
    PokemonModelFactory.loadAuthenticModel(name.toLowerCase(), MODEL_HEIGHT, fallback).then((loaded) => {
      if (generation !== this.generation) return;
      this.pokemon = loaded;
      this.pivot.add(loaded.mesh);
      this.frameCamera(new THREE.Box3().setFromObject(loaded.mesh).getSize(new THREE.Vector3()).y || MODEL_HEIGHT);
      this.elapsed = 0;
      const entrance = loaded.actions?.entrance;
      this.entranceEnds = entrance ? entrance.getClip().duration : 0;
      loaded.update(0, 0, entrance ? 'entrance' : 'idle');
    });
  }

  public hide(): void {
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clearModel();
  }

  private start(): void {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    if (this.frame) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      this.render(Math.min((now - this.lastTime) / 1000, 0.1));
      this.lastTime = now;
    };
    this.frame = requestAnimationFrame(tick);
  }

  private render(dt: number): void {
    const renderer = this.renderer!;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (this.pokemon) {
      this.elapsed += dt;
      const state: PokemonAnimationState = this.elapsed < this.entranceEnds ? 'entrance' : 'idle';
      this.pokemon.update(this.elapsed, dt, state);
      // Face the viewer through the send-out, then a gentle showcase sway.
      const sway = Math.max(0, this.elapsed - this.entranceEnds);
      this.pivot.rotation.y = Math.sin(sway * 0.9) * 0.45 * Math.min(1, sway);
    }
    renderer.render(this.scene, this.camera);
  }

  private frameCamera(height: number): void {
    const distance = (height * 0.62) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(0, height * 0.62, distance);
    this.camera.lookAt(0, height * 0.48, 0);
  }

  private clearModel(): void {
    if (this.pokemon) {
      this.pokemon.mixer?.stopAllAction();
      this.pivot.remove(this.pokemon.mesh);
    }
    this.pokemon = null;
    this.pivot.rotation.y = 0;
  }
}
