/**
 * StadiumUI.ts — Authentic Pokémon Stadium User Interface
 *
 * Implements:
 * - Iconic metallic tournament top bar (Cup, Round, Prize Money, Poké Balls)
 * - Vertical tower roster for selecting and deploying Pokémon
 * - Tower detail panel: three buyable move lines, evolution track, recall
 * - Dynamic Stadium Announcer popup banners
 * - Speed & camera controls
 */

import { Tower } from './Tower';
import { attackChips } from './TowerAttack';
import type { SignatureDef } from './Signatures';
import { PokemonType, TYPE_COLORS, getCombinedEffectiveness, getEffectivenessLabel } from '../stadium/TypeMatrix';
import { MOVES, ParticleFXType } from '../stadium/MoveDatabase';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumCamera, CameraMode } from '../engine/StadiumCamera';
import { STADIUM_MAPS, type StadiumMap } from './MapCatalog';
import { CUP_ORDER, CUPS, isEligible, unlockedCups, type CupId } from './Cups';
import { mapPreview } from './MapPreview';
import { BALL_ORDER, BALL_PRICES, BallType, CaptureHud } from './CaptureSequence';
import type { Creep } from './Creep';
import { EvolutionHud } from './EvolutionSequence';
import { SummonHud } from './SummonSequence';
import { INTERMISSION_SECONDS, type MilestoneReward } from './WaveManager';
import { TrophyModelView } from './TrophyModelView';
import { PrizeMoneyFx } from './PrizeMoneyFx';
import { RosterModelView } from './RosterModelView';
import { escapeHtml, TrainerScreens, reportListHtml } from './progression/TrainerScreens';
import { deployCostOf, displayName, formOf, nextEvolution, OwnedPokemon, POKEDEX_TOTAL, speciesOf, statsOf, STORAGE_MAX, TEAM_SIZE, TrainerStore } from './progression/TrainerStore';
import { isRental } from './progression/Rentals';
import { levelProgress, MAX_LEVEL, xpForLevel } from './progression/Stats';
import { VARIANTS } from './progression/Variants';
import { dexNumber } from './progression/Species';
import type { MatchReportEntry } from './progression/MatchProgress';
import './map-select.css';
import './stadium-ui-core.css';
import stadiumThemeUrl from './stadium-ui-theme.css?url';

const BALL_NAMES: Record<BallType, string> = { poke: 'POKÉ', great: 'GREAT', ultra: 'ULTRA' };

const UI_SCALE_KEY = 'pokestadium.uiScale';
const PREMIUM_BALL_TIP_KEY = 'pokestadium.premiumBallTipSeen';
const SIGNATURE_TIP_KEY = 'pokestadium.signatureTipSeen';
const ROSTER_COLLAPSED_KEY = 'pokestadium.rosterCollapsed';
const UI_SCALE_BASE_WIDTH = 1440;
const UI_SCALE_BASE_HEIGHT = 900;
const UI_SCALE_AUTO_MAX = 1.5;
/** Upper bound a roster info card's stat bars are scaled against; a level-50 stat rarely clears this. */
const ROSTER_STAT_BAR_MAX = 200;
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

/** Attacking types this defender shrugs off entirely, and (optionally) is weak to. */
function defensiveNotes(types: PokemonType[], includeWeaknesses: boolean): string {
  const immuneTo: PokemonType[] = [];
  const weakTo: PokemonType[] = [];
  for (const attackType of Object.keys(TYPE_COLORS) as PokemonType[]) {
    const multiplier = getCombinedEffectiveness(attackType, types);
    if (multiplier === 0) immuneTo.push(attackType);
    else if (multiplier >= 2) weakTo.push(attackType);
  }
  const parts: string[] = [];
  if (immuneTo.length) parts.push(`Immune to ${immuneTo.join('/')}`);
  if (includeWeaknesses && weakTo.length) parts.push(`Weak to ${weakTo.join('/')}`);
  return parts.join(' · ');
}

/** Whether a catchable creep briefly cancels the player's game-speed setting
 *  back to 1x: never, only for species not yet in the collection, or always. */
export type CatchSlowMoMode = 'off' | 'new' | 'always';

/** Whether course selection can safely bypass team select without changing it. */
export function canUseSavedTeam(collection: OwnedPokemon[], team: (string | null)[], cup: CupId): boolean {
  return collection.length > 0
    && collection.length <= TEAM_SIZE
    && collection.every(pokemon => isEligible(pokemon.level, CUPS[cup]))
    && collection.every(pokemon => team.includes(pokemon.uid));
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
  /** Full roster, ignoring the map's type bias, plus a random modifier. */
  isMystery: boolean;
  /** The final round's own name while the course's final plays. */
  finalTitle: string | null;
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
  /** The player froze the match with Space; the Escape sheet has its own title. */
  paused: boolean;
}

export interface CatchSlot {
  creep: Creep;
  /** This exact Pokémon form has never been registered in the persistent Pokédex. */
  isNew: boolean;
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
  private premiumBallTipShown = (() => {
    try { return localStorage.getItem(PREMIUM_BALL_TIP_KEY) === '1'; } catch { return false; }
  })();
  private premiumBallTipEl!: HTMLElement;
  private signatureTipShown = (() => {
    try { return localStorage.getItem(SIGNATURE_TIP_KEY) === '1'; } catch { return false; }
  })();
  private signatureTipEl!: HTMLElement;
  private sigTooltipEl!: HTMLElement;
  private rosterInfoTipEl!: HTMLElement;
  private combatTextLayerEl!: HTMLElement;
  /** Prize money popups, coins and the wallet count-up; the game feeds it every payout. */
  public prizeFx!: PrizeMoneyFx;
  /** Whether each price was affordable at the wallet's last shown value, for the flash when it becomes so. */
  private affordable = new WeakMap<HTMLElement, boolean>();
  private lastWalletShown = 0;
  private walletRose = false;
  private showTypeEffectiveness = false;
  private wasBallLocked: Partial<Record<BallType, boolean>> = {};
  private cardDeckToggleEl!: HTMLButtonElement;
  private rosterCollapsed = (() => {
    try { return localStorage.getItem(ROSTER_COLLAPSED_KEY) === '1'; } catch { return false; }
  })();

  // Callbacks
  private cinemaEl!: HTMLElement;
  private evoCinemaEl!: HTMLElement;
  private summonCinemaEl!: HTMLElement;
  private cinemaVerdict: string = '';
  private trophyTimer: number = 0;
  /** Cups open at the last map-select refresh; anything new since gets a pulsing tab. */
  private knownCups: Set<CupId> | null = null;
  private trophyView = new TrophyModelView();
  private storageConfirmMember: OwnedPokemon | null = null;
  private storageConfirmPreviousFocus: HTMLElement | null = null;

