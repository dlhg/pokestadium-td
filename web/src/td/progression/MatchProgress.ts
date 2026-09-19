/**
 * MatchProgress.ts — XP Awards Within One Match
 *
 * XP is paid only when a creep faints, from a fixed pool per creep split by
 * who helped: damage dealt plus credit for statuses landed. A leaked creep
 * pays nothing, and a titan cannot be farmed for damage. Clearing a wave pays
 * every placed tower a small share of that wave's pool on top.
 *
 * It also remembers where each Pokémon started, for the match report.
 */

import type { Creep } from '../Creep';
import type { Tower } from '../Tower';
import { getSpecies, speciesForCreepName } from './Species';
import { knockoutPool, levelScale, MAX_LEVEL, WAVE_CLEAR_SHARE } from './Stats';
import type { CupRules } from '../Cups';
import { isRental } from './Rentals';
import { formOf, OwnedPokemon, TrainerStore, XpResult } from './TrainerStore';

/** XP yield for creeps with no species entry (new roster names added later). */
const FALLBACK_EXP_YIELD = 60;

export interface XpAward {
  tower: Tower;
  amount: number;
  result: XpResult;
}

export interface MatchReportEntry {
  pokemon: OwnedPokemon;
  xpGained: number;
  levelFrom: number;
  formFrom: string;
  knockouts: number;
  caughtThisMatch: boolean;
  /** A loaner: its XP is shown but goes back with it. */
  rental: boolean;
  /** The cup this match passed the Pokémon beyond, e.g. 'LITTLE CUP'. */
  graduatedFrom: string | null;
}

interface Baseline {
  /** Rentals aren't in the store, so the report keeps hold of them directly. */
  pokemon: OwnedPokemon;
  xp: number;
  level: number;
  form: string;
  knockouts: number;
  caught: boolean;
}

export class MatchProgress {
  private baselines = new Map<string, Baseline>();
  private wavePool = 0;
  private waveLevel = 1;
  private cup: CupRules | null = null;

  constructor(private store: TrainerStore) {}

  /** The cup's level cap holds for everyone this match; without a cup, only MAX_LEVEL does. */
  public start(team: OwnedPokemon[], cup: CupRules | null = null): void {
    this.baselines.clear();
    this.wavePool = 0;
    this.cup = cup;
    team.forEach(pokemon => this.track(pokemon, false));
  }

  /** A mid-match catch joins the report from the level it was caught at. */
  public track(pokemon: OwnedPokemon, caught: boolean): void {
    if (this.baselines.has(pokemon.uid)) return;
    this.baselines.set(pokemon.uid, {
      pokemon, xp: pokemon.xp, level: pokemon.level, form: formOf(pokemon).name, knockouts: pokemon.record.knockouts, caught,
    });
  }

  public awardKnockout(creep: Creep, towers: Tower[]): XpAward[] {
    const match = speciesForCreepName(creep.name);
    const expYield = match ? getSpecies(match.speciesId).expYield : FALLBACK_EXP_YIELD;
    const pool = knockoutPool(expYield, creep.level, creep.threat);
    this.wavePool += pool;
    this.waveLevel = creep.level;

    // Only towers still on the pitch collect; a sold tower forfeits its share.
    const placed = new Set(towers);
    const shares = [...creep.contributors].filter(([tower]) => placed.has(tower));
    const total = shares.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) return [];

    let finisher: Tower | null = null;
    let best = 0;
    const awards = shares.map(([tower, weight]) => {
      if (weight > best) { best = weight; finisher = tower; }
      tower.pokemon.record.damageDealt += Math.round(weight);
      return this.give(tower, pool * (weight / total) * levelScale(tower.level, creep.level));
    });
    if (finisher) (finisher as Tower).pokemon.record.knockouts++;
    return awards;
  }

  public awardWaveClear(towers: Tower[]): XpAward[] {
    const pool = this.wavePool * WAVE_CLEAR_SHARE;
    this.wavePool = 0;
    if (pool <= 0) return [];
    return towers.map(tower => this.give(tower, pool * levelScale(tower.level, this.waveLevel)));
  }

  private give(tower: Tower, raw: number): XpAward {
    const amount = Math.max(1, Math.round(raw));
    return { tower, amount, result: this.store.gainXp(tower.pokemon, amount, this.cup?.levelCap ?? MAX_LEVEL) };
  }

  public report(): MatchReportEntry[] {
    return [...this.baselines].flatMap(([uid, base]) => {
      const rental = isRental(base.pokemon);
      const pokemon = rental ? base.pokemon : this.store.get(uid);
      if (!pokemon) return [];
      return [{
        pokemon,
        xpGained: pokemon.xp - base.xp,
        levelFrom: base.level,
        formFrom: base.form,
        knockouts: pokemon.record.knockouts - base.knockouts,
        caughtThisMatch: base.caught,
        rental,
        // Rentals go back, so only your own Pokémon graduate.
        graduatedFrom: this.cup && !rental && base.level <= this.cup.entryMax && pokemon.level > this.cup.entryMax
          ? this.cup.name : null,
      }];
    });
  }
}
