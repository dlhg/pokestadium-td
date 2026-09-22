/**
 * TrainerScreens.ts — Starter Select, Team Select, Summary, Match Report
 *
 * The between-matches half of the game. Every screen reads straight from the
 * TrainerStore and re-renders when it commits, so the dev panel and in-match
 * catches show up without any extra wiring.
 */

import { RosterModelView } from '../RosterModelView';
import type { StadiumMap } from '../MapCatalog';
import { openingThreatTypes } from '../WaveManager';
import { CUPS, isEligible, nearOutgrowing, type CupRules } from '../Cups';
import { MOVES } from '../../stadium/MoveDatabase';
import { getCombinedEffectiveness, PokemonType, TYPE_COLORS } from '../../stadium/TypeMatrix';
import { dexNumber, GIFT_ID, getSpecies, reachableMoveIds, STARTER_IDS } from './Species';
import { levelProgress, MAX_DV, MAX_LEVEL, STAT_KEYS, xpForLevel } from './Stats';
import {
  displayName, formOf, NICKNAME_MAX, OwnedPokemon, researchPointsFor, speciesOf, statsOf, STORAGE_MAX,
  TEAM_SIZE, TrainerStore,
} from './TrainerStore';
import type { MatchReportEntry } from './MatchProgress';
import { createRental, RENTALS, rentalLevel } from './Rentals';
import './trainer.css';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function typeChip(type: PokemonType): string {
  const color = TYPE_COLORS[type]?.hex ?? '#888';
  return `<span class="tr-type" style="background:${color}">${type.toUpperCase()}</span>`;
}

function typeArtStyle(type: PokemonType): string {
  const art = `/ui/types/${type.toLowerCase()}.jpg`;
  return `background-image: linear-gradient(rgba(4,17,63,.35), rgba(4,17,63,.88)), url('${art}'); background-size: cover; background-position: center;`;
}

function typeChips(pokemon: OwnedPokemon): string {
  const form = formOf(pokemon);
  return [form.type, form.secondaryType].filter((t): t is PokemonType => !!t).map(typeChip).join('');
}

function xpBar(pokemon: OwnedPokemon): string {
  return `<span class="tr-xp"><i style="width:${levelProgress(pokemon.xp, pokemon.level) * 100}%"></i></span>`;
}

/** Extracted Stadium party icon for the Pokemon's current evolutionary form. */
function pokemonIcon(pokemon: OwnedPokemon): string {
  const number = String(dexNumber(pokemon.speciesId, pokemon.stage)).padStart(3, '0');
  return `<img class="tr-card-icon" src="/generated/stadium/icons/${number}.png" alt="" onerror="this.remove()">`;
}

/** Threat types this Pokémon hits super-effectively with moves it can already buy. */
function strongAgainst(pokemon: OwnedPokemon, threats: PokemonType[]): PokemonType[] {
  const moveTypes = new Set(reachableMoveIds(speciesOf(pokemon), pokemon.level).map(id => MOVES[id].type));
  return threats.filter(threat => [...moveTypes].some(type => getCombinedEffectiveness(type, [threat]) >= 2));
}

/** Set in `unlocks` once the player has been told new catches go to the bench. */
const BENCH_INTRO_UNLOCK = 'bench-intro';
/** localStorage flag: the trainer has been told rentals cover cups nothing they own can enter. */
const RENTAL_INTRO_KEY = 'pokestadium.rentalIntroSeen';
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ }
}

/** When the gift's Poké Ball pops open; matches the tr-gift-ball animation in trainer.css. */
const GIFT_POP_MS = 700;

/** Below this many benched Pokémon the search, sort and filter toolbar stays hidden. */
const BENCH_TOOLS_MIN = 8;

type BenchSort = 'level' | 'recent' | 'name' | 'dex' | 'matchup';

interface BenchFilter {
  query: string;
  sort: BenchSort;
  types: Set<PokemonType>;
  strongOnly: boolean;
}

type StrongLookup = (pokemon: OwnedPokemon) => PokemonType[];
type BenchCompare = (a: OwnedPokemon, b: OwnedPokemon) => number;

const byName: BenchCompare = (a, b) => displayName(a).localeCompare(displayName(b));
const byLevel: BenchCompare = (a, b) => b.level - a.level || byName(a, b);

const BENCH_SORTS: Record<BenchSort, { label: string; compare: (strong: StrongLookup) => BenchCompare }> = {
  level: { label: 'LEVEL', compare: () => byLevel },
  recent: { label: 'RECENTLY CAUGHT', compare: () => (a, b) => b.origin.at - a.origin.at || byLevel(a, b) },
  name: { label: 'NAME', compare: () => (a, b) => byName(a, b) || b.level - a.level },
  dex: { label: 'POKÉDEX NO.', compare: () => (a, b) => dexNumber(a.speciesId, a.stage) - dexNumber(b.speciesId, b.stage) || byLevel(a, b) },
  matchup: { label: 'BEST VS THIS COURSE', compare: strong => (a, b) => strong(b).length - strong(a).length || byLevel(a, b) },
};

/** The cup's verdict on a card: over the entry limit, or close enough that this may be its last run. */
function cupTag(pokemon: OwnedPokemon, cup: CupRules | null): string {
  if (!cup) return '';
  if (!isEligible(pokemon.level, cup)) {
    return `<span class="tr-cup-tag out" title="Over ${cup.name}'s LV ${cup.entryMax} entry limit, so it sits this match out">OVER LV ${cup.entryMax} LIMIT</span>`;
  }
  return nearOutgrowing(pokemon.level, cup)
    ? `<span class="tr-cup-tag last" title="Passing LV ${cup.entryMax} graduates it from ${cup.name}. This may be its last run here.">NEAR LV ${cup.entryMax} LIMIT</span>`
    : '';
}