  public onSelectMember: (member: OwnedPokemon | null) => void = () => {};
  public onStoreMember: (member: OwnedPokemon) => void = () => {};
  /** The current cup's level cap: XP bars read CUP CAP there instead of counting on. */
  public levelCap = MAX_LEVEL;
  public onUpgradeTower: (tower: Tower, lineIdx: number) => void = () => {};
  public onRecallTower: (tower: Tower) => void = () => {};
  public onChangeTargetPriority: (tower: Tower, dir: number) => void = () => {};
  public onDeselectTower: () => void = () => {};
  public onStartWave: () => void = () => {};
  public onChangeSpeed: (speed: number) => void = () => {};
  public onChangeCamera: (mode: CameraMode) => void = () => {};
  public onOpenMaps: () => void = () => {};
  public onResumeMap: () => void = () => {};
  /** Course select came up (team select and the collection open from it). */
  public onMenuShown: () => void = () => {};
  /** The new-trainer gift's Poké Ball has popped open. */
  public onGiftRevealed: (name: string, type: PokemonType) => void = () => {};
  public onResumeGame: () => void = () => {};
  public onCastSignature: (tower: Tower, signatureId: string) => void = () => {};
  public onToggleSignatureCuts: () => void = () => {};
  public onToggleSummonCinematics: () => void = () => {};
  public onToggleTypeEffectivenessInfo: () => void = () => {};
  public onToggleCatchSlowMo: () => void = () => {};
  public onMusicVolumeChange: (value: number) => void = () => {};
  public onSfxVolumeChange: (value: number) => void = () => {};
  public onAnnouncerVolumeChange: (value: number) => void = () => {};
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
    this.trainer.onGiftRevealed = (name, type) => this.onGiftRevealed(name, type);
    // A new trainer picks a starter before anything else.
    if (!store.data.starterChosen) this.trainer.openStarterSelect(() => this.setMapSelectVisible(true));
  }

  private initDOM(): void {
    // CATCH_TAG_HEIGHT also drives the catch-tag hit-rect math below, so it stays
    // the source of truth in TS and feeds the stylesheet through a custom property.
    this.container.style.setProperty('--catch-tag-height', `${CATCH_TAG_HEIGHT}px`);
    this.container.innerHTML = `
      <link rel="stylesheet" href="${stadiumThemeUrl}">

      <div id="map-select" class="interactive" aria-label="Select a battlefield">
        <section class="map-select-panel stadium-panel">
          <div class="map-select-header">
            <div class="map-select-eyebrow">POKÉMON STADIUM TD / COURSE SELECT</div>
            <button id="btn-open-team" class="stadium-btn">VIEW MY POKÉMON</button>
          </div>
          <h1 class="map-select-title">CHOOSE YOUR BATTLEFIELD</h1>
          <div class="map-filters" aria-label="Filter by cup">
            ${['all',...CUP_ORDER].map((filter,i)=>`<button class="stadium-btn map-filter ${i===0?'active':''}" data-cup-filter="${filter}" aria-pressed="${i===0}">${filter==='all'?'ALL':CUPS[filter as CupId].name.replace(' CUP','')}</button>`).join('')}
          </div>
          <div class="map-cards">
            ${[...STADIUM_MAPS].sort((a,b)=>CUP_ORDER.indexOf(a.cup)-CUP_ORDER.indexOf(b.cup)).map(map=>{const cup=CUPS[map.cup];return `<button class="map-card interactive" data-map-id="${map.id}" data-map-cup="${map.cup}" aria-label="Play ${map.name}, ${cup.name}, entry level ${cup.entryMax} and under">
              ${mapPreview(map)}
              <span class="map-cup ${map.cup}">${cup.name}</span>
              <span class="map-lock" data-map-lock hidden>LOCKED<small>Clear a ${CUP_ORDER.indexOf(map.cup)>0?CUPS[CUP_ORDER[CUP_ORDER.indexOf(map.cup)-1]].name:''} course to open</small></span>
              <span class="map-card-body"><strong class="map-name">${map.name}</strong><span class="map-venue">${map.venue}</span>
              <span class="map-cup-rules">LV ≤ ${cup.entryMax} · CAP ${cup.levelCap}</span>
              <span class="map-description">${map.description}</span>
              <span class="map-record" data-map-record="${map.id}"></span></span>
            </button>`;}).join('')}
          </div>
          <div class="map-select-footer"><button id="btn-resume-map" class="stadium-btn" hidden>RESUME MATCH</button></div>
        </section>
      </div>

      <!-- Top Row: stats, start-match, and controls share one flex line so they
           can never overlap each other regardless of viewport width. -->
      <div id="top-row" class="interactive">
        <!-- Top Bar -->
        <div id="top-bar" class="stadium-panel">
          <div class="stat-badge" id="round-badge">
            <span class="stat-label" id="cup-title">QUALIFIERS</span>
            <span class="stat-value gold-glow" id="round-number">ROUND 1</span>
          </div>
          <div class="stat-badge" id="mystery-badge" hidden title="Mystery round: full roster, random modifier">
            <span class="stat-label">???</span>
            <span class="stat-value mystery-glow" id="mystery-mark">?</span>
          </div>
          <div class="stat-badge" aria-label="Available funds">
            <span class="stat-value" style="color: #48ff48;" id="prize-money">$400</span>
          </div>
          <div class="stat-badge">
            <span class="stat-label">STADIUM HP</span>
            <div class="pokeball-tray" id="stadium-hp"></div>
          </div>
        </div>

        <!-- Start Round -->
        <div id="start-match-bar">
          <button class="stadium-btn active" id="btn-wave"><span id="wave-clock" hidden><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="wave-clock-track" cx="18" cy="18" r="15.5"/><circle class="wave-clock-fill" id="wave-clock-fill" cx="18" cy="18" r="15.5" pathLength="100"/></svg><span id="wave-clock-count"></span></span><span id="wave-label">START ROUND</span></button>
        </div>

        <!-- Controls -->
        <div id="controls-bar">
          <div class="control-group" id="speed-control-group" aria-label="Game speed">
            <span class="control-group-label">SPEED</span>
            <div class="control-group-buttons">
              <button class="stadium-btn" id="btn-speed-half">.5X</button>
              <button class="stadium-btn active" id="btn-speed-1">1X</button>
              <button class="stadium-btn" id="btn-speed-2">2X</button>
              <button class="stadium-btn" id="btn-speed-3">3X</button>
              <button class="stadium-btn" id="btn-speed-4">4X</button>
            </div>
            <button class="control-group-tab" id="btn-catch-slowmo" title="When a Pokémon becomes catchable, briefly cancel your speed setting back to 1x so it doesn't faint before you can react">CATCH SLOW-MO: NEW ONLY</button>
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
      <button id="card-deck-toggle" class="interactive" aria-label="Collapse roster panel" aria-expanded="true" title="Collapse roster panel">▶</button>
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

      <!-- Floating combat text: crits, immunities, and (opt-in) type effectiveness -->
      <div id="combat-text-layer"></div>

      <!-- Prize money: popups off each payout and coins flying into the wallet -->
      <div id="prize-layer"></div>

      <div id="paused-banner" aria-live="polite" hidden>PAUSED</div>

      <div id="pause-screen" class="interactive" hidden>
        <section class="pause-card stadium-panel" aria-labelledby="pause-title">
          <h2 id="pause-title">PAUSED</h2>
          <div class="pause-actions">
            <button class="stadium-btn active" id="btn-pause-resume">RESUME</button>
            <button class="stadium-btn" id="btn-pause-quit">QUIT TO COURSE SELECT</button>
          </div>
          <button class="stadium-btn pause-setting" id="btn-signature-cuts">SIGNATURE CAMERA CUTS: ON</button>
          <button class="stadium-btn pause-setting" id="btn-summon-cinematics">POKÉ BALL ENTRANCES: ON</button>
          <button class="stadium-btn pause-setting" id="btn-type-effectiveness" title="Shows a popup for super/not-very-effective hits, not just immunity">TYPE EFFECTIVENESS INFO: OFF</button>
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
          <div class="pause-audio"><label for="pause-announcer-volume">ANNOUNCER</label><input id="pause-announcer-volume" type="range" min="0" max="100" value="100"><output id="pause-announcer-volume-value">100%</output></div>
        </section>
      </div>

      <!-- Capture Cinematic -->
      <div id="capture-cinema">
        <div id="cine-vignette"></div>
        <div class="cine-bar top"></div>
        <div class="cine-bar bottom"></div>
        <div id="cine-flare"></div>
        <div id="cine-card">
          <div class="cine-orb-wrap">
            <svg class="cine-timer-ring" id="cine-timer-ring" viewBox="0 0 36 36" width="36" height="36" hidden>
              <circle class="ring-track" cx="18" cy="18" r="15" />
              <circle class="ring-fill" cx="18" cy="18" r="15" />
            </svg>
            <div class="cine-orb poke" id="cine-orb"></div>
          </div>
          <div class="cine-copy"><span id="cine-target">CHALLENGER</span><span id="cine-sub">POKÉ BALL · 0%</span></div>
          <div id="cine-pips"></div>
        </div>
        <div id="cine-meter"><div class="meter-zone"></div><div class="meter-marker"></div></div>
        <div id="cine-grade"></div>
        <div id="cine-caption">CAPTURE ATTEMPT</div>
        <div id="cine-verdict"></div>
        <div id="cine-skip" hidden>CLICK · SPACE · ESC TO SKIP</div>
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
        <div class="capture-kit-header">
          <span class="col-select">BALL SELECT</span>
          <span class="col-buy">BUY</span>
        </div>
        ${BALL_ORDER.map(type => `
          <div class="capture-row" data-ball-row="${type}">
            <button class="ball-stock" data-ball-type="${type}" data-select-ball="${type}" aria-pressed="false">
              <span class="ball-icon ${type}" aria-hidden="true"></span>
              <span class="ball-name">${BALL_NAMES[type]}</span>
              <span class="ball-count">×0</span>
            </button>
            <button class="stadium-btn ball-buy" data-buy-ball="${type}">$${BALL_PRICES[type]}</button>
          </div>`).join('')}
      </div>
      <div id="premium-ball-tip" class="interactive" hidden>Great &amp; Ultra Balls only restock between rounds &mdash; stock up before you start the next one!</div>
      <div id="signature-tip" class="interactive" hidden>This is a SIGNATURE MOVE &mdash; a tower's strongest attack, worth aiming by hand. Click it or press its number key. Limited uses (PP) refill each round.</div>
      <div id="signature-bar" class="interactive" aria-label="Signature moves"></div>
      <div id="sig-tooltip" hidden></div>
      <div id="roster-info-tip" hidden></div>
      <!-- Tower Detail Panel -->
      <div id="tower-panel" class="stadium-panel interactive"></div>
    `;

    this.cardDeckEl = document.getElementById('card-deck')!;
    this.storageConfirmEl = document.getElementById('storage-confirm')!;
    this.cardDeckToggleEl = document.getElementById('card-deck-toggle') as HTMLButtonElement;
    this.cardDeckToggleEl.addEventListener('click', () => this.setRosterCollapsed(!this.rosterCollapsed));
    this.applyRosterCollapsed();
    this.premiumBallTipEl = document.getElementById('premium-ball-tip')!;
    this.premiumBallTipEl.addEventListener('click', () => this.dismissPremiumBallTip());
    this.signatureTipEl = document.getElementById('signature-tip')!;
    this.signatureTipEl.addEventListener('click', () => this.dismissSignatureTip());
    this.sigTooltipEl = document.getElementById('sig-tooltip')!;
    this.rosterInfoTipEl = document.getElementById('roster-info-tip')!;
    this.combatTextLayerEl = document.getElementById('combat-text-layer')!;
    this.prizeFx = new PrizeMoneyFx(document.getElementById('prize-layer')!, document.getElementById('prize-money')!, () => this.uiScale);
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
        // Skip team select only when every eligible collection member is
        // already on the saved team. Empty slots may be an intentional bench.
        const { collection, team } = this.store.data;
        if (canUseSavedTeam(collection, team, map.cup)) {
          this.store.rentalPicks = [];
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

  /** Course cards show the trainer's best run and whether the cup is open, both of which change after every match. */
  private refreshMapRecords(): void {
    this.container.querySelectorAll<HTMLElement>('[data-map-record]').forEach(el => {
      const record = this.store.data.maps[el.dataset.mapRecord!];
      el.textContent = record ? `BEST ROUND ${record.bestRound}${record.cleared ? ' · CLEARED' : ''}` : '';
      el.hidden = !record;
    });
    const open = unlockedCups(STADIUM_MAPS, this.store.data.maps);
    this.container.querySelectorAll<HTMLButtonElement>('[data-map-cup]').forEach(card => {
      const locked = !open.has(card.dataset.mapCup as CupId);
      card.disabled = locked;
      card.classList.toggle('locked', locked);
      card.querySelector<HTMLElement>('[data-map-lock]')!.hidden = !locked;
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-cup-filter]').forEach(tab => {
      const id = tab.dataset.cupFilter as CupId;
      if (id === ('all' as string)) return;
      tab.classList.toggle('locked', !open.has(id));
      if (this.knownCups && open.has(id) && !this.knownCups.has(id)) tab.classList.add('new-cup');
    });
    this.knownCups = open;
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

      const rental = isRental(member);
      if (rental) card.classList.add('rental');
      const variant = member.variant ? VARIANTS[member.variant.kind] : null;
      if (variant) {
        card.classList.add('has-variant');
        card.style.setProperty('--variant-color', variant.accentColor);
      }
      card.innerHTML = `
        <span class="card-portrait-stage" style="background-image: linear-gradient(90deg, transparent 28%, rgba(4,12,43,.18) 48%, rgba(4,12,43,.96) 78%), url('${typeArt}');"></span>
        <button class="card-info-btn" type="button" data-info-member aria-label="View ${escapeHtml(displayName(member))} details">?</button>
        <span class="card-cost">$${deployCostOf(member)}</span>
        <span class="card-xp"><i style="width:${levelProgress(member.xp, member.level) * 100}%"></i></span>
        <span class="card-deployed">ON FIELD</span>
        <button class="card-storage" type="button" data-store-member aria-label="Send ${escapeHtml(displayName(member))} to storage" ${rental ? 'hidden' : ''}>STORE</button>
        ${rental ? '<span class="card-rental">RENTAL</span>' : ''}
      `;

      const select = () => {
        if (!card.classList.contains('disabled')) this.onSelectMember(member);
      };
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

      const infoButton = card.querySelector<HTMLButtonElement>('[data-info-member]')!;
      infoButton.addEventListener('mouseenter', () => this.showRosterInfo(infoButton, member));
      infoButton.addEventListener('focus', () => this.showRosterInfo(infoButton, member));
      infoButton.addEventListener('mouseleave', () => this.hideRosterInfo());
      infoButton.addEventListener('blur', () => this.hideRosterInfo());
      infoButton.addEventListener('click', (event) => event.stopPropagation());
      infoButton.addEventListener('keydown', (event) => event.stopPropagation());

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

  private dismissPremiumBallTip(): void {
    this.premiumBallTipEl.hidden = true;
    this.premiumBallTipShown = true;
    try { localStorage.setItem(PREMIUM_BALL_TIP_KEY, '1'); } catch { /* storage blocked */ }
  }

  private dismissSignatureTip(): void {
    this.signatureTipEl.hidden = true;
    this.signatureTipShown = true;
    try { localStorage.setItem(SIGNATURE_TIP_KEY, '1'); } catch { /* storage blocked */ }
  }

  private setRosterCollapsed(collapsed: boolean): void {
    this.rosterCollapsed = collapsed;
    this.applyRosterCollapsed();
    try { localStorage.setItem(ROSTER_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* storage blocked */ }
  }

  private applyRosterCollapsed(): void {
    this.cardDeckEl.hidden = this.rosterCollapsed;
    this.cardDeckToggleEl.classList.toggle('collapsed', this.rosterCollapsed);
    this.cardDeckToggleEl.textContent = this.rosterCollapsed ? '◀' : '▶';
    this.cardDeckToggleEl.title = this.rosterCollapsed ? 'Expand roster panel' : 'Collapse roster panel';
    this.cardDeckToggleEl.setAttribute('aria-expanded', String(!this.rosterCollapsed));
  }

  private bindEvents(): void {
    document.getElementById('btn-resume-map')!.addEventListener('click',()=>{
      this.setMapSelectVisible(false);this.onResumeMap();
    });
    document.getElementById('btn-pause-resume')!.addEventListener('click', () => this.onResumeGame());
    document.getElementById('btn-pause-quit')!.addEventListener('click', () => this.onQuitToMenu());
    document.getElementById('btn-signature-cuts')!.addEventListener('click', () => this.onToggleSignatureCuts());
    document.getElementById('btn-summon-cinematics')!.addEventListener('click', () => this.onToggleSummonCinematics());
    document.getElementById('btn-type-effectiveness')!.addEventListener('click', () => this.onToggleTypeEffectivenessInfo());
    document.getElementById('btn-catch-slowmo')!.addEventListener('click', () => this.onToggleCatchSlowMo());
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
    bindVolume('pause-announcer-volume', 'pause-announcer-volume-value', value => this.onAnnouncerVolumeChange(value));
    this.container.querySelectorAll<HTMLButtonElement>('[data-cup-filter]').forEach(button=>{
      button.addEventListener('click',()=>{
        const filter=button.dataset.cupFilter;
        button.classList.remove('new-cup');
        this.container.querySelectorAll<HTMLButtonElement>('[data-cup-filter]').forEach(tab=>{
          tab.classList.toggle('active',tab===button);tab.setAttribute('aria-pressed',String(tab===button));
        });
        this.container.querySelectorAll<HTMLButtonElement>('[data-map-id]').forEach(card=>{
          card.hidden=filter!=='all' && card.dataset.mapCup!==filter;
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
      // shown/tp-line-stats only ever surfaces one tier's effect (the next
      // one to buy, or the final one once maxed) — a hover tooltip lists
      // every tier already bought so a player can see the full stack, not
      // just the newest layer (round 2 feedback #19).
      const purchasedSummary = bought > 0
        ? path.tiers.slice(0, bought).map((tier, t) => `TIER ${t + 1} — ${tier.name}: ${tier.description}`).join('\n')
        : '';
      return `
        <div class="tp-line${closedRow}">
          <div class="tp-pips">${pips}</div>
          <div class="tp-line-meta"${purchasedSummary ? ` title="${escapeHtml(purchasedSummary)}"` : ''}>
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
    // A fully-evolved tower simply has nothing to show here.
    const nextEvo = nextEvolution(tower.pokemon);
    const evoBlock = nextEvo
      ? `<div class="tp-evolve earned">
           <div>
             <span class="tp-evolve-label">→ ${nextEvo.name.toUpperCase()}</span>
             <span class="tp-evolve-sub">EVOLVES BY LEVELING UP IN BATTLE</span>
           </div>
           <span class="tp-evolve-cost">LV ${nextEvo.atLevel}</span>
         </div>`
      : '';

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
        <span class="tp-recall-note">Frees this spot &mdash; ${displayName(tower.pokemon)} goes back to your roster</span>
        <button class="tp-recall-btn" id="tp-recall">RECALL</button>
      </div>
    `;

    // Wire the freshly-built controls to the tower they were built for.
    document.getElementById('tp-close')!.addEventListener('click', () => this.onDeselectTower());
    document.getElementById('tp-recall')!.addEventListener('click', () => this.onRecallTower(tower));
    document.getElementById('tp-target-prev')!.addEventListener('click', () => this.onChangeTargetPriority(tower, -1));
    document.getElementById('tp-target-next')!.addEventListener('click', () => this.onChangeTargetPriority(tower, 1));

    this.panelEl.querySelectorAll<HTMLElement>('.tp-buy').forEach(btn => {
      if (btn.classList.contains('maxed') || btn.classList.contains('locked')) return;
      const lineIdx = Number(btn.dataset.line);
      btn.addEventListener('click', () => this.onUpgradeTower(tower, lineIdx));
    });
  }

  /** Per-frame refresh: affordability, targeting, live match-up. */
  private refreshPanel(tower: Tower, money: number): void {
    const targetLabel = document.getElementById('tp-target-label');
    if (targetLabel) targetLabel.innerText = tower.targetPriority.toUpperCase();

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
      this.noteAffordable(btn, cost);
    });

    const xpFill = document.getElementById('tp-xp-fill');
    const xpLabel = document.getElementById('tp-xp-label');
    if (xpFill && xpLabel) {
      const { xp, level } = tower.pokemon;
      xpFill.style.width = `${levelProgress(xp, level) * 100}%`;
      const label = level >= MAX_LEVEL ? 'MAX LEVEL' : level >= this.levelCap ? `CUP CAP · LV ${this.levelCap}` : `${xpForLevel(level + 1) - xp} XP TO LV ${level + 1}`;
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
    // A pale flare rides the tension so the near-frozen beats still breathe:
    // the wobble, and the held freeze while the ball drinks its quarry in.
    const frozen = cinema.phase === 'wobble' || cinema.phase === 'hang'
      || cinema.phase === 'absorb' || cinema.phase === 'snap';
    this.cinemaEl.querySelector<HTMLElement>('#cine-flare')!.style.opacity =
      frozen ? `${0.04 + Math.abs(Math.sin(performance.now() * 0.006)) * 0.05 * cinema.tension}` : '0';

    this.cinemaEl.querySelector<HTMLElement>('#cine-orb')!.className = `cine-orb ${cinema.ballType}`;
    const timerRing = this.cinemaEl.querySelector<SVGElement>('#cine-timer-ring')!;
    const showRing = cinema.phase === 'aim';
    timerRing.toggleAttribute('hidden', !showRing);
    if (showRing) {
      const ringFill = timerRing.querySelector<SVGCircleElement>('.ring-fill')!;
      const circumference = 2 * Math.PI * 15;
      ringFill.style.strokeDashoffset = `${circumference * (1 - cinema.aimTimeLeft)}`;
    }
    this.cinemaEl.querySelector<HTMLElement>('#cine-target')!.innerText = cinema.targetName;
    this.cinemaEl.querySelector<HTMLElement>('#cine-sub')!.innerText =
      `${cinema.ballName} · ${(cinema.chance * 100).toFixed(0)}% CATCH RATE`;
    this.cinemaEl.querySelector<HTMLElement>('#cine-caption')!.innerText = cinema.caption;
    // The outcome is already rolled the instant the throw releases, so
    // everything after that point is skippable straight to the verdict.
    this.cinemaEl.querySelector<HTMLElement>('#cine-skip')!.toggleAttribute('hidden', cinema.phase === 'aim');

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
    meter.classList.toggle('single-pass', aim.variant === 'single');

    grade.className = aim.grade ?? 'hint';
    grade.innerHTML = aim.grade === 'perfect' ? `PERFECT! +${Math.round(aim.bonus * 100)}% ODDS`
      : aim.grade === 'good' ? `GOOD! +${Math.round(aim.bonus * 100)}% ODDS`
      : aim.grade === 'wide' ? `WIDE! ${Math.round(aim.bonus * 100)}% ODDS`
      : `CLICK OR PRESS SPACE TO THROW ${cinema.ballName} <span class="cine-cancel-hint">· ESC TO CANCEL</span>`;
  }

  /** Milestone payout card, sharing the trophy card's slot and timing. */
  /** `unlockedCup` names a cup this clear just opened. */
  /** The trophy card's centre in layer pixels, where milestone coins shower from. */
  public trophyCenter(): { x: number; y: number } {
    const rect = document.getElementById('capture-trophy')!.getBoundingClientRect();
    if (!rect.width) return { x: window.innerWidth / 2 / this.uiScale, y: window.innerHeight * 0.3 / this.uiScale };
    return { x: (rect.left + rect.width / 2) / this.uiScale, y: (rect.top + rect.height / 2) / this.uiScale };
  }

  public showMilestone(milestone: MilestoneReward, unlockedCup?: string): void {
    const card = document.getElementById('capture-trophy')!;
    const ballNames: Record<BallType, string> = { poke: 'POKÉ BALL', great: 'GREAT BALL', ultra: 'ULTRA BALL' };
    const rewards = [
      `<div class="trophy-move"><span>+$${milestone.money}</span><em>PRIZE MONEY</em></div>`,
      ...(Object.entries(milestone.balls) as [BallType, number][]).map(([ball, count]) =>
        `<div class="trophy-move"><span>+${count} ${ballNames[ball]}${count > 1 ? 'S' : ''}</span><em>CAPTURE KIT</em></div>`),
      ...(unlockedCup ? [`<div class="trophy-move new-cup"><span>${unlockedCup}</span><em>NOW OPEN</em></div>`] : []),
    ].join('');
    this.trophyView.hide();
    card.classList.remove('has-model', 'new-registration');
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
    card.classList.remove('has-model', 'new-registration', 'naming', 'interactive');
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
    options: {
      duplicate: boolean;
      openTeamSlot: boolean;
      guestSlotsLeft: number;
      storageFull: boolean;
      firstRegistration: boolean;
      caughtBefore: number;
      newSpeciesBonus: number;
      milestone: boolean;
    },
    onNamed: (name: string | null, destination: 'match' | 'storage' | 'research') => void,
  ): void {
    const {
      duplicate, openTeamSlot, guestSlotsLeft, storageFull,
      firstRegistration, caughtBefore, newSpeciesBonus, milestone,
    } = options;
    const card = document.getElementById('capture-trophy')!;
    const species = speciesOf(pokemon);
    const form = formOf(pokemon);
    const typeColor = TYPE_COLORS[form.type]?.hex || '#ffffff';
    const variant = pokemon.variant ? VARIANTS[pokemon.variant.kind] : null;
    const moves = species.paths.map(path =>
      `<div class="trophy-move"><span>${path.tiers[0].name.toUpperCase()}</span><em>${path.label}</em></div>`
    ).join('');
    // An open team slot is a permanent add, not a temporary match guest, so
    // it gets its own label rather than borrowing the guest-slot language.
    const noteTail = storageFull
      ? `STORAGE FULL AT ${STORAGE_MAX} · RELEASE ONE IN MY POKÉMON TO MAKE ROOM`
      : openTeamSlot
      ? 'TEAM: OPEN SLOT'
      : guestSlotsLeft ? `MATCH GUESTS: ${guestSlotsLeft} SLOT${guestSlotsLeft === 1 ? '' : 'S'} LEFT` : 'MATCH GUESTS FULL';
    const addButton = storageFull ? ''
      : openTeamSlot
      ? '<button class="stadium-btn active" type="submit">ADD TO TEAM</button>'
      : guestSlotsLeft ? `<button class="stadium-btn active" type="submit">ADD TO MATCH · ${guestSlotsLeft} SLOT${guestSlotsLeft === 1 ? '' : 'S'} LEFT</button>` : '';
    // With nowhere to put it, research is the only way off this card.
    const researchButton = storageFull
      ? '<button class="stadium-btn active" type="button" data-research>SEND TO RESEARCH</button>'
      : duplicate ? '<button class="stadium-btn" type="button" data-research>SEND TO RESEARCH</button>' : '';
    const number = dexNumber(pokemon.speciesId, pokemon.stage);
    const dexStrip = Array.from({ length: 5 }, (_, index) => number + index - 2)
      .filter(value => value >= 1 && value <= POKEDEX_TOTAL)
      .map(value => value === number
        ? `<span class="dex-register-cell current"><span class="dex-silhouette"></span><img src="/generated/stadium/icons/${String(value).padStart(3, '0')}.png" alt=""><b>#${String(value).padStart(3, '0')}</b></span>`
        : `<span class="dex-register-cell"><span class="dex-silhouette"></span><b>#${String(value).padStart(3, '0')}</b></span>`)
      .join('');
    const registration = firstRegistration ? `
      <div class="registration-kicker">NEW POKÉMON!</div>
      <div class="registration-title">#${String(number).padStart(3, '0')} ${form.name.toUpperCase()} REGISTERED</div>
      <div class="dex-register-strip" aria-label="Pokédex number ${number} registered">${dexStrip}</div>
      <div class="registration-progress"><span>${caughtBefore} / ${POKEDEX_TOTAL}</span><i>→</i><strong>${caughtBefore + 1} / ${POKEDEX_TOTAL} CAUGHT</strong></div>
      <div class="registration-bonus">NEW SPECIES BONUS <strong>+$${newSpeciesBonus}</strong></div>
      ${milestone ? `<div class="registration-milestone">COLLECTOR MILESTONE · ${caughtBefore + 1} REGISTERED!</div>` : ''}
    ` : '';
    card.classList.toggle('has-variant', !!variant);
    card.classList.toggle('new-registration', firstRegistration);
    if (variant) card.style.setProperty('--variant-color', variant.accentColor);
    card.innerHTML = `
      <div class="trophy-stage"></div>
      <div class="trophy-copy">
        ${registration}
        <div class="trophy-kicker">${storageFull ? 'STORAGE FULL' : duplicate ? 'DUPLICATE ENCOUNTER' : firstRegistration ? 'COLLECTION UPDATED' : 'POKÉMON CAUGHT'}</div>
        <div class="trophy-name">${form.name.toUpperCase()} <small>LV ${pokemon.level}</small></div>
        <div class="trophy-type" style="background:${typeColor}">${form.type.toUpperCase()}</div>
        ${variant ? `<span class="trophy-variant">${variant.label}</span>` : ''}
        <div class="trophy-moves">${moves}</div>
        <div class="trophy-duplicate-note">${storageFull ? `You already own ${STORAGE_MAX} Pokémon.` : duplicate ? 'You already own this species.' : 'Choose where this Pokémon goes.'} ${noteTail}</div>
        <form class="trophy-nickname">
          <label for="trophy-nickname-input" ${storageFull ? 'hidden' : ''}>GIVE A NICKNAME TO ${form.name.toUpperCase()}?</label>
          <div class="trophy-nickname-row">
            <input id="trophy-nickname-input" maxlength="10" autocomplete="off" placeholder="${form.name}" ${storageFull ? 'hidden' : ''}>
            ${addButton}
            ${storageFull ? '' : '<button class="stadium-btn" type="button" data-storage>SEND TO STORAGE</button>'}
            ${researchButton}
          </div>
        </form>
      </div>
    `;
    card.querySelector('.trophy-stage')!.appendChild(this.trophyView.canvas);
    card.classList.add('has-model', 'shown', 'naming', 'interactive');
    this.trophyView.show(form.name, species.createModel, variant?.accentColor);
    const portrait = card.querySelector<HTMLImageElement>('.dex-register-cell.current img');
    if (portrait) {
      const loaded = () => portrait.parentElement?.classList.add('portrait-loaded');
      portrait.addEventListener('load', loaded, { once: true });
      if (portrait.complete && portrait.naturalWidth) loaded();
    }
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
      if (openTeamSlot || guestSlotsLeft) finish(input.value.trim() || null, 'match');
    });
    card.querySelector('[data-storage]')?.addEventListener('click', () => finish(input.value.trim() || null, 'storage'));
    card.querySelector('[data-research]')?.addEventListener('click', () => finish(null, 'research'));
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') finish(null, 'storage');
    });
    // With no nickname to type, the card's own key handling takes Escape and
    // focus goes to the one button that can close it.
    const dismiss = storageFull ? card.querySelector<HTMLButtonElement>('[data-research]')! : input;
    if (storageFull) {
      card.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(null, 'research');
      });
    }
    window.setTimeout(() => dismiss.focus(), firstRegistration ? 950 : 50);
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
  /** Measured once when a tag is created; its fixed content widths do not change afterward. */
  private catchTagWidths = new Map<number, number>();
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
        this.catchTagWidths.delete(id);
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
        tag.innerHTML = `<span class="ball-icon" aria-hidden="true"></span><span class="catch-new">NEW</span><span class="catch-label"></span><span class="catch-odds"></span>`;
        tagsEl.appendChild(tag);
        this.catchTags.set(id, tag);
      }
      tag.disabled = state.balls[state.selectedBall] <= 0;
      if ((tag.dataset.isNew === 'true') !== slot.isNew) this.catchTagWidths.delete(id);
      tag.dataset.isNew = String(slot.isNew);
      tag.classList.toggle('new-species', slot.isNew);
      tag.querySelector<HTMLElement>('.catch-new')!.hidden = !slot.isNew;
      const throwTitle = tag.disabled ? `No ${BALL_NAMES[state.selectedBall]} Balls left` : `Throw a ${BALL_NAMES[state.selectedBall]} Ball`;
      const typeInfo = defensiveNotes(slot.creep.types, this.showTypeEffectiveness);
      tag.title = typeInfo
        ? `${slot.creep.types.join('/').toUpperCase()} TYPE · ${typeInfo}\n${throwTitle}`
        : throwTitle;
      tag.querySelector<HTMLElement>('.ball-icon')!.className = `ball-icon ${state.selectedBall}`;
      tag.querySelector<HTMLElement>('.catch-label')!.textContent = `CATCH ${slot.creep.name.replace(/^Titan /, '').toUpperCase()}`;
      tag.querySelector<HTMLElement>('.catch-odds')!.textContent = `${Math.round(slot.odds[state.selectedBall] * 100)}%`;
      shown.add(id);
      let w = this.catchTagWidths.get(id);
      if (w === undefined) {
        w = tag.offsetWidth;
        this.catchTagWidths.set(id, w);
      }
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
    const trayKey = `${state.selectedBall}|${state.catchables.map(slot => `${this.catchId(slot.creep)}:${slot.isNew}`).join('|')}`;
    if (trayKey !== this.catchTrayKey) {
      this.catchTrayKey = trayKey;
      tray.hidden = state.catchables.length === 0;
      tray.querySelector('.catch-chips')!.innerHTML = state.catchables.map(slot => {
        const creep = slot.creep;
        const color = TYPE_COLORS[creep.type]?.hex ?? '#fff';
        const odds = Math.round(slot.odds[state.selectedBall] * 100);
        return `<button class="catch-chip${slot.isNew ? ' new-species' : ''}" data-catch-chip="${this.catchId(creep)}"><i style="background:${color}"></i><span class="catch-chip-copy"><b>${slot.isNew ? '<em>NEW</em>' : ''}${escapeHtml(creep.name.replace(/^Titan /, '').toUpperCase())}</b></span><span class="catch-odds">${odds}%</span></button>`;
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
          <button class="sig-btn" data-sig="${i}">
            <span class="sig-mark" style="background:${color}55">${glyph(SIGNATURE_GLYPHS[slot.def.type] ?? 'impact', color, 22)}</span>
            <span class="sig-name">${slot.def.name.toUpperCase()}</span>
            <span class="sig-meta">${escapeHtml(slot.tower.name.toUpperCase())}<span class="sig-pp"></span></span>
            ${i < 9 ? `<span class="sig-key">${i + 1}</span>` : ''}
          </button>`;
      }).join('');
      bar.querySelectorAll<HTMLButtonElement>('.sig-btn').forEach(button => {
        const slot = slots[Number(button.dataset.sig)];
        button.addEventListener('click', () => this.onCastSignature(slot.tower, slot.def.id));
        // A native title tooltip can't be made bigger, so a richer readout
        // (round 2 feedback #27) needs its own hover/focus-driven element.
        button.addEventListener('mouseenter', () => this.showSigTooltip(button, slot));
        button.addEventListener('focus', () => this.showSigTooltip(button, slot));
        button.addEventListener('mouseleave', () => this.hideSigTooltip());
        button.addEventListener('blur', () => this.hideSigTooltip());
      });
    }
    bar.querySelectorAll<HTMLButtonElement>('.sig-btn').forEach((button, i) => {
      const slot = slots[i];
      button.disabled = blocked || slot.pp <= 0;
      button.classList.toggle('aiming', slot.aiming);
      const pips = Array.from({ length: slot.def.pp }, (_, p) => `<i class="${p < slot.pp ? 'on' : ''}"></i>`).join('');
      const ppEl = button.querySelector<HTMLElement>('.sig-pp')!;
      if (ppEl.innerHTML !== pips) ppEl.innerHTML = pips;
      // Live-update the tooltip's PP line if it's open on this exact button
      // (aiming/casting can drain PP while the pointer never left it).
      if (this.sigTooltipTarget === button) this.showSigTooltip(button, slot);
    });
    // Teach what a signature move is the first time one ever exists, same
    // one-time pattern as the premium-ball tip. Positioned off the bar's own
    // rect, to its right rather than above it — the signature bar shares its
    // left-edge column with the capture-kit panel just above it, so stacking
    // the tip upward risked covering the ball-buying UI.
    if (slots.length > 0 && !this.signatureTipShown) {
      this.signatureTipEl.hidden = false;
      const rect = bar.getBoundingClientRect();
      // Anchored to the bar's bottom edge, not its top: with just one
      // signature the bar sits right at the screen edge, and a box growing
      // down from a top anchor there would run off the viewport.
      this.signatureTipEl.style.left = `${rect.right + 14}px`;
      this.signatureTipEl.style.top = `${Math.max(8, rect.bottom - this.signatureTipEl.offsetHeight)}px`;
      this.signatureTipShown = true;
      try { localStorage.setItem(SIGNATURE_TIP_KEY, '1'); } catch { /* storage blocked */ }
    }
  }

  private sigTooltipTarget: HTMLElement | null = null;

  private showSigTooltip(button: HTMLElement, slot: SignatureSlot): void {
    this.sigTooltipTarget = button;
    const color = TYPE_COLORS[slot.def.type]?.hex ?? '#fff';
    this.sigTooltipEl.innerHTML = `
      <div class="sigt-name">
        ${slot.def.name.toUpperCase()}
        <span class="sigt-type" style="background:${color}">${slot.def.type.toUpperCase()}</span>
      </div>
      <div class="sigt-desc">${escapeHtml(slot.def.description)}</div>
      <div class="sigt-pp">${escapeHtml(slot.tower.name.toUpperCase())} &middot; PP ${slot.pp}/${slot.def.pp}</div>
    `;
    this.sigTooltipEl.hidden = false;
    const rect = button.getBoundingClientRect();
    const tipRect = this.sigTooltipEl.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - tipRect.width - 8);
    this.sigTooltipEl.style.left = `${left}px`;
    this.sigTooltipEl.style.top = `${Math.max(8, rect.top - tipRect.height - 10)}px`;
  }

  private hideSigTooltip(): void {
    this.sigTooltipTarget = null;
    this.sigTooltipEl.hidden = true;
  }

  /** The roster card trims name/level/cost chrome to fit; this fills in the rest on demand. */
  private showRosterInfo(button: HTMLElement, member: OwnedPokemon): void {
    const form = formOf(member);
    const species = speciesOf(member);
    const stats = statsOf(member);
    const move = MOVES[species.basicAttack];
    const typeCol = TYPE_COLORS[form.type]?.hex || '#fff';
    const portraitUrl = `/generated/stadium/icons/${String(dexNumber(member.speciesId, member.stage)).padStart(3, '0')}.png`;
    const variant = member.variant ? VARIANTS[member.variant.kind] : null;
    const statBar = (label: string, value: number) => `
      <div class="rit-stat">
        <span class="rit-stat-label">${label}</span>
        <span class="rit-stat-track"><i style="width:${Math.min(100, (value / ROSTER_STAT_BAR_MAX) * 100)}%"></i></span>
        <span class="rit-stat-value">${value}</span>
      </div>`;
    this.rosterInfoTipEl.innerHTML = `
      <div class="rit-header">
        <img class="rit-portrait" src="${portraitUrl}" alt="" onerror="this.remove()">
        <span class="rit-name">${escapeHtml(displayName(member))}</span>
        <span class="rit-type" style="background:${typeCol}">${form.type.toUpperCase()}</span>
        ${variant ? `<span class="rit-variant" style="background:${variant.accentColor}">${variant.label}</span>` : ''}
        <span class="rit-level">LV ${member.level}</span>
      </div>
      <div class="rit-role">${escapeHtml(species.role)}</div>
      <div class="rit-stats">
        ${statBar('ATK', stats.attack)}
        ${statBar('SPD', stats.speed)}
        ${statBar('SPC', stats.special)}
      </div>
      ${move ? `
        <div class="rit-move">
          <span class="rit-move-name">${escapeHtml(move.name)}</span>
          <span class="rit-move-type" style="background:${TYPE_COLORS[move.type]?.hex || '#fff'}">${move.type.toUpperCase()}</span>
        </div>
        <div class="rit-move-desc">${escapeHtml(move.description)}</div>
      ` : ''}
    `;
    this.rosterInfoTipEl.hidden = false;
    const rect = button.getBoundingClientRect();
    const tipRect = this.rosterInfoTipEl.getBoundingClientRect();
    // The roster rail is docked to the right edge, so the card opens to its left.
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - tipRect.height - 8);
    this.rosterInfoTipEl.style.top = `${top}px`;
    this.rosterInfoTipEl.style.left = `${Math.max(8, rect.left - tipRect.width - 10)}px`;
  }

  private hideRosterInfo(): void {
    this.rosterInfoTipEl.hidden = true;
  }

  public setSignatureCuts(enabled: boolean): void {
    document.getElementById('btn-signature-cuts')!.textContent = `SIGNATURE CAMERA CUTS: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setSummonCinematics(enabled: boolean): void {
    document.getElementById('btn-summon-cinematics')!.textContent = `POKÉ BALL ENTRANCES: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setTypeEffectivenessInfo(enabled: boolean): void {
    this.showTypeEffectiveness = enabled;
    document.getElementById('btn-type-effectiveness')!.textContent = `TYPE EFFECTIVENESS INFO: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setCatchSlowMoMode(mode: CatchSlowMoMode): void {
    const label = mode === 'off' ? 'OFF' : mode === 'new' ? 'NEW ONLY' : 'ALWAYS';
    const button = document.getElementById('btn-catch-slowmo')!;
    button.textContent = `CATCH SLOW-MO: ${label}`;
    button.classList.toggle('active', mode !== 'off');
  }

  /** Flashes a price the moment the wallet's shown total climbs past it. */
  private noteAffordable(el: HTMLElement, cost: number, eligible = true): void {
    const now = eligible && this.prizeFx.displayed >= cost;
    const before = this.affordable.get(el);
    this.affordable.set(el, now);
    if (now && before === false && this.walletRose) {
      el.classList.remove('just-affordable');
      void el.offsetWidth;
      el.classList.add('just-affordable');
    }
  }

  /** Drops a floating combat-text callout (crit, immunity, type effectiveness,
   *  signature damage numbers) at a screen point. `size` (px) scales a
   *  signature hit's damage number to its value; omitted for everything else. */
  public spawnCombatText(x: number, y: number, text: string, color: string, size?: number): void {
    const el = document.createElement('span');
    el.className = 'combat-text';
    el.textContent = text;
    el.style.left = `${x / this.uiScale}px`;
    el.style.top = `${y / this.uiScale}px`;
    el.style.color = color;
    if (size) el.style.fontSize = `${size}px`;
    el.addEventListener('animationend', () => el.remove());
    this.combatTextLayerEl.appendChild(el);
  }

  public setAudioVolumes(music: number, sfx: number, announcer: number): void {
    for (const [id, outputId, value] of [
      ['pause-music-volume', 'pause-music-volume-value', music],
      ['pause-sfx-volume', 'pause-sfx-volume-value', sfx],
      ['pause-announcer-volume', 'pause-announcer-volume-value', announcer],
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
    document.getElementById('paused-banner')!.hidden = !state.paused;
    this.renderSignatureBar(state.signatures, !!state.captureCinema || !!state.evolutionCinema || !!state.summonCinema);
    ([['half',0.5],['1',1],['2',2],['3',3],['4',4]] as const).forEach(([key,speed]) => document.getElementById(`btn-speed-${key}`)!.classList.toggle('active',state.gameSpeed===speed));
    document.getElementById('btn-catch-slowmo')!.classList.toggle('expanded', state.gameSpeed > 1);
    ['tactical','stadium','action'].forEach(mode => document.getElementById(`btn-cam-${mode}`)!.classList.toggle('active',state.cameraMode===mode));

    // Top Bar updates
    // The final takes over the round badge: its stage and the round's own name.
    const inFinal = !!state.finalTitle && !state.freeplay;
    document.getElementById('cup-title')!.innerText = inFinal ? state.finalTitle!.toUpperCase() : state.mapName.toUpperCase();
    document.getElementById('round-number')!.innerText = state.freeplay
      ? `ROUND ${state.round} · FREEPLAY`
      : inFinal ? state.cupName : `ROUND ${state.round} / ${state.winRound}`;
    document.getElementById('round-badge')!.classList.toggle('in-final', inFinal);
    document.getElementById('mystery-badge')!.hidden = !state.isMystery;
    // The wallet's text belongs to prizeFx, which counts up as coins land.
    const walletShown = this.prizeFx.displayed;
    this.walletRose = walletShown > this.lastWalletShown;
    this.lastWalletShown = walletShown;

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
      this.noteAffordable(button, BALL_PRICES[type], !premiumLocked);
      // A locked ball can't be bought at any price right now, so the label drops the
      // dollar sign entirely rather than showing a price that looks buyable but isn't.
      const label = premiumLocked ? 'AFTER ROUND' : `$${BALL_PRICES[type]}`;
      if (button.textContent !== label) button.textContent = label;
      const title = premiumLocked ? 'Great & Ultra Balls restock between rounds'
        : !canAfford ? 'Not enough prize money'
        : `Buy one ${BALL_NAMES[type]} BALL`;
      if (button.title !== title) button.title = title;
      // Draw the eye back to the button the moment it unlocks, instead of
      // letting the restock pass unnoticed.
      if (this.wasBallLocked[type] && !premiumLocked) {
        button.classList.remove('unlock-flash');
        void button.offsetWidth;
        button.classList.add('unlock-flash');
      }
      this.wasBallLocked[type] = premiumLocked;
    });
    // Teach the between-rounds-only restriction once, before a player is
    // ever surprised by it, then let it go for good.
    if (state.inWave) {
      if (!this.premiumBallTipShown) {
        this.premiumBallTipEl.hidden = false;
        this.premiumBallTipShown = true;
        try { localStorage.setItem(PREMIUM_BALL_TIP_KEY, '1'); } catch { /* storage blocked */ }
      }
    } else if (!this.premiumBallTipEl.hidden) {
      this.premiumBallTipEl.hidden = true;
    }
    this.renderCatching(state);
    this.renderCaptureCinema(state.captureCinema);
    this.renderEvolutionCinema(state.evolutionCinema);
    this.renderSummonCinema(state.summonCinema);
    const captureHint = document.getElementById('capture-hint')!;
    captureHint.innerText = state.captureHint || '';

    // Wave button: only shown when starting a round is actually an option.
    const waveBtn = document.getElementById('btn-wave')!;
    waveBtn.style.display = state.inWave ? 'none' : '';
    if (!state.inWave) {
      const counting = state.intermissionTimer > 0;
      document.getElementById('wave-label')!.innerText = counting ? 'NEXT ROUND' : 'START ROUND';
      document.getElementById('wave-clock')!.hidden = !counting;
      if (counting) {
        const left = Math.min(1, state.intermissionTimer / INTERMISSION_SECONDS);
        document.getElementById('wave-clock-fill')!.style.strokeDashoffset = String(100 * (1 - left));
        document.getElementById('wave-clock-count')!.innerText = String(Math.ceil(state.intermissionTimer));
      }
    }

    // Card Deck affordability & selection highlight
    const placementHint = document.getElementById('placement-hint')!;
    if (state.placementStatus) {
      placementHint.innerText = state.placementStatus.label;
      placementHint.style.color = state.placementStatus.valid ? '#00f0ff' : '#ff6b6b';
    } else if (state.selectedMember) {
      placementHint.innerText = `SEND OUT ${displayName(state.selectedMember).toUpperCase()} · ESC TO CANCEL`;
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
      el.classList.toggle('disabled', deployed || state.money < deployCostOf(member));
      el.setAttribute('aria-disabled', String(deployed || state.money < deployCostOf(member)));
      this.noteAffordable(el, deployCostOf(member), !deployed);
      el.classList.toggle('selected', state.selectedMember?.uid === member.uid);
      const storageButton = el.querySelector<HTMLButtonElement>('[data-store-member]')!;
      storageButton.disabled = deployed;
      storageButton.title = deployed ? 'Recall the tower before sending this Pokémon to storage' : 'Send to storage';
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
