/**
 * StadiumUI.ts — Authentic Pokémon Stadium User Interface
 *
 * Implements:
 * - Iconic metallic tournament top bar (Cup, Round, Prize Money, Poké Balls)
 * - Vertical tower roster for selecting and deploying Pokémon
 * - Tower detail panel: three buyable move lines, evolution track, sell
 * - Dynamic Stadium Announcer popup banners
 * - Speed & camera controls
 */

import { Tower } from './Tower';
import { attackChips } from './TowerAttack';
import type { SignatureDef } from './Signatures';
import { TYPE_COLORS, getCombinedEffectiveness, getEffectivenessLabel } from '../stadium/TypeMatrix';
import { MOVES, ParticleFXType } from '../stadium/MoveDatabase';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumCamera, CameraMode } from '../engine/StadiumCamera';
import { STADIUM_MAPS, type StadiumMap } from './MapCatalog';
import { mapPreview } from './MapPreview';
import { BALL_ORDER, BALL_PRICES, BallType, CaptureHud } from './CaptureSequence';
import type { Creep } from './Creep';
import { EvolutionHud } from './EvolutionSequence';
import { SummonHud } from './SummonSequence';
import type { MilestoneReward } from './WaveManager';
import { TrophyModelView } from './TrophyModelView';
import { RosterModelView } from './RosterModelView';
import { escapeHtml, TrainerScreens, reportListHtml } from './progression/TrainerScreens';
import { displayName, formOf, nextEvolution, OwnedPokemon, speciesOf, TEAM_SIZE, TrainerStore } from './progression/TrainerStore';
import { levelProgress, MAX_LEVEL, xpForLevel } from './progression/Stats';
import type { MatchReportEntry } from './progression/MatchProgress';
import './map-select.css';
import stadiumThemeUrl from './stadium-ui-theme.css?url';

const BALL_NAMES: Record<BallType, string> = { poke: 'POKÉ', great: 'GREAT', ultra: 'ULTRA' };

const UI_SCALE_KEY = 'pokestadium.uiScale';
const UI_SCALE_BASE_WIDTH = 1440;
const UI_SCALE_BASE_HEIGHT = 900;
const UI_SCALE_AUTO_MAX = 1.5;
type UIScalePreference = 'auto' | number;

function readUiScalePreference(): UIScalePreference {
  try {
    const saved = localStorage.getItem(UI_SCALE_KEY);
    if (!saved || saved === 'auto') return 'auto';
    const scale = Number(saved);
    return [1, 1.25, 1.5, 1.75, 2].includes(scale) ? scale : 'auto';
  } catch {
    return 'auto';
  }
}

/** What the roster hint says about the spot the cursor is currently over. */
export interface PlacementStatus {
  valid: boolean;
  label: string;
}

export interface UIState {
  money: number;
  lives: number;
  balls: Record<BallType, number>;
  /** Every Pokémon weak enough to catch right now, nearest the exit first. */
  catchables: CatchSlot[];
  /** The ball thrown by catch tags, tray buttons, and the Q shortcut. */
  selectedBall: BallType;
  captureHint: string | null;
  /** Live capture set piece, or null when no ball is in the air. */
  captureCinema: CaptureHud | null;
  /** Live evolution set piece, or null when no tower is evolving. */
  evolutionCinema: EvolutionHud | null;
  /** Live Poké Ball deployment entrance, or null during ordinary play. */
  summonCinema: SummonHud | null;
  cupName: string;
  round: number;
  /** The round whose clear wins the course; play continues past it. */
  winRound: number;
  freeplay: boolean;
  inWave: boolean;
  intermissionTimer: number;
  gameSpeed: number;
  cameraMode: CameraMode;
  selectedTower: Tower | null;
  selectedMember: OwnedPokemon | null;
  /** UIDs of roster members currently standing on the pitch. */
  deployed: Set<string>;
  placementStatus: PlacementStatus | null;
  mapName: string;
  mapStrategy: string;
  /** Every signature move on the pitch, in hotkey order. */
  signatures: SignatureSlot[];
}

export interface CatchSlot {
  creep: Creep;
  /** Viewport pixels of the spot just above the creep's HP bar. */
  x: number;
  y: number;
  onScreen: boolean;
  /** Catch odds for each ball before the release meter. */
  odds: Record<BallType, number>;
}

/** Tags are stacked apart by these bounds so crowded Pokémon never share one. */
const CATCH_TAG_HEIGHT = 24;
const CATCH_TAG_GAP = 4;

export interface SignatureSlot {
  tower: Tower;
  def: SignatureDef;
  pp: number;
  /** The player is picking a spot or direction for this one. */
  aiming: boolean;
}

/** Effect glyph a signature's button wears, by its type. */
const SIGNATURE_GLYPHS: Partial<Record<string, ParticleFXType>> = {
  Grass: 'razor_leaf', Fire: 'flamethrower', Water: 'water_stream', Electric: 'lightning',
  Ice: 'blizzard', Psychic: 'psychic_wave', Flying: 'impact',
};

/**
 * Abstract geometric marks for each effect family — deliberately simple
 * shapes so a move reads at tile size without leaning on character art.
 */
const FX_GLYPHS: Record<ParticleFXType, string> = {
  lightning: '<polygon points="14,2 5,13 11,13 9,22 19,10 13,10"/>',
  flamethrower: '<path d="M12 2c3 5-1 6 1 9 1-1 2-3 2-3 2 3 3 5 3 8a6 6 0 0 1-12 0c0-5 4-8 6-14z"/>',
  water_stream: '<path d="M12 2c4 6 6 9.5 6 12.5a6 6 0 0 1-12 0C6 11.5 8 8 12 2z"/>',
  razor_leaf: '<path d="M4 20C4 10.5 11.5 4 20 4c0 9.5-7.5 16-16 16z"/><path d="M6 18 18 6" stroke="currentColor" stroke-width="1.2" fill="none"/>',
  shadow_ball: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4" fill="#0a1526"/>',
  psychic_wave: '<circle cx="12" cy="12" r="3" /><path d="M12 4.5a7.5 7.5 0 0 1 0 15M12 1a11 11 0 0 1 0 22" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  blizzard: '<path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17" fill="none" stroke="currentColor" stroke-width="2"/>',
  spore_cloud: '<circle cx="8" cy="14" r="4"/><circle cx="15" cy="15" r="4.5"/><circle cx="12" cy="9" r="4.2"/>',
  earthquake: '<path d="M2 12h5l3-5 3 10 3-7 3 2h3" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  hyper_beam: '<path d="M2 10h20v4H2z"/><path d="M4 6h16M4 18h16" stroke="currentColor" stroke-width="1.6"/>',
  impact: '<polygon points="12,2 14.5,9 22,12 14.5,15 12,22 9.5,15 2,12 9.5,9"/>',
};

