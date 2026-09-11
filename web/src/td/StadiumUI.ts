/**
 * StadiumUI.ts — Authentic Pokémon Stadium User Interface
 *
 * Implements:
 * - Iconic metallic tournament top bar (Cup, Round, Prize Money, Poké Balls)
 * - Tower deployment card deck at bottom
 * - Stadium Circular Radial Command Wheel for tower inspection/upgrades
 * - Dynamic Stadium Announcer popup banners
 * - Speed & camera controls
 */

import { Tower, TOWER_TEMPLATES, TowerTemplate } from './Tower';
import { TYPE_COLORS } from '../stadium/TypeMatrix';
import { StadiumAnnouncer } from '../stadium/Announcer';
import { StadiumCamera, CameraMode } from '../engine/StadiumCamera';

export interface UIState {
  money: number;
  lives: number;
  cupName: string;
  round: number;
  inWave: boolean;
  intermissionTimer: number;
  gameSpeed: number;
  cameraMode: CameraMode;
  selectedTower: Tower | null;
  selectedTemplate: TowerTemplate | null;
}

export class StadiumUI {
  private container: HTMLElement;
  private announcer: StadiumAnnouncer;
  private camera: StadiumCamera;

  // UI elements
  private topBarEl!: HTMLElement;
  private cardDeckEl!: HTMLElement;
  private radialMenuEl!: HTMLElement;
  private announcerBannerEl!: HTMLElement;
  private controlsEl!: HTMLElement;

  // Callbacks
  public onSelectTemplate: (template: TowerTemplate | null) => void = () => {};
  public onUpgradeTower: (tower: Tower) => void = () => {};
  public onSellTower: (tower: Tower) => void = () => {};
  public onChangeTargetPriority: (tower: Tower) => void = () => {};
  public onStartWave: () => void = () => {};
  public onChangeSpeed: (speed: number) => void = () => {};
  public onChangeCamera: (mode: CameraMode) => void = () => {};

  constructor(container: HTMLElement, announcer: StadiumAnnouncer, camera: StadiumCamera) {
    this.container = container;
    this.announcer = announcer;
    this.camera = camera;

    this.initDOM();
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

        .gold-glow {
          text-shadow: 0 0 10px #ffd700, 0 0 20px #ff9e00;
        }

        .cyan-glow {
          text-shadow: 0 0 8px #00f0ff;
        }

        /* Top Bar */
        #top-bar {
          position: absolute;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 8px 24px;
          z-index: 30;
        }

        .stat-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
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

        /* Poke Balls Remaining */
        .pokeball-tray {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .ui-pokeball {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: linear-gradient(180deg, #d90429 48%, #111 48%, #111 52%, #fff 52%);
          border: 1.5px solid #111;
          box-shadow: 0 2px 5px rgba(0,0,0,0.5);
          transition: transform 0.2s, opacity 0.2s;
        }

        .ui-pokeball.lost {
          opacity: 0.2;
          filter: grayscale(1);
          transform: scale(0.85);
        }

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

        /* Tower Card Deck (Bottom) */
        #card-deck {
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 12px;
          z-index: 30;
        }

        .tower-card {
          width: 96px;
          height: 120px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 8px 6px;
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s;
          position: relative;
        }

        .tower-card:hover {
          transform: translateY(-6px);
          border-color: #ffd700;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.8), 0 0 15px rgba(255, 215, 0, 0.3);
        }

        .tower-card.selected {
          border-color: #00f0ff;
          box-shadow: 0 0 20px rgba(0, 240, 255, 0.6);
          transform: translateY(-8px);
        }

        .tower-card.disabled {
          opacity: 0.4;
          filter: grayscale(0.7);
          cursor: not-allowed;
        }

        .card-type-tag {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 3px;
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8);
          letter-spacing: 0.5px;
        }

        .card-name {
          font-family: 'Impact', sans-serif;
          font-size: 15px;
          letter-spacing: 0.5px;
          color: #fff;
        }

        .card-cost {
          font-family: 'Rajdhani', sans-serif;
          font-size: 16px;
          font-weight: 800;
          color: #ffd700;
        }

        /* Announcer Banner */
        #announcer-banner {
          position: absolute;
          top: 68px;
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

