/**
 * Announcer.ts — The Legendary Pokémon Stadium Announcer Subsystem
 *
 * Manages reactive text banners and recorded announcer voice callouts
 * based on battle events and intensity.
 */

export interface AnnouncerQuote {
  text: string;
  intensity: 'normal' | 'high' | 'epic';
}

export class StadiumAnnouncer {
  private currentBanner: { text: string; timer: number; intensity: string } | null = null;
  private voiceEnabled: boolean = true;
  private voiceVolume: number = 1;
  private lastSpeakTime: number = 0;
  private static readonly speechPolicy: Partial<Record<string, { cooldown: number; chance: number }>> = {
    battle_start: { cooldown: 0, chance: 1 },
    round_start: { cooldown: 6_000, chance: 1 },
    boss_spawn: { cooldown: 0, chance: 1 }, boss_defeat: { cooldown: 0, chance: 1 },
    elite_spawn: { cooldown: 12_000, chance: 1 }, elite_defeat: { cooldown: 12_000, chance: 0.7 },
    mystery_round: { cooldown: 0, chance: 1 },
    final_start: { cooldown: 0, chance: 1 }, final_round: { cooldown: 0, chance: 1 },
    titan_ability: { cooldown: 5_000, chance: 1 },
    victory: { cooldown: 0, chance: 1 }, game_over: { cooldown: 0, chance: 1 },
    tower_evolve: { cooldown: 15_000, chance: 0.6 }, wave_cleared: { cooldown: 22_000, chance: 0.2 },
    capture_throw: { cooldown: 0, chance: 1 },
    trait_airborne: { cooldown: 0, chance: 1 }, trait_phantom: { cooldown: 0, chance: 1 },
    trait_armored: { cooldown: 0, chance: 1 },
    signature: { cooldown: 0, chance: 1 },
    pokemon_deploy: { cooldown: 0, chance: 1 },
    capture_success: { cooldown: 0, chance: 1 }, capture_failed: { cooldown: 0, chance: 1 },
  };
  private static readonly originalVoiceClips: Partial<Record<string, number[]>> = {
    battle_start: [222],
    super_effective: [261, 262, 267],
    critical_hit: [311, 312],
    not_effective: [270, 317, 319],
    creep_faint: [349, 351, 357, 358],
    victory: [365, 366, 367],
    wave_cleared: [367, 368],
  };

  public trigger(event: string, detail?: string): void {
    const quotes = this.getQuotesForEvent(event, detail);
    if (!quotes || quotes.length === 0) return;

    const chosen = quotes[Math.floor(Math.random() * quotes.length)];
    this.currentBanner = {
      text: chosen.text,
      timer: 2.8,
      intensity: chosen.intensity
    };

    const policy = StadiumAnnouncer.speechPolicy[event];
    if (policy && Math.random() <= policy.chance) {
      this.speak(event, policy.cooldown);
    }
  }

