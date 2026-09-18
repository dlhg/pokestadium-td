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
/** Catch odds lost per failed attempt since the last success — a gentle
 *  penalty so spamming throws isn't a substitute for a well-timed one. */
export const CAPTURE_MISS_PENALTY_STEP = 0.05;
/** Number of caught Pokémon that may join the current match beyond the team. */
export const MATCH_GUEST_SLOTS = 3;
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
  /** Species-specific progress earned by converting duplicate catches. */
  research: Record<string, number>;
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
    research: {},
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
    // A caught Pokémon keeps the exact form it had in the field, even if its
    // level happens to reach the next evolution's threshold. Without an
    // explicit stage (e.g. dev/starter spawns), fall back to level-based stage.
    stage: options.stage ?? stageForLevel(species, clamped),
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

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

function validSpeciesIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => {
    if (typeof id !== 'string') return false;
    try { getSpecies(id); return true; } catch { return false; }
  }))];
}

/** Tolerates hand-edited or older saves: malformed records are repaired or dropped. */
function migrate(raw: unknown): TrainerSave {
  const base = freshSave();
  if (!raw || typeof raw !== 'object' || (raw as { version?: number }).version !== 1) return base;
  const data = raw as Partial<TrainerSave>;
  const seenUids = new Set<string>();
  const collection = (Array.isArray(data.collection) ? data.collection : []).flatMap((value): OwnedPokemon[] => {
    if (!value || typeof value !== 'object') return [];
    const candidate = value as Partial<OwnedPokemon>;
    if (typeof candidate.uid !== 'string' || !candidate.uid || seenUids.has(candidate.uid)
      || typeof candidate.speciesId !== 'string') return [];
    let species: SpeciesDef;
    try { species = getSpecies(candidate.speciesId); } catch { return []; }
    seenUids.add(candidate.uid);

    const level = finiteInteger(candidate.level, 1, 1, MAX_LEVEL);
    const xp = finiteInteger(candidate.xp, xpForLevel(level), xpForLevel(level), xpForLevel(MAX_LEVEL));
    const dvs = candidate.dvs && typeof candidate.dvs === 'object' ? candidate.dvs : {} as Partial<StatBlock>;
    const record = candidate.record && typeof candidate.record === 'object' ? candidate.record : {} as Partial<OwnedPokemon['record']>;
    const origin = candidate.origin && typeof candidate.origin === 'object' ? candidate.origin : {} as Partial<OwnedPokemon['origin']>;
    const originKinds: OwnedPokemon['origin']['kind'][] = ['starter', 'gift', 'caught', 'dev'];
    const kind = originKinds.includes(origin.kind as OwnedPokemon['origin']['kind']) ? origin.kind! : 'caught';
    const repairedOrigin: OwnedPokemon['origin'] = {
      kind,
      at: finiteInteger(origin.at, 0, 0, Number.MAX_SAFE_INTEGER),
    };
    if (typeof origin.mapId === 'string') repairedOrigin.mapId = origin.mapId;
    if (typeof origin.round === 'number' && Number.isFinite(origin.round)) repairedOrigin.round = Math.max(0, Math.round(origin.round));
    if (origin.ball === 'poke' || origin.ball === 'great' || origin.ball === 'ultra') repairedOrigin.ball = origin.ball;

    return [{
      uid: candidate.uid,
      speciesId: candidate.speciesId,
      stage: finiteInteger(candidate.stage, stageForLevel(species, level), 0, species.forms.length - 1),
      nickname: typeof candidate.nickname === 'string' ? sanitizeNickname(candidate.nickname) : null,
      level,
      xp,
      dvs: {
        attack: finiteInteger(dvs.attack, 8, 0, MAX_DV),
        speed: finiteInteger(dvs.speed, 8, 0, MAX_DV),
        special: finiteInteger(dvs.special, 8, 0, MAX_DV),
      },
      origin: repairedOrigin,
      record: {
        knockouts: finiteInteger(record.knockouts, 0, 0, Number.MAX_SAFE_INTEGER),
        damageDealt: finiteInteger(record.damageDealt, 0, 0, Number.MAX_SAFE_INTEGER),
        matches: finiteInteger(record.matches, 0, 0, Number.MAX_SAFE_INTEGER),
      },
    }];
  });
  const owned = new Set(collection.map(p => p.uid));
  const team = Array.from({ length: TEAM_SIZE }, (_, i) => {
    const uid = data.team?.[i];
    return uid && owned.has(uid) ? uid : null;
  });
  const maps: Record<string, MapRecord> = {};
  if (data.maps && typeof data.maps === 'object') {
    for (const [id, value] of Object.entries(data.maps)) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Partial<MapRecord>;
      maps[id] = {
        cleared: record.cleared === true,
        bestRound: finiteInteger(record.bestRound, 0, 0, Number.MAX_SAFE_INTEGER),
      };
    }
  }
  const pokedex = data.pokedex && typeof data.pokedex === 'object' ? data.pokedex : base.pokedex;
  const research: Record<string, number> = {};
  if (data.research && typeof data.research === 'object') {
    for (const [speciesId, value] of Object.entries(data.research)) {
      try {
        getSpecies(speciesId);
        const points = finiteInteger(value, 0, 0, Number.MAX_SAFE_INTEGER);
        if (points > 0) research[speciesId] = points;
      } catch { /* Ignore research for species removed from the build. */ }
    }
  }
  return {
    version: 1,
    starterChosen: data.starterChosen === true,
    collection,
    team,
    maps,
    pokedex: { seen: validSpeciesIds(pokedex.seen), caught: validSpeciesIds(pokedex.caught) },
    captureLuck: finiteInteger(data.captureLuck, 0, 0, Number.MAX_SAFE_INTEGER),
    matchesPlayed: finiteInteger(data.matchesPlayed, 0, 0, Number.MAX_SAFE_INTEGER),
    unlocks: Array.isArray(data.unlocks) ? [...new Set(data.unlocks.filter((item): item is string => typeof item === 'string'))] : [],
    research,
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
  public add(pokemon: OwnedPokemon, addToTeam = true): void {
    this.data.collection.push(pokemon);
    if (addToTeam) {
      const open = this.data.team.indexOf(null);
      if (open !== -1) this.data.team[open] = pokemon.uid;
    }
    this.markCaught(pokemon.speciesId);
  }

  public hasSpecies(speciesId: string): boolean {
    return this.data.collection.some(pokemon => pokemon.speciesId === speciesId);
  }

  /** Duplicate catches grant diminishing species-specific research. */
  public convertDuplicate(speciesId: string): number {
    const prior = this.data.research[speciesId] ?? 0;
    const ownedCopies = this.data.collection.filter(pokemon => pokemon.speciesId === speciesId).length;
    const points = ownedCopies === 1 ? 3 : ownedCopies === 2 ? 2 : 1;
    this.data.research[speciesId] = prior + points;
    this.markCaught(speciesId);
    return points;
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

  /** Puts everyone not yet on the team into the open slots, in collection order. */
  public fillTeam(): void {
    for (const pokemon of this.data.collection) {
      const open = this.data.team.indexOf(null);
      if (open === -1) break;
      if (!this.data.team.includes(pokemon.uid)) this.data.team[open] = pokemon.uid;
    }
    this.commit();
  }

  public clearTeam(): void {
    this.data.team = this.data.team.map(() => null);
    this.commit();
  }

  /** Removes a Pokémon from the active team while keeping it in the collection. */
  public sendToStorage(uid: string): void {
    if (!this.data.team.includes(uid)) return;
    this.data.team = this.data.team.map(slot => (slot === uid ? null : slot));
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
   * `cap` is the cup's level cap: XP stops there for the rest of the match.
   */
  public gainXp(pokemon: OwnedPokemon, amount: number, cap = MAX_LEVEL): XpResult {
    const ceiling = Math.min(MAX_LEVEL, cap);
    if (amount <= 0 || pokemon.level >= ceiling) return { levelsGained: 0, evolvedFrom: null };
    pokemon.xp = Math.min(xpForLevel(ceiling), pokemon.xp + amount);
    return this.syncLevel(pokemon);
  }

  public setLevel(pokemon: OwnedPokemon, level: number): XpResult {
    const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
    pokemon.xp = xpForLevel(clamped);
    pokemon.level = clamped;
    return this.syncLevel(pokemon, true);
  }

  private syncLevel(pokemon: OwnedPokemon, forceEvolutionSync = false): XpResult {
    const before = pokemon.level;
    const beforeName = formOf(pokemon).name;
    pokemon.level = Math.max(pokemon.level, levelForXp(pokemon.xp));
    // Wild Pokemon can legitimately be caught above an evolution threshold.
    // Preserve that exact form until it actually levels up; otherwise even a
    // single point of XP would undo the explicit capture stage.
    const stage = forceEvolutionSync || pokemon.level > before
      ? Math.max(pokemon.stage, stageForLevel(speciesOf(pokemon), pokemon.level))
      : pokemon.stage;
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

  public get captureMissPenalty(): number {
    return this.data.captureLuck * CAPTURE_MISS_PENALTY_STEP;
  }
}
