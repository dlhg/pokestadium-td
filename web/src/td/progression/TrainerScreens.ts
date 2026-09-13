/**
 * TrainerScreens.ts — Starter Select, Team Select, Summary, Match Report
 *
 * The between-matches half of the game. Every screen reads straight from the
 * TrainerStore and re-renders when it commits, so the dev panel and in-match
 * catches show up without any extra wiring.
 */

import { RosterModelView } from '../RosterModelView';
import type { StadiumMap } from '../MapCatalog';
import { openingThreatTypes, WIN_ROUNDS } from '../WaveManager';
import { MOVES } from '../../stadium/MoveDatabase';
import { getCombinedEffectiveness, PokemonType, TYPE_COLORS } from '../../stadium/TypeMatrix';
import { GIFT_ID, getSpecies, STARTER_IDS } from './Species';
import { levelProgress, MAX_DV, MAX_LEVEL, STAT_KEYS, towerModifiers, xpForLevel } from './Stats';
import {
  displayName, formOf, NICKNAME_MAX, OwnedPokemon, speciesOf, statsOf, TEAM_SIZE, TrainerStore,
} from './TrainerStore';
import type { MatchReportEntry } from './MatchProgress';
import './trainer.css';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function typeChip(type: PokemonType): string {
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
  const moveTypes = new Set(speciesOf(pokemon).lines.flatMap(line =>
    line.tiers.filter(tier => (tier.requiresLevel ?? 0) <= pokemon.level).map(tier => MOVES[tier.moveId]?.type).filter(Boolean)));
  return threats.filter(threat => [...moveTypes].some(type => getCombinedEffectiveness(type!, [threat]) >= 2));
}

/** Shared by the quit report and the defeat card. */
export function reportListHtml(report: MatchReportEntry[]): string {
  if (!report.length) return '';
  const rows = report.map(entry => {
    const { pokemon } = entry;
    const form = formOf(pokemon).name;
    const tags = [
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

  public openTeamSelect(options: TeamSelectOptions): void {
    const threats = options.map ? openingThreatTypes(10, WIN_ROUNDS[options.map.difficulty]) : [];
    const scrollKey = '.tr-collection';
    this.open(() => {
      const scroll = this.root.querySelector(scrollKey)?.scrollTop ?? 0;
      this.clearViews();
      const { data } = this.store;
      const team = data.team.map(uid => (uid ? this.store.get(uid) : null));
      const collection = [...data.collection].sort((a, b) => b.level - a.level || displayName(a).localeCompare(displayName(b)));
      const record = options.map ? data.maps[options.map.id] : undefined;

      const slots = team.map((pokemon, slot) => pokemon
        ? `<button class="tr-slot filled" data-slot="${slot}" title="Remove from team" style="${typeArtStyle(formOf(pokemon).type)}">
            <span class="tr-model" data-model="${formOf(pokemon).name}" data-species="${pokemon.speciesId}"></span>
            <span class="tr-slot-name">${escapeHtml(displayName(pokemon).toUpperCase())}</span>
            <span class="tr-slot-meta">LV ${pokemon.level} ${typeChips(pokemon)}</span>
            ${xpBar(pokemon)}
          </button>`
        : `<div class="tr-slot empty"><span>SLOT ${slot + 1}</span></div>`).join('');

      const cards = collection.map(pokemon => {
        const onTeam = data.team.includes(pokemon.uid);
        const strong = strongAgainst(pokemon, threats);
        return `<div class="tr-card ${onTeam ? 'on-team' : ''}">
          <button class="tr-card-main" data-toggle="${pokemon.uid}" aria-pressed="${onTeam}" title="${onTeam ? 'Remove from team' : 'Add to team'}" style="${typeArtStyle(formOf(pokemon).type)}">
            <span class="tr-card-name">${escapeHtml(displayName(pokemon).toUpperCase())}</span>
            <span class="tr-card-form">${pokemon.nickname ? formOf(pokemon).name : '&nbsp;'}</span>
            <span class="tr-card-meta">LV ${pokemon.level} ${typeChips(pokemon)}</span>
            ${strong.length ? `<span class="tr-matchup">STRONG VS ${strong.slice(0, 3).join(' · ').toUpperCase()}</span>` : ''}
            ${xpBar(pokemon)}
            <span class="tr-check">${onTeam ? 'ON TEAM' : '+ ADD'}</span>
          </button>
          <button class="tr-info stadium-btn" data-info="${pokemon.uid}">INFO</button>
        </div>`;
      }).join('');

      const teamCount = team.filter(Boolean).length;
      this.root.innerHTML = `
        <section class="tr-panel stadium-panel tr-team">
          <div class="tr-eyebrow">${options.map ? `TEAM SELECT / ${options.map.name.toUpperCase()}` : 'MY POKÉMON'}</div>
          <h1 class="tr-title">${options.map ? 'PICK YOUR TEAM' : 'COLLECTION'}</h1>
          ${options.map ? `<div class="tr-threats"><span>OPENING WAVES</span>${threats.map(typeChip).join('')}
            ${record ? `<span class="tr-record">BEST ROUND ${record.bestRound}${record.cleared ? ' · CLEARED' : ''}</span>` : ''}</div>` : ''}
          <div class="tr-slots">${slots}</div>
          <div class="tr-collection-head"><span>${collection.length} OWNED · ${data.pokedex.caught.length} SPECIES CAUGHT</span><span>One tower per Pokémon on the field. Catch duplicates to field more.</span></div>
          <div class="tr-collection">${cards || '<p class="tr-empty">No Pokémon yet.</p>'}</div>
          <div class="tr-footer">
            <button class="stadium-btn" data-back>${options.map ? 'BACK TO COURSES' : 'DONE'}</button>
            ${options.onConfirm ? `<button class="stadium-btn active tr-confirm" data-confirm ${teamCount ? '' : 'disabled'}>${teamCount ? `START MATCH · ${teamCount}/${TEAM_SIZE}` : 'ADD A POKÉMON'}</button>` : ''}
          </div>
        </section>`;
      this.mountModels(this.root.querySelector('.tr-slots')!);
      this.root.querySelector(scrollKey)!.scrollTop = scroll;

      this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button =>
        button.addEventListener('click', () => this.store.setTeamSlot(Number(button.dataset.slot), null)));
      this.root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(button =>
        button.addEventListener('click', () => {
          if (!this.store.toggleTeam(button.dataset.toggle!)) this.flash('TEAM IS FULL · REMOVE ONE FIRST');
        }));
      this.root.querySelectorAll<HTMLButtonElement>('[data-info]').forEach(button =>
        button.addEventListener('click', () => this.openSummary(button.dataset.info!)));
      this.root.querySelector('[data-back]')!.addEventListener('click', () => {
        this.close();
        options.onBack();
      });
      this.root.querySelector('[data-confirm]')?.addEventListener('click', () => {
        if (!this.store.team.length) return;
        this.close();
        options.onConfirm!();
      });
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
              <h3>MOVE LINES</h3>
              ${species.lines.map(line => `<div class="tr-line"><span class="tr-line-label">${line.label}</span>
                ${line.tiers.map(tier => {
                  const move = MOVES[tier.moveId];
                  const locked = (tier.requiresLevel ?? 0) > pokemon.level;
                  return `<span class="tr-tier ${locked ? 'locked' : ''}"><b>${move.name}</b><small>${tier.cost ? `$${tier.cost}` : 'FREE'}${tier.requiresLevel ? ` · LV ${tier.requiresLevel}` : ''}</small></span>`;
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
