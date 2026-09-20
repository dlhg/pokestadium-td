/**
 * StadiumAudio.ts — Web Audio Procedural Synthesizer for Pokémon Stadium
 *
 * Uses locally generated Pokémon Stadium audio when it is available, then
 * falls back to a procedural N64-inspired soundscape. Nintendo audio is never
 * part of the web distribution: the optional files live under the gitignored
 * generated/stadium/audio and music directories.
 */

import { PokemonType } from '../stadium/TypeMatrix';

interface NativeAudioManifest {
  version: 1;
  sounds?: Record<string, string>;
  music?: Record<string, string>;
}

/** Per-type cry timbre. Real N64 sample banks aren't decoded yet (see ROM_ASSETS.md), so
 * every cry is synthesized — a `cry_<slug>` or `cry_<type>` native clip still wins if one is
 * ever dropped into the audio manifest. */
const CRY_TIMBRE: Record<PokemonType, { wave: OscillatorType; base: number }> = {
  Normal: { wave: 'triangle', base: 420 },
  Fire: { wave: 'sawtooth', base: 360 },
  Water: { wave: 'sine', base: 480 },
  Electric: { wave: 'square', base: 620 },
  Grass: { wave: 'triangle', base: 400 },
  Ice: { wave: 'sine', base: 700 },
  Fighting: { wave: 'square', base: 300 },
  Poison: { wave: 'sawtooth', base: 340 },
  Ground: { wave: 'triangle', base: 220 },
  Flying: { wave: 'sine', base: 560 },
  Psychic: { wave: 'sine', base: 640 },
  Bug: { wave: 'square', base: 520 },
  Rock: { wave: 'triangle', base: 260 },
  Ghost: { wave: 'sawtooth', base: 380 },
  Dragon: { wave: 'sawtooth', base: 300 },
};

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function readAudioVolume(kind: 'music' | 'sfx' | 'announcer', fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback;
  // getItem returns null, not undefined, for a key that was never set — and
  // Number(null) is 0, not NaN, so a naive Number(getItem(...)) silently
  // defaults a first-time player to 0% volume instead of the fallback below.
  const raw = localStorage.getItem(`pokestadium.${kind}Volume`);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? clampVolume(value) : fallback;
}

export class StadiumAudio {
  private static readonly nativeAudioBase = '/generated/stadium/audio/';
  private static readonly bundledMusicBase = '/music/';
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private crowdNode: AudioBufferSourceNode | null = null;
  private crowdGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicVolume = readAudioVolume('music', 1);
  private sfxVolume = readAudioVolume('sfx', 1);
  // The announcer's recorded voice clips play through plain <audio> elements
  // (Announcer.ts), not this class's Web Audio buses, but the volume is
  // stored and persisted here alongside music/sfx for one consistent
  // settings surface.
  private announcerVolume = readAudioVolume('announcer', 1);
  private nativeLoadStarted = false;
  private nativeBuffers = new Map<string, AudioBuffer>();
  private musicNode: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private requestedMusicId: string | null = null;
  private musicIds: string[] = [];

  /** Called after the optional local music manifest has been discovered. */
  public onMusicCatalogChanged: (() => void) | null = null;

  constructor() {
    // AudioContext will be lazily created on first user interaction to satisfy browser policies
  }