  private getQuotesForEvent(event: string, detail?: string): AnnouncerQuote[] {
    switch (event) {
      case 'battle_start':
        return [
          { text: "WELCOME TO POKÉMON STADIUM! LET THE BATTLE BEGIN!", intensity: 'epic' },
          { text: "WHAT A MATCH WE HAVE IN STORE TODAY!", intensity: 'epic' },
          { text: "THE CROWD IS ON THEIR FEET! HERE WE GO!", intensity: 'high' }
        ];
      case 'round_start':
        return [
          { text: `ROUND ${detail || ''}! LET THE BATTLE CONTINUE!`, intensity: 'high' },
          { text: detail ? `ROUND ${detail} IS UNDERWAY!` : 'THE NEXT ROUND IS UNDERWAY!', intensity: 'high' }
        ];
      case 'super_effective':
        return [
          { text: "IT'S SUPER EFFECTIVE!", intensity: 'high' },
          { text: "WHAT A MASSIVE HIT!", intensity: 'high' },
          { text: "A DEVASTATING BLOW!", intensity: 'epic' },
          { text: "BOOM! THAT'S GOTTA HURT!", intensity: 'high' }
        ];
      case 'critical_hit':
        return [
          { text: "A CRITICAL HIT!", intensity: 'epic' },
          { text: "DIRECT IMPACT! UNBELIEVABLE POWER!", intensity: 'epic' }
        ];
      case 'not_effective':
        return [
          { text: "THAT WASN'T VERY EFFECTIVE...", intensity: 'normal' },
          { text: "HARDLY A SCRATCH!", intensity: 'normal' }
        ];
      case 'creep_faint':
        return [
          { text: "DOWN IT GOES!", intensity: 'normal' },
          { text: "TAKEN DOWN!", intensity: 'normal' },
          { text: "AND IT'S OUT OF THERE!", intensity: 'high' },
          { text: "KNOCKED OUT!", intensity: 'normal' }
        ];
      case 'boss_spawn':
        return [
          { text: `A POWERFUL FOE HAS ENTERED THE STADIUM: ${detail || 'BOSS'}!`, intensity: 'epic' },
          { text: "THE ARENA IS SHAKING! HERE COMES THE BOSS!", intensity: 'epic' }
        ];
      case 'boss_defeat':
        return [
          { text: "THE BOSS HAS BEEN TOPPLED! WHAT AN INCREDIBLE DEFENSE!", intensity: 'epic' },
          { text: "DOWN GOES THE TITAN!", intensity: 'epic' }
        ];
      case 'signature':
        return [{ text: detail || 'A SIGNATURE MOVE!', intensity: 'epic' }];
      case 'pokemon_deploy':
        return [
          { text: `${(detail || 'POKÉMON').toUpperCase()}, I CHOOSE YOU!`, intensity: 'epic' },
          { text: `${(detail || 'POKÉMON').toUpperCase()} TAKES THE FIELD!`, intensity: 'epic' },
        ];
      case 'trait_airborne':
        return [{ text: "FLYERS INCOMING! GROUND ATTACKS WON'T TOUCH THEM!", intensity: 'high' }];
      case 'trait_phantom':
        return [{ text: "PHANTOMS! ONLY PSYCHIC AND GHOST POKÉMON CAN AIM AT THEM!", intensity: 'high' }];
      case 'trait_armored':
        return [{ text: "ARMORED FOES! LIGHT HITS BOUNCE OFF — BRING HEAVY MOVES!", intensity: 'high' }];
      case 'mystery_round':
        return [
          { text: "A MYSTERY ROUND! NO ONE KNOWS WHAT'S COMING!", intensity: 'epic' },
          { text: `SOMETHING'S DIFFERENT THIS ROUND — ${detail || 'STAY SHARP'}!`, intensity: 'epic' },
        ];
      case 'final_start':
        return [
          { text: `THE FINAL BEGINS! ${detail || 'FIVE ROUNDS TO GLORY'}!`, intensity: 'epic' },
          { text: `IT'S THE FINAL! ${detail || 'EVERYTHING COMES DOWN TO THIS'}!`, intensity: 'epic' },
        ];
      case 'titan_ability':
        return [{ text: detail || 'THE TITAN MAKES ITS MOVE!', intensity: 'epic' }];
      case 'final_round':
        return [{ text: `${detail || 'THE FINAL CONTINUES'}!`, intensity: 'epic' }];
      case 'elite_spawn':
        return [{ text: `AN ELITE ${detail || 'CHALLENGER'} JOINS THE ASSAULT!`, intensity: 'high' }];
      case 'elite_defeat':
        return [{ text: `THE ELITE ${detail || 'CHALLENGER'} HAS BEEN STOPPED!`, intensity: 'high' }];
      case 'wave_cleared':
        return [
          { text: "A SPECTACULAR PERFORMANCE! THE WAVE IS CLEARED!", intensity: 'high' },
          { text: "THE DEFENDERS HOLD STRONG!", intensity: 'high' }
        ];
      case 'tower_evolve':
        return [
          { text: `WHAT'S THIS? ${detail || 'YOUR POKÉMON'} IS EVOLVING!`, intensity: 'epic' },
          { text: "AN ASTONISHING POWER SURGE! IT HAS EVOLVED!", intensity: 'epic' }
        ];
      case 'level_up':
        return [
          { text: `${detail || 'YOUR POKÉMON'}!`, intensity: 'high' },
        ];
      case 'capture_throw':
        return [
          { text: `THE BALL IS AWAY — AT ${detail || 'THE CHALLENGER'}!`, intensity: 'epic' },
          { text: "HERE COMES THE THROW! THE CROWD HOLDS ITS BREATH!", intensity: 'epic' },
          { text: `A CAPTURE ATTEMPT ON ${detail || 'THE CHALLENGER'}!`, intensity: 'epic' },
        ];
      case 'capture_success':
        return [{ text: `${(detail || 'THE POKÉMON').toUpperCase()} WAS CAUGHT! IT JOINS YOUR COLLECTION!`, intensity: 'epic' }];
      case 'capture_failed':
        return [{ text: `${detail || 'IT'} BROKE FREE!`, intensity: 'high' }];
      case 'life_lost':
        return [
          { text: "AN INVADER BROKE THROUGH! THE PRESSURE IS MOUNTING!", intensity: 'high' },
          { text: "A DEFENSIVE BREACH! WATCH OUT!", intensity: 'high' }
        ];
      case 'game_over':
        return [
          { text: "AND THAT IS THE MATCH! BETTER LUCK NEXT TOURNAMENT!", intensity: 'epic' }
        ];
      case 'victory':
        return [
          { text: "VICTORY! THEY HAVE CONQUERED THE STADIUM TOURNAMENT!", intensity: 'epic' }
        ];
      default:
        return [{ text: detail || "WHAT AN ACTION-PACKED ARENA!", intensity: 'normal' }];
    }
  }

