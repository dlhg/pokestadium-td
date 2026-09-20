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

// The intro clip parks the logo small, well under the weight of the Tower
// Defense wordmark below it. Once it lands, punch the logo up to fill the room
// above the wordmark with a cartoon squash-and-stretch, so the two titles read
// as one lockup instead of a caption over a banner.
const PUNCH_HOLD = 0.16;
const PUNCH_DURATION = 0.86;
const PUNCH_MAX_SCALE = 3.4;
const PUNCH_ANTICIPATION = 0.22;
const PUNCH_ANTICIPATION_DEPTH = 0.08;
const PUNCH_OVERSHOOT = 1.45;
const PUNCH_WOBBLE = 0.2;
const PUNCH_WOBBLE_CYCLES = 1.67;
const PUNCH_WOBBLE_DECAY = 1.5;
const PUNCH_CROUCH_WOBBLE = 0.3;
/** How much of the width's wobble the height gives back. */
const PUNCH_SQUASH_BALANCE = 0.88;
/** How wide the logo may grow relative to the wordmark under it. */
const PUNCH_WORDMARK_MATCH = 1.02;
const PUNCH_STAGE_MARGIN = 0.94;
const PUNCH_BAND_MARGIN = 0.96;
const PUNCH_WORDMARK_GAP = 10;
/** Off-screen resolution used to measure the drawn logo. */
const PUNCH_MEASURE_WIDTH = 320;
const PUNCH_MEASURE_ALPHA = 16;
const PUNCH_FIT_PASSES = 3;

