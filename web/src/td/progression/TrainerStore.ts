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
import { VARIANTS, VariantTag } from './Variants';

export const TEAM_SIZE = 6;
export const NICKNAME_MAX = 10;
/** The long-term collection goal, including species not yet authored as towers. */
export const POKEDEX_TOTAL = 151;
/** While the collection is smaller than this, the last ball in hand always catches. */
export const GUARANTEED_CATCH_BELOW = 4;
/** Catch odds lost per failed attempt since the last success — a gentle
 *  penalty so spamming throws isn't a substitute for a well-timed one. */
export const CAPTURE_MISS_PENALTY_STEP = 0.05;
/** Number of caught Pokémon that may join the current match beyond the team. */
export const MATCH_GUEST_SLOTS = 3;
/**
 * Hard ceiling on owned Pokémon. The save lives in localStorage, which fails
 * silently once it fills, so the collection gets a stated limit well under
 * that: at the cap, catches can still be converted to research, and the
 * collection screen offers release. A save that arrives over the cap (an old
 * save, or the dev panel) is left intact — only new additions are refused.
 */
export const STORAGE_MAX = 1000;
const STORAGE_KEY = 'pokestadium-td/save';

/**
 * Research earned by parting with one Pokémon, given how many copies of that
 * species are kept. Rarer species are worth more, so the first duplicate pays
 * best and a hoard of the same species pays least.
 */
export function researchPointsFor(copiesKept: number): number {
  return copiesKept <= 1 ? 3 : copiesKept === 2 ? 2 : 1;
}

export interface OwnedPokemon {
  uid: string;
  speciesId: string;
  stage: number;
  nickname: string | null;
  level: number;
  /** Total XP, not progress into the current level. */
  xp: number;
  dvs: StatBlock;
  /** Set when this catch was something special (a Titan encounter, etc.); see Variants.ts. */
  variant?: VariantTag;
  /** 'rental' Pokémon are loaners from Rentals.ts and never enter the collection or the save. */
  origin: { kind: 'starter' | 'gift' | 'caught' | 'dev' | 'rental'; mapId?: string; round?: number; ball?: BallType; at: number };
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
  options: { stage?: number; nickname?: string | null; dvs?: StatBlock; variant?: VariantTag } = {},
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
    dvs: options.dvs ?? (options.variant ? VARIANTS[options.variant.kind].dvOverride : { attack: randomDv(), speed: randomDv(), special: randomDv() }),
    variant: options.variant,
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

/** Pokédex entries are form-specific (`gastly:1` is Haunter), while owned
 *  Pokémon and research remain evolution-line based (`gastly`). */
function pokedexEntry(speciesId: string, stage = 0): string {
  const species = getSpecies(speciesId);
  const safeStage = Math.max(0, Math.min(species.forms.length - 1, Math.round(stage)));
  return `${speciesId}:${safeStage}`;
}

function validPokedexEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry): string[] => {
    if (typeof entry !== 'string') return [];
    const separator = entry.lastIndexOf(':');
    const speciesId = separator === -1 ? entry : entry.slice(0, separator);
    const stage = separator === -1 ? 0 : Number(entry.slice(separator + 1));
    try {
      const species = getSpecies(speciesId);
      if (!Number.isInteger(stage) || stage < 0 || stage >= species.forms.length) return [];
      return [pokedexEntry(speciesId, stage)];
    } catch { return []; }
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

    const variantKind = candidate.variant?.kind;
    const variant: OwnedPokemon['variant'] = variantKind && variantKind in VARIANTS ? { kind: variantKind } : undefined;

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
      variant,
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
  const caughtEntries = new Set(validPokedexEntries(pokedex.caught));
  // Old v1 saves stored only an evolution-line id. Preserve that base-form
  // registration, and also register the exact form the player demonstrably
  // owns so an upgraded save never labels its own Pokémon as undiscovered.
  collection.forEach(pokemon => caughtEntries.add(pokedexEntry(pokemon.speciesId, pokemon.stage)));
  const seenEntries = new Set([...validPokedexEntries(pokedex.seen), ...caughtEntries]);
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
    pokedex: { seen: [...seenEntries], caught: [...caughtEntries] },
    captureLuck: finiteInteger(data.captureLuck, 0, 0, Number.MAX_SAFE_INTEGER),
    matchesPlayed: finiteInteger(data.matchesPlayed, 0, 0, Number.MAX_SAFE_INTEGER),
    unlocks: Array.isArray(data.unlocks) ? [...new Set(data.unlocks.filter((item): item is string => typeof item === 'string'))] : [],
    research,
  };
}

