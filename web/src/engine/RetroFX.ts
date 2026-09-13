/**
 * RetroFX.ts — Tunable Late-90s Display Pipeline
 *
 * Renders the scene into an (optionally low-resolution) target, then draws it
 * through one full-screen shader that fakes N64 video output and CRT glass:
 * reduced vertical resolution, 16-bit colour banding with ordered dither,
 * composite blur and glow, chromatic fringing, scanlines, an aperture grille,
 * barrel curvature, vignette, grain and flicker. The DOM HUD sits above the
 * canvas and stays crisp. When every effect is neutral the pass is skipped.
 */

import * as THREE from 'three';

export interface RetroSettings {
  /** Vertical lines to render at; 0 renders at native canvas resolution. */
  resolution: number;
  /** Upscale filter: 'nearest' for hard pixels, 'linear' for N64 VI softness. */
  filter: 'nearest' | 'linear';
  antialias: boolean;
  /** Bits per colour channel; 8 is off, 5 is the N64 framebuffer. */
  colorBits: number;
  dither: number;
  saturation: number;
  glow: number;
  chroma: number;
  scanlines: number;
  /** CSS pixels between scanlines, unless locked to the render resolution. */
  scanlineSpacing: number;
  scanlinesMatchRes: boolean;
  mask: number;
  curvature: number;
  vignette: number;
  noise: number;
  flicker: number;
  /** Multiplier on the arena's base fog density. */
  fog: number;
}

export const RETRO_OFF: RetroSettings = {
  resolution: 0, filter: 'nearest', antialias: true, colorBits: 8, dither: 0, saturation: 1,
  glow: 0, chroma: 0, scanlines: 0, scanlineSpacing: 4, scanlinesMatchRes: false, mask: 0,
  curvature: 0, vignette: 0, noise: 0, flicker: 0, fog: 1,
};

export const RETRO_PRESETS: Record<string, RetroSettings> = {
  off: RETRO_OFF,
  // The original CSS overlay: faint 4px scanlines, RGB stripes and a dark rim.
  classic: { ...RETRO_OFF, scanlines: 0.15, mask: 0.04, vignette: 0.55 },
  n64: {
    ...RETRO_OFF, resolution: 240, filter: 'linear', antialias: false, colorBits: 5, dither: 0.7,
    saturation: 1.1, glow: 0.2, chroma: 0.8, scanlines: 0.2, scanlinesMatchRes: true,
    vignette: 0.4, noise: 0.04, fog: 1.6,
  },
  arcade: {
    ...RETRO_OFF, resolution: 240, antialias: false, colorBits: 6, dither: 0.4, saturation: 1.2,
    glow: 0.4, chroma: 1.5, scanlines: 0.5, scanlinesMatchRes: true, mask: 0.35, curvature: 0.35,
    vignette: 0.7, noise: 0.05, flicker: 0.3,
  },
  crunchy: { ...RETRO_OFF, resolution: 180, antialias: false, colorBits: 4, dither: 1, saturation: 1.15 },
};

export const RETRO_PRESET_LABELS: Record<string, string> = {
  off: 'Off (clean)', classic: 'Classic overlay', n64: 'N64 composite', arcade: 'Arcade CRT', crunchy: 'Crunchy 4-bit',
};

export type RetroControl =
  | { key: keyof RetroSettings; label: string; kind: 'range'; min: number; max: number; step: number }
  | { key: keyof RetroSettings; label: string; kind: 'select'; options: [string | number, string][] }
  | { key: keyof RetroSettings; label: string; kind: 'check' };

