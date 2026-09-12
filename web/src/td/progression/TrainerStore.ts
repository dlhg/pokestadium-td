/**
 * TrainerStore.ts — The Player's Persistent Collection
 *
 * Everything that survives between matches: each owned Pokémon with its
 * nickname, level, XP, DVs and evolution stage; the team of six; course
 * records; and the capture safety net. Match state (money, placed towers,
 * bought tiers) never lives here.
 *
 * Saves go to localStorage under a versioned key. Every read and write is
 * guarded, so a blocked or corrupt store degrades to a fresh in-memory save.
 */

import type { BallType } from '../CaptureSequence';
import { GIFT_ID, getSpecies, SpeciesDef, SpeciesForm, stageForLevel } from './Species';
import { levelForXp, MAX_DV, MAX_LEVEL, StatBlock, xpForLevel, computeStats } from './Stats';

export const TEAM_SIZE = 6;
export const NICKNAME_MAX = 10;
/** While the collection is smaller than this, the last ball in hand always catches. */
export const GUARANTEED_CATCH_BELOW = 4;
/** Catch odds added per failed attempt since the last success. */
export const CAPTURE_LUCK_STEP = 0.12;

const STORAGE_KEY = 'pokestadium-td/save';

export interface OwnedPokemon {
  uid: string;
  speciesId: string;
  stage: number;
  nickname: string | null;
  level: number;
  /** Total XP, not progress into the current level. */
  xp: number;
  dvs: StatBlock;
  origin: { kind: 'starter' | 'gift' | 'caught' | 'dev'; mapId?: string; round?: number; ball?: BallType; at: number };
  record: { knockouts: number; damageDealt: number; matches: number };
}

export interface MapRecord {
  cleared: boolean;
  bestRound: number;
}

export interface TrainerSave {
  version: 1;
  starterChosen: boolean;
  collection: OwnedPokemon[];
  team: (string | null)[];
  maps: Record<string, MapRecord>;
  pokedex: { seen: string[]; caught: string[] };
  /** Failed capture attempts since the last catch. */
  captureLuck: number;
  matchesPlayed: number;
  /** Unlockable perks, e.g. 'exp_all'. Empty in v1. */
  unlocks: string[];
}

export interface XpResult {
  levelsGained: number;
  evolvedFrom: string | null;
}

export function freshSave(): TrainerSave {
  return {
    version: 1,
    starterChosen: false,
    collection: [],
    team: Array(TEAM_SIZE).fill(null),
    maps: {},
    pokedex: { seen: [], caught: [] },
    captureLuck: 0,
    matchesPlayed: 0,
    unlocks: [],
  };
}

function randomDv(): number {
  return Math.floor(Math.random() * (MAX_DV + 1));
}

