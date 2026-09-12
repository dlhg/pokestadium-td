/**
 * DevPanel.ts — Progression Cheats for Development
 *
 * Toggled with the backquote key (`) or the DEV tab. Grants Pokémon, sets
 * levels, wipes the save, and tops up the match in progress. Only mounted in
 * dev builds or with `?dev` in the URL.
 */

import type { StadiumTDGame } from '../StadiumTDGame';
import { SPECIES, STARTER_IDS, GIFT_ID } from './Species';
import { MAX_LEVEL } from './Stats';
import { createPokemon, displayName, TrainerStore } from './TrainerStore';
import './trainer.css';

export class DevPanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private status: HTMLElement;
  private resetArmed = 0;

  constructor(container: HTMLElement, private game: StadiumTDGame, private store: TrainerStore) {
    this.root = document.createElement('div');
    this.root.id = 'dev-panel';
    this.root.className = 'interactive collapsed';
    this.root.innerHTML = `
      <button class="dev-tab" data-dev="toggle" title="Dev panel (\`)">DEV</button>
      <div class="dev-body">
        <div class="dev-head"><strong>DEV PANEL</strong><span class="dev-status" aria-live="polite"></span></div>

        <fieldset><legend>COLLECTION</legend>
          <div class="dev-row">
            <select data-field="species">${Object.values(SPECIES).map(s => `<option value="${s.id}">${s.forms.map(f => f.name).join(' / ')}</option>`).join('')}</select>
          </div>
          <div class="dev-row">
            <label>LV <input data-field="level" type="number" min="1" max="${MAX_LEVEL}" value="10"></label>
            <button data-dev="add">ADD</button>
            <button data-dev="add-all">ADD ALL SPECIES</button>
          </div>
          <div class="dev-row">
            <button data-dev="team-level">SET TEAM TO LV</button>
            <button data-dev="all-level">SET ALL TO LV</button>
            <button data-dev="max-all">MAX EVERYONE</button>
          </div>
          <div class="dev-row">
            <button data-dev="skip-starter">SKIP STARTER PICK</button>
            <button data-dev="auto-team">AUTO TEAM (TOP 6)</button>
          </div>
        </fieldset>

        <fieldset><legend>MATCH</legend>
          <div class="dev-row">
            <button data-dev="money">+$1000</button>
            <button data-dev="balls">+5 BALLS EACH</button>
            <button data-dev="lives">REFILL HP</button>
          </div>
          <div class="dev-row">
            <button data-dev="xp">+1000 XP TO FIELD</button>
            <button data-dev="level-field">+5 LV TO FIELD</button>
          </div>
          <div class="dev-row">
            <label class="dev-check"><input type="checkbox" data-field="always-catch"> ALWAYS CATCH</label>
          </div>
        </fieldset>

        <fieldset><legend>SAVE</legend>
          <div class="dev-row">
            <button data-dev="luck-up">LUCK +1</button>
            <button data-dev="luck-reset">LUCK 0</button>
            <button data-dev="clear-maps">CLEAR COURSE RECORDS</button>
          </div>
          <div class="dev-row">
            <button data-dev="log">LOG SAVE</button>
            <button class="danger" data-dev="reset">RESET ALL PROGRESS</button>
          </div>
          <div class="dev-summary"></div>
        </fieldset>
      </div>`;
    container.appendChild(this.root);
    this.body = this.root.querySelector('.dev-body')!;
    this.status = this.root.querySelector('.dev-status')!;

    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-dev]');
      if (button) this.run(button.dataset.dev!);
    });
    this.root.querySelector<HTMLInputElement>('[data-field="always-catch"]')!.addEventListener('change', (event) => {
      this.game.devAlwaysCatch = (event.target as HTMLInputElement).checked;
      this.say(this.game.devAlwaysCatch ? 'Every throw catches' : 'Normal catch odds');
    });
    // Keys typed into the panel's fields stay out of the game.
    this.body.addEventListener('keydown', event => event.stopPropagation());
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Backquote' || (event.target as HTMLElement).closest?.('input, select, textarea')) return;
      this.toggle();
    });
    store.subscribe(() => this.refreshSummary());
    this.refreshSummary();
  }

  private toggle(): void {
    this.root.classList.toggle('collapsed');
  }

  private get level(): number {
    const value = Number(this.root.querySelector<HTMLInputElement>('[data-field="level"]')!.value);
    return Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(value) ? value : 10));
  }

  private say(message: string): void {
    this.status.textContent = message;
  }

  private run(action: string): void {
    const { store, game } = this;
    const origin = { kind: 'dev' as const, at: Date.now() };
    switch (action) {
      case 'toggle':
        return this.toggle();
      case 'add': {
        const speciesId = this.root.querySelector<HTMLSelectElement>('[data-field="species"]')!.value;
        const pokemon = createPokemon(speciesId, this.level, origin);
        store.add(pokemon);
        store.commit();
        return this.say(`Added ${displayName(pokemon)} Lv ${pokemon.level}`);
      }
      case 'add-all':
        Object.keys(SPECIES).forEach(id => store.add(createPokemon(id, this.level, origin)));
        store.commit();
        return this.say(`Added ${Object.keys(SPECIES).length} Pokémon at Lv ${this.level}`);
      case 'team-level':
        store.team.forEach(p => store.setLevel(p, this.level));
        return this.afterLevels(`Team set to Lv ${this.level}`);
      case 'all-level':
        store.data.collection.forEach(p => store.setLevel(p, this.level));
        return this.afterLevels(`Everyone set to Lv ${this.level}`);
      case 'max-all':
        store.data.collection.forEach(p => store.setLevel(p, MAX_LEVEL));
        return this.afterLevels(`Everyone at Lv ${MAX_LEVEL}`);
      case 'skip-starter':
        if (!store.data.starterChosen) {
          [...STARTER_IDS, GIFT_ID].forEach(id => store.add(createPokemon(id, 5, origin)));
          store.data.starterChosen = true;
          store.commit();
          // The starter screen is mid-flow; reload so every screen starts clean.
          window.location.reload();
          return;
        }
        return this.say('Starter already chosen');
      case 'auto-team': {
        const top = [...store.data.collection].sort((a, b) => b.level - a.level).slice(0, 6);
        store.data.team = Array.from({ length: 6 }, (_, i) => top[i]?.uid ?? null);
        store.commit();
        return this.say('Team set to the six highest levels');
      }
      case 'money':
        game.money += 1000;
        return this.say('+$1000');
      case 'balls':
        game.balls.poke += 5; game.balls.great += 5; game.balls.ultra += 5;
        return this.say('+5 of every ball');
      case 'lives':
        game.lives = 6;
        return this.say('Stadium HP refilled');
      case 'xp':
      case 'level-field': {
        if (!game.towers.length) return this.say('No towers on the field');
        game.towers.forEach(tower => {
          if (action === 'xp') store.gainXp(tower.pokemon, 1000);
          else store.setLevel(tower.pokemon, tower.pokemon.level + 5);
        });
        return this.afterLevels(action === 'xp' ? '+1000 XP to every placed tower' : '+5 levels to every placed tower');
      }
      case 'luck-up':
        store.data.captureLuck++;
        store.commit();
        return this.say(`Capture luck ${store.data.captureLuck}`);
      case 'luck-reset':
        store.data.captureLuck = 0;
        store.commit();
        return this.say('Capture luck reset');
      case 'clear-maps':
        store.data.maps = {};
        store.commit();
        return this.say('Course records cleared');
      case 'log':
        console.log('[TrainerSave]', JSON.parse(JSON.stringify(store.data)));
        return this.say('Save logged to console');
      case 'reset': {
        // Two clicks within three seconds; no browser confirm dialog.
        const now = Date.now();
        if (now - this.resetArmed > 3000) {
          this.resetArmed = now;
          return this.say('Click RESET again to wipe everything');
        }
        store.reset();
        window.location.reload();
        return;
      }
    }
  }

  private afterLevels(message: string): void {
    this.store.commit();
    this.game.syncTowers();
    this.say(message);
  }

  private refreshSummary(): void {
    const { data } = this.store;
    this.root.querySelector('.dev-summary')!.textContent =
      `${data.collection.length} owned · team ${data.team.filter(Boolean).length}/6 · luck ${data.captureLuck} · ${data.matchesPlayed} matches`;
  }
}