const _punchOffset = new THREE.Vector3();

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly fallback: HTMLElement;
  private readonly wordmark: HTMLImageElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly previousInert = new Map<HTMLElement, boolean>();
  private readonly logoPivot = new THREE.Group();
  private readonly punchOffset = new THREE.Vector3();
  private mixer: THREE.AnimationMixer | null = null;
  private logo: THREE.Object3D | null = null;
  private logoSize: THREE.Vector3 | null = null;
  private punchScale = 1;
  private punchElapsed: number | null = null;
  private punchLanded = false;
  private measureTarget: THREE.WebGLRenderTarget | null = null;
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
    this.wordmark = this.requireElement<HTMLImageElement>('.title-screen__wordmark');
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
    // The punch is measured against the wordmark, so a late-loading image has
    // to be re-fitted against.
    this.wordmark.addEventListener('load', this.refit);
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
      this.logoPivot.add(this.logo);
      this.scene.add(this.logoPivot);
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
          this.landIntro(true);
        } else {
          this.mixer.addEventListener('finished', this.onIntroFinished);
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

  private readonly onIntroFinished = (): void => {
    this.landIntro(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  };

  /** Size the landed logo against the wordmark, then punch it up to match. */
  private landIntro(instant: boolean): void {
    if (this.punchLanded || !this.logo) return;
    this.punchLanded = true;
    this.fitLogoToWordmark();
    if (instant || (this.punchScale <= 1.001 && this.punchOffset.lengthSq() < 1e-6)) {
      this.settlePunch();
      return;
    }
    this.punchElapsed = 0;
  }

  /**
   * Solve for the scale and offset that seat the logo in the gap above the
   * wordmark, by measuring what the renderer actually draws. The intro's
   * skinned pose leaves bones parked far outside the visible letters, so scene
   * bounds describe a box several times the logo you can see.
   */
  private fitLogoToWordmark(): void {
    const stage = this.canvas.getBoundingClientRect();
    const wordmark = this.wordmark.getBoundingClientRect();
    if (stage.width < 1 || stage.height < 1) return;

    const bandBottom = Math.min(stage.bottom, wordmark.top - PUNCH_WORDMARK_GAP);
    const maxHeight = Math.max((bandBottom - stage.top) * PUNCH_BAND_MARGIN, stage.height * 0.25);
    const maxWidth = Math.min(stage.width * PUNCH_STAGE_MARGIN, wordmark.width * PUNCH_WORDMARK_MATCH);
    const targetX = stage.width * 0.5;
    const targetY = (bandBottom - stage.top) * 0.5;
    const worldPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * this.camera.position.z) / stage.height;

    let scale = 1;
    const offset = new THREE.Vector3();
    for (let pass = 0; pass < PUNCH_FIT_PASSES; pass++) {
      this.applyPunchTransform(scale, scale, scale, offset);
      const drawn = this.measureDrawnLogo(stage.width, stage.height);
      if (!drawn) {
        scale = 1;
        offset.set(0, 0, 0);
        break;
      }
      scale = THREE.MathUtils.clamp(
        scale * Math.min(maxWidth / drawn.width, maxHeight / drawn.height),
        1,
        PUNCH_MAX_SCALE,
      );
      offset.x += (targetX - drawn.centerX) * worldPerPixel;
      offset.y += (drawn.centerY - targetY) * worldPerPixel;
    }

    this.punchScale = scale;
    this.punchOffset.copy(offset);
    this.applyPunch(0, 0);
  }

  /** Bounding box of the drawn pixels, in stage CSS pixels, or null if blank. */
  private measureDrawnLogo(
    cssWidth: number,
    cssHeight: number,
  ): { width: number; height: number; centerX: number; centerY: number } | null {
    const width = PUNCH_MEASURE_WIDTH;
    const height = Math.max(8, Math.round((width * cssHeight) / cssWidth));
    if (!this.measureTarget) this.measureTarget = new THREE.WebGLRenderTarget(width, height);
    else this.measureTarget.setSize(width, height);

    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.measureTarget);
    this.renderer.render(this.scene, this.camera);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.measureTarget, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(previous);

    let minX = width;
    let maxX = -1;
    let minRow = height;
    let maxRow = -1;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        if (pixels[(row * width + column) * 4 + 3] < PUNCH_MEASURE_ALPHA) continue;
        if (column < minX) minX = column;
        if (column > maxX) maxX = column;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }
    if (maxX < 0) return null;

    // readRenderTargetPixels hands back rows bottom-up.
    const scaleX = cssWidth / width;
    const scaleY = cssHeight / height;
    const top = (height - 1 - maxRow) * scaleY;
    const bottom = (height - minRow) * scaleY;
    return {
      width: Math.max((maxX + 1 - minX) * scaleX, scaleX),
      height: Math.max(bottom - top, scaleY),
      centerX: (minX + maxX + 1) * 0.5 * scaleX,
      centerY: (top + bottom) * 0.5,
    };
  }

  private updatePunch(delta: number): void {
    if (this.punchElapsed === null) return;
    this.punchElapsed += delta;
    const progress = (this.punchElapsed - PUNCH_HOLD) / PUNCH_DURATION;
    if (progress <= 0) return;
    if (progress >= 1) {
      this.settlePunch();
      return;
    }
    this.applyPunch(this.punchCurve(progress), this.punchWobble(progress));
  }

  /** Dip back, then overshoot: a cartoon anticipation beat before the pop. */
  private punchCurve(progress: number): number {
    if (progress < PUNCH_ANTICIPATION) {
      const t = progress / PUNCH_ANTICIPATION;
      return -PUNCH_ANTICIPATION_DEPTH * (0.5 - Math.cos(Math.PI * t) * 0.5);
    }
    const t = (progress - PUNCH_ANTICIPATION) / (1 - PUNCH_ANTICIPATION) - 1;
    const back = 1 + (PUNCH_OVERSHOOT + 1) * t * t * t + PUNCH_OVERSHOOT * t * t;
    return -PUNCH_ANTICIPATION_DEPTH + (1 + PUNCH_ANTICIPATION_DEPTH) * back;
  }

  /**
   * Width against height: a flattened crouch, a tall stretch as the logo rushes
   * out, a wide splat as it lands, then the jiggle dying off into the pose.
   */
  private punchWobble(progress: number): number {
    if (progress < PUNCH_ANTICIPATION) {
      return PUNCH_WOBBLE * PUNCH_CROUCH_WOBBLE * Math.sin((Math.PI * progress) / PUNCH_ANTICIPATION);
    }
    const t = progress - PUNCH_ANTICIPATION;
    return (
      -PUNCH_WOBBLE *
      Math.sin(Math.PI * 2 * PUNCH_WOBBLE_CYCLES * t) *
      Math.exp(-PUNCH_WOBBLE_DECAY * t) *
      Math.pow(1 - progress, 0.6)
    );
  }

  private settlePunch(): void {
    this.punchElapsed = null;
    this.applyPunch(1, 0);
    this.measureTarget?.dispose();
    this.measureTarget = null;
  }

  private applyPunch(growth: number, wobble: number): void {
    const scale = 1 + (this.punchScale - 1) * growth;
    _punchOffset.copy(this.punchOffset).multiplyScalar(growth);
    this.applyPunchTransform(
      scale * (1 + wobble),
      scale * (1 - wobble * PUNCH_SQUASH_BALANCE),
      scale,
      _punchOffset,
    );
  }

  private applyPunchTransform(x: number, y: number, z: number, offset: THREE.Vector3): void {
    this.logoPivot.scale.set(x, y, z);
    this.logoPivot.position.copy(offset);
    this.logoPivot.updateMatrixWorld(true);
  }

  private readonly refit = (): void => {
    if (!this.logo || this.closing || !this.punchLanded || this.punchElapsed !== null) return;
    this.fitLogoToWordmark();
    this.settlePunch();
  };

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameLogo();
    // A new stage size changes how much room the punched-up logo has.
    this.refit();
  };

  private readonly render = (): void => {
    this.frame = requestAnimationFrame(this.render);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.mixer?.update(delta);
    this.updatePunch(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private disposeLogo(): void {
    if (!this.logo) return;
    this.mixer?.removeEventListener('finished', this.onIntroFinished);
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.logo);
    this.disposeObject(this.logo);
    this.logoPivot.remove(this.logo);
    this.scene.remove(this.logoPivot);
    this.logo = null;
    this.mixer = null;
    this.punchElapsed = null;
    this.measureTarget?.dispose();
    this.measureTarget = null;
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
