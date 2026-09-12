/**
 * StadiumAudio.ts — Web Audio Procedural Synthesizer for Pokémon Stadium
 *
 * Uses locally generated Pokémon Stadium audio when it is available, then
 * falls back to a procedural N64-inspired soundscape. Nintendo audio is never
 * part of the web distribution: the optional files live under the ignored
 * generated/stadium/audio directory.
 */

interface NativeAudioManifest {
  version: 1;
  sounds?: Record<string, string>;
  music?: Record<string, string>;
}

export class StadiumAudio {
  private static readonly nativeAudioBase = '/generated/stadium/audio/';
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private crowdNode: AudioBufferSourceNode | null = null;
  private crowdGain: GainNode | null = null;
  private nativeLoadStarted = false;
  private nativeBuffers = new Map<string, AudioBuffer>();
  private musicNode: AudioBufferSourceNode | null = null;
  private requestedMusicId: string | null = null;

  constructor() {
    // AudioContext will be lazily created on first user interaction to satisfy browser policies
  }

  private initContext(): void {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
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
      const response = await fetch(`${StadiumAudio.nativeAudioBase}manifest.json`);
      if (!response.ok) return;
      const manifest = await response.json() as NativeAudioManifest;
      if (manifest.version !== 1) return;
      const entries = [...Object.entries(manifest.sounds ?? {}), ...Object.entries(manifest.music ?? {})];
      await Promise.all(entries.map(async ([id, relativeUrl]) => {
        // Keep the manifest local to the generated audio directory.
        if (relativeUrl.split('/').some(part => part === '.' || part === '..') || !/^[a-zA-Z0-9_./-]+\.(wav|ogg|mp3)$/i.test(relativeUrl)) return;
        const audioResponse = await fetch(`${StadiumAudio.nativeAudioBase}${relativeUrl}`);
        if (!audioResponse.ok || !this.ctx) return;
        const buffer = await this.ctx.decodeAudioData(await audioResponse.arrayBuffer());
        this.nativeBuffers.set(id, buffer);
      }));
      if (this.requestedMusicId) this.startMusic(this.requestedMusicId);
    } catch {
      // A missing local ROM-audio export is normal; procedural sound remains available.
    }
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
    gain.connect(this.ctx.destination);
    source.start();
    return true;
  }

  /** Start an optional extracted music loop. Safe to call repeatedly. */
  public startMusic(id: string = 'battle_theme'): void {
    this.initContext();
    this.requestedMusicId = id;
    if (!this.ctx || !this.enabled || this.musicNode) return;
    const buffer = this.nativeBuffers.get(id);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.45;
    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
    this.musicNode = source;
    source.onended = () => { if (this.musicNode === source) this.musicNode = null; };
  }

  public stopMusic(): void {
    this.requestedMusicId = null;
    this.musicNode?.stop();
    this.musicNode = null;
  }

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
      this.crowdGain.connect(this.ctx.destination);

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
    gain.connect(this.ctx.destination);

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
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
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
        gain.connect(this.ctx.destination);
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
        gain.connect(this.ctx.destination);
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
        gain.connect(this.ctx.destination);
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
        gain.connect(this.ctx.destination);
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
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + (isSuperEffective ? 0.25 : 0.15));
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
      gain.connect(this.ctx!.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.25);
    });
  }
}
