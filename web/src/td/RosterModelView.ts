/**
 * A tiny animated Stadium-model stage embedded in one roster card.
 *
 * Every card gets a cheap 2D canvas. A single hidden WebGL renderer draws the
 * registered stages into those canvases in turn, avoiding browser WebGL
 * context limits as captures expand the roster.
 */
import * as THREE from 'three';
import { AnimatedPokemon, PokemonModelFactory } from '../stadium/PokemonModels';

const MODEL_HEIGHT = 2;

export class RosterModelView {
  private static views = new Set<RosterModelView>();
  private static renderer: THREE.WebGLRenderer | null = null;
  private static frame = 0;
  private static lastTime = 0;

  public readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
  private cameraTarget = new THREE.Vector3();
  private pivot = new THREE.Group();
  private pokemon: AnimatedPokemon | null = null;
  private generation = 0;
  private elapsed = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roster-model-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Roster portrait canvas is unavailable');
    this.context = context;

    this.scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x17214c, 2.25));
    const key = new THREE.DirectionalLight(0xfff2cc, 2.7);
    key.position.set(3, 5, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8eb7ff, 1.8);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);
    this.scene.add(this.pivot);
    this.frameCamera(new THREE.Box3(
      new THREE.Vector3(-MODEL_HEIGHT * .5, 0, -MODEL_HEIGHT * .5),
      new THREE.Vector3(MODEL_HEIGHT * .5, MODEL_HEIGHT, MODEL_HEIGHT * .5),
    ));

    RosterModelView.views.add(this);
    RosterModelView.start();
  }

  public show(name: string, fallback: () => AnimatedPokemon): void {
    const generation = ++this.generation;
    PokemonModelFactory.loadAuthenticModel(name.toLowerCase(), MODEL_HEIGHT, fallback).then((loaded) => {
      if (generation !== this.generation) return;
      this.pokemon = loaded;
      this.pivot.add(loaded.mesh);
      loaded.update(0, 0, 'idle');
      loaded.mesh.updateMatrixWorld(true);
      this.frameCamera(new THREE.Box3().setFromObject(loaded.mesh, true));
    });
  }

  public destroy(): void {
    this.generation++;
    this.pokemon?.mixer?.stopAllAction();
    if (this.pokemon) this.pivot.remove(this.pokemon.mesh);
    this.pokemon = null;
    RosterModelView.views.delete(this);
    if (!RosterModelView.views.size) {
      // Callers rebuild card grids by destroying every view then immediately
      // creating fresh ones in the same tick. Tearing the shared renderer
      // down synchronously here would dispose it only to allocate a new
      // WebGL context moments later — `dispose()` doesn't call
      // `forceContextLoss()`, so the abandoned context lingers until GC and
      // repeated rebuilds can exhaust the browser's context limit, evicting
      // the main game renderer. Deferring the check lets same-tick rebuilds
      // see the new views before deciding the stage is really empty.
      queueMicrotask(() => {
        if (!RosterModelView.views.size) RosterModelView.stop();
      });
    }
  }

  private static start(): void {
    if (!this.renderer) {
      const surface = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas: surface, alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    }
    if (this.frame) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min((now - this.lastTime) / 1000, .1);
      this.lastTime = now;
      for (const view of this.views) view.render(dt, this.renderer!);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private static stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private render(dt: number, renderer: THREE.WebGLRenderer): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio, 1.5);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (this.pokemon) {
      this.elapsed += dt;
      this.pokemon.update(this.elapsed, dt, 'idle');
      this.pivot.rotation.y = Math.sin(this.elapsed * .9) * .16;
      this.pivot.position.y = Math.sin(this.elapsed * 1.7) * .025;
    }

    renderer.setSize(pixelWidth, pixelHeight, false);
    renderer.render(this.scene, this.camera);
    this.context.clearRect(0, 0, pixelWidth, pixelHeight);
    this.context.drawImage(renderer.domElement, 0, 0, pixelWidth, pixelHeight);
  }

  private frameCamera(bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const height = size.y || MODEL_HEIGHT;
    const width = Math.max(size.x, size.z);
    const framingHeight = Math.max(height, width / Math.max(this.camera.aspect, .01)) * 1.14;
    const distance = (framingHeight * .58) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.cameraTarget.copy(center);
    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.lookAt(this.cameraTarget);
  }
}
