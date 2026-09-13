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
import { RETRO_CONTROLS, RETRO_PRESET_LABELS, type RetroControl } from '../../engine/RetroFX';
import './trainer.css';

function retroControlHtml(control: RetroControl): string {
  const attr = `data-retro="${control.key}"`;
  if (control.kind === 'check') {
    return `<div class="dev-row"><label class="dev-check"><input type="checkbox" ${attr}> ${control.label}</label></div>`;
  }
  if (control.kind === 'select') {
    const options = control.options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    return `<label class="dev-volume dev-retro-row">${control.label} <select ${attr}>${options}</select></label>`;
  }
  return `<label class="dev-volume dev-retro-row">${control.label}
    <input type="range" ${attr} min="${control.min}" max="${control.max}" step="${control.step}">
    <span class="dev-retro-value" data-retro-value="${control.key}"></span></label>`;
}

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

        <fieldset><legend>MUSIC LAB</legend>
          <div class="dev-row">
            <select data-field="music" aria-label="Music track"><option value="">Loading local tracks…</option></select>
          </div>
          <div class="dev-row">
            <button data-dev="music-play">PLAY LOOP</button>
            <button data-dev="music-stop">STOP</button>
          </div>
          <label class="dev-volume">VOLUME <input data-field="music-volume" type="range" min="0" max="100" value="45"></label>
          <div class="dev-summary dev-music-note">Optional local ROM extraction only; no tracks are bundled.</div>
        </fieldset>

        <fieldset class="dev-retro"><legend>RETRO FX</legend>
          <div class="dev-row">
            <select data-field="retro-preset" aria-label="Retro preset">
              ${Object.entries(RETRO_PRESET_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
              <option value="custom" disabled>Custom</option>
            </select>
          </div>
          ${RETRO_CONTROLS.map(retroControlHtml).join('')}
          <div class="dev-summary">Curvature bends the picture but not the HUD or click picking.</div>
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
    game.audio.onMusicCatalogChanged = () => this.refreshMusicTracks();
    game.audio.prepare();
    this.refreshMusicTracks();

    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-dev]');
      if (button) this.run(button.dataset.dev!);
    });
    this.root.querySelector<HTMLInputElement>('[data-field="always-catch"]')!.addEventListener('change', (event) => {
      this.game.devAlwaysCatch = (event.target as HTMLInputElement).checked;
      this.say(this.game.devAlwaysCatch ? 'Every throw catches' : 'Normal catch odds');
    });
    this.root.querySelector<HTMLInputElement>('[data-field="music-volume"]')!.addEventListener('input', (event) => {
      this.game.audio.setMusicVolume(Number((event.target as HTMLInputElement).value) / 100);
    });
    this.bindRetro();
    // Keys typed into the panel's fields stay out of the game.
    this.body.addEventListener('keydown', event => event.stopPropagation());
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Backquote' || (event.target as HTMLElement).closest?.('input, select, textarea')) return;
      this.toggle();
    });
    store.subscribe(() => this.refreshSummary());
    this.refreshSummary();
  }

  private bindRetro(): void {
    const retro = this.game.renderer.retro;
    const fieldset = this.root.querySelector<HTMLElement>('.dev-retro')!;
    const preset = fieldset.querySelector<HTMLSelectElement>('[data-field="retro-preset"]')!;

    preset.addEventListener('change', () => {
      retro.usePreset(preset.value);
      this.syncRetro();
      this.say(`Retro: ${RETRO_PRESET_LABELS[preset.value]}`);
    });
    fieldset.addEventListener('input', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>('[data-retro]');
      if (!input) return;
      const control = RETRO_CONTROLS.find(c => c.key === input.dataset.retro)!;
      const value = control.kind === 'check' ? (input as HTMLInputElement).checked
        : control.kind === 'range' || control.key === 'resolution' ? Number(input.value)
        : input.value;
      retro.set(control.key, value as never);
      this.syncRetro();
    });
    this.syncRetro();
  }

  private syncRetro(): void {
    const { settings, preset } = this.game.renderer.retro;
    this.root.querySelector<HTMLSelectElement>('[data-field="retro-preset"]')!.value = preset;
    for (const control of RETRO_CONTROLS) {
      const input = this.root.querySelector<HTMLInputElement>(`[data-retro="${control.key}"]`)!;
      const value = settings[control.key];
      if (control.kind === 'check') input.checked = Boolean(value);
      else input.value = String(value);
      const readout = this.root.querySelector(`[data-retro-value="${control.key}"]`);
      if (readout) readout.textContent = String(value);
    }
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
      case 'music-play': {
        const id = this.root.querySelector<HTMLSelectElement>('[data-field="music"]')!.value;
        if (!id) return this.say('No local music tracks found');
        this.game.audio.startMusic(id);
        return this.say(`Playing ${this.musicLabel(id)}`);
      }
      case 'music-stop':
        this.game.audio.stopMusic();
        return this.say('Music stopped');
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

  private refreshMusicTracks(): void {
    const select = this.root.querySelector<HTMLSelectElement>('[data-field="music"]');
    if (!select) return;
    const current = select.value;
    const tracks = this.game.audio.getMusicTracks();
    select.innerHTML = tracks.length
      ? tracks.map(id => `<option value="${id}">${this.musicLabel(id)}</option>`).join('')
      : '<option value="">No local music manifest</option>';
    if (tracks.includes(current)) select.value = current;
  }

  private musicLabel(id: string): string {
    return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }
}