/** `researchPoints` is what releasing this one pays, or null when it cannot be released. */
function benchTileHtml(pokemon: OwnedPokemon, strong: PokemonType[], cup: CupRules | null, researchPoints: number | null): string {
  const form = formOf(pokemon);
  const eligible = !cup || isEligible(pokemon.level, cup);
  const release = researchPoints === null
    ? '<button class="tr-release stadium-btn" disabled title="Your last Pokémon stays with you">RELEASE</button>'
    : `<button class="tr-release stadium-btn" data-release="${pokemon.uid}" title="Send to the Professor for +${researchPoints} research data. This cannot be undone.">RELEASE · +${researchPoints} DATA</button>`;
  return `<div class="tr-card ${eligible ? '' : 'ineligible'}" draggable="${eligible}" ${eligible ? `data-drag-uid="${pokemon.uid}"` : ''}>
    <button class="tr-card-main" data-toggle="${pokemon.uid}" ${eligible ? 'title="Add to team · drag onto a slot to swap"' : `disabled title="Over ${cup!.name}'s LV ${cup!.entryMax} entry limit"`} style="${typeArtStyle(form.type)}">
      ${pokemonIcon(pokemon)}
      <span class="tr-card-copy">
        <span class="tr-card-name">${escapeHtml(displayName(pokemon).toUpperCase())}${pokemon.nickname ? `<small>${form.name.toUpperCase()}</small>` : ''}</span>
        <span class="tr-card-meta">LV ${pokemon.level}</span>
        ${cupTag(pokemon, cup)}
        <span class="tr-card-types">${typeChips(pokemon)}</span>
        ${strong.length ? `<span class="tr-matchup" title="Strong vs ${strong.join(', ')}">STRONG VS ${strong.slice(0, 3).join(' · ').toUpperCase()}</span>` : ''}
      </span>
    </button>
    <button class="tr-info stadium-btn" data-info="${pokemon.uid}" title="Summary">INFO</button>
    ${release}
  </div>`;
}

/** A loaner on offer: no summary or drag, a click puts it in the next open place. The RENTALS tab already names it, so no ribbon. */
function rentalTileHtml(pokemon: OwnedPokemon, strong: PokemonType[]): string {
  const form = formOf(pokemon);
  return `<div class="tr-card rental">
    <button class="tr-card-main" data-rent="${pokemon.speciesId}" title="Rent for this match" style="${typeArtStyle(form.type)}">
      ${pokemonIcon(pokemon)}
      <span class="tr-card-copy">
        <span class="tr-card-name">${escapeHtml(form.name.toUpperCase())}</span>
        <span class="tr-card-meta">LV ${pokemon.level}</span>
        <span class="tr-card-types">${typeChips(pokemon)}</span>
        ${strong.length ? `<span class="tr-matchup" title="Strong vs ${strong.join(', ')}">STRONG VS ${strong.slice(0, 3).join(' · ').toUpperCase()}</span>` : ''}
      </span>
    </button>
  </div>`;
}

/** Rentals picked in team select: which species, and whether the bench is showing them. */
interface RentalDesk {
  picks: string[];
  showing: boolean;
  add(speciesId: string): void;
  remove(speciesId: string): void;
  fill(): void;
}

/** Shared by the quit report and the defeat card. */
export function reportListHtml(report: MatchReportEntry[]): string {
  if (!report.length) return '';
  const rows = report.map(entry => {
    const { pokemon } = entry;
    const form = formOf(pokemon).name;
    const tags = [
      entry.rental ? '<em class="tr-tag rental">RENTAL · RETURNED</em>' : '',
      entry.caughtThisMatch ? '<em class="tr-tag new">NEW CATCH</em>' : '',
      form !== entry.formFrom ? `<em class="tr-tag evo">EVOLVED INTO ${form.toUpperCase()}</em>` : '',
      pokemon.level > entry.levelFrom ? `<em class="tr-tag up">LV ${entry.levelFrom} → ${pokemon.level}</em>` : '',
      entry.graduatedFrom ? `<em class="tr-tag grad" title="Now over its entry limit">GRADUATED FROM ${entry.graduatedFrom}</em>` : '',
    ].join('');
    return `<li class="tr-report-row">
      <span class="tr-report-name">${escapeHtml(displayName(pokemon).toUpperCase())}<small>LV ${pokemon.level}</small></span>
      <span class="tr-report-xp">+${entry.xpGained} XP${entry.knockouts ? ` · ${entry.knockouts} KO` : ''}</span>
      <span class="tr-report-tags">${tags}</span>
      ${xpBar(pokemon)}
    </li>`;
  }).join('');
  return `<ul class="tr-report">${rows}</ul>`;
}

interface TeamSelectOptions {
  /** The course about to be played, or null when browsing the collection. */
  map: StadiumMap | null;
  onConfirm?: () => void;
  onBack: () => void;
}

export class TrainerScreens {
  private root: HTMLElement;
  private summaryRoot: HTMLElement;
  private releaseRoot: HTMLElement;
  private views: RosterModelView[] = [];
  private summaryView: RosterModelView | null = null;
  private rerender: (() => void) | null = null;
  /** The gift's Poké Ball has popped: the game plays the release and the cry. */
  public onGiftRevealed: ((name: string, type: PokemonType) => void) | null = null;

