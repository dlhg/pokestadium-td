import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './title-screen.css';

interface StadiumManifest {
  extra?: Array<{ slug: string; glb: string }>;
}

interface TitleScreenOptions {
  /** Hold the complete intro on its last frame for visual regression shots. */
  settled?: boolean;
}

const LOGO_SLUG = 'x214_model';

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly fallback: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly previousInert = new Map<HTMLElement, boolean>();
  private mixer: THREE.AnimationMixer | null = null;
  private logo: THREE.Object3D | null = null;
  private logoSize: THREE.Vector3 | null = null;
  private frame = 0;
  private closing = false;

  constructor(container: HTMLElement, options: TitleScreenOptions = {}) {
    this.root = document.createElement('section');
    this.root.id = 'title-screen';
    this.root.className = 'interactive';
    this.root.setAttribute('aria-labelledby', 'title-screen-name');
    this.root.innerHTML = `
      <div class="title-screen__sky" aria-hidden="true"></div>
      <div class="title-screen__grid" aria-hidden="true"></div>
      <div class="title-screen__content">
        <h1 id="title-screen-name" class="title-screen__accessible-name">Pokémon Stadium Tower Defense</h1>
        <div class="title-screen__logo-stage">
          <canvas class="title-screen__model" aria-hidden="true"></canvas>
          <div class="title-screen__fallback" aria-hidden="true">
            <span class="title-screen__pokemon">POKéMON</span>
            <span class="title-screen__stadium">STADIUM</span>
          </div>
        </div>
        <img class="title-screen__wordmark" src="/ui/tower-defense-wordmark.png" alt="Tower Defense" />
        <button class="title-screen__start" type="button"><span>Press Start</span></button>
        <p class="title-screen__credit">A fan-made tower defense experiment</p>
      </div>
    `;

    this.canvas = this.requireElement<HTMLCanvasElement>('.title-screen__model');
    this.fallback = this.requireElement<HTMLElement>('.title-screen__fallback');
    const startButton = this.requireElement<HTMLButtonElement>('.title-screen__start');

    for (const child of Array.from(container.children)) {
      if (!(child instanceof HTMLElement)) continue;
      this.previousInert.set(child, child.inert);
      child.inert = true;
    }
    container.appendChild(this.root);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x251323, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-3, 5, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x527dff, 2.5);
    rim.position.set(5, 1, -4);
    this.scene.add(rim);

    startButton.addEventListener('click', this.dismiss);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();
    this.frame = requestAnimationFrame(this.render);
    void this.loadLogo(options.settled ?? false);
    startButton.focus({ preventScroll: true });
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing title screen element: ${selector}`);
    return element;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Enter' && event.code !== 'Space') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dismiss();
  };

  private readonly dismiss = (): void => {
    if (this.closing) return;
    this.closing = true;
    this.root.classList.add('title-screen--leaving');

    window.setTimeout(() => {
      window.removeEventListener('keydown', this.onKeyDown, true);
      this.resizeObserver.disconnect();
      cancelAnimationFrame(this.frame);
      this.clock.stop();
      this.disposeLogo();
      this.renderer.dispose();
      for (const [element, inert] of this.previousInert) element.inert = inert;
      this.root.remove();

      document.querySelector<HTMLElement>(
        '#trainer-screen:not([hidden]) button, #map-select:not([hidden]) button:not([disabled])',
      )?.focus({ preventScroll: true });
    }, 480);
  };

  private async loadLogo(settled: boolean): Promise<void> {
    try {
      const response = await fetch('/generated/stadium/manifest.json');
      if (!response.ok) throw new Error(`manifest returned ${response.status}`);
      const manifest = (await response.json()) as StadiumManifest;
      const entry = manifest.extra?.find((model) => model.slug === LOGO_SLUG);
      if (!entry) throw new Error(`${LOGO_SLUG} is not present in the local asset manifest`);

      const gltf = await new GLTFLoader().loadAsync(`/generated/stadium/${entry.glb}`);
      if (this.closing) {
        this.disposeObject(gltf.scene);
        return;
      }

      this.logo = gltf.scene;
      this.scene.add(this.logo);
      this.prepareMaterials(this.logo);
      // Establish the camera once. Recentring the skinned scene each frame
      // feeds its own transforms back into the bounds and fights the intro.
      this.centerAndFrameLogo();

      const clip = gltf.animations[0];
      if (clip) {
        this.mixer = new THREE.AnimationMixer(this.logo);
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.reset().play();
        if (settled) {
          this.mixer.setTime(clip.duration);
          action.paused = true;
        }
      }

      this.clock.start();
      this.renderer.render(this.scene, this.camera);
      this.canvas.classList.add('title-screen__model--loaded');
    } catch (error) {
      if (this.closing) return;
      this.disposeLogo();
      this.fallback.classList.add('title-screen__fallback--visible');
      console.info('[TitleScreen] Using the built-in logo fallback:', error);
    }
  }

  private prepareMaterials(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if ('map' in material && material.map instanceof THREE.Texture) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.magFilter = THREE.NearestFilter;
          material.map.minFilter = THREE.NearestMipmapNearestFilter;
        }
      }
    });
  }

  private centerAndFrameLogo(): void {
    if (!this.logo) return;
    this.logo.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.logo);
    if (box.isEmpty()) return;
    this.logo.position.sub(box.getCenter(new THREE.Vector3()));
    this.logo.updateMatrixWorld(true);
    this.logoSize = box.getSize(new THREE.Vector3());
    this.frameLogo();
  }

  private frameLogo(): void {
    if (!this.logoSize) return;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const heightDistance = this.logoSize.y * 0.5 / Math.tan(halfFov);
    const widthDistance = this.logoSize.x * 0.5 / (Math.tan(halfFov) * this.camera.aspect);
    const distance = Math.max(heightDistance, widthDistance) * 1.08 + this.logoSize.z * 0.5;
    this.camera.position.set(0, 0, Math.max(distance, 0.25));
    this.camera.near = Math.max(distance / 100, 0.001);
    this.camera.far = Math.max(distance * 10, 100);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameLogo();
  };

  private readonly render = (): void => {
    this.frame = requestAnimationFrame(this.render);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.mixer?.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private disposeLogo(): void {
    if (!this.logo) return;
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.logo);
    this.disposeObject(this.logo);
    this.scene.remove(this.logo);
    this.logo = null;
    this.mixer = null;
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }
}