/** Dev-panel layout: each control maps straight onto one setting. */
export const RETRO_CONTROLS: RetroControl[] = [
  { key: 'resolution', label: 'RES', kind: 'select', options: [[0, 'Native'], [480, '480p'], [360, '360p'], [240, '240p'], [180, '180p'], [120, '120p']] },
  { key: 'filter', label: 'UPSCALE', kind: 'select', options: [['nearest', 'Nearest'], ['linear', 'Linear (soft)']] },
  { key: 'antialias', label: 'MSAA', kind: 'check' },
  { key: 'colorBits', label: 'COLOR BITS', kind: 'range', min: 2, max: 8, step: 1 },
  { key: 'dither', label: 'DITHER', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'saturation', label: 'SATURATION', kind: 'range', min: 0, max: 2, step: 0.05 },
  { key: 'glow', label: 'GLOW', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'chroma', label: 'CHROMA', kind: 'range', min: 0, max: 4, step: 0.1 },
  { key: 'scanlines', label: 'SCANLINES', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'scanlineSpacing', label: 'LINE GAP', kind: 'range', min: 2, max: 8, step: 1 },
  { key: 'scanlinesMatchRes', label: 'LINES MATCH RES', kind: 'check' },
  { key: 'mask', label: 'RGB MASK', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'curvature', label: 'CURVATURE', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'VIGNETTE', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'noise', label: 'GRAIN', kind: 'range', min: 0, max: 0.5, step: 0.01 },
  { key: 'flicker', label: 'FLICKER', kind: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'fog', label: 'FOG', kind: 'range', min: 0, max: 5, step: 0.1 },
];