  private initContext(): void {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.ctx.destination);
      this.initCrowdAmbiance();
      void this.loadNativeAudio();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Load optional, locally extracted audio without making it a build asset. */
  private async loadNativeAudio(): Promise<void> {
    if (!this.ctx || this.nativeLoadStarted) return;
    this.nativeLoadStarted = true;
    try {
      const manifests: { base: string; manifest: NativeAudioManifest }[] = [];
      for (const base of [StadiumAudio.nativeAudioBase, StadiumAudio.bundledMusicBase]) {
        try {
          const response = await fetch(`${base}manifest.json`);
          if (!response.ok) continue;
          const manifest = JSON.parse(await response.text()) as NativeAudioManifest;
          if (manifest.version === 1) manifests.push({ base, manifest });
        } catch {
          // Optional manifests may not exist, or a dev server may return its HTML fallback.
        }
      }
      this.musicIds = manifests.flatMap(({ manifest }) => Object.keys(manifest.music ?? {}));
      this.onMusicCatalogChanged?.();
      const entries = manifests.flatMap(({ base, manifest }) => [
        ...Object.entries(manifest.sounds ?? {}).map(([id, relativeUrl]) => ({ base, id, relativeUrl })),
        ...Object.entries(manifest.music ?? {}).map(([id, relativeUrl]) => ({ base, id, relativeUrl })),
      ]);
      await Promise.all(entries.map(async ({ base, id, relativeUrl }) => {
        if (relativeUrl.startsWith('/') || relativeUrl.split('/').some(part => part === '.' || part === '..') || !/^[^#[\]?]+\.(wav|ogg|mp3)$/i.test(relativeUrl)) return;
        try {
          const audioResponse = await fetch(`${base}${relativeUrl}`);
          if (!audioResponse.ok || !this.ctx) return;
          const buffer = await this.ctx.decodeAudioData(await audioResponse.arrayBuffer());
          this.nativeBuffers.set(id, buffer);
        } catch {
          // One unavailable or malformed optional clip must not suppress the rest.
        }
      }));
      if (this.requestedMusicId) this.startMusic(this.requestedMusicId);
    } catch {
      // A missing local ROM-audio export is normal; procedural sound remains available.
    }
  }

  /** Initializes the suspended browser audio context and starts native-asset discovery. */
  public prepare(): void {
    this.initContext();
  }

  public getMusicTracks(): string[] {
    return [...this.musicIds];
  }

  /** Returns true only when an extracted Stadium clip was actually played. */
  private playNative(...ids: string[]): boolean {
    if (!this.ctx || !this.enabled) return false;
    const buffer = ids.map(id => this.nativeBuffers.get(id)).find((item): item is AudioBuffer => item !== undefined);
    if (!buffer) return false;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.8;
    source.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);
    source.start();
    return true;
  }

  /** Start an optional extracted music loop. Safe to call repeatedly. */
  public startMusic(id: string = 'battle_theme'): void {
    this.initContext();
    this.requestedMusicId = id;
    if (!this.ctx || !this.enabled) return;
    if (this.musicNode) {
      this.musicNode.stop();
      this.musicNode = null;
      this.musicGain = null;
    }
    const buffer = this.nativeBuffers.get(id) ?? (id === 'battle_theme' ? this.nativeBuffers.get('free_battle') : undefined);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.45;
    source.connect(gain);
    gain.connect(this.musicBus ?? this.ctx.destination);
    source.start();
    this.musicNode = source;
    this.musicGain = gain;
    source.onended = () => { if (this.musicNode === source) this.musicNode = null; };
  }

  /** Like startMusic, but leaves the loop alone when that track is already playing. */
  public playMusic(id: string): void {
    if (this.requestedMusicId === id && (this.musicNode || !this.nativeBuffers.has(id))) {
      this.initContext();
      return;
    }
    this.startMusic(id);
  }

  /**
   * One-shot music cue on the music bus. The loop ducks underneath it and
   * comes back when the cue ends. Returns false when the clip isn't loaded.
   */
  public playJingle(id: string): boolean {
    this.initContext();
    const buffer = this.nativeBuffers.get(id);
    if (!this.ctx || !this.enabled || !buffer) return false;
    const now = this.ctx.currentTime;
    const loopGain = this.musicGain;
    if (loopGain) {
      loopGain.gain.cancelScheduledValues(now);
      loopGain.gain.setTargetAtTime(0, now, 0.08);
      loopGain.gain.setTargetAtTime(0.45, now + buffer.duration, 0.5);
    }
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.6;
    source.connect(gain);
    gain.connect(this.musicBus ?? this.ctx.destination);
    source.start();
    return true;
  }

  public stopMusic(): void {
    this.requestedMusicId = null;
    this.musicNode?.stop();
    this.musicNode = null;
    this.musicGain = null;
  }

  public setMusicVolume(value: number): void {
    this.musicVolume = clampVolume(value);
    localStorage.setItem('pokestadium.musicVolume', String(this.musicVolume));
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.01);
    }
  }

  public getMusicVolume(): number { return this.musicVolume; }

  public setSfxVolume(value: number): void {
    this.sfxVolume = clampVolume(value);
    localStorage.setItem('pokestadium.sfxVolume', String(this.sfxVolume));
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.01);
    }
  }

  public getSfxVolume(): number { return this.sfxVolume; }

  public setAnnouncerVolume(value: number): void {
    this.announcerVolume = clampVolume(value);
    localStorage.setItem('pokestadium.announcerVolume', String(this.announcerVolume));
  }

  public getAnnouncerVolume(): number { return this.announcerVolume; }

  private initCrowdAmbiance(): void {
    if (!this.ctx) return;
    try {
      // Procedural stadium crowd ambiance via filtered pink noise
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 450;
      filter.Q.value = 1.2;

      this.crowdGain = this.ctx.createGain();
      this.crowdGain.gain.value = 0.08;

      noise.connect(filter);
      filter.connect(this.crowdGain);
      this.crowdGain.connect(this.sfxBus ?? this.ctx.destination);

      noise.start(0);
      this.crowdNode = noise;
    } catch {
      // Ignore if autoplay restricted
    }
  }

  public playSelect(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('ui_select')) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'square';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.04);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playDeploy(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('ui_deploy')) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Air-cutting spin as a trainer sends a Poké Ball onto the pitch. */
  public playSummonThrow(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('summon_throw', 'capture_throw')) return;
    this.noiseBurst(0.42, 2400, 420, 0.22);
    this.tone('triangle', 320, 760, 0.36, 0.12);
  }

  /** Bright release chord when the Poké Ball opens. */
  public playSummonRelease(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('summon_release', 'capture_break')) return;
    this.noiseBurst(0.32, 3200, 900, 0.2);
    this.tone('sine', 520, 1480, 0.4, 0.2);
    this.tone('triangle', 780, 1960, 0.32, 0.12, 0.04);
  }

  /**
   * The Pokémon's own voice at the moment it appears — on a throw, a catch,
   * or an evolution reveal. A `cry_<slug-of-name>` or `cry_<type>` clip in the
   * native audio manifest takes priority; until one exists, this synthesizes
   * a short type-flavored whoop, pitch-varied per species by name so the
   * roster doesn't all share one cry.
   */
  public playCry(name: string, type: PokemonType): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (this.playNative(`cry_${slug}`, `cry_${type.toLowerCase()}`)) return;

    const timbre = CRY_TIMBRE[type];
    const detune = 0.85 + (hashName(name) % 100) / 100 * 0.5;
    const base = timbre.base * detune;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = timbre.wave;
    osc.frequency.setValueAtTime(base * 0.7, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.6, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(base * 0.9, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.26, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);

    // A quieter octave-up voice gives the whoop body instead of a bare tone.
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(base * 1.4, now + 0.02);
    osc2.frequency.exponentialRampToValueAtTime(base * 2.1, now + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(base * 1.3, now + 0.26);
    gain2.gain.setValueAtTime(0.0001, now + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.12, now + 0.06);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(this.sfxBus ?? this.ctx.destination);
    osc2.start(now + 0.02);
    osc2.stop(now + 0.3);
  }

  public playAttack(type: string): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative(`attack_${type}`, 'attack_default')) return;
    const now = this.ctx.currentTime;

    switch (type) {
      case 'lightning': {
        // High electric crackle
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.18);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(this.sfxBus ?? this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case 'flamethrower': {
        // Low fire roar
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.22);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(this.sfxBus ?? this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }
      case 'water_stream': {
        // Water splash / whoosh
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(280, now + 0.15);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(this.sfxBus ?? this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
        break;
      }
      default: {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(this.sfxBus ?? this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    }
  }

  public playHit(isSuperEffective: boolean = false): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative(isSuperEffective ? 'hit_super_effective' : 'hit')) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isSuperEffective ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(isSuperEffective ? 380 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + (isSuperEffective ? 0.22 : 0.12));

    gain.gain.setValueAtTime(isSuperEffective ? 0.35 : 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isSuperEffective ? 0.25 : 0.15));

    osc.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);

    osc.start(now);
    osc.stop(now + (isSuperEffective ? 0.25 : 0.15));
  }

  /**
   * The universal "this is a signature move" stinger (round 2 feedback
   * #28/33) — one shared cue reused by every signature cast, not a
   * per-move sound, matching the universal-first, per-move-later baseline
   * decided for the visual/camera side of this feature. A quick rising
   * charge, a flash-crack of noise, then a falling punch.
   */
  public playSignatureCast(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('signature_cast')) return;
    this.tone('sawtooth', 220, 880, 0.14, 0.18);
    this.noiseBurst(0.3, 2600, 4400, 0.22, 0.1);
    this.tone('square', 700, 90, 0.28, 0.24, 0.08);
  }

  /**
   * Crowd level relative to its resting ambiance: below 1 hushes the stadium
   * (the held breath during a capture), above 1 swells it into a roar.
   */
  public duckCrowd(level: number, seconds: number = 0.4): void {
    if (!this.ctx || !this.crowdGain) return;
    const now = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(now);
    this.crowdGain.gain.setValueAtTime(this.crowdGain.gain.value, now);
    this.crowdGain.gain.linearRampToValueAtTime(0.08 * Math.max(0.01, level), now + seconds);
  }

  /** Filtered noise burst shared by the whoosh, land, and break cues. */
  private noiseBurst(duration: number, fromHz: number, toHz: number, peak: number, delay: number = 0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const frames = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(fromHz, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);
    source.start(now);
    source.stop(now + duration);
  }

  /** Single tone helper for the capture cues. */
  private tone(type: OscillatorType, fromHz: number, toHz: number, duration: number, peak: number, delay: number = 0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), now + duration);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus ?? this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  /** Rising riser as the lights drop and the world slows. */
  public playCaptureWindup(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_windup')) return;
    this.tone('sine', 140, 520, 0.55, 0.16);
    this.noiseBurst(0.5, 300, 2600, 0.1);
  }

  public playCaptureThrow(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_throw')) return;
    this.noiseBurst(0.34, 1800, 320, 0.26);
  }

  /** The ball actually hitting the body: a hard thunk, then the shell cracking. */
  public playCaptureStrike(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_strike')) return;
    this.tone('triangle', 260, 90, 0.14, 0.3);
    this.noiseBurst(0.1, 1400, 400, 0.24);
    // The hinge letting go, a beat after the impact that caused it.
    this.tone('square', 1500, 720, 0.07, 0.14, 0.07);
    this.noiseBurst(0.18, 600, 3400, 0.12, 0.08);
  }

  /** The tether snapping onto the target: crackle over a held tone. */
  public playCaptureBeam(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_beam')) return;
    this.tone('sawtooth', 180, 1500, 0.16, 0.18);
    this.noiseBurst(0.42, 3200, 900, 0.14);
    // Three ragged spits so the bolt reads as unstable rather than a laser.
    [0.06, 0.17, 0.29].forEach((delay, idx) => {
      this.noiseBurst(0.05, 5200 - idx * 900, 1800, 0.1, delay);
    });
  }

  /** Shell halves slamming home and the latch catching. */
  public playCaptureSnap(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_snap')) return;
    this.tone('square', 1700, 520, 0.06, 0.24);
    this.tone('triangle', 420, 160, 0.12, 0.2, 0.02);
    this.noiseBurst(0.08, 2600, 700, 0.16);
  }

  /** Bright suck-in shimmer as the target streams into the ball. */
  public playCaptureAbsorb(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_absorb')) return;
    this.tone('sawtooth', 1400, 180, 0.5, 0.2);
    this.tone('sine', 900, 240, 0.45, 0.14, 0.04);
    this.noiseBurst(0.4, 2400, 260, 0.18);
  }

  /** Mechanical click per wobble, pitched up so the tension escalates. */
  public playCaptureWobble(index: number): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative(`capture_wobble_${index + 1}`, 'capture_wobble')) return;
    const base = 620 + index * 130;
    this.tone('square', base, base * 0.55, 0.07, 0.16);
    this.tone('square', base * 1.3, base * 0.7, 0.05, 0.1, 0.07);
    // Heartbeat under the click: a double thump that gets heavier each time.
    this.tone('sine', 82, 46, 0.2, 0.2 + index * 0.05, 0.12);
    this.tone('sine', 74, 42, 0.22, 0.16 + index * 0.05, 0.34);
  }

  /** Confirming lock: a hard click and a short original three-note flourish. */
  public playCaptureLock(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_lock')) return;
    this.tone('square', 980, 420, 0.08, 0.22);
    [659.25, 880, 1174.66].forEach((freq, idx) => {
      this.tone('triangle', freq, freq, 0.3, 0.2, 0.14 + idx * 0.11);
    });
  }

  /** The ball bursting open on a failed attempt. */
  public playCaptureBreak(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('capture_break')) return;
    this.noiseBurst(0.45, 400, 3200, 0.3);
    this.tone('sawtooth', 320, 1200, 0.28, 0.18);
    this.tone('square', 220, 90, 0.3, 0.16, 0.05);
  }

  /** Rising, shimmering charge as the tower begins to glow. Longer and stranger than a capture windup. */
  public playEvolutionCharge(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('evolution_charge')) return;
    this.tone('sine', 220, 880, 1.1, 0.14);
    this.tone('triangle', 440, 1320, 1.0, 0.1, 0.08);
    this.noiseBurst(0.9, 200, 4200, 0.06);
  }

  /** The hard white-out at the moment the old form gives way to the new one. */
  public playEvolutionFlash(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('evolution_flash')) return;
    this.noiseBurst(0.4, 3600, 5200, 0.28);
    this.tone('square', 1600, 60, 0.35, 0.22);
  }

  public playFanfare(): void {
    this.initContext();
    if (!this.ctx || !this.enabled) return;
    if (this.playNative('victory_fanfare')) return;
    const now = this.ctx.currentTime;

    // Pokémon Stadium classic 4-note victory flourish (C5, E5, G5, C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const noteTime = now + idx * 0.12;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.2, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.25);

      osc.connect(gain);
      gain.connect(this.sfxBus ?? this.ctx!.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.25);
    });
  }
}