function glyph(fx: ParticleFXType, color: string, size = 26): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="color:${color}">${FX_GLYPHS[fx] || FX_GLYPHS.impact}</svg>`;
}

export class StadiumUI {
  private container: HTMLElement;
  private announcer: StadiumAnnouncer;
  private camera: StadiumCamera;

  // UI elements
  private cardDeckEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private storageConfirmEl!: HTMLElement;
  private announcerBannerEl!: HTMLElement;

  /** Structure is rebuilt only when the tower's purchases actually change. */
  private panelSignature: string = '';
  private currentSelectedTower: Tower | null = null;
  private roster: OwnedPokemon[] = [];
  /** Rebuild the deck only when membership, names or forms change. */
  private rosterSignature = '';
  private renderedLives = -1;
  private rosterViews = new Map<string, RosterModelView>();
  public readonly trainer: TrainerScreens;
  private uiScale = 1;
  private uiScalePreference: UIScalePreference = readUiScalePreference();
  private readonly handleUiResize = (): void => this.applyUiScale();

  // Callbacks
  private cinemaEl!: HTMLElement;
  private evoCinemaEl!: HTMLElement;
  private summonCinemaEl!: HTMLElement;
  private cinemaVerdict: string = '';
  private trophyTimer: number = 0;
  private trophyView = new TrophyModelView();
  private storageConfirmMember: OwnedPokemon | null = null;
  private storageConfirmPreviousFocus: HTMLElement | null = null;

  public onSelectMember: (member: OwnedPokemon | null) => void = () => {};
  public onStoreMember: (member: OwnedPokemon) => void = () => {};
  public onUpgradeTower: (tower: Tower, lineIdx: number) => void = () => {};
  public onSellTower: (tower: Tower) => void = () => {};
  public onChangeTargetPriority: (tower: Tower, dir: number) => void = () => {};
  public onDeselectTower: () => void = () => {};
  public onStartWave: () => void = () => {};
  public onChangeSpeed: (speed: number) => void = () => {};
  public onChangeCamera: (mode: CameraMode) => void = () => {};
  public onOpenMaps: () => void = () => {};
  public onResumeMap: () => void = () => {};
  /** Course select came up (team select and the collection open from it). */
  public onMenuShown: () => void = () => {};
  public onResumeGame: () => void = () => {};
  public onCastSignature: (tower: Tower, signatureId: string) => void = () => {};
  public onToggleSignatureCuts: () => void = () => {};
  public onToggleSummonCinematics: () => void = () => {};
  public onMusicVolumeChange: (value: number) => void = () => {};
  public onSfxVolumeChange: (value: number) => void = () => {};
  public onQuitToMenu: () => void = () => {};
  public onRetryMap: () => void = () => {};
  public onCatch: (creep: Creep) => void = () => {};
  public onSelectBall: (ball: BallType) => void = () => {};
  public onBuyBall: (ball: BallType) => void = () => {};
  public onSelectMap: (map: StadiumMap) => void = () => {};

  constructor(container: HTMLElement, announcer: StadiumAnnouncer, camera: StadiumCamera, private store: TrainerStore) {
    this.container = container;
    this.announcer = announcer;
    this.camera = camera;

    this.initDOM();
    this.applyUiScale();
    window.addEventListener('resize', this.handleUiResize);
    this.trainer = new TrainerScreens(container, store);
    // A new trainer picks a starter before anything else.
    if (!store.data.starterChosen) this.trainer.openStarterSelect(() => this.setMapSelectVisible(true));
  }

  private initDOM(): void {
    this.container.innerHTML = `
      <style>
        .stadium-panel {
          background: linear-gradient(180deg, #102542 0%, #071326 100%);
          border: 2px solid #3a608f;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2);
          border-radius: 6px;
        }

        .gold-glow { text-shadow: 0 0 10px #ffd700, 0 0 20px #ff9e00; }
        .cyan-glow { text-shadow: 0 0 8px #00f0ff; }

        /* Top Bar */
        #top-bar {
          position: absolute;
          top: 14px;
          left: 18px;
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 8px 24px;
          z-index: 30;
        }

        .stat-badge { display: flex; flex-direction: column; align-items: center; }

        #start-match-bar {
          position: absolute;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          padding: 8px 16px;
          z-index: 30;
        }

        #storage-confirm {
          position: absolute; inset: 0; z-index: 75; display: grid; place-items: center;
          background: rgba(3, 7, 16, .7);
        }
        #storage-confirm[hidden] { display: none; }
        #storage-confirm .storage-confirm-card {
          width: min(330px, 84vw); padding: 20px 24px; text-align: center;
          transform: skew(-6deg); background: linear-gradient(180deg, #16305a 0%, #07142a 100%);
          border: 3px solid var(--broadcast-gold, #f6c437);
          box-shadow: 0 10px 0 rgba(3,7,16,.8), 0 0 42px rgba(246,196,55,.4);
        }
        #storage-confirm .storage-confirm-kicker { color: #f6c437; font-size: 11px; font-weight: 800; letter-spacing: 2px; }
        #storage-confirm .storage-confirm-title { margin: 4px 0 8px; color: #fff; font: 38px/1 'Teko','Impact',sans-serif; text-shadow: 2px 3px #08152b; }
        #storage-confirm .storage-confirm-copy { margin: 0 0 16px; color: #cfe3ff; font-size: 14px; letter-spacing: .4px; }
        #storage-confirm .storage-confirm-actions { display: flex; justify-content: center; gap: 9px; }
        #storage-confirm .storage-confirm-actions .stadium-btn { padding: 7px 18px; }

        #start-match-bar #btn-wave {
          font-size: 20px;
          padding: 10px 28px;
        }

        .stat-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          color: #8faecf;
          text-transform: uppercase;
        }

        .stat-value {
          font-family: 'Impact', sans-serif;
          font-size: 24px;
          letter-spacing: 1px;
        }

        .pokeball-tray { display: flex; gap: 6px; align-items: center; }

        .ui-pokeball {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: linear-gradient(180deg, #d90429 48%, #111 48%, #111 52%, #fff 52%);
          border: 1.5px solid #111;
          box-shadow: 0 2px 5px rgba(0,0,0,0.5);
          transition: transform 0.2s, opacity 0.2s;
        }

        .ui-pokeball.lost { opacity: 0.2; filter: grayscale(1); transform: scale(0.85); }
        /* Headless verification freezes single frames; show settled states, not mid-transition ones. */
        .shot-mode *, .shot-mode *::before, .shot-mode *::after { transition:none !important; animation-duration:0s !important; }

        /* ---- Capture cinematic overlay ---- */
        /* Gameplay chrome recedes so the ball owns the screen. */
        #top-bar, #start-match-bar, #controls-bar, #card-deck, #tower-panel, #capture-kit, #capture-hint, #catch-layer { transition:opacity .28s ease, filter .28s ease; }
        .cinema-live #top-bar, .cinema-live #start-match-bar, .cinema-live #controls-bar, .cinema-live #card-deck,
        .cinema-live #tower-panel, .cinema-live #capture-kit, .cinema-live #catch-layer,
        .cinema-live #capture-hint { opacity:.1; filter:blur(2px) saturate(.35); pointer-events:none; }
        .cinema-live #announcer-banner { display:none !important; }
        #capture-cinema { position:absolute; inset:0; z-index:60; pointer-events:none; opacity:0; transition:opacity .18s ease; }
        #capture-cinema.live { opacity:1; }

        /* ---- Evolution cinematic overlay ---- */
        .evo-live #top-bar, .evo-live #start-match-bar, .evo-live #controls-bar, .evo-live #card-deck,
        .evo-live #tower-panel, .evo-live #capture-kit, .evo-live #catch-layer,
        .evo-live #capture-hint { opacity:.1; filter:blur(2px) saturate(.35); pointer-events:none; }
        .evo-live #announcer-banner { display:none !important; }
        #evo-cinema { position:absolute; inset:0; z-index:60; pointer-events:none; opacity:0; transition:opacity .18s ease; }
        #evo-cinema.live { opacity:1; }
        #evo-vignette { position:absolute; inset:0; background:radial-gradient(ellipse 60% 50% at 50% 52%, rgba(0,0,0,0) 30%, rgba(46,32,3,.5) 74%, rgba(20,14,2,.85) 100%); }
        #evo-flash { position:absolute; inset:0; background:#fff8e0; opacity:0; mix-blend-mode:screen; }
        #evo-kicker {
          position:absolute; left:50%; top:calc(13vh + 30px); transform:translateX(-50%) skew(-7deg);
          font-family:'Teko','Impact',sans-serif; font-size:30px; letter-spacing:3px; color:#fff3c4;
          text-shadow:0 0 20px rgba(255,227,140,.85), 3px 4px #3a2a02; transition:opacity .2s ease;
        }
        #evo-caption {
          position:absolute; left:50%; bottom:calc(6.5vh - 26px); transform:translateX(-50%) skew(-7deg);
          font-family:'Teko','Impact',sans-serif; font-size:38px; letter-spacing:1.6px; color:#fff;
          text-shadow:0 0 18px rgba(0,0,0,.9), 3px 4px #0a1428; white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis;
        }

        /* ---- Poké Ball deployment cinematic ---- */
        .summon-live #top-bar, .summon-live #start-match-bar, .summon-live #controls-bar, .summon-live #card-deck,
        .summon-live #tower-panel, .summon-live #capture-kit, .summon-live #signature-bar, .summon-live #catch-layer,
        .summon-live #capture-hint { opacity:.08; filter:blur(2px) saturate(.3); pointer-events:none; }
        .summon-live #announcer-banner { display:none !important; }
        #summon-cinema { position:absolute; inset:0; z-index:60; pointer-events:none; opacity:0; transition:opacity .16s ease; }
        #summon-cinema.live { opacity:1; }
        #summon-vignette { position:absolute; inset:0; background:radial-gradient(ellipse 56% 50% at 50% 53%, transparent 28%, rgba(5,24,40,.48) 72%, rgba(2,8,18,.88) 100%); }
        #summon-flash { position:absolute; inset:0; background:#eaffff; opacity:0; mix-blend-mode:screen; }
        #summon-kicker {
          position:absolute; left:50%; top:calc(13vh + 27px); transform:translateX(-50%) skew(-7deg);
          padding:5px 18px; font-size:12px; font-weight:900; letter-spacing:4px; color:#071326;
          background:linear-gradient(180deg,#fff3a8,#f6c437); border:2px solid #fff8d5;
          box-shadow:0 5px 0 rgba(3,7,16,.75),0 0 24px rgba(246,196,55,.42);
        }
        #summon-caption {
          position:absolute; left:50%; bottom:calc(6.5vh - 27px); transform:translateX(-50%) skew(-7deg);
          max-width:92vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          font-family:'Teko','Impact',sans-serif; font-size:44px; letter-spacing:2px; color:#fff;
          text-shadow:0 0 18px #00d9ff,3px 4px #071326;
        }
        #summon-skip {
          position:absolute; right:22px; bottom:calc(13vh + 18px); font-size:10px; font-weight:800;
          letter-spacing:1.6px; color:#b9d6e8; text-shadow:0 2px 3px #000;
        }
        .cine-bar { position:absolute; left:0; right:0; height:13vh; background:#04070d; box-shadow:0 0 40px rgba(0,0,0,.9); transform:translateY(0); }
        .cine-bar.top { top:0; }
        .cine-bar.bottom { bottom:0; }
        #cine-vignette { position:absolute; inset:0; background:radial-gradient(ellipse 60% 50% at 50% 52%, rgba(0,0,0,0) 32%, rgba(3,6,14,.55) 72%, rgba(3,6,14,.88) 100%); }
        #cine-flare { position:absolute; inset:0; background:#fff; opacity:0; mix-blend-mode:screen; }
        #cine-card {
          position:absolute; left:50%; top:calc(13vh + 22px); transform:translateX(-50%) skew(-7deg);
          display:flex; align-items:center; gap:12px; padding:8px 18px 8px 12px;
          background:linear-gradient(180deg,#16305a 0%,#07142a 100%);
          border:2px solid #f6c437; border-left:6px solid #f6c437;
          box-shadow:0 6px 0 rgba(3,7,16,.75), 0 0 26px rgba(246,196,55,.35);
        }
        #cine-card .cine-orb { width:30px; height:30px; border-radius:50%; border:2px solid #0a0f1b; box-shadow:inset 0 -6px 10px rgba(0,0,0,.45), 0 0 14px currentColor; }
        #cine-card .cine-orb.poke { background:linear-gradient(180deg,#d90429 50%,#fff 50%); color:#ff5566; }
        #cine-card .cine-orb.great { background:linear-gradient(180deg,#2468c7 50%,#f14b3e 50%); color:#5fa8ff; }
        #cine-card .cine-orb.ultra { background:linear-gradient(180deg,#1b1b20 50%,#f3c532 50%); color:#ffd34d; }
        #cine-card .cine-copy { display:flex; flex-direction:column; line-height:1; }
        #cine-target { font-family:'Teko','Impact',sans-serif; font-size:26px; letter-spacing:1.4px; color:#fff; text-shadow:2px 2px #08152b; }
        #cine-sub { font-size:11px; font-weight:800; letter-spacing:1.6px; color:#f6c437; }
        #cine-pips { display:flex; gap:6px; margin-left:8px; }
        .cine-pip { width:13px; height:13px; border-radius:50%; border:2px solid #7d93b5; background:#0a1428; transition:all .12s ease; }
        .cine-pip.lit { border-color:#fff2a7; background:radial-gradient(circle at 40% 35%,#fff,#f6c437 60%,#a85d00); box-shadow:0 0 12px #f6c437; transform:scale(1.18); }
        /* The caption rides inside the lower bar so it never fights the ball. */
        /* Release meter: the one input the cutscene takes. */
        #cine-meter {
          position:absolute; left:50%; top:calc(13vh + 84px); transform:translateX(-50%) skew(-7deg);
          width:min(460px,52vw); height:26px; background:linear-gradient(180deg,#0a1428,#060d1c);
          border:2px solid #7d93b5; box-shadow:0 4px 0 rgba(3,7,16,.7), inset 0 0 18px rgba(0,0,0,.7);
        }
        #cine-meter.spent { border-color:#f6c437; }
        #cine-meter .meter-zone {
          position:absolute; top:0; bottom:0; background:linear-gradient(180deg,#ffe99a,#f6c437 55%,#a85d00);
          box-shadow:0 0 16px rgba(246,196,55,.8);
        }
        #cine-meter .meter-zone::after {
          content:''; position:absolute; left:50%; top:0; bottom:0; width:2px; margin-left:-1px; background:rgba(255,255,255,.85);
        }
        #cine-meter .meter-marker {
          position:absolute; top:-5px; bottom:-5px; width:5px; margin-left:-2px; background:#fff;
          box-shadow:0 0 12px #fff, 0 0 26px #8ee7ff;
        }
        #cine-grade {
          position:absolute; left:50%; top:calc(13vh + 118px); transform:translateX(-50%) skew(-7deg);
          font-family:'Teko','Impact',sans-serif; font-size:30px; letter-spacing:2px; white-space:nowrap;
        }
        #cine-grade.perfect { color:#fff3b0; text-shadow:0 0 16px #f6c437, 2px 3px #7a3d00; }
        #cine-grade.good { color:#b9f0ff; text-shadow:0 0 14px #00f0ff, 2px 3px #06283d; }
        #cine-grade.wide { color:#ffb3b3; text-shadow:2px 3px #55070f; }
        /* The pre-throw instruction runs longer than a grade word, so it gets its own size and can wrap. */
        #cine-grade.hint {
          font-size:18px; letter-spacing:1px; white-space:normal; color:#cfe3ff;
          width:min(440px,80vw); text-align:center;
        }
        #cine-grade.hint .cine-cancel-hint { color:#ffb3b3; }

        /* Trophy card: the payoff beat after the ball locks. */
        #capture-trophy {
          position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) skew(-6deg) scale(.85);
          z-index:62; min-width:330px; padding:16px 22px; opacity:0; pointer-events:none;
          background:linear-gradient(180deg,#16305a 0%,#07142a 100%);
          border:3px solid #f6c437; box-shadow:0 10px 0 rgba(3,7,16,.8), 0 0 54px rgba(246,196,55,.5);
          transition:opacity .25s ease, transform .35s cubic-bezier(.16,1.3,.5,1);
        }
        #capture-trophy.shown { opacity:1; transform:translate(-50%,-50%) skew(-6deg) scale(1); }
        #capture-trophy .trophy-kicker { font-size:11px; font-weight:800; letter-spacing:3px; color:#f6c437; }
        #capture-trophy .trophy-name { font-family:'Teko','Impact',sans-serif; font-size:44px; line-height:1; color:#fff; text-shadow:3px 4px #08152b; }
        #capture-trophy .trophy-type { display:inline-block; margin:4px 0 10px; padding:2px 9px; font-size:11px; font-weight:800; letter-spacing:1.4px; border-radius:3px; color:#071326; }
        #capture-trophy .trophy-moves { display:flex; flex-direction:column; gap:4px; border-top:1px solid rgba(246,196,55,.35); padding-top:9px; }
        #capture-trophy .trophy-move { display:flex; justify-content:space-between; gap:18px; font-size:12px; letter-spacing:.6px; color:#cfe3ff; }
        #capture-trophy .trophy-move em { color:#8faecf; font-style:normal; font-size:10px; letter-spacing:1.4px; }
        #capture-trophy .trophy-nickname-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
        #capture-trophy .trophy-nickname-row input { min-width:110px; flex:1 1 110px; }
        #capture-trophy.has-model { display:flex; align-items:center; gap:18px; }
        #capture-trophy .trophy-stage {
          flex:0 0 150px; height:176px; overflow:hidden; border:2px solid rgba(246,196,55,.55);
          background:radial-gradient(ellipse at 50% 88%, rgba(246,196,55,.4) 0 22%, transparent 48%), radial-gradient(circle at 50% 40%, #2a5596 0%, #0b1d3c 72%);
          box-shadow:inset 0 0 22px rgba(0,0,0,.6);
        }
        #capture-trophy .trophy-canvas { display:block; width:100%; height:100%; transform:skew(6deg) scale(1.12); }
        @media (max-width: 480px) {
          #capture-trophy.has-model { flex-direction:column; gap:10px; min-width:0; width:min(88vw,330px); }
          #capture-trophy .trophy-stage { flex-basis:auto; width:100%; height:150px; }
        }

        /* Defeat: the only screen that stops a run. */
        #defeat-screen {
          position:absolute; inset:0; z-index:70; display:grid; place-items:center;
          background:radial-gradient(ellipse at 50% 40%, rgba(60,6,14,.72), rgba(3,7,16,.92) 75%);
        }
        #defeat-screen[hidden] { display:none; }
        #defeat-screen .defeat-card {
          min-width:340px; padding:22px 30px; text-align:center; transform:skew(-6deg);
          background:linear-gradient(180deg,#16305a 0%,#07142a 100%);
          border:3px solid #d90429; box-shadow:0 10px 0 rgba(3,7,16,.8), 0 0 54px rgba(217,4,41,.45);
        }
        #defeat-screen .defeat-kicker { font-size:11px; font-weight:800; letter-spacing:3px; color:#ff6b7d; }
        #defeat-screen .defeat-title { font-family:'Teko','Impact',sans-serif; font-size:56px; line-height:1; color:#fff; text-shadow:3px 4px #08152b; margin:4px 0; }
        #defeat-screen .defeat-detail { font-size:13px; letter-spacing:1px; color:#cfe3ff; margin-bottom:16px; }
        #defeat-screen .defeat-actions { display:flex; gap:10px; justify-content:center; }
        #defeat-screen .defeat-actions .stadium-btn { padding:8px 22px; }

        #cine-caption {
          position:absolute; left:50%; bottom:calc(6.5vh - 26px); transform:translateX(-50%) skew(-7deg);
          font-family:'Teko','Impact',sans-serif; font-size:40px; letter-spacing:2px; color:#fff;
          text-shadow:0 0 18px rgba(0,0,0,.9), 3px 4px #0a1428; white-space:nowrap;
        }
        #cine-verdict {
          position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) skew(-8deg) scale(1);
          font-family:'Teko','Impact',sans-serif; font-size:104px; line-height:.85; letter-spacing:3px;
          white-space:nowrap; opacity:0; text-align:center;
        }
        #cine-verdict.caught { opacity:1; color:#fff3b0; text-shadow:0 0 30px #f6c437, 4px 6px #7a3d00, 0 0 70px rgba(246,196,55,.7); animation:cine-slam .45s cubic-bezier(.14,1.5,.4,1) forwards; }
        #cine-verdict.broke { opacity:1; color:#ffd7d7; text-shadow:0 0 26px #ff3b3b, 4px 6px #55070f; animation:cine-shatter .4s ease-out forwards; }
        @keyframes cine-slam { 0% { opacity:1; transform:translate(-50%,-50%) skew(-8deg) scale(2.4); } 70% { opacity:1; transform:translate(-50%,-50%) skew(-8deg) scale(.92); } 100% { opacity:1; transform:translate(-50%,-50%) skew(-8deg) scale(1); } }
        @keyframes cine-shatter { 0% { opacity:1; transform:translate(-50%,-50%) skew(-8deg) scale(.6) rotate(-6deg); } 60% { opacity:1; transform:translate(-50%,-52%) skew(-8deg) scale(1.12) rotate(2deg); } 100% { opacity:1; transform:translate(-50%,-50%) skew(-8deg) scale(1.02) rotate(0); } }
        @media (prefers-reduced-motion: reduce) { #cine-verdict.caught, #cine-verdict.broke { animation:none; opacity:1; } }

        #capture-hint { position:absolute; bottom:296px; left:18px; color:#fff2a7; font-weight:800; letter-spacing:.8px; text-shadow:0 2px 3px #000; z-index:31; background:rgba(9,25,51,.88); border-left:3px solid #f6c437; padding:6px 10px; }
        #capture-hint:empty { display:none; }
        #signature-bar {
          position:absolute; left:18px; bottom:18px; z-index:31;
          display:flex; flex-wrap:wrap-reverse; gap:10px 8px; max-width:calc(100% - 520px);
        }
        #signature-bar:empty { display:none; }
        .sig-btn {
          position:relative; display:grid; grid-template-columns:30px auto; align-items:center; gap:2px 7px;
          min-width:118px; padding:5px 9px 5px 6px; border:2px solid #b9d1e2; border-radius:0;
          background:linear-gradient(180deg,#3b75aa,#11345f); color:#fff; cursor:pointer; text-align:left;
          box-shadow:2px 2px 0 rgba(0,0,0,.45), inset 0 1px rgba(255,255,255,.28);
          font-family:'Teko','Impact',sans-serif;
        }
        .sig-btn:hover:not(:disabled) { border-color:#ffd700; box-shadow:0 0 12px rgba(255,215,0,.5); }
        .sig-btn:disabled { opacity:.45; cursor:not-allowed; }
        .sig-btn.aiming { border-color:#ffd700; background:linear-gradient(180deg,#8a6a12,#3d2c06); }
        .sig-mark { grid-row:span 2; width:30px; height:30px; display:grid; place-items:center; border:1.5px solid #fff0ad; }
        .sig-name { font-size:18px; line-height:.85; letter-spacing:.4px; white-space:nowrap; }
        .sig-meta { display:flex; align-items:center; gap:5px; font-size:11px; line-height:.9; letter-spacing:.8px; color:#bcd7ec; white-space:nowrap; }
        .sig-pp { display:flex; gap:2px; }
        .sig-pp i { width:7px; height:7px; border:1px solid #fff4af; background:#07182f; }
        .sig-pp i.on { background:#f6c437; }
        .sig-key { position:absolute; top:-8px; right:-6px; min-width:16px; padding:1px 3px; background:#f6c437; color:#07162f; font-size:13px; line-height:1; text-align:center; border:1px solid #07162f; }
        .pause-setting { margin-top:10px; font-size:12px; }
        .pause-audio { display:grid; grid-template-columns:64px 1fr 34px; align-items:center; gap:8px; margin-top:10px; font-size:11px; letter-spacing:1px; color:#bcd7ec; }
        .pause-audio input { width:100%; accent-color:#f6c437; }
        .pause-audio output { color:#f6c437; text-align:right; }
        #capture-kit { position:absolute; left:18px; bottom:88px; z-index:30; padding:8px 10px; display:grid; gap:5px; }
        .capture-kit-title { color:#f6c437; font-family:'Teko','Impact',sans-serif; font-size:15px; line-height:.9; letter-spacing:1.2px; }
        .capture-row { display:grid; grid-template-columns:1fr auto; gap:5px; }
        .ball-stock { display:grid; grid-template-columns:18px 1fr auto; align-items:center; gap:7px; min-width:118px; padding:4px 8px 4px 6px; border:2px solid transparent; border-radius:6px; background:#07182f; color:#fff; cursor:pointer; text-align:left; font-family:'Teko','Impact',sans-serif; font-size:17px; letter-spacing:.6px; }
        .ball-stock:hover:not(:disabled) { border-color:#7fa6c9; background:#123766; }
        .ball-stock.selected { border-color:#ffe766; background:linear-gradient(180deg,#765a0d,#302205); box-shadow:0 0 10px rgba(255,215,0,.4); }
        .ball-stock.selected::after { content:'READY'; grid-column:1 / -1; color:#ffe766; font-size:11px; line-height:.7; letter-spacing:1.4px; text-align:center; }
        .ball-stock.selected.empty::after { content:'EMPTY'; color:#ff9b8e; }
        .ball-stock.empty { opacity:.45; }
        .ball-stock:disabled { cursor:not-allowed; filter:saturate(.35); }
        .ball-count { display:inline-block; color:#f6c437; }
        .ball-buy:disabled { cursor:not-allowed; }
        .ball-buy.poor { opacity:.6; filter:saturate(.45); color:#ff6b6b; }
        .ball-buy.locked {
          opacity:.85; color:#9fb4cf; font-size:11px; letter-spacing:.3px;
          background: repeating-linear-gradient(45deg, #0d1a30, #0d1a30 4px, #16273f 4px, #16273f 8px);
          border-color:#3a608f;
        }

        /* ---- Catching: one-click tags over weakened Pokémon and the CATCH NOW tray ---- */
        #catch-layer { position:absolute; inset:0; z-index:29; pointer-events:none; overflow:hidden; }
        .catch-tag {
          position:absolute; left:0; top:0; height:${CATCH_TAG_HEIGHT}px; display:flex; align-items:center; gap:5px;
          padding:0 8px 0 4px; border:2px solid #fff3a6; border-radius:12px; cursor:pointer; pointer-events:auto;
          background:linear-gradient(180deg,#ffe766,#e7a312); color:#1a1204; white-space:nowrap;
          font-family:'Teko','Impact',sans-serif; font-size:17px; line-height:1; letter-spacing:.6px;
          box-shadow:0 0 0 2px #5c3a05, 0 3px 6px rgba(0,0,0,.5); will-change:transform;
          animation:catch-tag-pulse 1.1s ease-in-out infinite;
        }
        .catch-tag::after {
          content:''; position:absolute; left:50%; top:100%; width:2px; height:var(--stem,6px);
          background:#ffe766; box-shadow:0 0 0 1px #5c3a05; transform:translateX(-50%);
        }
        .catch-tag:hover:not(:disabled) { background:linear-gradient(180deg,#fff,#ffd84a); animation:none; }
        .catch-tag:disabled { opacity:.48; cursor:not-allowed; animation:none; filter:saturate(.35); }
        .catch-tag.elite { border-color:#8ee7ff; }
        .catch-tag.titan { border-color:#ff8a4d; }
        .catch-tag .ball-icon { width:14px; height:14px; }
        @keyframes catch-tag-pulse { 50% { box-shadow:0 0 0 2px #5c3a05, 0 0 14px 3px rgba(255,224,90,.75); } }
        @media (prefers-reduced-motion: reduce) { .catch-tag { animation:none; } }
        .catch-odds { min-width:38px; text-align:right; color:#8dff8d; }
        .catch-key { position:relative; min-width:15px; padding:1px 3px; background:#f6c437; color:#07162f; font-size:13px; text-align:center; border:1px solid #07162f; }
        #catch-tray { display:grid; gap:4px; padding-bottom:6px; margin-bottom:2px; border-bottom:1px solid #476f99; }
        #catch-tray[hidden] { display:none; }
        .catch-tray-title { display:flex; align-items:center; gap:6px; color:#ffe766; font-family:'Teko','Impact',sans-serif; font-size:16px; line-height:.9; letter-spacing:1.2px; }
        .catch-chips { display:flex; flex-wrap:wrap; gap:4px; max-width:196px; }
        .catch-chip {
          display:flex; align-items:center; gap:4px; padding:2px 7px 2px 4px; border:2px solid #f6c437; border-radius:10px;
          background:#2a2106; color:#fff3b0; cursor:pointer; font-family:'Teko','Impact',sans-serif; font-size:15px; line-height:1; letter-spacing:.5px;
        }
        .catch-chip:hover:not(:disabled) { background:#f6c437; color:#1a1204; }
        .catch-chip:disabled { opacity:.48; cursor:not-allowed; filter:saturate(.35); }
        .catch-chip .catch-odds { min-width:auto; margin-left:2px; }
        .catch-chip i { width:7px; height:7px; border-radius:50%; border:1px solid rgba(0,0,0,.6); }
        .ball-buy { min-width:58px; padding:4px 7px; color:#8dff8d; }
        .ball-count.bump { animation:ball-count-bump .35s ease-out; }
        @keyframes ball-count-bump { 40% { transform:scale(1.45); color:#fff; } }
        .ball-icon { width:16px; height:16px; border-radius:50%; border:1px solid #111; box-shadow:0 1px 0 #000;
          background:radial-gradient(circle, #fff 0 2.5px, #111 2.5px 4px, transparent 4px), linear-gradient(180deg, #d90429 46%, #111 46% 54%, #f4f4f4 54%); }
        .ball-icon.great { background:radial-gradient(circle, #fff 0 2.5px, #111 2.5px 4px, transparent 4px), linear-gradient(90deg, transparent 22%, #e8283a 22% 34%, transparent 34% 66%, #e8283a 66% 78%, transparent 78%) top/100% 46% no-repeat, linear-gradient(180deg, #2f6fd6 46%, #111 46% 54%, #f4f4f4 54%); }
        .ball-icon.ultra { background:radial-gradient(circle, #fff 0 2.5px, #111 2.5px 4px, transparent 4px), linear-gradient(90deg, transparent 26%, #f6c437 26% 40%, transparent 40% 60%, #f6c437 60% 74%, transparent 74%) top/100% 46% no-repeat, linear-gradient(180deg, #222 46%, #111 46% 54%, #f4f4f4 54%); }

        /* Controls (Top Right) */
        #controls-bar {
          position: absolute;
          top: 14px;
          right: 20px;
          display: flex;
          gap: 8px;
          z-index: 30;
        }

        .stadium-btn {
          background: linear-gradient(180deg, #2b4870 0%, #162a45 100%);
          color: #fff;
          border: 1.5px solid #5280b8;
          border-radius: 4px;
          padding: 6px 14px;
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .stadium-btn:hover {
          background: linear-gradient(180deg, #3d68a0 0%, #1f3b61 100%);
          border-color: #00f0ff;
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
        }

        .stadium-btn.active {
          background: linear-gradient(180deg, #ffd700 0%, #e08b00 100%);
          color: #051329;
          border-color: #fff;
          font-weight: 800;
        }

        /* Tower Roster (Right Rail) */
        #card-deck {
          position: absolute;
          top: 82px;
          right: 14px;
          bottom: 14px;
          width: 150px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 9px;
          overflow-y: auto;
          overflow-x: hidden;
          box-sizing: border-box;
          z-index: 30;
          scrollbar-width: thin;
          scrollbar-color: #5280b8 #071326;
        }

        .tower-rail-header {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px 3px 7px;
          border-bottom: 1px solid rgba(82, 128, 184, 0.65);
          text-align: center;
        }

        .tower-rail-title {
          display: block;
          color: #ffd700;
          font-family: 'Impact', sans-serif;
          font-size: 16px;
          letter-spacing: 1.2px;
        }

        #placement-hint {
          display: block;
          min-height: 22px;
          margin-top: 2px;
          color: #8faecf;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.15;
          letter-spacing: 0.65px;
          text-transform: uppercase;
        }

        #placement-hint:empty {
          min-height: 0;
          margin-top: 0;
        }

        .tower-card {
          width: 100%;
          min-height: 70px;
          flex: 0 0 70px;
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 1fr;
          align-items: center;
          gap: 3px 5px;
          padding: 7px 8px;
          box-sizing: border-box;
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s;
          position: relative;
          text-align: left;
        }

        .tower-card:hover {
          transform: translateX(-6px);
          border-color: #ffd700;
          box-shadow: 7px 4px 20px rgba(0, 0, 0, 0.8), 0 0 15px rgba(255, 215, 0, 0.3);
        }

        .tower-card.selected {
          border-color: #00f0ff;
          box-shadow: 0 0 20px rgba(0, 240, 255, 0.6);
          transform: translateX(-8px);
        }

        .tower-card.selected::before {
          content: '';
          position: absolute;
          top: 8px;
          bottom: 8px;
          left: -4px;
          width: 3px;
          border-radius: 2px;
          background: #00f0ff;
          box-shadow: 0 0 8px #00f0ff;
        }

        .tower-card.disabled { opacity: 0.4; filter: grayscale(0.7); cursor: not-allowed; }

        .card-type-tag {
          grid-column: 1 / -1;
          justify-self: start;
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 50%;
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8);
          letter-spacing: 0.5px;
        }

        .card-name {
          font-family: 'Impact', sans-serif;
          font-size: 14px;
          letter-spacing: 0.5px;
          color: #fff;
          white-space: nowrap;
        }

        .card-cost {
          font-family: 'Rajdhani', sans-serif;
          font-size: 16px;
          font-weight: 800;
          color: #ffd700;
        }

        @media (max-height: 650px) {
          .tower-card { min-height: 62px; flex-basis: 62px; }
        }

        /* Announcer Banner */
        #announcer-banner {
          position: absolute;
          top: 143px;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 25;
          display: none;
          text-align: center;
        }

        .banner-inner {
          display: inline-block;
          background: linear-gradient(90deg, transparent 0%, rgba(217, 4, 41, 0.95) 15%, rgba(217, 4, 41, 0.95) 85%, transparent 100%);
          border-top: 2.5px solid #ffd700;
          border-bottom: 2.5px solid #ffd700;
          padding: 8px 42px;
          font-family: 'Impact', sans-serif;
          font-size: 28px;
          letter-spacing: 2px;
          color: #fff;
          text-shadow: 0 3px 6px rgba(0,0,0,0.9), 0 0 15px #ffd700;
          transform: skew(-6deg);
        }

        /* ------------------------------------------------------------------
           Tower Detail Panel — move shop
           ------------------------------------------------------------------ */
        #tower-panel {
          position: absolute;
          top: 122px;
          right: 176px;
          width: 312px;
          max-height: calc(100% - 136px);
          display: none;
          flex-direction: column;
          padding: 0;
          overflow: hidden;
          z-index: 34;
        }

        #tower-panel.open { display: flex; }

        .tp-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: linear-gradient(180deg, #1d3c68 0%, #0d2140 100%);
          border-bottom: 2px solid #3a608f;
        }

        .tp-title {
          flex: 1;
          font-family: 'Impact', sans-serif;
          font-size: 19px;
          letter-spacing: 1px;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tp-stage-pips { display: flex; gap: 3px; }

        .tp-stage-pip {
          width: 9px;
          height: 9px;
          transform: rotate(45deg);
          background: #0a1526;
          border: 1px solid #5280b8;
        }

        .tp-stage-pip.on { background: #ffd700; border-color: #fff; box-shadow: 0 0 6px #ffd700; }

        .tp-close {
          width: 22px;
          height: 22px;
          flex: 0 0 auto;
          border-radius: 3px;
          border: 1px solid #5280b8;
          background: #0d2140;
          color: #8faecf;
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
        }

        .tp-close:hover { border-color: #ff3333; color: #ff6666; }

        .tp-crest {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 9px 10px 0;
          padding: 9px 10px;
          border-radius: 5px;
          border: 1px solid #3a608f;
        }

        .tp-crest-mark {
          width: 46px;
          height: 46px;
          flex: 0 0 auto;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid rgba(255,255,255,0.5);
        }

        .tp-crest-meta { flex: 1; min-width: 0; }

        .tp-crest-type {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.2px;
          color: #fff;
        }

        .tp-matchup {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.4px;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tp-target {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin: 7px 10px 0;
          padding: 4px 6px;
          border-radius: 4px;
          border: 1px solid #3a608f;
          background: #0a1a30;
        }

        .tp-arrow {
          width: 24px;
          height: 22px;
          border-radius: 3px;
          border: 1px solid #5280b8;
          background: linear-gradient(180deg, #2b4870, #162a45);
          color: #fff;
          font-size: 12px;
          line-height: 1;
          cursor: pointer;
        }

        .tp-arrow:hover { border-color: #00f0ff; box-shadow: 0 0 8px rgba(0,240,255,0.45); }

        .tp-target-label {
          flex: 1;
          text-align: center;
          font-family: 'Impact', sans-serif;
          font-size: 14px;
          letter-spacing: 1.4px;
          color: #ffd700;
        }

        .tp-target-cap {
          display: block;
          font-family: 'Rajdhani', sans-serif;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 1.2px;
          color: #8faecf;
        }

        .tp-lines {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 9px 10px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #5280b8 #071326;
        }

        .tp-line {
          display: grid;
          grid-template-columns: 14px 1fr 92px;
          align-items: stretch;
          gap: 6px;
          padding: 5px;
          border-radius: 5px;
          border: 1px solid #2d4a72;
          background: rgba(9, 26, 48, 0.85);
        }

        .tp-pips {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
        }

        .tp-pip {
          height: 11px;
          border-radius: 2px;
          background: #0a1526;
          border: 1px solid #3a608f;
        }

        .tp-pip.on { background: #ffd700; border-color: #fff; box-shadow: 0 0 5px rgba(255,215,0,0.7); }

        .tp-line-meta {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
        }

        .tp-line-label {
          font-size: 8.5px;
          font-weight: 800;
          letter-spacing: 1.3px;
          color: #6f92bb;
        }

        .tp-line-move {
          font-family: 'Impact', sans-serif;
          font-size: 14px;
          letter-spacing: 0.6px;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tp-line-move.empty { color: #55749a; font-style: italic; }

        .tp-line-stats {
          font-size: 9px;
          font-weight: 700;
          color: #8faecf;
          letter-spacing: 0.3px;
          line-height: 1.15;
        }

        .tp-buy {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          padding: 4px 3px;
          border-radius: 5px;
          border: 1.5px solid #5280b8;
          background: linear-gradient(180deg, #21375c 0%, #0e1f38 100%);
          cursor: pointer;
          text-align: center;
          transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
        }

        .tp-buy:hover:not(.locked):not(.maxed):not(.poor) {
          border-color: #ffd700;
          box-shadow: 0 0 12px rgba(255, 215, 0, 0.45);
          transform: translateY(-1px);
        }

        .tp-buy-name {
          font-size: 8.5px;
          font-weight: 800;
          letter-spacing: 0.4px;
          color: #cfe2f7;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }

        .tp-buy-cost {
          font-family: 'Rajdhani', sans-serif;
          font-size: 14px;
          font-weight: 800;
          color: #ffd700;
          line-height: 1;
        }

        .tp-buy.poor { opacity: 0.5; cursor: not-allowed; }
        .tp-buy.poor .tp-buy-cost { color: #ff6b6b; }

        .tp-buy.locked {
          opacity: 0.65;
          cursor: not-allowed;
          border-color: #3a608f;
          background: repeating-linear-gradient(
            45deg, #101f36, #101f36 5px, #16273f 5px, #16273f 10px
          );
        }

        .tp-buy.maxed {
          cursor: default;
          border-color: #ffd700;
          background: linear-gradient(180deg, #3a2f10 0%, #1c1707 100%);
        }

        .tp-line.closed { opacity: 0.45; }

        .tp-buy-warn {
          font-size: 7.5px;
          font-weight: 800;
          letter-spacing: 0.3px;
          color: #ff9a6b;
          line-height: 1.05;
        }

        .tp-attack {
          display: block;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.6px;
          color: #fff;
        }

        .tp-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }

        .tp-chip {
          font-size: 7.5px;
          font-weight: 800;
          letter-spacing: 0.6px;
          padding: 1px 4px;
          border: 1px solid currentColor;
          color: #cfe2f7;
        }
        .tp-chip.heavy { color: #ff7a7a; }
        .tp-chip.sees-phantoms { color: #c3a8ff; }
        .tp-chip.ground-only { color: #e0c068; }

        .tp-buy-note {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.5px;
          color: #8faecf;
          line-height: 1.1;
        }

        .tp-evolve {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 0 10px;
          padding: 7px 10px;
          border-radius: 5px;
          border: 1.5px solid #00f0ff;
          background: linear-gradient(180deg, #113a52 0%, #08202f 100%);
          cursor: pointer;
          transition: box-shadow 0.15s;
        }

        .tp-evolve:hover:not(.poor):not(.final) { box-shadow: 0 0 14px rgba(0, 240, 255, 0.55); }
        .tp-evolve.poor { opacity: 0.55; cursor: not-allowed; }

        .tp-evolve.final {
          cursor: default;
          border-color: #ffd700;
          background: linear-gradient(180deg, #3a2f10 0%, #1c1707 100%);
        }

        .tp-evolve-label {
          font-family: 'Impact', sans-serif;
          font-size: 14px;
          letter-spacing: 1px;
          color: #00f0ff;
        }

        .tp-evolve.final .tp-evolve-label { color: #ffd700; }

        .tp-evolve-sub {
          display: block;
          font-family: 'Rajdhani', sans-serif;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1px;
          color: #8faecf;
        }

        .tp-evolve-cost {
          font-family: 'Rajdhani', sans-serif;
          font-size: 17px;
          font-weight: 800;
          color: #ffd700;
        }

        .tp-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 10px;
          border-top: 2px solid #3a608f;
          background: linear-gradient(180deg, #0d2140 0%, #071326 100%);
        }

        .tp-sell-value {
          flex: 1;
          font-family: 'Rajdhani', sans-serif;
          font-size: 16px;
          font-weight: 800;
          color: #48ff48;
        }

        .tp-sell-value span {
          display: block;
          font-size: 8px;
          letter-spacing: 1.2px;
          color: #8faecf;
        }

        .tp-sell-btn {
          padding: 7px 24px;
          border-radius: 4px;
          border: 1.5px solid #ff6b6b;
          background: linear-gradient(180deg, #a8121f 0%, #6d0b14 100%);
          color: #fff;
          font-family: 'Impact', sans-serif;
          font-size: 15px;
          letter-spacing: 1.6px;
          cursor: pointer;
        }

        .tp-sell-btn:hover { background: linear-gradient(180deg, #d90429 0%, #8c0c19 100%); box-shadow: 0 0 12px rgba(217,4,41,0.6); }

        @media (max-width: 1100px) {
          #tower-panel { right: 172px; width: 272px; }
          .tp-line { grid-template-columns: 12px 1fr 84px; }
        }

        /* ------------------------------------------------------------------
           Stadium menu skin

           The original presentation leans on physical broadcast hardware:
           pale metal edging, a deep blue enamel field, gold title strips and
           red confirmation keys.  These rules intentionally sit on top of
           the TD layout above so the information architecture stays intact.
           ------------------------------------------------------------------ */
        .stadium-panel {
          --plate-dark: #07152c;
          --plate-blue: #123c73;
          --plate-mid: #1b5c9e;
          --plate-light: #c5d7e7;
          --plate-gold: #f6c437;
          --plate-red: #b41927;
          position: relative;
          border: 2px solid #d0e0eb;
          border-radius: 0;
          background:
            linear-gradient(135deg, rgba(255,255,255,.16), transparent 22%),
            repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px),
            linear-gradient(180deg, #1a4e86 0%, #0b2b59 9%, #081d42 10%, #07172f 100%);
          box-shadow:
            0 0 0 2px #173c65,
            0 0 0 4px rgba(3, 10, 25, .88),
            4px 6px 0 rgba(0, 0, 0, .52),
            inset 0 1px 0 rgba(255,255,255,.65),
            inset 0 -2px 0 rgba(0,0,0,.55);
        }

        .stadium-panel::after {
          content: '';
          position: absolute;
          inset: 5px;
          pointer-events: none;
          border-top: 1px solid rgba(255,255,255,.20);
          border-bottom: 1px solid rgba(0,0,0,.35);
        }

        .gold-glow { text-shadow: 1px 2px 0 #75410b, 0 0 7px rgba(246,196,55,.5); }
        .cyan-glow { text-shadow: 1px 2px 0 #063345, 0 0 7px rgba(83,224,255,.5); }

        #top-bar {
          gap: 19px;
          min-height: 61px;
          padding: 7px 13px 7px 18px;
          clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px);
        }

        #start-match-bar {
          min-height: 61px;
          padding: 7px 22px;
          align-items: center;
          clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px);
        }

        #top-bar::before, #card-deck::before, #tower-panel::before, #start-match-bar::before {
          content: '';
          position: absolute;
          z-index: 1;
          width: 5px;
          height: 5px;
          top: 5px;
          left: 5px;
          background: #f8e7a5;
          border-radius: 50%;
          box-shadow: calc(100% + 0px) 0 #f8e7a5, 0 calc(100% + 0px) #f8e7a5;
        }

        .stat-badge { position: relative; z-index: 2; min-width: 64px; }
        .stat-label { color: #d9eafa; font-family: 'Teko', sans-serif; font-size: 12px; line-height: .9; letter-spacing: 1.15px; text-shadow: 1px 1px #102344; }
        .stat-value { font-family: 'Teko', 'Impact', sans-serif; font-size: 29px; line-height: .92; letter-spacing: .65px; }

        .pokeball-tray { padding: 3px 5px; background: #061126; border: 1px solid #476f99; box-shadow: inset 0 1px 2px #000; }
        .ui-pokeball { width: 17px; height: 17px; border: 1px solid #e3e7e8; box-shadow: 0 1px 0 #000, inset 0 1px 1px rgba(255,255,255,.5); }

        #controls-bar { gap: 5px; }
        .stadium-btn {
          position: relative;
          border: 1px solid #c5d7e7;
          border-radius: 0;
          padding: 5px 11px;
          background: linear-gradient(180deg, #4c85b9 0 12%, #1b548e 14%, #113969 52%, #0a2348 100%);
          box-shadow: 0 0 0 1px #10294e, 2px 3px 0 rgba(0,0,0,.48), inset 0 1px rgba(255,255,255,.45);
          color: #fff;
          font-family: 'Teko', sans-serif;
          font-size: 17px;
          line-height: 1;
          letter-spacing: .8px;
          text-shadow: 1px 1px #061428;
        }
        .stadium-btn:hover { background: linear-gradient(180deg, #77afdf, #276ca8 50%, #113f72); border-color: #fff; box-shadow: 0 0 0 1px #f6c437, 2px 3px 0 rgba(0,0,0,.48), inset 0 1px rgba(255,255,255,.6); }
        .stadium-btn.active { background: linear-gradient(180deg, #ffdd59 0 12%, #f5b928 14%, #d97a16 58%, #a8430e 100%); border-color: #fff4b4; color: #18233b; text-shadow: 1px 1px rgba(255,255,255,.45); }
        #btn-wave { background: linear-gradient(180deg, #ef5961 0 12%, #c52c35 14%, #921522 60%, #64101c 100%); color: #fff9db; border-color: #ffd2a5; text-shadow: 1px 1px #4e0710; }

        #card-deck { width: 154px; padding: 8px; border-color: #c8d7e5; }
        .tower-rail-header { position: relative; z-index: 2; padding: 3px 5px 8px; border-bottom: 2px solid #e2b533; background: linear-gradient(90deg, #b47c13, #f1c83c 42%, #b67b10); }
        .tower-rail-title { color: #102442; font-family: 'Teko', sans-serif; font-size: 16px; line-height: .9; letter-spacing: .2px; white-space: nowrap; text-shadow: 1px 1px rgba(255,255,255,.55); }
        #placement-hint { color: #172f4e; font-size: 8px; line-height: 1.2; letter-spacing: .55px; }
        .tower-card {
          min-height: 69px;
          flex-basis: 69px;
          border: 1px solid #9fc2df;
          border-radius: 0;
          background: linear-gradient(135deg, rgba(255,255,255,.16), transparent 32%), linear-gradient(180deg, #245d96, #0d2d59 55%, #071a37);
          box-shadow: 2px 3px 0 rgba(0,0,0,.42), inset 0 1px rgba(255,255,255,.32);
        }
        .tower-card:hover { transform: translateX(-4px); border-color: #ffe06a; box-shadow: 2px 3px 0 rgba(0,0,0,.42), 0 0 0 2px #b77d15; }
        .tower-card.selected { border-color: #fff1a5; background: linear-gradient(135deg, rgba(255,255,255,.35), transparent 36%), linear-gradient(180deg, #356fa7, #16477e 55%, #0b2852); box-shadow: 2px 3px 0 rgba(0,0,0,.42), 0 0 0 2px #f1bf36; transform: translateX(-5px); }
        .tower-card.selected::before { left: -6px; width: 4px; border-radius: 0; background: #f6c437; box-shadow: none; }
        .card-type-tag { border-radius: 0; border: 1px solid rgba(255,255,255,.7); padding: 1px 5px; font-family: 'Teko', sans-serif; font-size: 12px; line-height: 1; letter-spacing: .5px; }
        .card-name { font-family: 'Teko', 'Impact', sans-serif; font-size: 18px; line-height: .9; letter-spacing: .2px; text-shadow: 1px 2px #07162e; }
        .card-cost { font-family: 'Teko', sans-serif; font-size: 19px; line-height: 1; color: #ffdc48; text-shadow: 1px 2px #583606; }

        .banner-inner { border: 2px solid #ffe786; border-left: 0; border-right: 0; border-radius: 0; background: linear-gradient(90deg, transparent 0%, #9d1626 11%, #d02d32 22%, #d02d32 78%, #9d1626 89%, transparent 100%); box-shadow: 0 3px 0 rgba(53,7,15,.75), inset 0 1px rgba(255,255,255,.45); font-family: 'Teko', 'Impact', sans-serif; font-size: 35px; line-height: .9; letter-spacing: 1.4px; text-shadow: 2px 3px #560915; transform: skew(-6deg); }

        #tower-panel { border-color: #d6e5ee; clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px); }
        .tp-header { padding: 7px 10px; border-bottom: 2px solid #e5b934; background: linear-gradient(180deg, #f5d15a 0 8%, #b77d16 10%, #563d1d 13%, #183f73 16%, #0e2852 100%); }
        .tp-title { font-family: 'Teko', 'Impact', sans-serif; font-size: 25px; line-height: .9; color: #fff9d7; letter-spacing: .7px; text-shadow: 2px 2px #07162f; }
        .tp-stage-pip { width: 8px; height: 8px; background: #07182f; border-color: #a4c5dd; }
        .tp-stage-pip.on { background: #f6c437; border-color: #fff4b0; box-shadow: 0 0 4px #f6c437; }
        .tp-close, .tp-arrow { border-radius: 0; border-color: #b9d1e2; background: linear-gradient(#3974a9, #12365f); color: #fff; }
        .tp-crest { border-radius: 0; border-color: #9dc0dc; box-shadow: inset 0 1px rgba(255,255,255,.28); }
        .tp-crest-mark { border-color: #fff0ad; box-shadow: 0 0 0 2px rgba(13,37,69,.75); }
        .tp-target { border-radius: 0; border-color: #739dc1; background: linear-gradient(180deg, #173e70, #0a2246); }
        .tp-target-label { font-family: 'Teko', 'Impact', sans-serif; font-size: 19px; line-height: .8; color: #ffe057; }
        .tp-target-cap, .tp-line-label, .tp-line-stats, .tp-buy-note, .tp-evolve-sub, .tp-sell-value span { font-family: 'Teko', sans-serif; font-size: 11px; line-height: .85; letter-spacing: .85px; color: #bcd7ec; }
        .tp-line { border-radius: 0; border-color: #4778a7; background: linear-gradient(135deg, rgba(255,255,255,.08), transparent 35%), #0a2348; }
        .tp-pip { border-radius: 0; border-color: #5f91bd; }
        .tp-pip.on { background: #f6c437; border-color: #fff4af; }
        .tp-line-move { font-family: 'Teko', 'Impact', sans-serif; font-size: 19px; line-height: .85; letter-spacing: .45px; }
        .tp-line-stats { line-height: 1.05; margin-top: 2px; }
        .tp-buy { border-radius: 0; border-color: #b9d1e2; background: linear-gradient(180deg, #3b75aa, #11345f); box-shadow: inset 0 1px rgba(255,255,255,.28); }
        .tp-buy.maxed, .tp-evolve.final { border-color: #f1c43f; background: linear-gradient(180deg, #77541a, #38270e); }
        .tp-evolve { border-radius: 0; border-color: #f4ca42; background: linear-gradient(180deg, #3e82a1, #0d4260 60%, #092d49); box-shadow: inset 0 1px rgba(255,255,255,.3); }
        .tp-evolve-label { font-family: 'Teko', 'Impact', sans-serif; font-size: 20px; line-height: .8; color: #fff0a3; }
        .tp-evolve-cost { font-family: 'Teko', sans-serif; font-size: 23px; line-height: .8; color: #ffe052; }
        .tp-footer { border-top-color: #d8b33a; background: linear-gradient(180deg, #14396b, #071a35); }
        .tp-sell-value { font-family: 'Teko', sans-serif; font-size: 22px; line-height: .85; }
        .tp-sell-btn { border-radius: 0; border-color: #ffd099; background: linear-gradient(180deg, #e34c50 0 10%, #b81e2a 13%, #7b101c 100%); font-family: 'Teko', 'Impact', sans-serif; font-size: 20px; line-height: .85; box-shadow: 2px 2px 0 rgba(0,0,0,.45), inset 0 1px rgba(255,255,255,.35); }
      </style>
      <link rel="stylesheet" href="${stadiumThemeUrl}">

      <div id="map-select" class="interactive" aria-label="Select a battlefield">
        <section class="map-select-panel stadium-panel">
          <div class="map-select-eyebrow">POKÉMON STADIUM TD / COURSE SELECT</div>
          <h1 class="map-select-title">CHOOSE YOUR BATTLEFIELD</h1>
          <p class="map-select-subtitle">Every course has a different way through. Find your team's home advantage.</p>
          <div class="map-filters" aria-label="Map difficulty">
            ${['all','easy','medium','hard'].map((filter,i)=>`<button class="stadium-btn map-filter ${i===0?'active':''}" data-difficulty="${filter}" aria-pressed="${i===0}">${filter.toUpperCase()}</button>`).join('')}
          </div>
          <div class="map-cards">
            ${STADIUM_MAPS.map(map=>`<button class="map-card interactive" data-map-id="${map.id}" data-map-difficulty="${map.difficulty}" aria-label="Play ${map.name}, ${map.difficulty}">
              ${mapPreview(map)}
              <span class="map-difficulty ${map.difficulty}">${map.difficulty.toUpperCase()}</span>
              <span class="map-card-body"><strong class="map-name">${map.name}</strong><span class="map-venue">${map.venue}</span>
              <span class="map-description">${map.description}</span>
              <span class="map-record" data-map-record="${map.id}"></span><span class="map-obstacles">${map.terrain?'3 TERRACES · HIGH GROUND':map.routes.length>1?'2 ENTRANCES · SPLIT DEFENSE':map.bridges.length?'2 BRIDGES · SHORE DEFENSE':map.theme==='canyon'?'HAIRPINS · TIGHT CLEARINGS':'LONG ROUTE · REPEAT COVERAGE'}</span></span>
            </button>`).join('')}
          </div>
          <div class="map-select-footer"><div class="map-legend"><span>Entrance</span><span>Exit</span></div><span>Choose a course, then pick your team.</span><button id="btn-open-team" class="stadium-btn">MY POKÉMON</button><button id="btn-resume-map" class="stadium-btn" hidden>RESUME MATCH</button></div>
        </section>
      </div>

      <!-- Top Bar -->
      <div id="top-bar" class="stadium-panel interactive">
        <div class="stat-badge">
          <span class="stat-label" id="cup-title">POKE CUP</span>
          <span class="stat-value gold-glow" id="round-number">ROUND 1</span>
        </div>
        <div class="stat-badge" aria-label="Available funds">
          <span class="stat-value" style="color: #48ff48;" id="prize-money">$400</span>
        </div>
        <div class="stat-badge">
          <span class="stat-label">STADIUM HP</span>
          <div class="pokeball-tray" id="stadium-hp"></div>
        </div>
      </div>

      <!-- Start Match -->
      <div id="start-match-bar" class="stadium-panel interactive">
        <button class="stadium-btn active" id="btn-wave">START MATCH</button>
      </div>

      <!-- Controls -->
      <div id="controls-bar" class="interactive">
        <div class="control-group" aria-label="Game speed">
          <span class="control-group-label">SPEED</span>
          <div class="control-group-buttons">
            <button class="stadium-btn" id="btn-speed-half">.5X</button>
            <button class="stadium-btn active" id="btn-speed-1">1X</button>
            <button class="stadium-btn" id="btn-speed-2">2X</button>
            <button class="stadium-btn" id="btn-speed-3">3X</button>
            <button class="stadium-btn" id="btn-speed-4">4X</button>
          </div>
        </div>
        <div class="control-group" aria-label="Camera">
          <span class="control-group-label">CAMERA</span>
          <div class="control-group-buttons">
            <button class="stadium-btn active" id="btn-cam-tactical">TACTICAL</button>
            <button class="stadium-btn" id="btn-cam-stadium">STADIUM</button>
            <button class="stadium-btn" id="btn-cam-action">ACTION</button>
          </div>
        </div>
      </div>

      <!-- Announcer Banner -->
      <div id="announcer-banner">
        <div class="banner-inner">
          <span class="pokeball-emblem" aria-hidden="true"></span>
          <span id="announcer-text">WHAT A BATTLE!</span>
          <span class="pokeball-emblem" aria-hidden="true"></span>
        </div>
      </div>

      <!-- Tower Purchase Roster -->
      <div id="card-deck" class="stadium-panel interactive"></div>

      <div id="storage-confirm" class="interactive" hidden>
        <section class="storage-confirm-card" role="dialog" aria-modal="true" aria-labelledby="storage-confirm-title">
          <div class="storage-confirm-kicker">SEND TO STORAGE?</div>
          <div id="storage-confirm-title" class="storage-confirm-title"></div>
          <p class="storage-confirm-copy">This Pokémon will leave the current match roster.</p>
          <div class="storage-confirm-actions">
            <button class="stadium-btn" type="button" data-storage-cancel>CANCEL</button>
            <button class="stadium-btn active" type="button" data-storage-confirm>CONFIRM</button>
          </div>
        </section>
      </div>

      <div id="capture-hint"></div>

      <!-- Catch tags immediately throw the ball selected in the capture kit -->
      <div id="catch-layer">
        <div class="catch-tags"></div>
      </div>

      <div id="pause-screen" class="interactive" hidden>
        <section class="pause-card stadium-panel" aria-labelledby="pause-title">
          <div class="pause-kicker">MATCH PAUSED</div>
          <h2 id="pause-title">TAKE A BREATHER</h2>
          <p>The stadium will wait for you.</p>
          <div class="pause-actions">
            <button class="stadium-btn active" id="btn-pause-resume">RESUME</button>
            <button class="stadium-btn" id="btn-pause-quit">QUIT TO COURSE SELECT</button>
          </div>
          <button class="stadium-btn pause-setting" id="btn-signature-cuts">SIGNATURE CAMERA CUTS: ON</button>
          <button class="stadium-btn pause-setting" id="btn-summon-cinematics">POKÉ BALL ENTRANCES: ON</button>
          <div class="pause-ui-scale">
            <label for="pause-ui-scale">UI SCALE</label>
            <select id="pause-ui-scale">
              <option value="auto">AUTO</option>
              <option value="1">100%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
              <option value="1.75">175%</option>
              <option value="2">200%</option>
            </select>
          </div>
          <div class="pause-audio"><label for="pause-music-volume">MUSIC</label><input id="pause-music-volume" type="range" min="0" max="100" value="100"><output id="pause-music-volume-value">100%</output></div>
          <div class="pause-audio"><label for="pause-sfx-volume">SFX</label><input id="pause-sfx-volume" type="range" min="0" max="100" value="100"><output id="pause-sfx-volume-value">100%</output></div>
        </section>
      </div>

      <!-- Capture Cinematic -->
      <div id="capture-cinema">
        <div id="cine-vignette"></div>
        <div class="cine-bar top"></div>
        <div class="cine-bar bottom"></div>
        <div id="cine-flare"></div>
        <div id="cine-card">
          <div class="cine-orb poke" id="cine-orb"></div>
          <div class="cine-copy"><span id="cine-target">CHALLENGER</span><span id="cine-sub">POKÉ BALL · 0%</span></div>
          <div id="cine-pips"></div>
        </div>
        <div id="cine-meter"><div class="meter-zone"></div><div class="meter-marker"></div></div>
        <div id="cine-grade"></div>
        <div id="cine-caption">CAPTURE ATTEMPT</div>
        <div id="cine-verdict"></div>
      </div>
      <div id="capture-trophy"></div>

      <!-- Poké Ball Deployment Cinematic -->
      <div id="summon-cinema">
        <div id="summon-vignette"></div>
        <div class="cine-bar top"></div>
        <div class="cine-bar bottom"></div>
        <div id="summon-flash"></div>
        <div id="summon-kicker">TRAINER CALL</div>
        <div id="summon-caption">I CHOOSE YOU!</div>
        <div id="summon-skip">CLICK · SPACE · ESC TO SKIP</div>
      </div>

      <!-- Evolution Cinematic -->
      <div id="evo-cinema">
        <div class="cine-bar top"></div>
        <div class="cine-bar bottom"></div>
        <div id="evo-vignette"></div>
        <div id="evo-flash"></div>
        <div id="evo-kicker">WHAT?!</div>
        <div id="evo-caption"></div>
      </div>
      <div id="defeat-screen" class="interactive" hidden>
        <div class="defeat-card">
          <div class="defeat-kicker">STADIUM HP DEPLETED</div>
          <div class="defeat-title">DEFEAT</div>
          <div class="defeat-detail" id="defeat-detail"></div>
          <div id="defeat-report"></div>
          <div class="defeat-actions">
            <button class="stadium-btn active" id="btn-defeat-retry">RETRY COURSE</button>
            <button class="stadium-btn" id="btn-defeat-maps">COURSE SELECT</button>
          </div>
        </div>
      </div>
      <!-- Capture Kit: who can be caught right now, and the balls on hand to do it -->
      <div id="capture-kit" class="stadium-panel interactive" aria-label="Capture balls">
        <div id="catch-tray" hidden>
          <strong class="catch-tray-title">CATCH NOW <span class="catch-key">Q</span></strong>
          <div class="catch-chips"></div>
        </div>
        <strong class="capture-kit-title">CAPTURE BALLS</strong>
        ${BALL_ORDER.map(type => `
          <div class="capture-row" data-ball-row="${type}">
            <button class="ball-stock" data-ball-type="${type}" data-select-ball="${type}" aria-pressed="false">
              <span class="ball-icon ${type}" aria-hidden="true"></span>
              <span class="ball-name">${BALL_NAMES[type]}</span>
              <span class="ball-count">×0</span>
            </button>
            <button class="stadium-btn ball-buy" data-buy-ball="${type}">+$${BALL_PRICES[type]}</button>
          </div>`).join('')}
      </div>
      <div id="signature-bar" class="interactive" aria-label="Signature moves"></div>
      <!-- Tower Detail Panel -->
      <div id="tower-panel" class="stadium-panel interactive"></div>
    `;

    this.cardDeckEl = document.getElementById('card-deck')!;
    this.storageConfirmEl = document.getElementById('storage-confirm')!;
    this.panelEl = document.getElementById('tower-panel')!;
    this.announcerBannerEl = document.getElementById('announcer-banner')!;
    this.cinemaEl = document.getElementById('capture-cinema')!;
    this.evoCinemaEl = document.getElementById('evo-cinema')!;
    this.summonCinemaEl = document.getElementById('summon-cinema')!;

    this.bindEvents();
    this.storageConfirmEl.querySelector<HTMLButtonElement>('[data-storage-cancel]')!.addEventListener('click', () => this.closeStorageConfirmation());
    this.storageConfirmEl.querySelector<HTMLButtonElement>('[data-storage-confirm]')!.addEventListener('click', () => {
      const member = this.storageConfirmMember;
      this.closeStorageConfirmation();
      if (member) this.onStoreMember(member);
    });
    this.storageConfirmEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeStorageConfirmation();
      }
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-buy-ball]').forEach(button => button.addEventListener('click', () => this.onBuyBall(button.dataset.buyBall as BallType)));
    this.container.querySelectorAll<HTMLButtonElement>('[data-select-ball]').forEach(button => button.addEventListener('click', () => this.onSelectBall(button.dataset.selectBall as BallType)));
    this.bindCatchEvents();
    this.renderCardDeck();
    this.setMapSelectVisible(true);
    this.container.querySelectorAll<HTMLButtonElement>('[data-map-id]').forEach(button => {
      button.addEventListener('click', () => {
        const map = STADIUM_MAPS.find(candidate => candidate.id === button.dataset.mapId);
        if (!map) return;
        this.setMapSelectVisible(false);
        // With six or fewer Pokémon everyone plays, so there is nothing to pick.
        const owned = this.store.data.collection.length;
        if (owned > 0 && owned <= TEAM_SIZE) {
          this.store.fillTeam();
          this.onSelectMap(map);
          return;
        }
        // Otherwise the course leads to team select; the match starts once a team is confirmed.
        this.trainer.openTeamSelect({
          map,
          onConfirm: () => this.onSelectMap(map),
          onBack: () => this.setMapSelectVisible(true),
        });
      });
    });
    document.getElementById('btn-open-team')!.addEventListener('click', () => {
      const canResume = !document.getElementById('btn-resume-map')!.hidden;
      this.setMapSelectVisible(false);
      this.trainer.openTeamSelect({ map: null, onBack: () => this.setMapSelectVisible(true, canResume) });
    });
  }

  /** Course cards show the trainer's best run, which changes after every match. */
  private refreshMapRecords(): void {
    this.container.querySelectorAll<HTMLElement>('[data-map-record]').forEach(el => {
      const record = this.store.data.maps[el.dataset.mapRecord!];
      el.textContent = record ? `BEST ROUND ${record.bestRound}${record.cleared ? ' · CLEARED' : ''}` : '';
      el.hidden = !record;
    });
  }

  public setMapSelectVisible(visible: boolean, canResume=false): void {
    const chooser=this.container.querySelector<HTMLElement>('#map-select')!;
    chooser.style.display=visible?'grid':'none';
    this.container.classList.toggle('map-select-open',visible);
    ['top-bar','start-match-bar','controls-bar','card-deck','tower-panel','capture-kit','capture-hint','catch-layer'].forEach(id=>{
      this.container.querySelector<HTMLElement>(`#${id}`)!.inert=visible;
    });
    this.container.querySelector<HTMLButtonElement>('#btn-resume-map')!.hidden=!canResume;
    if(visible) { this.refreshMapRecords(); this.onMenuShown(); }
    if(visible) chooser.querySelector<HTMLButtonElement>('.map-filter.active')?.focus();
    else this.container.querySelector<HTMLButtonElement>('#btn-wave')?.focus();
  }

  public setPauseVisible(visible: boolean): void {
    const pause = this.container.querySelector<HTMLElement>('#pause-screen')!;
    pause.hidden = !visible;
    this.container.classList.toggle('pause-open', visible);
    if (visible) pause.querySelector<HTMLButtonElement>('#btn-pause-resume')?.focus();
  }

  /** The match roster: the chosen team plus anything caught since the match began. */
  public setRoster(members: OwnedPokemon[]): void {
    this.roster = [...members];
    this.renderCardDeck();
  }

  private renderCardDeck(): void {
    this.rosterSignature = this.roster.map(m => `${m.uid}:${m.stage}:${m.nickname ?? ''}`).join('|');
    this.rosterViews.forEach(view => view.destroy());
    this.rosterViews.clear();
    this.cardDeckEl.innerHTML = `
      <div class="tower-rail-header">
        <span class="pokeball-emblem" aria-hidden="true"></span>
        <span class="tower-rail-copy">
          <span class="tower-rail-title">ROSTER</span>
          <span id="placement-hint"></span>
        </span>
      </div>
    `;

    this.roster.forEach(member => {
      const form = formOf(member);
      const card = document.createElement('div');
      card.className = 'stadium-panel tower-card';
      card.id = `card-${member.uid}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const typeCol = TYPE_COLORS[form.type]?.hex || '#fff';
      const typeArt = `/ui/types/${form.type.toLowerCase()}.jpg`;

      card.innerHTML = `
        <span class="card-portrait-stage" style="background-image: linear-gradient(90deg, transparent 28%, rgba(4,12,43,.18) 48%, rgba(4,12,43,.96) 78%), url('${typeArt}');"></span>
        <span class="card-type-tag" style="background-color: ${typeCol};">LV <b class="card-level">${member.level}</b></span>
        <span class="card-name">${escapeHtml(displayName(member))}</span>
        <span class="card-cost">$${speciesOf(member).deployCost}</span>
        <span class="card-xp"><i style="width:${levelProgress(member.xp, member.level) * 100}%"></i></span>
        <span class="card-deployed">ON FIELD</span>
        <button class="card-storage" type="button" data-store-member aria-label="Send ${escapeHtml(displayName(member))} to storage">STORE</button>
      `;

      const select = () => this.onSelectMember(member);
      card.addEventListener('click', select);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
      const storageButton = card.querySelector<HTMLButtonElement>('[data-store-member]')!;
      storageButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!storageButton.disabled) this.openStorageConfirmation(member, storageButton);
      });
      storageButton.addEventListener('keydown', (event) => event.stopPropagation());

      this.cardDeckEl.appendChild(card);
      const portraitStage = card.querySelector<HTMLElement>('.card-portrait-stage')!;
      const view = new RosterModelView();
      portraitStage.appendChild(view.canvas);
      view.show(form.name, speciesOf(member).createModel);
      this.rosterViews.set(member.uid, view);
    });
  }

  private openStorageConfirmation(member: OwnedPokemon, source: HTMLElement): void {
    this.storageConfirmMember = member;
    this.storageConfirmPreviousFocus = source;
    this.storageConfirmEl.querySelector<HTMLElement>('#storage-confirm-title')!.innerText = displayName(member).toUpperCase();
    this.storageConfirmEl.hidden = false;
    this.storageConfirmEl.querySelector<HTMLButtonElement>('[data-storage-confirm]')!.focus();
  }

  private closeStorageConfirmation(): void {
    this.storageConfirmEl.hidden = true;
    this.storageConfirmMember = null;
    const previousFocus = this.storageConfirmPreviousFocus;
    this.storageConfirmPreviousFocus = null;
    previousFocus?.focus();
  }

  private bindEvents(): void {
    document.getElementById('btn-resume-map')!.addEventListener('click',()=>{
      this.setMapSelectVisible(false);this.onResumeMap();
    });
    document.getElementById('btn-pause-resume')!.addEventListener('click', () => this.onResumeGame());
    document.getElementById('btn-pause-quit')!.addEventListener('click', () => this.onQuitToMenu());
    document.getElementById('btn-signature-cuts')!.addEventListener('click', () => this.onToggleSignatureCuts());
    document.getElementById('btn-summon-cinematics')!.addEventListener('click', () => this.onToggleSummonCinematics());
    const uiScale = document.getElementById('pause-ui-scale') as HTMLSelectElement;
    uiScale.value = String(this.uiScalePreference);
    uiScale.addEventListener('change', () => {
      this.uiScalePreference = uiScale.value === 'auto' ? 'auto' : Number(uiScale.value);
      try { localStorage.setItem(UI_SCALE_KEY, String(this.uiScalePreference)); } catch { /* storage blocked */ }
      this.applyUiScale();
    });
    const bindVolume = (id: string, outputId: string, callback: (value: number) => void) => {
      const input = document.getElementById(id) as HTMLInputElement;
      const output = document.getElementById(outputId)!;
      input.addEventListener('input', () => {
        const value = Number(input.value) / 100;
        output.textContent = `${input.value}%`;
        callback(value);
      });
    };
    bindVolume('pause-music-volume', 'pause-music-volume-value', value => this.onMusicVolumeChange(value));
    bindVolume('pause-sfx-volume', 'pause-sfx-volume-value', value => this.onSfxVolumeChange(value));
    this.container.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(button=>{
      button.addEventListener('click',()=>{
        const filter=button.dataset.difficulty;
        this.container.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(tab=>{
          tab.classList.toggle('active',tab===button);tab.setAttribute('aria-pressed',String(tab===button));
        });
        this.container.querySelectorAll<HTMLButtonElement>('[data-map-id]').forEach(card=>{
          card.hidden=filter!=='all' && card.dataset.mapDifficulty!==filter;
        });
      });
    });
    document.getElementById('btn-defeat-retry')!.addEventListener('click', () => this.onRetryMap());
    document.getElementById('btn-defeat-maps')!.addEventListener('click', () => this.onOpenMaps());

    // Wave start button
    document.getElementById('btn-wave')!.addEventListener('click', () => {
      this.onStartWave();
    });

    // Speed buttons
    const speeds = [
      { id: 'btn-speed-half', spd: 0.5 },
      { id: 'btn-speed-1', spd: 1 },
      { id: 'btn-speed-2', spd: 2 },
      { id: 'btn-speed-3', spd: 3 },
      { id: 'btn-speed-4', spd: 4 },
    ];
    speeds.forEach(s => {
      document.getElementById(s.id)!.addEventListener('click', () => {
        speeds.forEach(other => document.getElementById(other.id)!.classList.remove('active'));
        document.getElementById(s.id)!.classList.add('active');
        this.onChangeSpeed(s.spd);
      });
    });

    // Camera buttons
    const cams: { id: string; mode: CameraMode }[] = [
      { id: 'btn-cam-tactical', mode: 'tactical' },
      { id: 'btn-cam-stadium', mode: 'stadium' },
      { id: 'btn-cam-action', mode: 'action' },
    ];
    cams.forEach(c => {
      document.getElementById(c.id)!.addEventListener('click', () => {
        cams.forEach(other => document.getElementById(other.id)!.classList.remove('active'));
        document.getElementById(c.id)!.classList.add('active');
        this.onChangeCamera(c.mode);
      });
    });
  }

  /**
   * Keeps the HUD physically readable on dense desktop displays while the 3D
   * canvas continues to render at native resolution. Giving the container an
   * inverse logical size keeps right/bottom anchored controls at the viewport
   * edges after its visual transform is applied.
   */
  private applyUiScale(): void {
    const automatic = Math.min(
      window.innerWidth / UI_SCALE_BASE_WIDTH,
      window.innerHeight / UI_SCALE_BASE_HEIGHT,
      UI_SCALE_AUTO_MAX,
    );
    this.uiScale = this.uiScalePreference === 'auto'
      ? Math.max(1, automatic)
      : this.uiScalePreference;
    this.container.style.width = `${window.innerWidth / this.uiScale}px`;
    this.container.style.height = `${window.innerHeight / this.uiScale}px`;
    this.container.style.transform = `scale(${this.uiScale})`;
    this.container.style.transformOrigin = 'top left';
    this.container.style.setProperty('--ui-scale', String(this.uiScale));

    const automaticOption = this.container.querySelector<HTMLOptionElement>('#pause-ui-scale option[value="auto"]');
    if (automaticOption) automaticOption.textContent = `AUTO (${Math.round(Math.max(1, automatic) * 100)}%)`;
  }

  /**
   * Rebuilds the panel body. Called only when the tower's identity, purchases
   * or evolution stage change — per-frame work is limited to affordability.
   */
  private buildPanel(tower: Tower): void {
    const form = formOf(tower.pokemon);
    const typeCol = TYPE_COLORS[form.type];
    const maxStages = tower.species.forms.length - 1;

    const stagePips = Array.from({ length: maxStages }, (_, i) =>
      `<div class="tp-stage-pip ${i < tower.pokemon.stage ? 'on' : ''}"></div>`
    ).join('');

    const pathName = (idx: number) => tower.species.paths[idx].label;
    const lineRows = tower.species.paths.map((path, idx) => {
      const bought = tower.tiers[idx];
      const next = tower.getNextTier(idx);
      const blocked = tower.getUpgradeBlockReason(idx);
      // Show what buying gets you; once topped out, what the path became.
      const shown = next ?? path.tiers[bought - 1];

      const pips = path.tiers.map((_, t) =>
        `<div class="tp-pip ${t < bought ? 'on' : ''}"></div>`
      ).join('');

      let buyInner: string;
      let buyClass = 'tp-buy';

      if (blocked === 'maxed') {
        buyClass += ' maxed';
        buyInner = `<span class="tp-buy-note">MASTERED</span>`;
      } else if (blocked === 'path_closed') {
        buyClass += ' locked';
        buyInner = `<span class="tp-buy-note">PATH CLOSED</span>`;
      } else if (blocked === 'tier_capped') {
        buyClass += ' maxed';
        buyInner = `<span class="tp-buy-note">TIER ${bought} CAP</span>`;
      } else if (blocked === 'needs_level' && next) {
        buyClass += ' locked';
        buyInner = `
          <span class="tp-buy-note">UNLOCKS AT</span>
          <span class="tp-buy-cost">LV ${next.requiresLevel}</span>
        `;
      } else {
        const { closes, caps } = tower.upgradeConsequences(idx);
        const warning = closes.length ? `CLOSES ${closes.map(pathName).join(' + ')}`
          : caps.length ? `CAPS ${caps.map(pathName).join(' + ')}` : '';
        buyInner = `
          <span class="tp-buy-name">TIER ${bought + 1}</span>
          <span class="tp-buy-cost">$${next!.cost}</span>
          ${warning ? `<span class="tp-buy-warn">${warning}</span>` : ''}
        `;
      }

      const closedRow = blocked === 'path_closed' ? ' closed' : '';
      return `
        <div class="tp-line${closedRow}">
          <div class="tp-pips">${pips}</div>
          <div class="tp-line-meta">
            <span class="tp-line-label">${path.label}${bought ? ` · TIER ${bought}` : ''}</span>
            <span class="tp-line-move">${shown.name}</span>
            <span class="tp-line-stats">${shown.description}</span>
          </div>
          <div class="${buyClass}" data-line="${idx}" ${next ? `data-cost="${next.cost}"` : ''}>${buyInner}</div>
        </div>
      `;
    }).join('');

    const attack = tower.attack;
    const shape = attack.move.delivery.toUpperCase();
    const chips = attackChips(attack, tower.seesPhantoms)
      .map(chip => `<span class="tp-chip ${chip.replace(/\s+/g, '-').toLowerCase()}">${chip}</span>`).join('');

    // Evolution is earned in battle now, so the track is a read-out, not a purchase.
    const nextEvo = nextEvolution(tower.pokemon);
    const evoBlock = nextEvo
      ? `<div class="tp-evolve earned">
           <div>
             <span class="tp-evolve-label">→ ${nextEvo.name.toUpperCase()}</span>
             <span class="tp-evolve-sub">EVOLVES BY LEVELING UP IN BATTLE</span>
           </div>
           <span class="tp-evolve-cost">LV ${nextEvo.atLevel}</span>
         </div>`
      : `<div class="tp-evolve final">
           <div>
             <span class="tp-evolve-label">FINAL FORM</span>
             <span class="tp-evolve-sub">${tower.species.forms.length > 1 ? 'FULLY EVOLVED' : 'DOES NOT EVOLVE'}</span>
           </div>
         </div>`;

    this.panelEl.innerHTML = `
      <div class="tp-header">
        <span class="pokeball-emblem" aria-hidden="true"></span>
        <span class="tp-title">${escapeHtml(tower.name.toUpperCase())}</span>
        <span class="tp-level">LV ${tower.level}</span>
        <div class="tp-stage-pips">${stagePips}</div>
        <button class="tp-close" id="tp-close">✕</button>
      </div>

      <div class="tp-crest" style="background: linear-gradient(135deg, ${typeCol.hex}33 0%, rgba(7,19,38,0.9) 70%);">
        <div class="tp-crest-mark" style="background: radial-gradient(circle at 35% 30%, ${typeCol.light}, ${typeCol.hex});">
          ${glyph(tower.primaryMove.fxType, '#0a1526', 28)}
        </div>
        <div class="tp-crest-meta">
          <span class="tp-crest-type" style="color: ${typeCol.light};">${tower.pokemon.nickname ? `${form.name.toUpperCase()} · ` : ''}${form.type.toUpperCase()} TYPE</span>
          <span class="tp-attack">${escapeHtml(attack.move.name.toUpperCase())} · ${shape} · ${attack.move.basePower} PWR</span>
          <span class="tp-matchup" id="tp-matchup">—</span>
          ${chips ? `<span class="tp-chips">${chips}</span>` : ''}
          <span class="tp-xp"><i id="tp-xp-fill"></i></span>
          <span class="tp-xp-label" id="tp-xp-label"></span>
        </div>
      </div>

      <div class="tp-target">
        <button class="tp-arrow" id="tp-target-prev">◀</button>
        <div>
          <span class="tp-target-cap">TARGETING</span>
          <span class="tp-target-label" id="tp-target-label">FIRST</span>
        </div>
        <button class="tp-arrow" id="tp-target-next">▶</button>
      </div>

      <div class="tp-lines">${lineRows}</div>

      ${evoBlock}

      <div class="tp-footer">
        <div class="tp-sell-value">
          <span>SELL VALUE</span>
          <span id="tp-sell-value">$0</span>
        </div>
        <button class="tp-sell-btn" id="tp-sell">SELL</button>
      </div>
    `;

    // Wire the freshly-built controls to the tower they were built for.
    document.getElementById('tp-close')!.addEventListener('click', () => this.onDeselectTower());
    document.getElementById('tp-sell')!.addEventListener('click', () => this.onSellTower(tower));
    document.getElementById('tp-target-prev')!.addEventListener('click', () => this.onChangeTargetPriority(tower, -1));
    document.getElementById('tp-target-next')!.addEventListener('click', () => this.onChangeTargetPriority(tower, 1));

    this.panelEl.querySelectorAll<HTMLElement>('.tp-buy').forEach(btn => {
      if (btn.classList.contains('maxed') || btn.classList.contains('locked')) return;
      const lineIdx = Number(btn.dataset.line);
      btn.addEventListener('click', () => this.onUpgradeTower(tower, lineIdx));
    });
  }

  /** Per-frame refresh: affordability, targeting, live match-up, sell value. */
  private refreshPanel(tower: Tower, money: number): void {
    const targetLabel = document.getElementById('tp-target-label');
    if (targetLabel) targetLabel.innerText = tower.targetPriority.toUpperCase();

    const sellEl = document.getElementById('tp-sell-value');
    if (sellEl) sellEl.innerText = `$${tower.getSellValue()}`;

    const matchup = document.getElementById('tp-matchup');
    if (matchup) {
      const move = tower.primaryMove;
      if (tower.currentTarget) {
        const multiplier = move.ignoresType
          ? 1
          : getCombinedEffectiveness(move.type, tower.currentTarget.types);
        matchup.innerText = `${move.type.toUpperCase()} → ${tower.currentTarget.types.join('/').toUpperCase()} ${multiplier}×`;
        matchup.style.color = getEffectivenessLabel(multiplier).color;
      } else {
        matchup.innerText = tower.species.role;
        matchup.style.color = '#8faecf';
      }
    }

    this.panelEl.querySelectorAll<HTMLElement>('.tp-buy').forEach(btn => {
      if (btn.classList.contains('maxed') || btn.classList.contains('locked')) return;
      const cost = Number(btn.dataset.cost);
      btn.classList.toggle('poor', money < cost);
    });

    const xpFill = document.getElementById('tp-xp-fill');
    const xpLabel = document.getElementById('tp-xp-label');
    if (xpFill && xpLabel) {
      const { xp, level } = tower.pokemon;
      xpFill.style.width = `${levelProgress(xp, level) * 100}%`;
      const label = level >= MAX_LEVEL ? 'MAX LEVEL' : `${xpForLevel(level + 1) - xp} XP TO LV ${level + 1}`;
      if (xpLabel.textContent !== label) xpLabel.textContent = label;
    }
  }

  /**
   * Mirrors the live capture set piece: letterbox bars ride in, the vignette
   * tightens with the sequence's tension, wobble pips light one per click, and
   * the verdict slams in over the whole screen.
   */
  private renderCaptureCinema(cinema: CaptureHud | null): void {
    if (!cinema) {
      if (this.cinemaEl.classList.contains('live')) {
        this.cinemaEl.classList.remove('live');
        this.container.classList.remove('cinema-live');
        this.cinemaVerdict = '';
        this.cinemaEl.querySelector<HTMLElement>('#cine-verdict')!.className = '';
      }
      return;
    }
    this.cinemaEl.classList.add('live');
    this.container.classList.add('cinema-live');

    const bars = this.cinemaEl.querySelectorAll<HTMLElement>('.cine-bar');
    bars[0].style.transform = `translateY(${(cinema.letterbox - 1) * 100}%)`;
    bars[1].style.transform = `translateY(${(1 - cinema.letterbox) * 100}%)`;
    this.cinemaEl.querySelector<HTMLElement>('#cine-vignette')!.style.opacity = `${0.35 + cinema.tension * 0.65}`;
    // A pale flare rides the tension so the near-frozen wobble beats still breathe.
    this.cinemaEl.querySelector<HTMLElement>('#cine-flare')!.style.opacity =
      cinema.phase === 'wobble' ? `${0.04 + Math.abs(Math.sin(performance.now() * 0.006)) * 0.05 * cinema.tension}` : '0';

    this.cinemaEl.querySelector<HTMLElement>('#cine-orb')!.className = `cine-orb ${cinema.ballType}`;
    this.cinemaEl.querySelector<HTMLElement>('#cine-target')!.innerText = cinema.targetName;
    this.cinemaEl.querySelector<HTMLElement>('#cine-sub')!.innerText =
      `${cinema.ballName} · ${(cinema.chance * 100).toFixed(0)}% CATCH RATE`;
    this.cinemaEl.querySelector<HTMLElement>('#cine-caption')!.innerText = cinema.caption;

    this.renderReleaseMeter(cinema);

    const pips = this.cinemaEl.querySelector<HTMLElement>('#cine-pips')!;
    if (pips.children.length !== cinema.totalWobbles) {
      pips.innerHTML = Array.from({ length: cinema.totalWobbles }, () => '<div class="cine-pip"></div>').join('');
    }
    Array.from(pips.children).forEach((pip, idx) => pip.classList.toggle('lit', idx < cinema.wobbles));

    const verdict = this.cinemaEl.querySelector<HTMLElement>('#cine-verdict')!;
    const label = cinema.verdict === 'caught' ? 'GOTCHA!' : cinema.verdict === 'broke' ? 'BROKE FREE!' : '';
    if (label !== this.cinemaVerdict) {
      this.cinemaVerdict = label;
      verdict.innerText = label;
      // Reassigning the class restarts the slam/shatter keyframes.
      verdict.className = cinema.verdict ?? '';
    }
  }

  /**
   * Mirrors the live evolution set piece: letterbox bars ride in like the
   * capture cinematic, the vignette glows warm instead of dread-blue, and a
   * kicker/caption pair carries "WHAT?! X IS EVOLVING!" through to the
   * "X EVOLVED INTO Y!" payoff. A separate overlay from capture's since the
   * two never play at once and the beats read very differently.
   */
  private renderEvolutionCinema(cinema: EvolutionHud | null): void {
    if (!cinema) {
      this.evoCinemaEl.classList.remove('live');
      this.container.classList.remove('evo-live');
      return;
    }
    this.evoCinemaEl.classList.add('live');
    this.container.classList.add('evo-live');

    const bars = this.evoCinemaEl.querySelectorAll<HTMLElement>('.cine-bar');
    bars[0].style.transform = `translateY(${(cinema.letterbox - 1) * 100}%)`;
    bars[1].style.transform = `translateY(${(1 - cinema.letterbox) * 100}%)`;
    this.evoCinemaEl.querySelector<HTMLElement>('#evo-flash')!.style.opacity = `${cinema.flash}`;
    this.evoCinemaEl.querySelector<HTMLElement>('#evo-kicker')!.style.opacity = cinema.phase === 'reveal' ? '0' : '1';
    this.evoCinemaEl.querySelector<HTMLElement>('#evo-caption')!.innerText = cinema.caption;
  }

  /**
   * The release meter: a marker sweeping a bar with a gold window. It freezes
   * where the player let go and reports the grade, then retires once the ball
   * is in the air.
   */
  private renderReleaseMeter(cinema: CaptureHud): void {
    const meter = this.cinemaEl.querySelector<HTMLElement>('#cine-meter')!;
    const grade = this.cinemaEl.querySelector<HTMLElement>('#cine-grade')!;
    const aim = cinema.aim;
    // The meter stays up through the throw so the player sees what they hit.
    const visible = !!aim && (cinema.phase === 'aim' || cinema.phase === 'throw');
    meter.style.display = visible ? 'block' : 'none';
    grade.style.display = visible ? 'block' : 'none';
    if (!visible || !aim) return;

    const zone = meter.querySelector<HTMLElement>('.meter-zone')!;
    zone.style.left = `${aim.zoneStart * 100}%`;
    zone.style.width = `${(aim.zoneEnd - aim.zoneStart) * 100}%`;
    meter.querySelector<HTMLElement>('.meter-marker')!.style.left = `${(aim.released ?? aim.marker) * 100}%`;
    meter.classList.toggle('spent', aim.released !== null);

    grade.className = aim.grade ?? 'hint';
    grade.innerHTML = aim.grade === 'perfect' ? `PERFECT! +${Math.round(aim.bonus * 100)}% ODDS`
      : aim.grade === 'good' ? `GOOD! +${Math.round(aim.bonus * 100)}% ODDS`
      : aim.grade === 'wide' ? `WIDE! ${Math.round(aim.bonus * 100)}% ODDS`
      : `CLICK OR PRESS SPACE TO THROW ${cinema.ballName} <span class="cine-cancel-hint">· ESC TO CANCEL</span>`;
  }

  /** Milestone payout card, sharing the trophy card's slot and timing. */
  public showMilestone(milestone: MilestoneReward): void {
    const card = document.getElementById('capture-trophy')!;
    const ballNames: Record<BallType, string> = { poke: 'POKÉ BALL', great: 'GREAT BALL', ultra: 'ULTRA BALL' };
    const rewards = [
      `<div class="trophy-move"><span>+$${milestone.money}</span><em>PRIZE MONEY</em></div>`,
      ...(Object.entries(milestone.balls) as [BallType, number][]).map(([ball, count]) =>
        `<div class="trophy-move"><span>+${count} ${ballNames[ball]}${count > 1 ? 'S' : ''}</span><em>CAPTURE KIT</em></div>`),
    ].join('');
    this.trophyView.hide();
    card.classList.remove('has-model');
    card.innerHTML = `
      <div class="trophy-kicker">ROUND ${milestone.round} CLEARED</div>
      <div class="trophy-name">${milestone.label}</div>
      <div class="trophy-moves">${rewards}</div>
    `;
    card.classList.add('shown');
    window.clearTimeout(this.trophyTimer);
    this.trophyTimer = window.setTimeout(() => card.classList.remove('shown'), 4200);
  }

  /** Immediate payoff for converting a duplicate instead of keeping it. */
  public showResearchResult(formName: string, points: number): void {
    const card = document.getElementById('capture-trophy')!;
    this.trophyView.hide();
    card.classList.remove('has-model', 'naming', 'interactive');
    card.innerHTML = `
      <div class="trophy-copy research-result">
        <div class="trophy-kicker">RESEARCH COMPLETE</div>
        <div class="trophy-name">${formName.toUpperCase()} DATA</div>
        <div class="trophy-moves">
          <div class="trophy-move"><span>+${points}</span><em>RESEARCH DATA</em></div>
        </div>
        <div class="trophy-duplicate-note">Duplicate released to the Professor. This data is saved for future ${formName} upgrades.</div>
      </div>
    `;
    card.classList.add('shown');
    window.clearTimeout(this.trophyTimer);
    this.trophyTimer = window.setTimeout(() => card.classList.remove('shown'), 2600);
  }

  public showDefeat(mapName: string, round: number, winRound: number, report: MatchReportEntry[] = []): void {
    this.renderCaptureCinema(null);
    this.renderEvolutionCinema(null);
    document.getElementById('defeat-report')!.innerHTML = reportListHtml(report);
    document.getElementById('defeat-detail')!.innerText = round > winRound
      ? `${mapName.toUpperCase()} · FELL IN FREEPLAY ROUND ${round}`
      : `${mapName.toUpperCase()} · FELL IN ROUND ${round} OF ${winRound}`;
    document.getElementById('defeat-screen')!.hidden = false;
  }

  public hideDefeat(): void {
    document.getElementById('defeat-screen')!.hidden = true;
  }

  /**
   * The payoff beat: the new catch with the move lines it brings, and a
   * nickname prompt. The card holds until the player names it or skips.
   */
  public showCaptureTrophy(
    pokemon: OwnedPokemon,
    duplicate: boolean,
    guestSlotsLeft: number,
    onNamed: (name: string | null, destination: 'match' | 'storage' | 'research') => void,
  ): void {
    const card = document.getElementById('capture-trophy')!;
    const species = speciesOf(pokemon);
    const form = formOf(pokemon);
    const typeColor = TYPE_COLORS[form.type]?.hex || '#ffffff';
    const moves = species.paths.map(path =>
      `<div class="trophy-move"><span>${path.tiers[0].name.toUpperCase()}</span><em>${path.label}</em></div>`
    ).join('');
    card.innerHTML = `
      <div class="trophy-stage"></div>
      <div class="trophy-copy">
        <div class="trophy-kicker">${duplicate ? 'DUPLICATE ENCOUNTER' : 'POKÉMON CAUGHT'}</div>
        <div class="trophy-name">${form.name.toUpperCase()} <small>LV ${pokemon.level}</small></div>
        <div class="trophy-type" style="background:${typeColor}">${form.type.toUpperCase()}</div>
        <div class="trophy-moves">${moves}</div>
        <div class="trophy-duplicate-note">${duplicate ? 'You already own this species.' : 'Choose where this Pokémon goes.'} ${guestSlotsLeft ? `MATCH GUESTS: ${guestSlotsLeft} SLOT${guestSlotsLeft === 1 ? '' : 'S'} LEFT` : 'MATCH GUESTS FULL'}</div>
        <form class="trophy-nickname">
          <label for="trophy-nickname-input">GIVE A NICKNAME TO ${form.name.toUpperCase()}?</label>
          <div class="trophy-nickname-row">
            <input id="trophy-nickname-input" maxlength="10" autocomplete="off" placeholder="${form.name}">
            ${guestSlotsLeft ? `<button class="stadium-btn active" type="submit">ADD TO MATCH · ${guestSlotsLeft} SLOT${guestSlotsLeft === 1 ? '' : 'S'} LEFT</button>` : ''}
            <button class="stadium-btn" type="button" data-storage>SEND TO STORAGE</button>
            ${duplicate ? '<button class="stadium-btn" type="button" data-research>SEND TO RESEARCH</button>' : ''}
          </div>
        </form>
      </div>
    `;
    card.querySelector('.trophy-stage')!.appendChild(this.trophyView.canvas);
    card.classList.add('has-model', 'shown', 'naming', 'interactive');
    this.trophyView.show(form.name, species.createModel);
    window.clearTimeout(this.trophyTimer);

    const input = card.querySelector<HTMLInputElement>('#trophy-nickname-input')!;
    let answered = false;
    const finish = (name: string | null, destination: 'match' | 'storage' | 'research') => {
      if (answered) return;
      answered = true;
      card.classList.remove('naming', 'interactive');
      onNamed(name, destination);
      card.classList.remove('shown');
      this.trophyTimer = window.setTimeout(() => this.trophyView.hide(), 400);
    };
    card.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      if (guestSlotsLeft) finish(input.value.trim() || null, 'match');
    });
    card.querySelector('[data-storage]')!.addEventListener('click', () => finish(input.value.trim() || null, 'storage'));
    card.querySelector('[data-research]')?.addEventListener('click', () => finish(null, 'research'));
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') finish(null, 'storage');
    });
    window.setTimeout(() => input.focus(), 50);
  }

  /** The end-of-match card when a player quits: who grew, who evolved, who was caught. */
  public showMatchReport(report: MatchReportEntry[], mapName: string, onContinue: () => void): void {
    this.trainer.showMatchReport(report, mapName, onContinue);
  }

  /** Catch elements are keyed by a per-creep id so frames patch them instead of rebuilding. */
  private catchIds = new WeakMap<Creep, number>();
  private nextCatchId = 1;
  private catchCreeps = new Map<number, Creep>();
  private catchTags = new Map<number, HTMLButtonElement>();
  private catchTrayKey = '';

  private catchId(creep: Creep): number {
    let id = this.catchIds.get(creep);
    if (id === undefined) {
      id = this.nextCatchId++;
      this.catchIds.set(creep, id);
    }
    return id;
  }

  private bindCatchEvents(): void {
    // Tags and chips are patched every frame but only rebuilt when the set
    // changes, so delegation keeps a held click working.
    const creepFrom = (event: Event, attr: string): Creep | null => {
      const el = (event.target as HTMLElement).closest<HTMLElement>(`[${attr}]`);
      return el ? this.catchCreeps.get(Number(el.getAttribute(attr))) ?? null : null;
    };
    const layer = this.container.querySelector<HTMLElement>('#catch-layer')!;
    layer.querySelector('.catch-tags')!.addEventListener('click', event => {
      const creep = creepFrom(event, 'data-catch');
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-catch]');
      if (creep && !button?.disabled) this.onCatch(creep);
    });
    this.container.querySelector('#catch-tray')!.addEventListener('click', event => {
      const creep = creepFrom(event, 'data-catch-chip');
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-catch-chip]');
      if (creep && !button?.disabled) this.onCatch(creep);
    });
  }

  /** One-click targets for every catchable Pokémon, using the selected ball. */
  private renderCatching(state: UIState): void {
    this.catchCreeps.clear();
    state.catchables.forEach(slot => this.catchCreeps.set(this.catchId(slot.creep), slot.creep));
    const layer = this.container.querySelector<HTMLElement>('#catch-layer')!;
    const tagsEl = layer.querySelector<HTMLElement>('.catch-tags')!;
    const width = layer.clientWidth;
    const height = layer.clientHeight;

    // Tags: one per catchable creep, stacked upward out of each other's way.
    for (const [id, tag] of this.catchTags) {
      if (!this.catchCreeps.has(id)) {
        tag.remove();
        this.catchTags.delete(id);
      }
    }
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const visible = state.catchables
      .filter(slot => {
        const x = slot.x / this.uiScale;
        const y = slot.y / this.uiScale;
        return slot.onScreen && x >= 0 && x <= width && y >= 0 && y <= height;
      })
      .sort((a, b) => b.y - a.y);
    const shown = new Set<number>();
    for (const slot of visible) {
      const id = this.catchId(slot.creep);
      let tag = this.catchTags.get(id);
      if (!tag) {
        tag = document.createElement('button');
        tag.className = `catch-tag interactive ${slot.creep.threat}`;
        tag.dataset.catch = String(id);
        tag.innerHTML = `<span class="ball-icon" aria-hidden="true"></span><span class="catch-label"></span><span class="catch-odds"></span>`;
        tagsEl.appendChild(tag);
        this.catchTags.set(id, tag);
      }
      tag.disabled = state.balls[state.selectedBall] <= 0;
      tag.title = tag.disabled ? `No ${BALL_NAMES[state.selectedBall]} Balls left` : `Throw a ${BALL_NAMES[state.selectedBall]} Ball`;
      tag.querySelector<HTMLElement>('.ball-icon')!.className = `ball-icon ${state.selectedBall}`;
      tag.querySelector<HTMLElement>('.catch-label')!.textContent = `CATCH ${slot.creep.name.replace(/^Titan /, '').toUpperCase()}`;
      tag.querySelector<HTMLElement>('.catch-odds')!.textContent = `${Math.round(slot.odds[state.selectedBall] * 100)}%`;
      shown.add(id);
      const w = tag.offsetWidth;
      // Renderer coordinates are physical viewport pixels; this layer lives in
      // the scaled HUD's logical coordinate space.
      const x = slot.x / this.uiScale;
      const y = slot.y / this.uiScale;
      const rect = { left: x - w / 2, right: x + w / 2, top: y - CATCH_TAG_HEIGHT - 6, bottom: y - 6 };
      // Walk the tag up until it clears everything already placed below it.
      for (let moved = true; moved;) {
        moved = false;
        for (const other of placed) {
          if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
            rect.bottom = other.top - CATCH_TAG_GAP;
            rect.top = rect.bottom - CATCH_TAG_HEIGHT;
            moved = true;
          }
        }
      }
      placed.push(rect);
      tag.hidden = false;
      // Lower tags draw on top, so a stacked tag's stem runs behind the ones beneath it.
      tag.style.zIndex = String(visible.length - placed.length + 1);
      tag.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      tag.style.setProperty('--stem', `${Math.max(6, Math.round(y - rect.bottom))}px`);
    }
    for (const [id, tag] of this.catchTags) if (!shown.has(id)) tag.hidden = true;

    // Tray: every catchable creep, even off screen or hidden behind the stands.
    const tray = this.container.querySelector<HTMLElement>('#catch-tray')!;
    const trayKey = `${state.selectedBall}|${state.catchables.map(slot => this.catchId(slot.creep)).join('|')}`;
    if (trayKey !== this.catchTrayKey) {
      this.catchTrayKey = trayKey;
      tray.hidden = state.catchables.length === 0;
      tray.querySelector('.catch-chips')!.innerHTML = state.catchables.map(slot => {
        const creep = slot.creep;
        const color = TYPE_COLORS[creep.type]?.hex ?? '#fff';
        const odds = Math.round(slot.odds[state.selectedBall] * 100);
        return `<button class="catch-chip" data-catch-chip="${this.catchId(creep)}"><i style="background:${color}"></i>${escapeHtml(creep.name.replace(/^Titan /, '').toUpperCase())}<span class="catch-odds">${odds}%</span></button>`;
      }).join('');
    }
    tray.querySelectorAll<HTMLButtonElement>('[data-catch-chip]').forEach(chip => {
      chip.disabled = state.balls[state.selectedBall] <= 0;
      chip.title = chip.disabled ? `No ${BALL_NAMES[state.selectedBall]} Balls left` : `Throw a ${BALL_NAMES[state.selectedBall]} Ball`;
      const slot = state.catchables.find(candidate => this.catchId(candidate.creep) === Number(chip.dataset.catchChip));
      if (slot) chip.querySelector<HTMLElement>('.catch-odds')!.textContent = `${Math.round(slot.odds[state.selectedBall] * 100)}%`;
    });
  }

  private signatureBarKey = '';

  /** Rebuilds the bar when the set of signatures changes; PP and aim state refresh every frame. */
  private renderSignatureBar(slots: SignatureSlot[], blocked: boolean): void {
    const bar = document.getElementById('signature-bar')!;
    const key = slots.map(slot => `${slot.tower.id}:${slot.def.id}`).join('|');
    if (key !== this.signatureBarKey) {
      this.signatureBarKey = key;
      bar.innerHTML = slots.map((slot, i) => {
        const color = TYPE_COLORS[slot.def.type]?.hex ?? '#fff';
        return `
          <button class="sig-btn" data-sig="${i}" title="${escapeHtml(slot.def.description)}">
            <span class="sig-mark" style="background:${color}55">${glyph(SIGNATURE_GLYPHS[slot.def.type] ?? 'impact', color, 22)}</span>
            <span class="sig-name">${slot.def.name.toUpperCase()}</span>
            <span class="sig-meta">${escapeHtml(slot.tower.name.toUpperCase())}<span class="sig-pp"></span></span>
            ${i < 9 ? `<span class="sig-key">${i + 1}</span>` : ''}
          </button>`;
      }).join('');
      bar.querySelectorAll<HTMLButtonElement>('.sig-btn').forEach(button => {
        const slot = slots[Number(button.dataset.sig)];
        button.addEventListener('click', () => this.onCastSignature(slot.tower, slot.def.id));
      });
    }
    bar.querySelectorAll<HTMLButtonElement>('.sig-btn').forEach((button, i) => {
      const slot = slots[i];
      button.disabled = blocked || slot.pp <= 0;
      button.classList.toggle('aiming', slot.aiming);
      const pips = Array.from({ length: slot.def.pp }, (_, p) => `<i class="${p < slot.pp ? 'on' : ''}"></i>`).join('');
      const ppEl = button.querySelector<HTMLElement>('.sig-pp')!;
      if (ppEl.innerHTML !== pips) ppEl.innerHTML = pips;
    });
  }

  public setSignatureCuts(enabled: boolean): void {
    document.getElementById('btn-signature-cuts')!.textContent = `SIGNATURE CAMERA CUTS: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setSummonCinematics(enabled: boolean): void {
    document.getElementById('btn-summon-cinematics')!.textContent = `POKÉ BALL ENTRANCES: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setAudioVolumes(music: number, sfx: number): void {
    for (const [id, outputId, value] of [
      ['pause-music-volume', 'pause-music-volume-value', music],
      ['pause-sfx-volume', 'pause-sfx-volume-value', sfx],
    ] as [string, string, number][]) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      const output = document.getElementById(outputId);
      if (input) input.value = String(Math.round(Math.max(0, Math.min(1, value)) * 100));
      if (output && input) output.textContent = `${input.value}%`;
    }
  }

  private renderSummonCinema(cinema: SummonHud | null): void {
    if (!cinema) {
      this.summonCinemaEl.classList.remove('live');
      this.container.classList.remove('summon-live');
      return;
    }
    this.summonCinemaEl.classList.add('live');
    this.container.classList.add('summon-live');
    const bars = this.summonCinemaEl.querySelectorAll<HTMLElement>('.cine-bar');
    bars[0].style.transform = `translateY(${(cinema.letterbox - 1) * 100}%)`;
    bars[1].style.transform = `translateY(${(1 - cinema.letterbox) * 100}%)`;
    this.summonCinemaEl.querySelector<HTMLElement>('#summon-flash')!.style.opacity = `${cinema.flash}`;
    this.summonCinemaEl.querySelector<HTMLElement>('#summon-caption')!.innerText = cinema.caption;
    this.summonCinemaEl.querySelector<HTMLElement>('#summon-skip')!.innerText = cinema.prompt;
  }

  public update(state: UIState): void {
    this.currentSelectedTower = state.selectedTower;
    this.renderSignatureBar(state.signatures, !!state.captureCinema || !!state.evolutionCinema || !!state.summonCinema);
    ([['half',0.5],['1',1],['2',2],['3',3],['4',4]] as const).forEach(([key,speed]) => document.getElementById(`btn-speed-${key}`)!.classList.toggle('active',state.gameSpeed===speed));
    ['tactical','stadium','action'].forEach(mode => document.getElementById(`btn-cam-${mode}`)!.classList.toggle('active',state.cameraMode===mode));

    // Top Bar updates
    document.getElementById('cup-title')!.innerText = state.mapName.toUpperCase();
    document.getElementById('round-number')!.innerText = state.freeplay
      ? `ROUND ${state.round} · FREEPLAY`
      : `ROUND ${state.round} / ${state.winRound}`;
    document.getElementById('prize-money')!.innerText = `$${state.money}`;

    // Stadium HP remains the defensive fail-state; balls are capture inventory.
    const tray = document.getElementById('stadium-hp')!;
    if (state.lives !== this.renderedLives) {
      this.renderedLives = state.lives;
      tray.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const ball = document.createElement('div');
        ball.className = `ui-pokeball ${i >= state.lives ? 'lost' : ''}`;
        tray.appendChild(ball);
      }
    }

    // Buttons are patched in place, never rebuilt, so a held click survives frame updates.
    const captureKit = document.getElementById('capture-kit')!;
    captureKit.querySelectorAll<HTMLElement>('[data-ball-type]').forEach(stock => {
      const type = stock.dataset.ballType as BallType;
      stock.classList.toggle('empty', state.balls[type] <= 0);
      stock.classList.toggle('selected', type === state.selectedBall);
      stock.setAttribute('aria-pressed', String(type === state.selectedBall));
      (stock as HTMLButtonElement).disabled = state.balls[type] <= 0;
      stock.title = type === state.selectedBall ? `${BALL_NAMES[type]} Ball selected` : state.balls[type] > 0 ? `Select ${BALL_NAMES[type]} Ball` : `No ${BALL_NAMES[type]} Balls available`;
      const countEl = stock.querySelector<HTMLElement>('.ball-count')!;
      const count = `×${state.balls[type]}`;
      if (countEl.textContent !== count) {
        const gained = state.balls[type] > Number(countEl.textContent!.slice(1));
        countEl.textContent = count;
        if (gained) { countEl.classList.remove('bump'); void countEl.offsetWidth; countEl.classList.add('bump'); }
      }
    });
    captureKit.querySelectorAll<HTMLButtonElement>('[data-buy-ball]').forEach(button => {
      const type = button.dataset.buyBall as BallType;
      const premiumLocked = type !== 'poke' && state.inWave;
      const canAfford = state.money >= BALL_PRICES[type];
      button.disabled = premiumLocked || !canAfford;
      button.classList.toggle('locked', premiumLocked);
      button.classList.toggle('poor', !premiumLocked && !canAfford);
      // A locked ball can't be bought at any price right now, so the label drops the
      // dollar sign entirely rather than showing a price that looks buyable but isn't.
      const label = premiumLocked ? 'AFTER ROUND' : `+$${BALL_PRICES[type]}`;
      if (button.textContent !== label) button.textContent = label;
      const title = premiumLocked ? 'Great & Ultra Balls restock between rounds'
        : !canAfford ? 'Not enough prize money'
        : `Buy one ${BALL_NAMES[type]} BALL`;
      if (button.title !== title) button.title = title;
    });
    this.renderCatching(state);
    this.renderCaptureCinema(state.captureCinema);
    this.renderEvolutionCinema(state.evolutionCinema);
    this.renderSummonCinema(state.summonCinema);
    const captureHint = document.getElementById('capture-hint')!;
    captureHint.innerText = state.captureHint || '';

    // Wave button label
    const waveBtn = document.getElementById('btn-wave')!;
    if (state.inWave) {
      waveBtn.innerText = 'MATCH IN PROGRESS';
      waveBtn.classList.remove('active');
      waveBtn.style.pointerEvents = 'none';
      waveBtn.style.opacity = '0.7';
    } else {
      waveBtn.innerText = state.intermissionTimer > 0 ? `NEXT MATCH (${Math.ceil(state.intermissionTimer)}S)` : 'START MATCH';
      waveBtn.classList.add('active');
      waveBtn.style.pointerEvents = 'auto';
      waveBtn.style.opacity = '1.0';
    }

    // Card Deck affordability & selection highlight
    const placementHint = document.getElementById('placement-hint')!;
    if (state.placementStatus) {
      placementHint.innerText = state.placementStatus.label;
      placementHint.style.color = state.placementStatus.valid ? '#00f0ff' : '#ff6b6b';
    } else if (state.selectedMember) {
      placementHint.innerText = `PLACE ${displayName(state.selectedMember).toUpperCase()} · ESC TO CANCEL`;
      placementHint.style.color = '#00f0ff';
    } else {
      placementHint.innerText = '';
    }

    // Evolutions and renames change a card's model and title; rebuild only then.
    const rosterSignature = this.roster.map(m => `${m.uid}:${m.stage}:${m.nickname ?? ''}`).join('|');
    if (rosterSignature !== this.rosterSignature) this.renderCardDeck();
    this.roster.forEach(member => {
      const el = document.getElementById(`card-${member.uid}`);
      if (!el) return;
      const deployed = state.deployed.has(member.uid);
      el.classList.toggle('deployed', deployed);
      el.classList.toggle('disabled', deployed || state.money < speciesOf(member).deployCost);
      el.classList.toggle('selected', state.selectedMember?.uid === member.uid);
      const storageButton = el.querySelector<HTMLButtonElement>('[data-store-member]')!;
      storageButton.disabled = deployed;
      storageButton.title = deployed ? 'Sell the tower before sending this Pokémon to storage' : 'Send to storage';
      const level = el.querySelector<HTMLElement>('.card-level')!;
      if (level.textContent !== String(member.level)) level.textContent = String(member.level);
      el.querySelector<HTMLElement>('.card-xp i')!.style.width = `${levelProgress(member.xp, member.level) * 100}%`;
    });

    // Tower Detail Panel
    const tower = state.selectedTower;
    if (tower) {
      const signature = `${tower.id}|${tower.tiers.join(',')}|${tower.pokemon.stage}|${tower.pokemon.level}|${tower.pokemon.nickname ?? ''}`;
      if (signature !== this.panelSignature) {
        this.panelSignature = signature;
        this.buildPanel(tower);
      }
      this.panelEl.classList.add('open');
      this.refreshPanel(tower, state.money);
    } else {
      this.panelEl.classList.remove('open');
      this.panelSignature = '';
    }

    // Announcer Banner
    const banner = this.announcer.getCurrentBanner();
    if (banner) {
      this.announcerBannerEl.style.display = 'block';
      this.announcerBannerEl.style.opacity = `${banner.opacity}`;
      document.getElementById('announcer-text')!.innerText = banner.text;
    } else {
      this.announcerBannerEl.style.display = 'none';
    }
  }
}