const STORAGE_KEY = 'stadium.retroFx';
const DEFAULT_PRESET = 'classic';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uOutput;      // drawing-buffer pixels
  uniform vec2 uSource;      // scene target pixels
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uColorBits;
  uniform float uDither;
  uniform float uSaturation;
  uniform float uGlow;
  uniform float uChroma;
  uniform float uScanlines;
  uniform float uScanlineRows;
  uniform float uMask;
  uniform float uCurvature;
  uniform float uVignette;
  uniform float uNoise;
  uniform float uFlicker;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    vec2 c = mod(floor(p), 4.0);
    int i = int(c.x) + int(c.y) * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[i]) + 0.5) / 16.0;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 display(vec3 c) {
    #ifdef TONE_MAPPING
      c = toneMapping(c);
    #endif
    return linearToOutputTexel(vec4(c, 1.0)).rgb;
  }

  void main() {
    vec2 uv = vUv;
    if (uCurvature > 0.0) {
      vec2 cc = uv * 2.0 - 1.0;
      cc *= 1.0 + dot(cc.yx, cc.yx) * uCurvature * 0.12;
      uv = cc * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
    }

    vec3 hdr;
    if (uChroma > 0.0) {
      vec2 off = (uv - 0.5) * 2.0 * uChroma * uPixelRatio / uOutput;
      hdr = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
    } else {
      hdr = texture2D(tScene, uv).rgb;
    }

    if (uGlow > 0.0) {
      vec2 t = 2.0 / uSource;
      vec3 blur = vec3(0.0);
      blur += texture2D(tScene, uv + vec2( t.x, 0.0)).rgb;
      blur += texture2D(tScene, uv + vec2(-t.x, 0.0)).rgb;
      blur += texture2D(tScene, uv + vec2(0.0,  t.y)).rgb;
      blur += texture2D(tScene, uv + vec2(0.0, -t.y)).rgb;
      blur += texture2D(tScene, uv + t * 1.5).rgb;
      blur += texture2D(tScene, uv - t * 1.5).rgb;
      blur += texture2D(tScene, uv + vec2(t.x, -t.y) * 1.5).rgb;
      blur += texture2D(tScene, uv + vec2(-t.x, t.y) * 1.5).rgb;
      blur /= 8.0;
      hdr += max(blur - 0.6, 0.0) * uGlow * 2.0;
    }

    vec3 col = display(hdr);

    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = clamp(mix(vec3(luma), col, uSaturation), 0.0, 1.0);

    if (uColorBits < 8.0) {
      float levels = pow(2.0, uColorBits) - 1.0;
      float d = (bayer4(uv * uSource) - 0.5) * uDither;
      col = clamp(floor(col * levels + 0.5 + d) / levels, 0.0, 1.0);
    }

    vec2 cssPx = gl_FragCoord.xy / uPixelRatio;

    if (uScanlines > 0.0) {
      float row = uScanlineRows > 0.0 ? uv.y * uScanlineRows : cssPx.y / -uScanlineRows;
      float wave = 0.5 + 0.5 * cos(fract(row) * 6.28318);
      col *= 1.0 - uScanlines * smoothstep(0.2, 0.8, 1.0 - wave);
    }

    if (uMask > 0.0) {
      float column = mod(floor(cssPx.x), 3.0);
      vec3 tint = column < 1.0 ? vec3(1.0, 0.0, 0.0) : column < 2.0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
      col *= mix(vec3(1.0), 0.35 + tint * 0.95, uMask);
    }

    if (uVignette > 0.0) {
      vec2 v = uv * (1.0 - uv);
      col *= pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), uVignette * 0.45);
    }

    if (uNoise > 0.0) {
      col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uNoise;
    }

    if (uFlicker > 0.0) {
      float roll = smoothstep(0.0, 0.08, abs(fract(uv.y * 0.5 - uTime * 0.12) - 0.5));
      col *= 1.0 - uFlicker * (0.03 * sin(uTime * 55.0) + 0.06 * (1.0 - roll));
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class RetroFX {
  public settings: RetroSettings;
  public preset: string;

  private target: THREE.WebGLRenderTarget | null = null;
  private targetKey = '';
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private baseFog: number) {
    const saved = RetroFX.load();
    this.preset = saved?.preset ?? DEFAULT_PRESET;
    this.settings = { ...RETRO_OFF, ...(RETRO_PRESETS[this.preset] ?? {}), ...(saved?.settings ?? {}) };

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        uOutput: { value: new THREE.Vector2() },
        uSource: { value: new THREE.Vector2() },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uColorBits: { value: 8 },
        uDither: { value: 0 },
        uSaturation: { value: 1 },
        uGlow: { value: 0 },
        uChroma: { value: 0 },
        uScanlines: { value: 0 },
        uScanlineRows: { value: 0 },
        uMask: { value: 0 },
        uCurvature: { value: 0 },
        uVignette: { value: 0 },
        uNoise: { value: 0 },
        uFlicker: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.applyFog();
  }

  public set<K extends keyof RetroSettings>(key: K, value: RetroSettings[K]): void {
    this.settings[key] = value;
    this.preset = 'custom';
    this.applyFog();
    this.save();
  }

  public usePreset(name: string): void {
    const preset = RETRO_PRESETS[name];
    if (!preset) return;
    this.settings = { ...preset };
    this.preset = name;
    this.applyFog();
    this.save();
  }

  public render(camera: THREE.Camera): void {
    if (this.isNeutral()) {
      this.renderer.render(this.scene, camera);
      return;
    }

    const s = this.settings;
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const height = s.resolution > 0 ? Math.min(s.resolution, buffer.y) : buffer.y;
    const width = Math.max(1, Math.round(buffer.x * height / buffer.y));
    const target = this.ensureTarget(width, height);

    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);

    const u = this.material.uniforms;
    const pixelRatio = this.renderer.getPixelRatio();
    u.tScene.value = target.texture;
    u.uOutput.value.copy(buffer);
    u.uSource.value.set(width, height);
    u.uPixelRatio.value = pixelRatio;
    u.uTime.value = performance.now() * 0.001;
    u.uColorBits.value = s.colorBits;
    u.uDither.value = s.dither;
    u.uSaturation.value = s.saturation;
    u.uGlow.value = s.glow;
    u.uChroma.value = s.chroma;
    u.uScanlines.value = s.scanlines;
    // Positive: rows across the screen. Negative: CSS-pixel spacing (the shader flips it back).
    u.uScanlineRows.value = s.scanlinesMatchRes && s.resolution > 0 ? s.resolution : -s.scanlineSpacing;
    u.uMask.value = s.mask;
    u.uCurvature.value = s.curvature;
    u.uVignette.value = s.vignette;
    u.uNoise.value = s.noise;
    u.uFlicker.value = s.flicker;
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private isNeutral(): boolean {
    const s = this.settings;
    return s.resolution === 0 && s.antialias && s.colorBits >= 8 && s.saturation === 1 && !s.glow
      && !s.chroma && !s.scanlines && !s.mask && !s.curvature && !s.vignette && !s.noise && !s.flicker;
  }

  private ensureTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const { filter, antialias } = this.settings;
    const key = `${filter}|${antialias}`;
    if (this.target && this.targetKey === key) {
      if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
      return this.target;
    }
    this.target?.dispose();
    const texFilter = filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: texFilter,
      magFilter: texFilter,
      samples: antialias ? 4 : 0,
    });
    this.targetKey = key;
    return this.target;
  }

  private applyFog(): void {
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = this.baseFog * this.settings.fog;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset: this.preset, settings: this.settings }));
    } catch { /* storage unavailable; settings last for this session */ }
  }

  private static load(): { preset: string; settings: Partial<RetroSettings> } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