export class TrainerStore {
  public data: TrainerSave;
  /**
   * Species loaned out in team select for the next match. Each match builds
   * fresh rentals from these, so a retry doesn't inherit last match's levels.
   * Session-only: never part of `data`, so never saved.
   */
  public rentalPicks: string[] = [];
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

  /** Owned Pokémon against the storage ceiling. */
  public get storageUsed(): number {
    return this.data.collection.length;
  }

  public get storageSpace(): number {
    return Math.max(0, STORAGE_MAX - this.data.collection.length);
  }

  public get isStorageFull(): boolean {
    return this.storageSpace === 0;
  }

  /**
   * Adds to the collection and drops into the first open team slot, if there
   * is one. Returns false when storage is full and nothing was kept — callers
   * offer research instead.
   */
  public add(pokemon: OwnedPokemon, addToTeam = true): boolean {
    if (this.isStorageFull) return false;
    this.data.collection.push(pokemon);
    if (addToTeam) {
      const open = this.data.team.indexOf(null);
      if (open !== -1) this.data.team[open] = pokemon.uid;
    }
    this.markCaught(pokemon.speciesId, pokemon.stage);
    return true;
  }

  public hasSpecies(speciesId: string): boolean {
    return this.data.collection.some(pokemon => pokemon.speciesId === speciesId);
  }

  /** Permanent registration state, unlike `hasSpecies`, which only asks what
   *  is owned right now and becomes false when the last copy is released. */
  public hasCaughtSpecies(speciesId: string, stage: number): boolean {
    return this.data.pokedex.caught.includes(pokedexEntry(speciesId, stage));
  }

  public get caughtSpeciesCount(): number {
    return this.data.pokedex.caught.length;
  }

  /** Duplicate catches grant diminishing species-specific research. */
  public convertDuplicate(speciesId: string, stage = 0): number {
    return this.awardResearch(speciesId, this.copiesOf(speciesId), stage);
  }

  private copiesOf(speciesId: string): number {
    return this.data.collection.filter(pokemon => pokemon.speciesId === speciesId).length;
  }

  private awardResearch(speciesId: string, copiesKept: number, stage: number): number {
    const points = researchPointsFor(copiesKept);
    this.data.research[speciesId] = (this.data.research[speciesId] ?? 0) + points;
    this.markCaught(speciesId, stage);
    return points;
  }

  /** What releasing this Pokémon would pay, so a card can show it before asking. */
  public researchValue(uid: string): number {
    const pokemon = this.get(uid);
    return pokemon ? researchPointsFor(this.copiesOf(pokemon.speciesId) - 1) : 0;
  }

  /** The last Pokémon standing can't be released — that would strand the trainer. */
  public canRelease(uid: string): boolean {
    return this.data.collection.length > 1 && !!this.get(uid);
  }

  /**
   * Sends an owned Pokémon to the Professor: it leaves the collection (and any
   * team slot) for good and its species banks research. Returns the points
   * earned, or null when the release was refused.
   */
  public releaseForResearch(uid: string): number | null {
    const pokemon = this.get(uid);
    if (!pokemon || !this.canRelease(uid)) return null;
    const points = this.awardResearch(pokemon.speciesId, this.copiesOf(pokemon.speciesId) - 1, pokemon.stage);
    this.release(uid);
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

  public markSeen(speciesId: string, stage = 0): void {
    const entry = pokedexEntry(speciesId, stage);
    if (!this.data.pokedex.seen.includes(entry)) this.data.pokedex.seen.push(entry);
  }

  public markCaught(speciesId: string, stage = 0): void {
    const entry = pokedexEntry(speciesId, stage);
    this.markSeen(speciesId, stage);
    if (!this.data.pokedex.caught.includes(entry)) this.data.pokedex.caught.push(entry);
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
    if (evolved) this.markCaught(pokemon.speciesId, pokemon.stage);
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