  private speak(event: string, cooldown: number): void {
    if (!this.voiceEnabled || this.voiceVolume <= 0) return;

    // Throttle speech so it doesn't overlap excessively
    const now = performance.now();
    if (now - this.lastSpeakTime < cooldown) return;

    const clips = StadiumAnnouncer.originalVoiceClips[event];
    if (!clips?.length) return; // No recorded clip for this event — show the banner only, stay silent.

    this.lastSpeakTime = now;
    const clip = clips[Math.floor(Math.random() * clips.length)];
    const nativeVoice = new Audio(`/generated/stadium/audio/announcer/stadium_mort_${String(clip).padStart(3, '0')}.wav`);
    // 0.9 headroom at full volume keeps clips from ever hitting a hard 1.0
    // ceiling; the player's announcer-volume setting scales down from there.
    nativeVoice.volume = this.voiceVolume * 0.9;
    nativeVoice.play().catch(() => {
      // Audio blocked by browser autoplay policy until user gesture
    });
  }

  public update(dt: number): void {
    if (this.currentBanner) {
      this.currentBanner.timer -= dt;
      if (this.currentBanner.timer <= 0) {
        this.currentBanner = null;
      }
    }
  }

  public getCurrentBanner(): { text: string; intensity: string; opacity: number } | null {
    if (!this.currentBanner) return null;
    const fadeOutThreshold = 0.5;
    let opacity = 1.0;
    if (this.currentBanner.timer < fadeOutThreshold) {
      opacity = this.currentBanner.timer / fadeOutThreshold;
    }
    return {
      text: this.currentBanner.text,
      intensity: this.currentBanner.intensity,
      opacity
    };
  }

  public setVoiceEnabled(val: boolean): void {
    this.voiceEnabled = val;
  }

  /** Player-facing announcer-voice volume (0–1), independent of the internal
   *  voiceEnabled flag used for headless/screenshot capture. */
  public setVoiceVolume(value: number): void {
    this.voiceVolume = Math.max(0, Math.min(1, value));
  }
}
