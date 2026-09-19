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
import { levelProgress, MAX_DV, MAX_LEVEL, STAT_KEYS, towerModifiers, xpForLevel } from './Stats';
import {
  displayName, formOf, NICKNAME_MAX, OwnedPokemon, speciesOf, statsOf, TEAM_SIZE, TrainerStore,
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

function benchTileHtml(pokemon: OwnedPokemon, strong: PokemonType[], cup: CupRules | null): string {
  const form = formOf(pokemon);
  const eligible = !cup || isEligible(pokemon.level, cup);
  return `<div class="tr-card ${eligible ? '' : 'ineligible'}" draggable="${eligible}" ${eligible ? `data-drag-uid="${pokemon.uid}"` : ''}>
    <button class="tr-card-main" data-toggle="${pokemon.uid}" ${eligible ? 'title="Add to team · drag onto a slot to swap"' : `disabled title="Over ${cup!.name}'s LV ${cup!.entryMax} entry limit"`} style="${typeArtStyle(form.type)}">
      <span class="tr-card-name">${escapeHtml(displayName(pokemon).toUpperCase())}${pokemon.nickname ? `<small>${form.name.toUpperCase()}</small>` : ''}</span>
      <span class="tr-card-meta">LV ${pokemon.level}</span>
      ${cupTag(pokemon, cup)}
      <span class="tr-card-types">${typeChips(pokemon)}</span>
      ${strong.length ? `<span class="tr-matchup" title="Strong vs ${strong.join(', ')}">STRONG VS ${strong.slice(0, 3).join(' · ').toUpperCase()}</span>` : ''}
    </button>
    <button class="tr-info stadium-btn" data-info="${pokemon.uid}" title="Summary">INFO</button>
  </div>`;
}

/** A loaner on offer: no summary or drag, a click puts it in the next open place. The RENTALS tab already names it, so no ribbon. */
function rentalTileHtml(pokemon: OwnedPokemon, strong: PokemonType[]): string {
  const form = formOf(pokemon);
  return `<div class="tr-card rental">
    <button class="tr-card-main" data-rent="${pokemon.speciesId}" title="Rent for this match" style="${typeArtStyle(form.type)}">
      <span class="tr-card-name">${escapeHtml(form.name.toUpperCase())}</span>
      <span class="tr-card-meta">LV ${pokemon.level}</span>
      <span class="tr-card-types">${typeChips(pokemon)}</span>
      ${strong.length ? `<span class="tr-matchup" title="Strong vs ${strong.join(', ')}">STRONG VS ${strong.slice(0, 3).join(' · ').toUpperCase()}</span>` : ''}
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
  private views: RosterModelView[] = [];
  private summaryView: RosterModelView | null = null;
  private rerender: (() => void) | null = null;

  constructor(private container: HTMLElement, private store: TrainerStore) {
    this.root = document.createElement('div');
    this.root.id = 'trainer-screen';
    this.root.className = 'interactive';
    this.root.hidden = true;
    this.summaryRoot = document.createElement('div');
    this.summaryRoot.id = 'trainer-summary';
    this.summaryRoot.className = 'interactive';
    this.summaryRoot.hidden = true;
    container.append(this.root, this.summaryRoot);

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

  public openStarterSelect(onDone: () => void): void {
    let chosen: string | null = null;
    this.open(() => {
      if (this.root.querySelector('.tr-starter')) return; // Built once; choosing only restyles it.
      this.clearViews();
      const gift = getSpecies(GIFT_ID);
      this.root.innerHTML = `
        <section class="tr-panel stadium-panel tr-starter">
          <div class="tr-eyebrow">NEW TRAINER</div>
          <h1 class="tr-title">CHOOSE YOUR FIRST POKÉMON</h1>
          <p class="tr-subtitle">Your partner grows with every battle. ${gift.forms[0].name} joins you as a gift. Catch the rest in the stadium.</p>
          <div class="tr-starter-cards">
            ${STARTER_IDS.map(id => {
              const species = getSpecies(id);
              const form = species.forms[0];
              return `<button class="tr-starter-card ${chosen === id ? 'selected' : ''}" data-starter="${id}" aria-pressed="${chosen === id}">
                <span class="tr-model" data-model="${form.name}" data-species="${id}"></span>
                <strong>${form.name.toUpperCase()}</strong>
                <span class="tr-types">${typeChip(form.type)}</span>
                <span class="tr-desc">${species.description}</span>
                <span class="tr-evo-line">${species.forms.map(f => f.name).join(' → ')}</span>
              </button>`;
            }).join('')}
          </div>
          <form class="tr-starter-names">
            <label>STARTER NICKNAME <input name="starter" maxlength="${NICKNAME_MAX}" autocomplete="off" placeholder="${chosen ? getSpecies(chosen).forms[0].name : 'Starter'}" ${chosen ? '' : 'disabled'}></label>
            <label>${gift.forms[0].name.toUpperCase()} NICKNAME <input name="gift" maxlength="${NICKNAME_MAX}" autocomplete="off" placeholder="${gift.forms[0].name}"></label>
            <button class="stadium-btn active tr-confirm" type="submit" ${chosen ? '' : 'disabled'}>BEGIN YOUR JOURNEY</button>
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
      }));
      this.root.querySelector('form')!.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!chosen) return;
        const { starter, gift: giftName } = this.readStarterNames();
        this.store.chooseStarter(chosen, starter || null, giftName || null);
        this.close();
        onDone();
      });
    });
  }

  private readStarterNames(): { starter: string; gift: string } {
    const form = this.root.querySelector('form');
    const read = (name: string) => form?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? '';
    return { starter: read('starter'), gift: read('gift') };
  }

  // ---- Team select ---------------------------------------------------------

  /**
   * The six slots re-render when the store commits; the bench re-renders on
   * store commits and on every search, sort or filter change. The toolbar is
   * built once so the search box keeps focus while typing.
   */
  public openTeamSelect(options: TeamSelectOptions): void {
    const cup = options.map ? CUPS[options.map.cup] : null;
    const threats = cup ? openingThreatTypes(10, cup.winRound) : [];
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

      const scroll = list.scrollTop;
      list.innerHTML = shown.map(pokemon => renting ? rentalTileHtml(pokemon, strong(pokemon)) : benchTileHtml(pokemon, strong(pokemon), cup)).join('')
        || `<p class="tr-empty">${renting ? (!bench.length ? 'Every rental is already on loan.' : 'No rentals match these filters.')
          : !data.collection.length ? 'No Pokémon yet.' : !bench.length ? 'Everyone you own is already on your team.' : 'No Pokémon match these filters.'}</p>`;
      list.scrollTop = scroll;

      const filtering = !!query || filter.types.size > 0 || filter.strongOnly;
      const researchTotal = Object.values(data.research).reduce((total, points) => total + points, 0);
      const shownCount = filtering ? `SHOWING ${shown.length} OF ${bench.length}` : `${bench.length}`;
      this.root.querySelector('[data-bench-count]')!.textContent = renting
        ? `${shownCount} RENTALS AT LV ${rentalLevel(cup!.id)} · ${desk.picks.length} ON LOAN · RETURNED AFTER THE MATCH`
        : `${shownCount} ON BENCH · ${data.collection.length} OWNED · ${data.pokedex.caught.length} SPECIES CAUGHT · ${researchTotal} RESEARCH DATA`;
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

  private flash(message: string): void {
    const footer = this.root.querySelector('.tr-footer');
    if (!footer) return;
    const note = document.createElement('span');
    note.className = 'tr-flash';
    note.textContent = message;
    footer.prepend(note);
    window.setTimeout(() => note.remove(), 1800);
  }

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
      const mods = towerModifiers(stats, pokemon.level);
      const effect = { attack: `${Math.round((mods.damage - 1) * 100)}% DMG`, speed: `${Math.round((mods.rate - 1) * 100)}% RATE`, special: `${Math.round((mods.status - 1) * 100)}% STATUS` };
      const signed = (text: string) => (text.startsWith('-') ? text : `+${text}`);
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
              ${STAT_KEYS.map(key => `<div class="tr-stat">
                <span class="tr-stat-name">${key.toUpperCase()}</span>
                <span class="tr-stat-value">${stats[key]}</span>
                <span class="tr-stars" title="DV ${pokemon.dvs[key]} / ${MAX_DV}">${'★'.repeat(Math.round(pokemon.dvs[key] / 3))}${'☆'.repeat(5 - Math.round(pokemon.dvs[key] / 3))}</span>
                <span class="tr-stat-effect ${effect[key].startsWith('-') ? 'down' : ''}">${signed(effect[key])}</span>
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
