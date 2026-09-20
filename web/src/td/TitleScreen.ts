import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WORDMARK_TEXEL_COLUMNS, WordmarkCover } from './WordmarkCover';
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

// The intro rains Pokemon out of the logo down onto the wordmark. Rather than
// hard-coding the clip's landing times, watch the bones that actually fall and
// fire on the frame each one reverses from a descent while it is down at the
// wordmark. Every landing jolts the lockup; the clip's finale drops three at
// once, and the pile-up is what drives the wordmark itself down.

/** A faller's Y track has to cover this much of the widest one in the clip. */
const IMPACT_SPAN_FRACTION = 0.4;
/** Stage px/s of descent under which a reversal is a settle, not a landing. */
const IMPACT_MIN_SPEED = 120;
/**
 * A Pokemon standing on the letters projects its origin into the art's top
 * half. Higher than that and it is still in the air over the text; lower and it
 * has fallen past the lockup altogether, which is how the whole cast exits at
 * the end of the clip -- at 1900-2300 px/s, an order above any real landing.
 */
const IMPACT_BAND = 0.5;
/** Keeps one faller's landing from registering twice on noisy frames. */
const IMPACT_COOLDOWN = 0.1;

/**
 * A landing's jolt carries its energy, so the speed counts twice. That is also
 * what separates the clip's two acts without naming either: the Pokemon
 * bouncing around mid-sequence come down at 140-555 stage px/s and land one at
 * a time, the finale's three at 560-675 and together. Squaring, then stacking
 * what arrives inside the decay, turns that into 15 against 50.
 */
const JOLT_PER_ENERGY = 4.6e-5;
const JOLT_DECAY = 6.5;
/** Below this the jolt is snapped away, so a finished intro holds still. */
const JOLT_REST = 0.4;

const SHAKE_MAX = 12;
/**
 * How quickly the jolt saturates towards that ceiling, kept well above it so
 * the curve still has somewhere to go. Tied to the ceiling instead, the single
 * landings came out at two thirds of the finale's throw and the two acts
 * stopped reading as different sizes.
 */
const SHAKE_KNEE = 30;
/** Impacts are vertical, so the sideways component stays a fraction of it. */
const SHAKE_SIDEWAYS = 0.34;
/** Slow enough that 60Hz still has five samples to draw each cycle with. */
const SHAKE_FREQUENCY = 12;

/**
 * Jolt past which the wordmark stops riding it out and gives. The Pokemon
 * bouncing around on their own top out near 15; the finale stacks three inside
 * a couple of frames and runs to 50. None of the clip's times are written down
 * anywhere -- the pile-up is what the threshold is picking out.
 */
const KNOCK_THRESHOLD = 24;
const KNOCK_PER_JOLT = 2;
/**
 * The drop is measured in the wordmark's own texels rather than CSS pixels, and
 * quantised to them on the way out: the art is baked to a texel grid and blown
 * back up with `image-rendering: pixelated`, so a fractional offset would
 * resample the very edges the bake exists to keep hard. Three texels reads as
 * the letters taking the hit without the element looking like it slid.
 */
const KNOCK_MAX_TEXELS = 3;
/**
 * Slack enough to hold the text down for about a third of a second before it
 * rides back up. Stiffer than this and the drop is over in four frames, which
 * registers as a flicker rather than as the letters taking a hit.
 */
const KNOCK_STIFFNESS = 90;
const KNOCK_DAMPING = 11;
const KNOCK_REST = 0.04;

const TAU = Math.PI * 2;

const _punchOffset = new THREE.Vector3();
const _probe = new THREE.Vector3();