export function createPokemon(
  speciesId: string,
  level: number,
  origin: OwnedPokemon['origin'],
  options: { stage?: number; nickname?: string | null; dvs?: StatBlock } = {},
): OwnedPokemon {
  const species = getSpecies(speciesId);
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  return {
    uid: `pkmn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    speciesId,
    // A caught evolved form keeps its form even below that form's evolution level.
    stage: Math.max(options.stage ?? 0, stageForLevel(species, clamped)),
    nickname: options.nickname ?? null,
    level: clamped,
    xp: xpForLevel(clamped),
    dvs: options.dvs ?? { attack: randomDv(), speed: randomDv(), special: randomDv() },
    origin,
    record: { knockouts: 0, damageDealt: 0, matches: 0 },
  };
}

export function speciesOf(pokemon: OwnedPokemon): SpeciesDef {
  return getSpecies(pokemon.speciesId);
}

export function formOf(pokemon: OwnedPokemon): SpeciesForm {
  const species = speciesOf(pokemon);
  return species.forms[Math.min(pokemon.stage, species.forms.length - 1)];
}

export function displayName(pokemon: OwnedPokemon): string {
  return pokemon.nickname || formOf(pokemon).name;
}

export function statsOf(pokemon: OwnedPokemon): StatBlock {
  return computeStats(formOf(pokemon).base, pokemon.dvs, pokemon.level);
}

/** The next evolution and the level it lands at, if any. */
export function nextEvolution(pokemon: OwnedPokemon): SpeciesForm | null {
  return speciesOf(pokemon).forms[pokemon.stage + 1] ?? null;
}

export function sanitizeNickname(raw: string): string | null {
  const cleaned = raw.replace(/[^\p{L}\p{N} .'!?♂♀-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
  return cleaned || null;
}

/** Tolerates hand-edited or older saves: unknown species are dropped, gaps are filled. */
function migrate(raw: unknown): TrainerSave {
  const base = freshSave();
  if (!raw || typeof raw !== 'object' || (raw as { version?: number }).version !== 1) return base;
  const data = raw as Partial<TrainerSave>;
  const collection = (Array.isArray(data.collection) ? data.collection : []).filter(p => {
    try { getSpecies(p.speciesId); return true; } catch { return false; }
  });
  const owned = new Set(collection.map(p => p.uid));
  const team = Array.from({ length: TEAM_SIZE }, (_, i) => {
    const uid = data.team?.[i];
    return uid && owned.has(uid) ? uid : null;
  });
  return {
    ...base,
    ...data,
    version: 1,
    collection,
    team,
    maps: data.maps ?? {},
    pokedex: { seen: data.pokedex?.seen ?? [], caught: data.pokedex?.caught ?? [] },
    unlocks: data.unlocks ?? [],
  };
}

export class TrainerStore {
  public data: TrainerSave;
  private listeners = new Set<() => void>();

  /** `persist: false` keeps everything in memory — the headless shot harness uses it. */
  constructor(private readonly persist = true, seed?: TrainerSave) {
    this.data = seed ?? (persist ? this.read() : freshSave());
  }

  private read(): TrainerSave {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? migrate(JSON.parse(raw)) : freshSave();
    } catch {
      return freshSave();
    }
  }

  /** Writes the save and tells every screen that shows it. */
  public commit(): void {
    if (this.persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
    }
    this.listeners.forEach(listener => listener());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public reset(): void {
    this.data = freshSave();
    this.commit();
  }

  public get(uid: string): OwnedPokemon | null {
    return this.data.collection.find(p => p.uid === uid) ?? null;
  }

  public get team(): OwnedPokemon[] {
    return this.data.team.map(uid => (uid ? this.get(uid) : null)).filter((p): p is OwnedPokemon => p !== null);
  }

  /** Adds to the collection and drops into the first open team slot, if there is one. */
  public add(pokemon: OwnedPokemon): void {
    this.data.collection.push(pokemon);
    const open = this.data.team.indexOf(null);
    if (open !== -1) this.data.team[open] = pokemon.uid;
    this.markCaught(pokemon.speciesId);
  }

  public chooseStarter(starterId: string, nickname: string | null, giftNickname: string | null): void {
    this.add(createPokemon(starterId, 5, { kind: 'starter', at: Date.now() }, { nickname }));
    this.add(createPokemon(GIFT_ID, 5, { kind: 'gift', at: Date.now() }, { nickname: giftNickname }));
    this.data.starterChosen = true;
    this.commit();
  }

  public setTeamSlot(slot: number, uid: string | null): void {
    if (uid) {
      const existing = this.data.team.indexOf(uid);
      if (existing !== -1) this.data.team[existing] = this.data.team[slot];
    }
    this.data.team[slot] = uid;
    this.commit();
  }

  /** Toggles a Pokémon on or off the team; returns false when the team is full. */
  public toggleTeam(uid: string): boolean {
    const slot = this.data.team.indexOf(uid);
    if (slot !== -1) {
      this.data.team[slot] = null;
    } else {
      const open = this.data.team.indexOf(null);
      if (open === -1) return false;
      this.data.team[open] = uid;
    }
    this.commit();
    return true;
  }

  public rename(uid: string, raw: string): void {
    const pokemon = this.get(uid);
    if (!pokemon) return;
    pokemon.nickname = sanitizeNickname(raw);
    this.commit();
  }

  public release(uid: string): void {
    this.data.collection = this.data.collection.filter(p => p.uid !== uid);
    this.data.team = this.data.team.map(slot => (slot === uid ? null : slot));
    this.commit();
  }

  public markSeen(speciesId: string): void {
    if (!this.data.pokedex.seen.includes(speciesId)) this.data.pokedex.seen.push(speciesId);
  }

  public markCaught(speciesId: string): void {
    this.markSeen(speciesId);
    if (!this.data.pokedex.caught.includes(speciesId)) this.data.pokedex.caught.push(speciesId);
  }

  /**
   * Adds XP in place (towers hold the same object), levels up, and evolves
   * when a level threshold is crossed. Does not commit — matches save per wave.
   */
  public gainXp(pokemon: OwnedPokemon, amount: number): XpResult {
    if (amount <= 0 || pokemon.level >= MAX_LEVEL) return { levelsGained: 0, evolvedFrom: null };
    pokemon.xp = Math.min(xpForLevel(MAX_LEVEL), pokemon.xp + amount);
    return this.syncLevel(pokemon);
  }

  public setLevel(pokemon: OwnedPokemon, level: number): XpResult {
    const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
    pokemon.xp = xpForLevel(clamped);
    pokemon.level = clamped;
    return this.syncLevel(pokemon);
  }

  private syncLevel(pokemon: OwnedPokemon): XpResult {
    const before = pokemon.level;
    const beforeName = formOf(pokemon).name;
    pokemon.level = Math.max(pokemon.level, levelForXp(pokemon.xp));
    const stage = Math.max(pokemon.stage, stageForLevel(speciesOf(pokemon), pokemon.level));
    const evolved = stage !== pokemon.stage;
    pokemon.stage = stage;
    return { levelsGained: pokemon.level - before, evolvedFrom: evolved ? beforeName : null };
  }

  public recordMap(mapId: string, round: number, cleared: boolean): void {
    const record = this.data.maps[mapId] ?? { cleared: false, bestRound: 0 };
    record.bestRound = Math.max(record.bestRound, round);
    record.cleared = record.cleared || cleared;
    this.data.maps[mapId] = record;
  }

  /** True when this throw must succeed so a new trainer never runs dry. */
  public shouldGuaranteeCatch(ballsLeftAfterThrow: number, threat: 'normal' | 'elite' | 'titan'): boolean {
    return threat !== 'titan' && ballsLeftAfterThrow === 0 && this.data.collection.length < GUARANTEED_CATCH_BELOW;
  }

  public get captureLuckBonus(): number {
    return this.data.captureLuck * CAPTURE_LUCK_STEP;
  }
}