        /* Radial Command Wheel (Appears over selected tower) */
        #radial-menu {
          position: absolute;
          width: 290px;
          height: 290px;
          transform: translate(-50%, -50%);
          pointer-events: auto;
          display: none;
          z-index: 35;
        }

        .radial-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 104px;
          height: 104px;
          border-radius: 50%;
          background: radial-gradient(circle, #1a365d 0%, #0a192f 100%);
          border: 3px solid #00f0ff;
          box-shadow: 0 0 20px rgba(0, 240, 255, 0.6);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 4px;
        }

        .radial-btn {
          position: absolute;
          width: 82px;
          height: 60px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px;
          font-size: 11px;
          font-weight: 700;
          text-align: center;
          cursor: pointer;
        }

        .radial-btn.top { top: -6px; left: 50%; transform: translateX(-50%); }
        .radial-btn.bottom { bottom: -6px; left: 50%; transform: translateX(-50%); }
        .radial-btn.left { left: -6px; top: 50%; transform: translateY(-50%); }
        .radial-btn.right { right: -6px; top: 50%; transform: translateY(-50%); }

        .radial-btn:hover {
          border-color: #ffd700;
          transform: scale(1.08);
        }
        .radial-btn.top:hover { transform: translateX(-50%) scale(1.08); }
        .radial-btn.bottom:hover { transform: translateX(-50%) scale(1.08); }
        .radial-btn.left:hover { transform: translateY(-50%) scale(1.08); }
        .radial-btn.right:hover { transform: translateY(-50%) scale(1.08); }
      </style>

      <!-- Top Bar -->
      <div id="top-bar" class="stadium-panel interactive">
        <div class="stat-badge">
          <span class="stat-label" id="cup-title">POKE CUP</span>
          <span class="stat-value gold-glow" id="round-number">ROUND 1</span>
        </div>
        <div class="stat-badge">
          <span class="stat-label">PRIZE MONEY</span>
          <span class="stat-value" style="color: #48ff48;" id="prize-money">$400</span>
        </div>
        <div class="stat-badge">
          <span class="stat-label">POKÉ BALLS</span>
          <div class="pokeball-tray" id="pokeball-tray"></div>
        </div>
        <button class="stadium-btn active" id="btn-wave">START MATCH</button>
      </div>

      <!-- Controls -->
      <div id="controls-bar" class="interactive">
        <button class="stadium-btn active" id="btn-speed-1">1X</button>
        <button class="stadium-btn" id="btn-speed-2">2X</button>
        <button class="stadium-btn" id="btn-speed-3">3X</button>
        <button class="stadium-btn active" id="btn-cam-tactical">TACTICAL</button>
        <button class="stadium-btn" id="btn-cam-stadium">STADIUM</button>
        <button class="stadium-btn" id="btn-cam-action">ACTION</button>
      </div>

      <!-- Announcer Banner -->
      <div id="announcer-banner">
        <div class="banner-inner" id="announcer-text">WHAT A BATTLE!</div>
      </div>

      <!-- Tower Card Deck -->
      <div id="card-deck" class="interactive"></div>

      <!-- Radial Command Wheel -->
      <div id="radial-menu" class="interactive">
        <div class="radial-center" id="radial-center-content">
          <span style="font-family: Impact; font-size: 16px; color: #fff;" id="rad-name">PIKACHU</span>
          <span style="font-size: 11px; color: #ffd700;" id="rad-lvl">LV. 1</span>
        </div>
        <button class="stadium-panel radial-btn top" id="rad-upgrade">
          <span style="color: #ffd700;">UPGRADE</span>
          <span style="font-size: 10px;" id="rad-up-cost">$120</span>
        </button>
        <button class="stadium-panel radial-btn right" id="rad-evolve">
          <span style="color: #00f0ff;">EVOLVE</span>
          <span style="font-size: 10px;" id="rad-ev-cost">$220</span>
        </button>
        <button class="stadium-panel radial-btn bottom" id="rad-target">
          <span style="color: #fff;">TARGET</span>
          <span style="font-size: 10px; color: #8faecf;" id="rad-target-mode">FIRST</span>
        </button>
        <button class="stadium-panel radial-btn left" id="rad-sell">
          <span style="color: #ff3333;">SELL</span>
          <span style="font-size: 10px;" id="rad-sell-val">+$70</span>
        </button>
      </div>
    `;

    this.topBarEl = document.getElementById('top-bar')!;
    this.cardDeckEl = document.getElementById('card-deck')!;
    this.radialMenuEl = document.getElementById('radial-menu')!;
    this.announcerBannerEl = document.getElementById('announcer-banner')!;
    this.controlsEl = document.getElementById('controls-bar')!;

    this.bindEvents();
    this.renderCardDeck();
  }

  private renderCardDeck(): void {
    const templates = Object.values(TOWER_TEMPLATES);
    this.cardDeckEl.innerHTML = '';

    templates.forEach(tmpl => {
      const card = document.createElement('div');
      card.className = 'stadium-panel tower-card';
      card.id = `card-${tmpl.id}`;

      const typeCol = TYPE_COLORS[tmpl.type]?.hex || '#fff';

      card.innerHTML = `
        <span class="card-type-tag" style="background-color: ${typeCol};">${tmpl.type.toUpperCase()}</span>
        <span class="card-name">${tmpl.name}</span>
        <span class="card-cost">$${tmpl.cost}</span>
      `;

      card.addEventListener('click', () => {
        this.onSelectTemplate(tmpl);
      });

      this.cardDeckEl.appendChild(card);
    });
  }

  private bindEvents(): void {
    // Wave start button
    document.getElementById('btn-wave')!.addEventListener('click', () => {
      this.onStartWave();
    });

    // Speed buttons
    const speeds = [
      { id: 'btn-speed-1', spd: 1 },
      { id: 'btn-speed-2', spd: 2 },
      { id: 'btn-speed-3', spd: 3 },
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

    // Radial Menu Actions
    document.getElementById('rad-upgrade')!.addEventListener('click', () => {
      if (this.currentSelectedTower) {
        this.onUpgradeTower(this.currentSelectedTower);
      }
    });

    document.getElementById('rad-evolve')!.addEventListener('click', () => {
      if (this.currentSelectedTower) {
        this.onUpgradeTower(this.currentSelectedTower);
      }
    });

    document.getElementById('rad-target')!.addEventListener('click', () => {
      if (this.currentSelectedTower) {
        this.onChangeTargetPriority(this.currentSelectedTower);
      }
    });

    document.getElementById('rad-sell')!.addEventListener('click', () => {
      if (this.currentSelectedTower) {
        this.onSellTower(this.currentSelectedTower);
      }
    });
  }

  private currentSelectedTower: Tower | null = null;

  public update(state: UIState, screenPos?: { x: number; y: number; visible: boolean }): void {
    this.currentSelectedTower = state.selectedTower;

    // Top Bar updates
    document.getElementById('cup-title')!.innerText = state.cupName;
    document.getElementById('round-number')!.innerText = `ROUND ${state.round}`;
    document.getElementById('prize-money')!.innerText = `$${state.money}`;

    // Poké Balls
    const tray = document.getElementById('pokeball-tray')!;
    tray.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const ball = document.createElement('div');
      ball.className = `ui-pokeball ${i >= state.lives ? 'lost' : ''}`;
      tray.appendChild(ball);
    }

    // Wave button label
    const waveBtn = document.getElementById('btn-wave')!;
    if (state.inWave) {
      waveBtn.innerText = 'MATCH IN PROGRESS';
      waveBtn.classList.remove('active');
      waveBtn.style.pointerEvents = 'none';
      waveBtn.style.opacity = '0.7';
    } else {
      waveBtn.innerText = `NEXT MATCH (${Math.ceil(state.intermissionTimer)}S)`;
      waveBtn.classList.add('active');
      waveBtn.style.pointerEvents = 'auto';
      waveBtn.style.opacity = '1.0';
    }

    // Card Deck affordability & selection highlight
    const templates = Object.values(TOWER_TEMPLATES);
    templates.forEach(tmpl => {
      const el = document.getElementById(`card-${tmpl.id}`);
      if (el) {
        if (state.money < tmpl.cost) {
          el.classList.add('disabled');
        } else {
          el.classList.remove('disabled');
        }
        if (state.selectedTemplate && state.selectedTemplate.id === tmpl.id) {
          el.classList.add('selected');
        } else {
          el.classList.remove('selected');
        }
      }
    });

    // Radial Menu Positioning & Content
    if (state.selectedTower && screenPos && screenPos.visible) {
      this.radialMenuEl.style.display = 'block';
      this.radialMenuEl.style.left = `${screenPos.x}px`;
      this.radialMenuEl.style.top = `${screenPos.y}px`;

      const t = state.selectedTower;
      document.getElementById('rad-name')!.innerText = t.name;
      document.getElementById('rad-lvl')!.innerText = `LV. ${t.level} (${t.currentMove.name})`;
      document.getElementById('rad-target-mode')!.innerText = t.targetPriority.toUpperCase();

      // Upgrade / Evolve costs
      const upBtn = document.getElementById('rad-upgrade')!;
      const evBtn = document.getElementById('rad-evolve')!;
      const sellVal = document.getElementById('rad-sell-val')!;

      sellVal.innerText = `+$${t.getSellValue()}`;

      if (t.level === 1) {
        upBtn.style.display = 'flex';
        evBtn.style.display = 'none';
        document.getElementById('rad-up-cost')!.innerText = `$${t.template.upgradeCost}`;
      } else if (t.level === 2) {
        upBtn.style.display = 'none';
        evBtn.style.display = 'flex';
        document.getElementById('rad-ev-cost')!.innerText = `$${t.template.evolveCost}`;
      } else {
        upBtn.style.display = 'none';
        evBtn.style.display = 'none';
      }
    } else {
      this.radialMenuEl.style.display = 'none';
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
