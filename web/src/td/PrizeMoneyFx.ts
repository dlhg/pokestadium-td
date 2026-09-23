/**
 * PrizeMoneyFx.ts — Making Prize Money Feel Earned
 *
 * Every payout is a short trip from where it was earned to where it is spent:
 * a world-anchored "+$22" rises off the knockout, a few coins burst from the
 * same spot and arc into the wallet, and the wallet counts up only as each
 * coin lands, with a coin chime that climbs in pitch through a fast streak.
 *
 * The match's `money` is always exact and spendable the instant it is earned;
 * this only delays what the counter *shows*. The wallet reads `money - pending`,
 * where pending is whatever is still queued or in flight, so a purchase drops
 * the counter immediately and the count-up never runs ahead of the coins.
 *
 * Late rounds knock out a dozen creeps a second, so restraint is built in:
 * payouts that land near a popup still rising merge into it, popups are capped,
 * and coin bursts leave the queue at a fixed cadence, merging when it backs up.
 */

import * as THREE from 'three';

export type PrizeSource = 'knockout' | 'bounty' | 'capture' | 'newSpecies' | 'payDay' | 'milestone';

type ScreenPoint = { x: number; y: number };
/** World point to renderer (window) pixels; the fx divides out the UI scale. */
export type PrizeProjector = (world: THREE.Vector3) => ScreenPoint & { visible: boolean };

export interface PrizeEarning {
  amount: number;
  source: PrizeSource;
  /** Where the money came from in the world, or a fixed point on screen (layer pixels). */
  at: THREE.Vector3 | ScreenPoint;
  /** A stop on the way to the wallet (a bounty's tower), and what happens when the coin gets there. */
  via?: { at: THREE.Vector3; onArrive?: () => void };
  /** Pay multiplier in force, shown beside the amount when it's above 1. */
  multiplier?: number;
  /** Replaces the default callout wording ("PAY DAY!", "NEW SPECIES"). */
  label?: string;
  /** Seconds before anything appears, to stage one payout after another. */
  delay?: number;
}

interface Popup {
  el: HTMLElement;
  amountEl: HTMLElement;
  source: PrizeSource;
  anchor: THREE.Vector3 | ScreenPoint;
  /** The anchor's last projected position, before the rise. */
  screen: ScreenPoint;
  amount: number;
  age: number;
  life: number;
  drift: number;
  bump: number;
}

interface Burst {
  amount: number;
  coins: number;
  from: ScreenPoint;
  via?: { at: THREE.Vector3; onArrive?: () => void };
  /** Credited so far; the last coin to land takes the remainder. */
  credited: number;
  landed: number;
  arrived: boolean;
}

interface Coin {
  el: HTMLElement;
  burst: Burst;
  share: number;
  phase: 'scatter' | 'via' | 'home';
  t: number;
  pos: ScreenPoint;
  vel: ScreenPoint;
  legFrom: ScreenPoint;
  legDuration: number;
  spin: number;
}