interface Faller {
  readonly object: THREE.Object3D;
  /** Stage-relative screen Y last frame, or null before the first sample. */
  previous: number | null;
  /** Fastest descent seen so far in the current fall, in stage px/s. */
  peak: number;
  cooldown: number;
}

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
  private readonly content: HTMLElement;
  private readonly wordmarkStage: HTMLElement;
  private readonly cover: WordmarkCover;
  private readonly fallers: Faller[] = [];
  private readonly reducedMotion: boolean;
  private jolt = 0;
  private joltPhase = 0;
  private knock = 0;
  private knockVelocity = 0;
  /** Wordmark's contact band and the stage's box, in stage CSS pixels. */
  private impactLine = Infinity;
  private impactDepth = 0;
  private impactLeft = 0;
  private impactWidth = 1;
  private stageHeight = 0;
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
        <div class="title-screen__wordmark-stage">
          <img class="title-screen__wordmark" src="/ui/tower-defense-wordmark.png" alt="Tower Defense" />
          <canvas class="title-screen__wordmark-cover" aria-hidden="true"></canvas>
        </div>
        <button class="title-screen__start" type="button"><span>Start</span></button>
        <p class="title-screen__credit">A fan-made tower defense experiment</p>
      </div>
    `;

    this.canvas = this.requireElement<HTMLCanvasElement>('.title-screen__model');
    this.fallback = this.requireElement<HTMLElement>('.title-screen__fallback');
    this.wordmark = this.requireElement<HTMLImageElement>('.title-screen__wordmark');
    this.content = this.requireElement<HTMLElement>('.title-screen__content');
    this.wordmarkStage = this.requireElement<HTMLElement>('.title-screen__wordmark-stage');
    this.cover = new WordmarkCover(
      this.requireElement<HTMLCanvasElement>('.title-screen__wordmark-cover'),
      this.wordmark,
    );
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Everything that would break the cast off is motion. Without it the stone
    // would simply sit there, so the wordmark starts uncovered instead.
    if (this.reducedMotion) this.cover.reveal();
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
      this.content.style.transform = '';
      this.wordmarkStage.style.transform = '';
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
        this.collectFallers(clip);
        this.mixer = new THREE.AnimationMixer(this.logo);
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.reset().play();
        if (settled) {
          this.mixer.setTime(clip.duration);
          action.paused = true;
          // A held frame skips every landing, so nothing would ever break.
          this.cover.reveal();
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
      // No logo means no Pokemon to fall out of it and break the cast.
      this.cover.reveal();
      this.fallback.classList.add('title-screen__fallback--visible');
      console.info('[TitleScreen] Using the built-in logo fallback:', error);
    }
  }

  /**
   * Pick out the bones the intro actually drops. Every bone in the clip carries
   * a position track, but the Pokemon that fall out of the logo travel an order
   * of magnitude further down it than the letters do, so the widest Y spans in
   * the clip name themselves without any hard-coded bone list.
   */
  private collectFallers(clip: THREE.AnimationClip): void {
    const spans: Array<{ name: string; span: number }> = [];
    for (const track of clip.tracks) {
      if (!(track instanceof THREE.VectorKeyframeTrack) || !track.name.endsWith('.position')) continue;
      let low = Infinity;
      let high = -Infinity;
      for (let i = 1; i < track.values.length; i += 3) {
        const y = track.values[i];
        if (y < low) low = y;
        if (y > high) high = y;
      }
      if (high > low) spans.push({ name: track.name.slice(0, -'.position'.length), span: high - low });
    }
    if (!spans.length) return;

    const widest = spans.reduce((best, entry) => Math.max(best, entry.span), 0);
    for (const entry of spans) {
      if (entry.span < widest * IMPACT_SPAN_FRACTION) continue;
      const object = this.logo?.getObjectByName(entry.name);
      if (object) this.fallers.push({ object, previous: null, peak: 0, cooldown: 0 });
    }
  }

  /** Where the wordmark's contact band sits, in the stage's own CSS pixels. */
  private measureImpactLine(): void {
    const stage = this.canvas.getBoundingClientRect();
    const wordmark = this.wordmark.getBoundingClientRect();
    this.stageHeight = stage.height;
    // The shake moves stage and wordmark together, so it cancels; the knock
    // moves only the wordmark and has to come back out.
    this.impactLine = wordmark.height > 0 ? wordmark.top - this.knock - stage.top : Infinity;
    this.impactDepth = wordmark.height * IMPACT_BAND;
    this.impactLeft = wordmark.left - stage.left;
    this.impactWidth = Math.max(1, wordmark.width);
    this.cover.resize();
  }

  /**
   * Fire an impact on the frame a faller stops descending while it is down at
   * the wordmark. A bounce and a dead stop both read as the descent ending,
   * which is what makes this work for the clip's bouncing middle as well as
   * its finale.
   *
   * The landing is rated by the fastest frame of the whole descent rather than
   * the last one before the reversal. Differencing a single frame across the
   * turn puts the answer at the mercy of where the frame boundary happened to
   * fall, which moved measured speeds by up to 2x between runs -- and the jolt
   * squares that.
   */
  private updateImpacts(delta: number): void {
    // Landings belong to the intro. Once it has handed over, the cast is on its
    // way out of frame and the punch is throwing the logo around.
    if (!this.fallers.length || delta <= 0 || this.punchLanded) return;
    for (const faller of this.fallers) {
      faller.cooldown = Math.max(0, faller.cooldown - delta);
      _probe.setFromMatrixPosition(faller.object.matrixWorld).project(this.camera);
      const y = (1 - _probe.y) * 0.5 * this.stageHeight;
      const x = (_probe.x + 1) * 0.5 * this.canvas.clientWidth;
      if (faller.previous !== null) {
        const descent = (y - faller.previous) / delta;
        if (descent > 0) {
          faller.peak = Math.max(faller.peak, descent);
        } else {
          const onTheLetters = y >= this.impactLine && y <= this.impactLine + this.impactDepth;
          if (faller.peak > IMPACT_MIN_SPEED && !faller.cooldown && onTheLetters) {
            this.land(faller.peak, (x - this.impactLeft) / this.impactWidth);
            faller.cooldown = IMPACT_COOLDOWN;
          }
          faller.peak = 0;
        }
      }
      faller.previous = y;
    }
  }

  /** One Pokemon touching down: jolt the lockup, crack the cast, stack up to a knock. */
  private land(speed: number, where: number): void {
    this.jolt += speed * speed * JOLT_PER_ENERGY;
    this.joltPhase = 0;
    this.cover.strike(where, this.jolt);
    if (this.jolt <= KNOCK_THRESHOLD) return;
    this.knock = Math.min(
      this.knock + (this.jolt - KNOCK_THRESHOLD) * KNOCK_PER_JOLT,
      this.texel() * KNOCK_MAX_TEXELS,
    );
  }

  /** One texel of the baked wordmark, in CSS pixels. */
  private texel(): number {
    return this.wordmark.clientWidth / WORDMARK_TEXEL_COLUMNS;
  }

  private updateShake(delta: number): void {
    if (!this.jolt && !this.knock && !this.knockVelocity) return;

    this.joltPhase += delta;
    this.jolt *= Math.exp(-JOLT_DECAY * delta);
    if (this.jolt < JOLT_REST) {
      this.jolt = 0;
      this.joltPhase = 0;
    }

    // The wordmark rides back up on a spring rather than a curve, so a second
    // hit while it is still recovering pushes off wherever it currently is.
    this.knockVelocity += (-KNOCK_STIFFNESS * this.knock - KNOCK_DAMPING * this.knockVelocity) * delta;
    this.knock += this.knockVelocity * delta;
    if (Math.abs(this.knock) < KNOCK_REST && Math.abs(this.knockVelocity) < 1) {
      this.knock = 0;
      this.knockVelocity = 0;
    }

    // The jolt saturates into the shake rather than clipping, so a pile-up
    // still reads as bigger than a single landing once both are past the knee.
    // Cosine, not sine: an impact is at full throw on its very first frame.
    const amplitude = SHAKE_MAX * (1 - Math.exp(-this.jolt / SHAKE_KNEE));
    const swing = amplitude * Math.cos(TAU * SHAKE_FREQUENCY * this.joltPhase);
    const x = Math.round(swing * SHAKE_SIDEWAYS);
    const y = Math.round(swing);
    const drop = Math.round(this.knock / this.texel()) * this.texel();
    this.content.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : '';
    // The stage, not the image: the stone cast has to ride the knock with it.
    this.wordmarkStage.style.transform = drop ? `translateY(${drop.toFixed(2)}px)` : '';
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

    // A knock in progress has the wordmark displaced; fit against its rest pose.
    const bandBottom = Math.min(stage.bottom, wordmark.top - this.knock - PUNCH_WORDMARK_GAP);
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
    this.cover.build();
    this.measureImpactLine();
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
    this.measureImpactLine();
    // A new stage size changes how much room the punched-up logo has.
    this.refit();
  };

  private readonly render = (): void => {
    this.frame = requestAnimationFrame(this.render);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.mixer?.update(delta);
    this.updatePunch(delta);
    if (!this.reducedMotion && !this.closing) {
      // The renderer resolves world matrices itself, but the impact probe reads
      // them before it runs and would otherwise trail a frame behind the pose.
      this.logoPivot.updateMatrixWorld(true);
      this.updateImpacts(delta);
      this.updateShake(delta);
      this.cover.update(delta);
    }
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
    this.fallers.length = 0;
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