  constructor(private container: HTMLElement, private store: TrainerStore) {
    this.root = document.createElement('div');
    this.root.id = 'trainer-screen';
    this.root.className = 'interactive';
    this.root.hidden = true;
    this.summaryRoot = document.createElement('div');
    this.summaryRoot.id = 'trainer-summary';
    this.summaryRoot.className = 'interactive';
    this.summaryRoot.hidden = true;
    this.releaseRoot = document.createElement('div');
    this.releaseRoot.id = 'trainer-release';
    this.releaseRoot.className = 'interactive';
    this.releaseRoot.hidden = true;
    container.append(this.root, this.summaryRoot, this.releaseRoot);
    // Bound once: the dialog's own markup is rebuilt on every open.
    this.releaseRoot.addEventListener('click', (event) => {
      if (event.target === this.releaseRoot) this.closeReleaseConfirm();
    });
    this.releaseRoot.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.closeReleaseConfirm();
    });

    store.subscribe(() => this.rerender?.());
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  private open(render: () => void): void {
    this.rerender = render;
    this.root.hidden = false;
    this.container.classList.add('trainer-open');
    render();
  }

  public close(): void {
    this.clearViews();
    this.rerender = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.closeSummary();
    this.closeReleaseConfirm();
    this.container.classList.remove('trainer-open');
  }

  private clearViews(): void {
    this.views.forEach(view => view.destroy());
    this.views = [];
  }

  /** Mounts a live model into every `[data-model]` placeholder under `scope`. */
  private mountModels(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLElement>('[data-model]').forEach(stage => {
      const species = getSpecies(stage.dataset.species!);
      const view = new RosterModelView();
      stage.appendChild(view.canvas);
      view.show(stage.dataset.model!, species.createModel);
      this.views.push(view);
    });
  }

  // ---- Starter select ------------------------------------------------------

  /**
   * Two beats: choose a partner, then meet the gift. Pikachu used to be one
   * clause in the pick screen's subtitle plus a nickname box for a Pokémon
   * nobody had seen yet, so players missed that they get it at all. Now it
   * gets its own reveal, and each nickname is asked for right after that
   * Pokémon is met. Nothing is saved until the last beat, so backing out of
   * the gift loses nothing and a closed tab just starts over.
   */
  public openStarterSelect(onDone: () => void): void {
    let chosen: string | null = null;
    let starterName = '';
    let step: 'pick' | 'gift' = 'pick';
    const render = () => {
      if (step === 'pick') this.renderStarterPick(chosen, starterName, (id, name) => {
        chosen = id;
        starterName = name;
        step = 'gift';
        render();
      });
      else this.renderGiftReveal(chosen!, starterName, () => {
        step = 'pick';
        render();
      }, (giftName) => {
        this.store.chooseStarter(chosen!, starterName || null, giftName || null);
        this.close();
        onDone();
      });
    };
    this.open(render);
  }

  private renderStarterPick(initial: string | null, initialName: string, onChoose: (id: string, nickname: string) => void): void {
    if (this.root.querySelector('.tr-starter')) return; // Built once; choosing only restyles it.
    this.clearViews();
    let chosen = initial;
    const chooseLabel = () => chosen ? `CHOOSE ${getSpecies(chosen).forms[0].name.toUpperCase()}` : 'CHOOSE';
    this.root.innerHTML = `
      <section class="tr-panel stadium-panel tr-starter">
        <div class="tr-eyebrow">NEW TRAINER</div>
        <h1 class="tr-title">CHOOSE YOUR FIRST POKÉMON</h1>
        <p class="tr-subtitle">Your partner grows with every battle. Pick one, and a gift is waiting once you do.</p>
        <div class="tr-starter-cards">
          ${STARTER_IDS.map(id => {
            const species = getSpecies(id);
            const form = species.forms[0];
            return `<button class="tr-starter-card ${chosen === id ? 'selected' : ''}" data-starter="${id}" aria-pressed="${chosen === id}">
              <span class="tr-model" data-model="${form.name}" data-species="${id}"></span>
              <strong>${form.name.toUpperCase()}</strong>
              <span class="tr-types">${typeChip(form.type)}</span>
              <span class="tr-desc">${species.description}</span>
            </button>`;
          }).join('')}
        </div>
        <form class="tr-starter-names">
          <label>NICKNAME <input name="starter" maxlength="${NICKNAME_MAX}" autocomplete="off" value="${escapeHtml(initialName)}" placeholder="${chosen ? getSpecies(chosen).forms[0].name : 'Choose a Pokémon first'}" ${chosen ? '' : 'disabled'}></label>
          <button class="stadium-btn active tr-confirm" type="submit" ${chosen ? '' : 'disabled'}>${chooseLabel()}</button>
        </form>
      </section>`;
    this.mountModels(this.root);
    const starterInput = this.root.querySelector<HTMLInputElement>('input[name="starter"]')!;
    const confirm = this.root.querySelector<HTMLButtonElement>('.tr-confirm')!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-starter]').forEach(button => button.addEventListener('click', () => {
      chosen = button.dataset.starter!;
      this.root.querySelectorAll<HTMLButtonElement>('[data-starter]').forEach(card => {
        card.classList.toggle('selected', card === button);
        card.setAttribute('aria-pressed', String(card === button));
      });
      starterInput.disabled = false;
      starterInput.placeholder = getSpecies(chosen).forms[0].name;
      confirm.disabled = false;
      confirm.textContent = chooseLabel();
    }));
    this.root.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      if (chosen) onChoose(chosen, this.readNickname('starter'));
    });
  }

  /**
   * The gift, staged like a send-out: a Poké Ball drops in, pops, and Pikachu
   * is standing there with everything a starter card shows. The two-slot team
   * strip underneath is the point of the screen -- you are not choosing
   * between these, you are leaving with both.
   */
  private renderGiftReveal(starterId: string, starterName: string, onBack: () => void, onBegin: (giftName: string) => void): void {
    if (this.root.querySelector('.tr-gift')) return;
    this.clearViews();
    const gift = getSpecies(GIFT_ID);
    const form = gift.forms[0];
    const starter = getSpecies(starterId).forms[0];
    const partner = starterName || starter.name;
    const slot = (speciesId: string, name: string, species: string, tag: string) => `
      <li class="tr-gift-slot">
        <span class="tr-model" data-model="${species}" data-species="${speciesId}"></span>
        <span class="tr-gift-slot-copy"><b>${escapeHtml(name.toUpperCase())}</b><small>${tag} · LV 5</small></span>
      </li>`;
    this.root.innerHTML = `
      <section class="tr-panel stadium-panel tr-gift">
        <div class="tr-eyebrow">A GIFT FROM THE STADIUM</div>
        <h1 class="tr-title">${form.name.toUpperCase()} JOINS YOUR TEAM</h1>
        <p class="tr-subtitle">Every new trainer gets one. ${form.name} fights alongside ${escapeHtml(partner)} from your very first match.</p>
        <div class="tr-gift-reveal">
          <div class="tr-gift-stage">
            <span class="tr-gift-ball" aria-hidden="true"><i></i><i></i></span>
            <span class="tr-gift-flash" aria-hidden="true"></span>
            <span class="tr-model" data-model="${form.name}" data-species="${GIFT_ID}"></span>
          </div>
          <div class="tr-gift-copy">
            <span class="tr-gift-role">${gift.role}</span>
            <strong>${form.name.toUpperCase()}</strong>
            <span class="tr-types">${typeChip(form.type)}</span>
            <span class="tr-desc">${gift.description}</span>
          </div>
        </div>
        <div class="tr-gift-team">
          <span class="tr-gift-team-label">YOUR TEAM</span>
          <ul>
            ${slot(starterId, partner, starter.name, 'YOUR PICK')}
            ${slot(GIFT_ID, form.name, form.name, 'GIFT')}
          </ul>
        </div>
        <form class="tr-starter-names">
          <label>${form.name.toUpperCase()} NICKNAME <input name="gift" maxlength="${NICKNAME_MAX}" autocomplete="off" placeholder="${form.name}"></label>
          <button class="stadium-btn tr-back" type="button">BACK</button>
          <button class="stadium-btn active tr-confirm" type="submit">BEGIN YOUR JOURNEY</button>
        </form>
      </section>`;
    this.mountModels(this.root);
    const giftInput = this.root.querySelector<HTMLInputElement>('input[name="gift"]')!;
    const giftSlotName = this.root.querySelectorAll<HTMLElement>('.tr-gift-slot b')[1];
    giftInput.addEventListener('input', () => {
      giftSlotName.textContent = (giftInput.value.trim() || form.name).toUpperCase();
    });
    this.root.querySelector('.tr-back')!.addEventListener('click', onBack);
    this.root.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      onBegin(this.readNickname('gift'));
    });
    // Timed to the ball popping in trainer.css, so the cry lands on the reveal.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.setTimeout(() => {
      if (this.root.querySelector('.tr-gift')) this.onGiftRevealed?.(form.name, form.type);
    }, reduced ? 0 : GIFT_POP_MS);
  }

  private readNickname(name: 'starter' | 'gift'): string {
    return this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? '';
  }


  // ---- Team select ---------------------------------------------------------

  /**
   * The six slots re-render when the store commits; the bench re-renders on
   * store commits and on every search, sort or filter change. The toolbar is
   * built once so the search box keeps focus while typing.
   */
  public openTeamSelect(options: TeamSelectOptions): void {
    const cup = options.map ? CUPS[options.map.cup] : null;
    const threats = cup ? openingThreatTypes(10, cup.winRound, options.map?.typeWeights) : [];
    const canEnter = (pokemon: OwnedPokemon) => !cup || isEligible(pokemon.level, cup);
    const filter: BenchFilter = { query: '', sort: 'level', types: new Set(), strongOnly: false };
    const strongCache = new Map<string, PokemonType[]>();
    const strong = (pokemon: OwnedPokemon) => {
      const key = `${pokemon.speciesId}:${pokemon.level}`;
      if (!strongCache.has(key)) strongCache.set(key, strongAgainst(pokemon, threats));
      return strongCache.get(key)!;
    };
    const showBenchIntro = !!options.map && this.store.data.collection.length > TEAM_SIZE
      && !this.store.data.unlocks.includes(BENCH_INTRO_UNLOCK);

    // Rentals: previews of the cup's pool, placed in whichever slots are empty or sitting out.
    const pool = cup ? RENTALS[cup.id] : [];
    const previews = new Map(pool.map(id => [id, createRental(id, cup!.id)]));
    const openPlaces = () => this.store.data.team.flatMap((uid, slot) => {
      const member = uid ? this.store.get(uid) : null;
      return !member || !canEnter(member) ? [slot] : [];
    });
    const nothingEligible = !!cup && !this.store.data.collection.some(canEnter);
    const showRentalIntro = nothingEligible && !readFlag(RENTAL_INTRO_KEY);
    const desk: RentalDesk = {
      picks: cup ? this.store.rentalPicks.filter(id => pool.includes(id)) : [],
      showing: nothingEligible,
      add: (speciesId) => {
        if (desk.picks.includes(speciesId)) return;
        if (desk.picks.length >= openPlaces().length) {
          this.flash('NO OPEN PLACE · RETURN A RENTAL OR CLEAR A SLOT');
          return;
        }
        desk.picks.push(speciesId);
        this.rerender?.();
      },
      remove: (speciesId) => {
        desk.picks = desk.picks.filter(id => id !== speciesId);
        this.rerender?.();
      },
      fill: () => {
        const best = [...pool].sort((a, b) => strong(previews.get(b)!).length - strong(previews.get(a)!).length);
        for (const id of best) {
          if (desk.picks.length >= openPlaces().length) break;
          if (!desk.picks.includes(id)) desk.picks.push(id);
        }
        this.rerender?.();
      },
    };

    const renderSlots = () => {
      this.clearViews();
      const { data } = this.store;
      const team = data.team.map(uid => (uid ? this.store.get(uid) : null));
      const teamCount = team.filter(Boolean).length;
      // Rentals take the open places in order; a place filled by an owned Pokémon hands its rental back.
      const places = openPlaces();
      desk.picks.splice(places.length);
      const rentalAt = new Map(places.slice(0, desk.picks.length).map((slot, i) => [slot, previews.get(desk.picks[i])!]));
      // Only members allowed in this cup take the field; the rest stay on the saved team.
      const eligible = team.filter((pokemon): pokemon is OwnedPokemon => !!pokemon && canEnter(pokemon)).length;
      const fielded = eligible + desk.picks.length;
      this.root.querySelector('.tr-slots')!.innerHTML = team.map((owned, slot) => [owned, rentalAt.get(slot)] as const).map(([pokemon, rental], slot) => rental
        ? `<div class="tr-slot filled rental" data-drop-slot="${slot}" style="${typeArtStyle(formOf(rental).type)}">
            <button class="tr-slot-main" data-unrent="${rental.speciesId}" title="Return this rental">
              <span class="tr-model" data-model="${formOf(rental).name}" data-species="${rental.speciesId}"></span>
              <span class="tr-slot-name">${escapeHtml(formOf(rental).name.toUpperCase())}</span>
              <span class="tr-slot-meta">LV ${rental.level}</span>
              <span class="tr-slot-types">${typeChips(rental)}</span>
            </button>
            <span class="tr-rental-ribbon">RENTAL</span>
          </div>`
        : pokemon
        ? `<div class="tr-slot filled ${canEnter(pokemon) ? '' : 'ineligible'}" data-drop-slot="${slot}" data-drag-uid="${pokemon.uid}" draggable="true" style="${typeArtStyle(formOf(pokemon).type)}">
            <button class="tr-slot-main" data-slot="${slot}" title="Click to remove · drag to swap">
              <span class="tr-model" data-model="${formOf(pokemon).name}" data-species="${pokemon.speciesId}"></span>
              <span class="tr-slot-name">${escapeHtml(displayName(pokemon).toUpperCase())}</span>
              <span class="tr-slot-meta">LV ${pokemon.level}</span>
              ${cupTag(pokemon, cup)}
              <span class="tr-slot-types">${typeChips(pokemon)}</span>
              ${xpBar(pokemon)}
            </button>
            <button class="tr-info stadium-btn" data-info="${pokemon.uid}" title="Summary">INFO</button>
          </div>`
        : `<div class="tr-slot empty" data-drop-slot="${slot}"><span>SLOT ${slot + 1}</span></div>`).join('');
      this.mountModels(this.root.querySelector('.tr-slots')!);
      const sittingOut = teamCount - eligible;
      this.root.querySelector('[data-team-count]')!.textContent = `TEAM ${teamCount}/${TEAM_SIZE}`
        + (sittingOut ? ` · ${sittingOut} SIT${sittingOut === 1 ? 'S' : ''} OUT` : '')
        + (desk.picks.length ? ` · ${desk.picks.length} RENTAL${desk.picks.length === 1 ? '' : 'S'}` : '');
      const fillButton = this.root.querySelector<HTMLButtonElement>('[data-fill-rentals]');
      if (fillButton) fillButton.disabled = desk.picks.length >= Math.min(places.length, pool.length);
      this.root.querySelector<HTMLButtonElement>('[data-clear-team]')!.disabled = !teamCount;
      const confirm = this.root.querySelector<HTMLButtonElement>('[data-confirm]');
      if (confirm) {
        confirm.disabled = !fielded;
        confirm.textContent = fielded ? `START MATCH · ${fielded}/${TEAM_SIZE}` : cup ? 'ADD A POKÉMON OR RENTAL' : 'ADD A POKÉMON';
      }
    };

    const renderBench = () => {
      const list = this.root.querySelector<HTMLElement>('.tr-collection');
      if (!list) return;
      const { data } = this.store;
      const renting = desk.showing;
      const bench = renting
        ? pool.filter(id => !desk.picks.includes(id)).map(id => previews.get(id)!)
        : data.collection.filter(pokemon => !data.team.includes(pokemon.uid));
      const query = filter.query.trim().toLowerCase();
      const shown = bench.filter(pokemon => {
        const form = formOf(pokemon);
        if (query && ![displayName(pokemon), form.name, pokemon.speciesId].some(name => name.toLowerCase().includes(query))) return false;
        if (filter.types.size && !filter.types.has(form.type) && !(form.secondaryType && filter.types.has(form.secondaryType))) return false;
        return !filter.strongOnly || strong(pokemon).length > 0;
      }).sort((a, b) => Number(canEnter(b)) - Number(canEnter(a)) || BENCH_SORTS[filter.sort].compare(strong)(a, b));

      // Counted once per render: every card shows what parting with it pays.
      const copies = new Map<string, number>();
      for (const owned of data.collection) copies.set(owned.speciesId, (copies.get(owned.speciesId) ?? 0) + 1);
      const releasePoints = (pokemon: OwnedPokemon) => data.collection.length > 1
        ? researchPointsFor((copies.get(pokemon.speciesId) ?? 1) - 1)
        : null;

      const scroll = list.scrollTop;
      list.innerHTML = shown.map(pokemon => renting
        ? rentalTileHtml(pokemon, strong(pokemon))
        : benchTileHtml(pokemon, strong(pokemon), cup, releasePoints(pokemon))).join('')
        || `<p class="tr-empty">${renting ? (!bench.length ? 'Every rental is already on loan.' : 'No rentals match these filters.')
          : !data.collection.length ? 'No Pokémon yet.' : !bench.length ? 'Everyone you own is already on your team.' : 'No Pokémon match these filters.'}</p>`;
      list.scrollTop = scroll;

      const filtering = !!query || filter.types.size > 0 || filter.strongOnly;
      const researchTotal = Object.values(data.research).reduce((total, points) => total + points, 0);
      const shownCount = filtering ? `SHOWING ${shown.length} OF ${bench.length}` : `${bench.length}`;
      const storage = `${data.collection.length}/${STORAGE_MAX} STORED`
        + (this.store.isStorageFull ? ' · FULL, RELEASE ONE TO CATCH MORE' : '');
      this.root.querySelector('[data-bench-count]')!.textContent = renting
        ? `${shownCount} RENTALS AT LV ${rentalLevel(cup!.id)} · ${desk.picks.length} ON LOAN · RETURNED AFTER THE MATCH`
        : `${shownCount} ON BENCH · ${storage} · ${data.pokedex.caught.length} SPECIES CAUGHT · ${researchTotal} RESEARCH DATA`;
      this.root.querySelector<HTMLElement>('[data-bench-count]')!.classList.toggle('full', !renting && this.store.isStorageFull);
      list.classList.toggle('storage-full', !renting && this.store.isStorageFull);
      this.root.querySelectorAll<HTMLButtonElement>('[data-bench-mode]').forEach(tab => {
        tab.setAttribute('aria-pressed', String((tab.dataset.benchMode === 'rentals') === renting));
      });
      // A handful of Pokémon doesn't need a toolbar; keep it while any filter is on so it can be cleared.
      this.root.querySelector<HTMLElement>('.tr-bench-tools')!.hidden = bench.length < BENCH_TOOLS_MIN && !filtering;
      this.root.querySelector<HTMLButtonElement>('[data-clear-filters]')!.hidden = !filtering;
      const benchTypes = new Set(bench.flatMap(pokemon => [formOf(pokemon).type, formOf(pokemon).secondaryType]));
      this.root.querySelectorAll<HTMLButtonElement>('[data-type-filter]').forEach(chip => {
        const type = chip.dataset.typeFilter as PokemonType;
        const on = filter.types.has(type);
        chip.setAttribute('aria-pressed', String(on));
        chip.disabled = !on && !benchTypes.has(type);
      });
    };

    this.open(() => {
      if (!this.root.querySelector('.tr-team')) this.buildTeamShell(options, threats, filter, showBenchIntro, showRentalIntro, desk, renderBench);
      renderSlots();
      renderBench();
    });

    if (showBenchIntro) {
      this.store.data.unlocks.push(BENCH_INTRO_UNLOCK);
      this.store.commit();
    }
    if (showRentalIntro) writeFlag(RENTAL_INTRO_KEY);
  }

  /** Static chrome and delegated listeners for team select, built once per opening. */
  private buildTeamShell(
    options: TeamSelectOptions, threats: PokemonType[], filter: BenchFilter,
    showBenchIntro: boolean, showRentalIntro: boolean, desk: RentalDesk, renderBench: () => void,
  ): void {
    this.clearViews();
    const cup = options.map ? CUPS[options.map.cup] : null;
    const record = options.map ? this.store.data.maps[options.map.id] : undefined;
    this.root.innerHTML = `
        <section class="tr-panel stadium-panel tr-team">
        <div class="tr-eyebrow">${options.map ? `TEAM SELECT / ${options.map.name.toUpperCase()}` : 'MY POKÉMON'}</div>
        <div class="tr-heading-row">
          <h1 class="tr-title">${options.map ? 'PICK YOUR TEAM' : 'COLLECTION'}</h1>
          <div class="tr-heading-actions">
            <button class="stadium-btn" data-back>${options.map ? 'BACK TO COURSES' : 'DONE'}</button>
            ${options.onConfirm ? '<button class="stadium-btn active tr-confirm" data-confirm></button>' : ''}
          </div>
        </div>
        ${options.map ? `<div class="tr-threats"><span>OPENING WAVES</span>${threats.map(typeChip).join('')}
          ${record ? `<span class="tr-record">BEST ROUND ${record.bestRound}${record.cleared ? ' · CLEARED' : ''}</span>` : ''}</div>` : ''}
        ${cup ? `<p class="tr-cup-rules"><b>${cup.name}</b>${cup.entryMax >= MAX_LEVEL ? 'Pokémon of any level can enter.' : `Pokémon LV ${cup.entryMax} and under can enter.`} Your team can grow to LV ${cup.levelCap} this match.</p>` : ''}
        ${showRentalIntro && cup ? `<p class="tr-intro">None of your Pokémon are LV ${cup.entryMax} or under, so they can't enter ${cup.name}. Rent a team below: rentals level up this match, then go back to the stadium.</p>` : ''}
        ${showBenchIntro ? '<p class="tr-intro">Your team is full, so new catches wait on the bench. Click one, or drag it onto a slot, to swap it in.</p>' : ''}
        <div class="tr-team-head">
          <span data-team-count></span>
          <span class="tr-team-hint">Click a slot to bench it · drag to swap</span>
          ${cup ? '<button class="stadium-btn tr-mini" data-fill-rentals title="Fill every open place with a rental">FILL WITH RENTALS</button>' : ''}
          <button class="stadium-btn tr-mini" data-clear-team>CLEAR TEAM</button>
        </div>
        <div class="tr-slots"></div>
        ${cup ? `<div class="tr-bench-tabs" role="group" aria-label="Bench">
          <button class="tr-filter-toggle" data-bench-mode="mine" aria-pressed="true">MY POKÉMON</button>
          <button class="tr-filter-toggle" data-bench-mode="rentals" aria-pressed="false">RENTALS</button>
        </div>` : ''}
        <div class="tr-collection-head"><span data-bench-count></span><span>One tower per Pokémon on the field. Catch duplicates to field more.</span></div>
        <div class="tr-bench-tools">
          <div class="tr-bench-row">
            <input type="search" class="tr-input tr-search" placeholder="Search name" aria-label="Search Pokémon" autocomplete="off">
            <label class="tr-sort">SORT
              <select class="tr-input" aria-label="Sort bench">
                ${(Object.keys(BENCH_SORTS) as BenchSort[]).filter(key => options.map || key !== 'matchup')
                  .map(key => `<option value="${key}" ${key === filter.sort ? 'selected' : ''}>${BENCH_SORTS[key].label}</option>`).join('')}
              </select>
            </label>
            ${options.map ? '<button class="tr-filter-toggle" data-strong-only aria-pressed="false">STRONG VS OPENING WAVES</button>' : ''}
            <button class="tr-filter-toggle clear" data-clear-filters hidden>CLEAR FILTERS</button>
          </div>
          <div class="tr-type-filters" aria-label="Filter by type">
            ${(Object.keys(TYPE_COLORS) as PokemonType[]).map(type =>
              `<button class="tr-type tr-type-filter" data-type-filter="${type}" aria-pressed="false" style="background:${TYPE_COLORS[type].hex}">${type.toUpperCase()}</button>`).join('')}
          </div>
        </div>
        <div class="tr-collection" data-drop-bench></div>
        <div class="tr-footer"></div>
      </section>`;

    const section = this.root.querySelector<HTMLElement>('.tr-team')!;
    const search = section.querySelector<HTMLInputElement>('.tr-search')!;
    const strongToggle = section.querySelector<HTMLButtonElement>('[data-strong-only]');

    section.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target || target.disabled) return;
      const { dataset } = target;
      if (dataset.slot !== undefined) this.store.setTeamSlot(Number(dataset.slot), null);
      else if (dataset.rent) desk.add(dataset.rent);
      else if (dataset.unrent) desk.remove(dataset.unrent);
      else if (dataset.fillRentals !== undefined) desk.fill();
      else if (dataset.benchMode) {
        desk.showing = dataset.benchMode === 'rentals';
        renderBench();
      }
      else if (dataset.toggle) {
        if (!this.store.toggleTeam(dataset.toggle)) {
          // A full team can still take a newcomer in place of someone who can't enter this cup.
          const benched = cup ? this.store.data.team.findIndex(uid => {
            const member = uid ? this.store.get(uid) : null;
            return !!member && !isEligible(member.level, cup);
          }) : -1;
          if (benched !== -1) this.store.setTeamSlot(benched, dataset.toggle);
          else this.flash('TEAM IS FULL · REMOVE ONE OR DRAG ONTO A SLOT');
        }
      } else if (dataset.info) this.openSummary(dataset.info);
      else if (dataset.release) this.openReleaseConfirm(dataset.release, target);
      else if (dataset.clearTeam !== undefined) this.store.clearTeam();
      else if (dataset.typeFilter) {
        const type = dataset.typeFilter as PokemonType;
        if (!filter.types.delete(type)) filter.types.add(type);
        renderBench();
      } else if (dataset.strongOnly !== undefined) {
        filter.strongOnly = !filter.strongOnly;
        target.setAttribute('aria-pressed', String(filter.strongOnly));
        renderBench();
      } else if (dataset.clearFilters !== undefined) {
        filter.query = search.value = '';
        filter.types.clear();
        filter.strongOnly = false;
        strongToggle?.setAttribute('aria-pressed', 'false');
        renderBench();
      } else if (dataset.back !== undefined) {
        this.close();
        options.onBack();
      } else if (dataset.confirm !== undefined) {
        if (!this.store.team.some(member => !cup || isEligible(member.level, cup)) && !desk.picks.length) return;
        this.store.rentalPicks = cup ? [...desk.picks] : [];
        this.close();
        options.onConfirm!();
      }
    });
    search.addEventListener('input', () => {
      filter.query = search.value;
      renderBench();
    });
    section.querySelector('select')!.addEventListener('change', (event) => {
      filter.sort = (event.target as HTMLSelectElement).value as BenchSort;
      renderBench();
    });

    // Drag a bench tile onto a slot to swap it in, a slot onto a slot to swap
    // places, or a slot back onto the bench to remove it.
    let dragUid: string | null = null;
    const dropTarget = (event: DragEvent) => (event.target as HTMLElement).closest<HTMLElement>('[data-drop-slot], [data-drop-bench]');
    const clearDropMarks = () => section.querySelectorAll('.drop-over').forEach(el => el.classList.remove('drop-over'));
    section.addEventListener('dragstart', (event) => {
      const source = (event.target as HTMLElement).closest<HTMLElement>('[data-drag-uid]');
      if (!source) return;
      dragUid = source.dataset.dragUid!;
      event.dataTransfer?.setData('text/plain', dragUid);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      source.classList.add('dragging');
      section.classList.add('is-dragging');
    });
    section.addEventListener('dragover', (event) => {
      const target = dropTarget(event);
      if (!dragUid || !target) return;
      if (target.dataset.dropBench !== undefined && !this.store.data.team.includes(dragUid)) return;
      event.preventDefault();
      if (!target.classList.contains('drop-over')) {
        clearDropMarks();
        target.classList.add('drop-over');
      }
    });
    section.addEventListener('dragleave', (event) => {
      const target = dropTarget(event);
      if (target && !target.contains(event.relatedTarget as Node)) target.classList.remove('drop-over');
    });
    section.addEventListener('drop', (event) => {
      const target = dropTarget(event);
      const uid = dragUid;
      if (!target || !uid) return;
      event.preventDefault();
      clearDropMarks();
      if (target.dataset.dropSlot !== undefined) this.store.setTeamSlot(Number(target.dataset.dropSlot), uid);
      else if (this.store.data.team.includes(uid)) this.store.toggleTeam(uid);
    });
    section.addEventListener('dragend', () => {
      dragUid = null;
      clearDropMarks();
      section.classList.remove('is-dragging');
      section.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    });
  }

  private flash(message: string, tone: 'warn' | 'good' = 'warn'): void {
    const footer = this.root.querySelector('.tr-footer');
    if (!footer) return;
    const note = document.createElement('span');
    note.className = `tr-flash ${tone}`;
    note.textContent = message;
    footer.prepend(note);
    window.setTimeout(() => note.remove(), 1800);
  }

  // ---- Release ------------------------------------------------------------

  /**
   * Releasing is permanent and the only way to free a storage slot, so it asks
   * first and names what the trade pays.
   */
  private openReleaseConfirm(uid: string, source: HTMLElement | null = null): void {
    const pokemon = this.store.get(uid);
    if (!pokemon || !this.store.canRelease(uid)) return;
    this.releaseSource = source;
    const name = displayName(pokemon).toUpperCase();
    const points = this.store.researchValue(uid);
    const copies = this.store.data.collection.filter(other => other.speciesId === pokemon.speciesId).length;
    this.releaseRoot.innerHTML = `
      <section class="tr-dialog stadium-panel" role="dialog" aria-modal="true" aria-labelledby="tr-release-title">
        <div class="tr-eyebrow">SEND TO RESEARCH?</div>
        <h2 class="tr-title" id="tr-release-title">${escapeHtml(name)}</h2>
        <p class="tr-dialog-copy">
          LV ${pokemon.level} ${escapeHtml(formOf(pokemon).name.toUpperCase())} · ${pokemon.record.knockouts} KOs · ${pokemon.record.matches} matches<br>
          The Professor keeps it for good. Its species banks
          <b>+${points} research data</b>${copies > 1 ? `, and you keep ${copies - 1} other${copies === 2 ? '' : 's'}` : ' — this is your only one'}.
        </p>
        <p class="tr-dialog-warn">This cannot be undone.</p>
        <div class="tr-footer">
          <button class="stadium-btn" type="button" data-release-cancel>CANCEL</button>
          <button class="stadium-btn active" type="button" data-release-confirm>SEND TO RESEARCH</button>
        </div>
      </section>`;
    this.releaseRoot.hidden = false;
    this.releaseRoot.querySelector<HTMLButtonElement>('[data-release-confirm]')!.focus();
    this.releaseRoot.querySelector('[data-release-cancel]')!.addEventListener('click', () => this.closeReleaseConfirm());
    this.releaseRoot.querySelector('[data-release-confirm]')!.addEventListener('click', () => {
      const earned = this.store.releaseForResearch(uid);
      this.closeReleaseConfirm();
      if (earned !== null) this.flash(`${name} SENT TO RESEARCH · +${earned} DATA`, 'good');
    });
  }

  private closeReleaseConfirm(): void {
    this.releaseRoot.hidden = true;
    this.releaseRoot.innerHTML = '';
    const previous = this.releaseSource;
    this.releaseSource = null;
    if (previous?.isConnected) previous.focus();
  }

  private releaseSource: HTMLElement | null = null;

  // ---- Summary -------------------------------------------------------------

  public openSummary(uid: string): void {
    this.closeSummary();
    const render = () => {
      const pokemon = this.store.get(uid);
      this.summaryView?.destroy();
      this.summaryView = null;
      if (!pokemon) return this.closeSummary();
      const species = speciesOf(pokemon);
      const form = formOf(pokemon);
      const stats = statsOf(pokemon);
      const effect = { attack: 'MOVE DAMAGE', speed: 'ATTACK SPEED', special: 'STATUS EFFECTS' };
      const origin = pokemon.origin.kind === 'caught'
        ? `Caught at round ${pokemon.origin.round ?? '?'} with a ${(pokemon.origin.ball ?? 'poke').toUpperCase()} BALL`
        : pokemon.origin.kind === 'starter' ? 'Your first partner' : pokemon.origin.kind === 'gift' ? 'A gift from the stadium' : 'Granted from the dev panel';

      this.summaryRoot.innerHTML = `
        <section class="tr-panel stadium-panel tr-summary" role="dialog" aria-label="${escapeHtml(displayName(pokemon))} summary">
          <div class="tr-summary-top">
            <span class="tr-model large" data-model="${form.name}" data-species="${species.id}"></span>
            <div class="tr-summary-id">
              <div class="tr-eyebrow">${form.name.toUpperCase()} · LV ${pokemon.level}</div>
              <h2 class="tr-title">${escapeHtml(displayName(pokemon).toUpperCase())}</h2>
              <div class="tr-types">${typeChips(pokemon)}</div>
              ${xpBar(pokemon)}
              <div class="tr-xp-label">${pokemon.level >= MAX_LEVEL ? 'MAX LEVEL' : `${xpForLevel(pokemon.level + 1) - pokemon.xp} XP TO LV ${pokemon.level + 1}`}</div>
              <form class="tr-rename">
                <input maxlength="${NICKNAME_MAX}" autocomplete="off" placeholder="${form.name}" value="${escapeHtml(pokemon.nickname ?? '')}" aria-label="Nickname">
                <button class="stadium-btn" type="submit">RENAME</button>
              </form>
            </div>
          </div>
          <div class="tr-summary-grid">
            <div>
              <h3>STATS</h3>
              <p class="tr-stat-note">Stats grow with level. Natural talent is unique to each Pokémon and never changes.</p>
              <div class="tr-stat tr-stat-head" aria-hidden="true">
                <span>STAT</span><span>NOW</span><span>NATURAL TALENT</span><span>AFFECTS</span>
              </div>
              ${STAT_KEYS.map(key => `<div class="tr-stat">
                <span class="tr-stat-name">${key.toUpperCase()}</span>
                <span class="tr-stat-value">${stats[key]}</span>
                <span class="tr-stars" title="Natural talent ${pokemon.dvs[key]} / ${MAX_DV} · fixed when caught">${'★'.repeat(Math.round(pokemon.dvs[key] / 3))}${'☆'.repeat(5 - Math.round(pokemon.dvs[key] / 3))}</span>
                <span class="tr-stat-effect">${effect[key]}</span>
              </div>`).join('')}
              <h3>EVOLUTION</h3>
              <div class="tr-evo">${species.forms.map((f, i) => `<span class="${i === pokemon.stage ? 'current' : i < pokemon.stage ? 'past' : ''}">${f.name}${f.atLevel ? ` <small>LV ${f.atLevel}</small>` : ''}</span>`).join('<b>→</b>')}</div>
              <h3>RECORD</h3>
              <p class="tr-record-text">${pokemon.record.knockouts} KOs · ${pokemon.record.damageDealt.toLocaleString()} damage · ${pokemon.record.matches} matches<br>${origin}</p>
            </div>
            <div>
              <h3>${species.role} · ${MOVES[species.basicAttack].name.toUpperCase()}</h3>
              ${species.paths.map(path => `<div class="tr-line"><span class="tr-line-label">${path.label}</span>
                ${path.tiers.map(tier => {
                  const locked = (tier.requiresLevel ?? 0) > pokemon.level;
                  return `<span class="tr-tier ${locked ? 'locked' : ''}" title="${tier.description}"><b>${tier.name}</b><small>$${tier.cost}${tier.requiresLevel ? ` · LV ${tier.requiresLevel}` : ''}</small></span>`;
                }).join('')}
              </div>`).join('')}
            </div>
          </div>
          <div class="tr-footer"><button class="stadium-btn active" data-close>CLOSE</button></div>
        </section>`;
      const stage = this.summaryRoot.querySelector<HTMLElement>('[data-model]')!;
      this.summaryView = new RosterModelView();
      stage.appendChild(this.summaryView.canvas);
      this.summaryView.show(form.name, species.createModel);
      this.summaryRoot.querySelector('[data-close]')!.addEventListener('click', () => this.closeSummary());
      this.summaryRoot.querySelector('form')!.addEventListener('submit', (event) => {
        event.preventDefault();
        this.store.rename(uid, this.summaryRoot.querySelector<HTMLInputElement>('.tr-rename input')!.value);
      });
    };
    this.summaryRoot.hidden = false;
    this.closeSummaryHook = this.store.subscribe(() => { if (!this.summaryRoot.hidden) render(); });
    render();
  }

  private closeSummaryHook: (() => void) | null = null;

  private closeSummary(): void {
    this.closeSummaryHook?.();
    this.closeSummaryHook = null;
    this.summaryView?.destroy();
    this.summaryView = null;
    this.summaryRoot.hidden = true;
    this.summaryRoot.innerHTML = '';
  }

  // ---- Match report --------------------------------------------------------

  public showMatchReport(report: MatchReportEntry[], mapName: string, onContinue: () => void): void {
    this.open(() => {
      this.clearViews();
      this.root.innerHTML = `
        <section class="tr-panel stadium-panel tr-results">
          <div class="tr-eyebrow">MATCH REPORT / ${mapName.toUpperCase()}</div>
          <h1 class="tr-title">RESULTS</h1>
          ${reportListHtml(report) || '<p class="tr-empty">No battles fought this match.</p>'}
          <div class="tr-footer"><button class="stadium-btn active" data-continue>CONTINUE</button></div>
        </section>`;
      this.root.querySelector('[data-continue]')!.addEventListener('click', () => {
        this.close();
        onContinue();
      });
    });
  }
}