const POPUP_LIFE = 1.15;
const POPUP_RISE = 52;
const MAX_POPUPS = 8;
/** A payout this close (px) to a popup younger than this merges into it. */
const MERGE_RADIUS = 46;
const MERGE_AGE = 0.4;
const BURST_INTERVAL = 0.08;
const MAX_COINS_IN_FLIGHT = 48;
/** Coin landings closer together than this keep the chime climbing. */
const STREAK_WINDOW = 0.5;
const MAX_STREAK_STEP = 12;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class PrizeMoneyFx {
  /** Called as each coin lands with the streak step (0 = fresh), for the chime. */
  public onCoinLand: ((step: number) => void) | null = null;

  private popups: Popup[] = [];
  private coins: Coin[] = [];
  private queue: Burst[] = [];
  private delayed: { earning: PrizeEarning; timer: number }[] = [];
  private burstTimer = 0;
  private shown: number | null = null;
  private lastShownText = '';
  private streak = 0;
  private sinceLanding = Infinity;
  private walletTag: { el: HTMLElement; amount: number; age: number } | null = null;
  private readonly reducedMotion: boolean;

  constructor(
    private layer: HTMLElement,
    private wallet: HTMLElement,
    private uiScale: () => number,
  ) {
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** What the wallet shows right now, which trails the real total while coins are in the air. */
  public get displayed(): number { return this.shown ?? 0; }

  /** Money earned but not yet landed in the wallet. */
  public get pending(): number {
    const queued = this.queue.reduce((sum, burst) => sum + burst.amount, 0);
    const delayed = this.delayed.reduce((sum, d) => sum + d.earning.amount, 0);
    const flying = new Set(this.coins.map(coin => coin.burst));
    let inAir = 0;
    flying.forEach(burst => { inAir += burst.amount - burst.credited; });
    return queued + delayed + inAir;
  }

  public earn(earning: PrizeEarning, project: PrizeProjector): void {
    if (earning.amount <= 0) return;
    if (earning.delay && earning.delay > 0) {
      this.delayed.push({ earning: { ...earning, delay: 0 }, timer: earning.delay });
      return;
    }
    const from = this.screenOf(earning.at, project);
    if (earning.source !== 'milestone') this.spawnPopup(earning, from);
    if (this.reducedMotion) {
      // No flight to watch: the wallet takes it at once, with one chime.
      this.onCoinLand?.(0);
      this.pulseWallet(earning.amount);
      earning.via?.onArrive?.();
      return;
    }
    const burst: Burst = {
      amount: earning.amount,
      coins: coinCount(earning.amount, earning.source),
      from,
      via: earning.via,
      credited: 0,
      landed: 0,
      arrived: false,
    };
    // A backed-up queue folds plain payouts together instead of growing.
    const tail = this.queue[this.queue.length - 1];
    if (this.queue.length >= 6 && tail && !tail.via && !burst.via) {
      tail.amount += burst.amount;
      tail.coins = Math.min(8, tail.coins + 1);
      return;
    }
    this.queue.push(burst);
  }

  /** Drops everything in flight; the wallet snaps to the real total. */
  public reset(): void {
    this.popups.forEach(p => p.el.remove());
    this.coins.forEach(c => c.el.remove());
    this.walletTag?.el.remove();
    this.popups = [];
    this.coins = [];
    this.queue = [];
    this.delayed = [];
    this.walletTag = null;
    this.shown = null;
    this.streak = 0;
  }

  public update(realDt: number, money: number, project: PrizeProjector): void {
    const dt = Math.min(realDt, 0.1);

    for (const d of this.delayed) d.timer -= dt;
    const due = this.delayed.filter(d => d.timer <= 0);
    this.delayed = this.delayed.filter(d => d.timer > 0);
    due.forEach(d => this.earn(d.earning, project));

    this.releaseBursts(dt);
    this.updateCoins(dt, project);
    this.updatePopups(dt, project);
    this.updateWallet(dt, money);
  }

  // ---- Popups ---------------------------------------------------------------

  private spawnPopup(earning: PrizeEarning, from: ScreenPoint): void {
    const source = earning.source;
    // A bounty's callout appears at the tower when the coin reaches it, not here.
    if (earning.via) return;
    if (this.mergeInto(source, from, earning.amount)) return;

    if (this.popups.length >= MAX_POPUPS && (source === 'knockout' || source === 'bounty')) {
      const youngest = this.popups.reduce((a, b) => (a.age < b.age ? a : b));
      this.addTo(youngest, earning.amount);
      return;
    }

    const el = document.createElement('div');
    el.className = `prize-pop prize-${source} ${sizeClass(earning.amount, source)}`;
    const label = earning.label ?? (source === 'payDay' ? 'PAY DAY!' : source === 'newSpecies' ? 'NEW SPECIES' : '');
    if (label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'prize-label';
      labelEl.textContent = label;
      el.appendChild(labelEl);
    }
    const amountEl = document.createElement('span');
    amountEl.className = 'prize-amount';
    amountEl.textContent = `+$${earning.amount}`;
    el.appendChild(amountEl);
    if (earning.multiplier && earning.multiplier > 1) {
      const multEl = document.createElement('span');
      multEl.className = 'prize-mult';
      multEl.textContent = `×${earning.multiplier}`;
      el.appendChild(multEl);
    }
    this.layer.appendChild(el);
    const big = source === 'payDay' || source === 'newSpecies' || earning.amount >= 150;
    this.popups.push({
      el, amountEl, source,
      anchor: earning.at instanceof THREE.Vector3 ? earning.at.clone() : { ...from },
      screen: { ...from },
      amount: earning.amount,
      age: 0,
      life: big ? POPUP_LIFE + 0.5 : POPUP_LIFE,
      drift: (Math.random() - 0.5) * 18,
      bump: 0,
    });
  }

  private mergeInto(source: PrizeSource, at: ScreenPoint, amount: number): boolean {
    if (source !== 'knockout' && source !== 'bounty') return false;
    for (const popup of this.popups) {
      if (popup.source !== source || popup.age > MERGE_AGE) continue;
      const dx = popup.screen.x - at.x;
      const dy = popup.screen.y - at.y;
      if (dx * dx + dy * dy > MERGE_RADIUS * MERGE_RADIUS) continue;
      this.addTo(popup, amount);
      return true;
    }
    return false;
  }

  private addTo(popup: Popup, amount: number): void {
    popup.amount += amount;
    popup.amountEl.textContent = `+$${popup.amount}`;
    popup.bump = 1;
    popup.age = Math.min(popup.age, 0.15);
    const size = sizeClass(popup.amount, popup.source);
    popup.el.classList.remove('prize-sm', 'prize-md', 'prize-lg');
    popup.el.classList.add(size);
  }

  private updatePopups(dt: number, project: PrizeProjector): void {
    this.popups = this.popups.filter(popup => {
      popup.age += dt;
      if (popup.age >= popup.life) { popup.el.remove(); return false; }
      const base = this.screenOf(popup.anchor, project);
      const visible = !(popup.anchor instanceof THREE.Vector3) || project(popup.anchor).visible;
      const rise = this.reducedMotion ? 0 : POPUP_RISE * easeOutCubic(Math.min(1, popup.age / (popup.life * 0.8)));
      const x = base.x + popup.drift * Math.min(1, popup.age / popup.life);
      const y = base.y - rise;
      // Pops in oversized and settles, with a bump each time a payout merges in.
      const pop = popup.age < 0.12 ? 1.3 - 0.3 * (popup.age / 0.12) : 1;
      popup.bump = Math.max(0, popup.bump - dt * 6);
      const scale = pop + popup.bump * 0.25;
      const fadeStart = popup.life * 0.62;
      const opacity = popup.age < 0.06 ? popup.age / 0.06
        : popup.age > fadeStart ? 1 - (popup.age - fadeStart) / (popup.life - fadeStart) : 1;
      popup.screen = base;
      popup.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      popup.el.style.opacity = visible ? opacity.toFixed(3) : '0';
      return true;
    });
  }

  // ---- Coins ----------------------------------------------------------------

  private releaseBursts(dt: number): void {
    this.burstTimer -= dt;
    while (this.burstTimer <= 0 && this.queue.length && this.coins.length < MAX_COINS_IN_FLIGHT) {
      this.launch(this.queue.shift()!);
      this.burstTimer += BURST_INTERVAL;
    }
    if (this.burstTimer < 0) this.burstTimer = 0;
  }

  private launch(burst: Burst): void {
    const share = Math.floor(burst.amount / burst.coins);
    for (let i = 0; i < burst.coins; i++) {
      const el = document.createElement('div');
      el.className = 'prize-coin';
      this.layer.appendChild(el);
      // Scatter up and out, fanned across the burst so coins don't overlap.
      const angle = -Math.PI / 2 + (burst.coins === 1 ? 0 : (i / (burst.coins - 1) - 0.5) * 2.2) + (Math.random() - 0.5) * 0.4;
      const speed = 150 + Math.random() * 110;
      this.coins.push({
        el, burst, share,
        phase: 'scatter',
        t: -i * 0.025,
        pos: { ...burst.from },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        legFrom: { ...burst.from },
        legDuration: 0,
        spin: Math.random() * Math.PI,
      });
    }
  }

  private updateCoins(dt: number, project: PrizeProjector): void {
    const wallet = this.walletPoint();
    this.coins = this.coins.filter(coin => {
      coin.t += dt;
      coin.spin += dt * 16;
      if (coin.t < 0) { coin.el.style.opacity = '0'; return true; }

      if (coin.phase === 'scatter') {
        coin.pos.x += coin.vel.x * dt;
        coin.pos.y += coin.vel.y * dt;
        coin.vel.x *= Math.pow(0.02, dt);
        coin.vel.y = coin.vel.y * Math.pow(0.02, dt) + 380 * dt;
        if (coin.t >= 0.2) this.nextLeg(coin, coin.burst.via && !coin.burst.arrived ? 'via' : 'home');
      } else {
        const target = coin.phase === 'via' ? this.screenOf(coin.burst.via!.at, project) : wallet;
        const k = Math.min(1, coin.t / coin.legDuration);
        // Ease in, so the coin accelerates into its destination, along an arc.
        const e = k * k;
        const lift = coin.phase === 'home' ? 90 : 50;
        const cx = (coin.legFrom.x + target.x) / 2;
        const cy = Math.min(coin.legFrom.y, target.y) - lift;
        coin.pos.x = (1 - e) * (1 - e) * coin.legFrom.x + 2 * (1 - e) * e * cx + e * e * target.x;
        coin.pos.y = (1 - e) * (1 - e) * coin.legFrom.y + 2 * (1 - e) * e * cy + e * e * target.y;
        if (k >= 1) {
          if (coin.phase === 'via') {
            if (!coin.burst.arrived) {
              coin.burst.arrived = true;
              coin.burst.via!.onArrive?.();
              this.spawnPopup({ amount: coin.burst.amount, source: 'bounty', at: coin.burst.via!.at }, target);
            }
            this.nextLeg(coin, 'home');
          } else {
            this.land(coin);
            coin.el.remove();
            return false;
          }
        }
      }

      const flip = Math.max(0.2, Math.abs(Math.cos(coin.spin)));
      const shrink = coin.phase === 'home' ? 1 - 0.35 * Math.min(1, coin.t / coin.legDuration) : 1;
      coin.el.style.opacity = '1';
      coin.el.style.transform = `translate(${coin.pos.x}px, ${coin.pos.y}px) translate(-50%, -50%) scale(${(flip * shrink).toFixed(3)}, ${shrink.toFixed(3)})`;
      return true;
    });
  }

  private nextLeg(coin: Coin, phase: 'via' | 'home'): void {
    coin.phase = phase;
    coin.t = 0;
    coin.legFrom = { ...coin.pos };
    coin.legDuration = phase === 'via' ? 0.32 + Math.random() * 0.08 : 0.45 + Math.random() * 0.15;
  }

  private land(coin: Coin): void {
    const burst = coin.burst;
    burst.landed++;
    const credit = burst.landed === burst.coins ? burst.amount - burst.credited : coin.share;
    burst.credited += credit;

    this.streak = this.sinceLanding < STREAK_WINDOW ? Math.min(MAX_STREAK_STEP, this.streak + 1) : 0;
    this.sinceLanding = 0;
    this.onCoinLand?.(this.streak);
    this.pulseWallet(credit);
  }

  // ---- Wallet ---------------------------------------------------------------

  private pulseWallet(amount: number): void {
    const badge = this.wallet.closest<HTMLElement>('.stat-badge') ?? this.wallet;
    badge.classList.remove('wallet-hit');
    void badge.offsetWidth;
    badge.classList.add('wallet-hit');

    // One running "+N" beside the wallet while landings keep coming.
    if (this.walletTag && this.walletTag.age < 0.6) {
      this.walletTag.amount += amount;
      this.walletTag.age = 0;
    } else {
      this.walletTag?.el.remove();
      const el = document.createElement('span');
      el.className = 'wallet-tag';
      badge.appendChild(el);
      this.walletTag = { el, amount, age: 0 };
    }
    this.walletTag.el.textContent = `+${this.walletTag.amount}`;
    this.walletTag.el.classList.remove('bump');
    void this.walletTag.el.offsetWidth;
    this.walletTag.el.classList.add('bump');
  }

  private updateWallet(dt: number, money: number): void {
    this.sinceLanding += dt;
    const target = money - this.pending;
    if (this.shown === null || target < this.shown) {
      // Spending, and the first frame of a match, show the real total at once.
      this.shown = target;
    } else if (target > this.shown) {
      const step = Math.max(1, Math.ceil((target - this.shown) * Math.min(1, dt * 12)));
      this.shown = Math.min(target, this.shown + step);
    }
    const text = `$${this.shown}`;
    if (text !== this.lastShownText) {
      this.wallet.textContent = text;
      this.lastShownText = text;
    }

    if (this.walletTag) {
      this.walletTag.age += dt;
      if (this.walletTag.age > 1.1) {
        this.walletTag.el.remove();
        this.walletTag = null;
      }
    }
  }

  // ---- Space ----------------------------------------------------------------

  private walletPoint(): ScreenPoint {
    const rect = this.wallet.getBoundingClientRect();
    const scale = this.uiScale();
    return { x: (rect.left + rect.width / 2) / scale, y: (rect.top + rect.height / 2) / scale };
  }

  private screenOf(at: THREE.Vector3 | ScreenPoint, project: PrizeProjector): ScreenPoint {
    if (!(at instanceof THREE.Vector3)) return at;
    const { x, y } = project(at);
    const scale = this.uiScale();
    return { x: x / scale, y: y / scale };
  }
}

function coinCount(amount: number, source: PrizeSource): number {
  if (source === 'milestone') return 12;
  if (source === 'payDay') return 10;
  if (source === 'newSpecies') return 6;
  if (source === 'bounty') return 1;
  return amount < 40 ? 1 : amount < 100 ? 2 : amount < 200 ? 3 : 5;
}

function sizeClass(amount: number, source: PrizeSource): string {
  if (source === 'payDay' || source === 'newSpecies' || amount >= 150) return 'prize-lg';
  if (source === 'bounty' || amount < 50) return 'prize-sm';
  return 'prize-md';
}
