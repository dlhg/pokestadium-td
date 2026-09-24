/**
 * Finals.ts — Every Course's Hand-Made Final
 *
 * The last five rounds of a match are written by hand for the course they're
 * played on (docs/match-length.md). Every final follows the same five beats,
 * so players learn the rhythm, while what fills each beat belongs to the
 * course: its typing, its lanes, and the Titan it ends on.
 *
 * Groups are exact: `count` is how many reach the lane, each as tough as a
 * procedural creep of the same round. `at` lets groups overlap and `route`
 * pins a group to one entrance, which the procedural rounds never do.
 */

import type { TitanId } from './Titans';

export type FinalBeat = 'showcase' | 'exam' | 'breather' | 'gauntlet' | 'titan';

export const FINAL_BEATS: readonly FinalBeat[] = ['showcase', 'exam', 'breather', 'gauntlet', 'titan'];

export interface FinalGroup {
  /** A roster creep's name, or 'titan' for the course's Titan. */
  creep: string;
  count: number;
  /** Seconds between spawns within the group. */
  interval: number;
  /** Seconds after the round starts. Default: right after the previous group finishes. */
  at?: number;
  /** Pin to one of the course's routes. Default: take turns like any wave. */
  route?: number;
  /** HP over a procedural creep of the same round. Default 1. */
  hp?: number;
  threat?: 'elite';
}

export interface FinalRound {
  beat: FinalBeat;
  name: string;
  groups: FinalGroup[];
  /** Knockout pay multiplier, like a Bounty Round's. */
  payMult?: number;
}

export interface CourseFinal {
  titan: TitanId;
  rounds: readonly [FinalRound, FinalRound, FinalRound, FinalRound, FinalRound];
}

const g = (creep: string, count: number, interval: number, extra: Partial<FinalGroup> = {}): FinalGroup =>
  ({ creep, count, interval, ...extra });
const titan = (extra: Partial<FinalGroup> = {}): FinalGroup => ({ creep: 'titan', count: 1, interval: 1, ...extra });

/** Breathers pay extra: the last chance to buy before the climax. */
const BREATHER_PAY = 1.5;

export const FINALS: Record<string, CourseFinal> = {
  // ---- Little Cup ---------------------------------------------------------
  'open-cup': {
    titan: 'beedrill',
    rounds: [
      { beat: 'showcase', name: 'Forest Stampede', groups: [
        g('Oddish', 8, 1.0), g('Paras', 6, 1.4, { at: 6 }), g('Weedle', 6, 0.8, { at: 12 }),
      ] },
      { beat: 'exam', name: 'Spore Wall', groups: [
        g('Paras', 8, 1.6, { hp: 1.2 }), g('Pidgey', 10, 0.6, { at: 9 }),
      ] },
      { beat: 'breather', name: 'Sunny Clearing', payMult: BREATHER_PAY, groups: [
        g('Weedle', 10, 0.9, { hp: 0.7 }), g('Oddish', 4, 1.2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Elite Grove', groups: [
        g('Zubat', 8, 0.7), g('Oddish', 1, 1, { threat: 'elite', at: 2 }), g('Paras', 1, 1, { threat: 'elite', at: 8 }),
        g('Kakuna', 4, 1.5, { at: 12, hp: 1.4 }),
      ] },
      { beat: 'titan', name: 'The Hive Queen', groups: [
        titan(), g('Weedle', 8, 0.8, { at: 3 }), g('Kakuna', 4, 1.5, { at: 10, hp: 1.5 }),
      ] },
    ],
  },
  'boulder-circuit': {
    titan: 'onix',
    rounds: [
      { beat: 'showcase', name: 'Boulder Rush', groups: [
        g('Geodude', 10, 1.2), g('Machop', 6, 1.0, { at: 8 }),
      ] },
      { beat: 'exam', name: 'Rock Columns', groups: [
        g('Geodude', 8, 0.7, { hp: 1.2 }), g('Graveler', 4, 1.6, { at: 8 }),
      ] },
      { beat: 'breather', name: 'Moonlit Cave', payMult: BREATHER_PAY, groups: [
        g('Zubat', 12, 0.6, { hp: 0.6 }), g('Geodude', 3, 1.4, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Zubat Cloud', groups: [
        g('Zubat', 14, 0.4), g('Machoke', 1, 1, { threat: 'elite', at: 3 }), g('Machop', 6, 1.0, { at: 5 }),
      ] },
      { beat: 'titan', name: 'The Rock Snake', groups: [
        titan(), g('Geodude', 6, 1.0, { at: 2 }), g('Graveler', 4, 1.4, { at: 10 }),
      ] },
    ],
  },
  // ---- Poké Cup -----------------------------------------------------------
  'cerulean-crossing': {
    titan: 'starmie',
    rounds: [
      { beat: 'showcase', name: 'Riverside Rush', groups: [
        g('Psyduck', 8, 1.0), g('Golduck', 4, 1.4, { at: 6 }),
      ] },
      { beat: 'exam', name: 'Twin Bridges', groups: [
        g('Golduck', 6, 0.8), g('Psyduck', 6, 0.8, { at: 12 }),
      ] },
      { beat: 'breather', name: 'Starlit Shallows', payMult: BREATHER_PAY, groups: [
        g('Staryu', 10, 0.8, { hp: 0.7 }), g('Psyduck', 3, 1.2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Ferry Convoy', groups: [
        g('Lapras', 2, 3, { threat: 'elite' }), g('Golduck', 6, 0.8, { at: 2 }),
      ] },
      { beat: 'titan', name: 'The Gem of the Sea', groups: [
        titan(), g('Staryu', 8, 0.8, { at: 2 }), g('Lapras', 2, 2.5, { at: 12 }),
      ] },
    ],
  },
  'power-plant': {
    titan: 'zapdos',
    rounds: [
      { beat: 'showcase', name: 'Power Surge', groups: [
        g('Voltorb', 8, 0.9, { route: 0 }), g('Electrode', 6, 0.9, { route: 1, at: 0 }),
      ] },
      { beat: 'exam', name: 'Both Gates', groups: [
        g('Haunter', 6, 0.9, { route: 0 }), g('Electrode', 8, 0.6, { route: 1, at: 0 }),
      ] },
      { beat: 'breather', name: 'Brownout', payMult: BREATHER_PAY, groups: [
        g('Voltorb', 10, 0.8, { hp: 0.7 }), g('Golbat', 3, 1.2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Overload', groups: [
        g('Electrode', 12, 0.35, { route: 0 }), g('Haunter', 8, 0.9, { route: 1, at: 0 }),
        g('Electrode', 1, 1, { threat: 'elite', route: 0, at: 8 }),
      ] },
      { beat: 'titan', name: 'The Thunderbird', groups: [
        titan({ route: 0 }), g('Electrode', 8, 0.6, { route: 1, at: 0 }), g('Golbat', 6, 0.8, { route: 0, at: 8 }),
      ] },
    ],
  },
  // ---- Great Cup ----------------------------------------------------------
  'indigo-plateau': {
    titan: 'moltres',
    rounds: [
      { beat: 'showcase', name: 'Victory Road', groups: [
        g('Graveler', 8, 1.2), g('Kadabra', 6, 1.0, { at: 6 }),
      ] },
      { beat: 'exam', name: 'Over the Stairs', groups: [
        g('Golbat', 10, 0.6), g('Scyther', 6, 0.8, { at: 6 }),
      ] },
      { beat: 'breather', name: 'Torchlit Rest', payMult: BREATHER_PAY, groups: [
        g('Rapidash', 8, 0.9, { hp: 0.7 }), g('Kadabra', 4, 1.2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'League Gate', groups: [
        g('Kadabra', 8, 0.7), g('Rhydon', 1, 1, { threat: 'elite', at: 2 }), g('Rhydon', 1, 1, { threat: 'elite', at: 10 }),
      ] },
      { beat: 'titan', name: 'The Firebird', groups: [
        titan(), g('Rapidash', 8, 0.8, { at: 2 }), g('Golbat', 6, 0.6, { at: 10 }),
      ] },
    ],
  },
  'bell-tower': {
    titan: 'gengar',
    rounds: [
      { beat: 'showcase', name: 'Pagoda Climb', groups: [
        g('Haunter', 8, 1.0), g('Gloom', 6, 1.2, { at: 6 }),
      ] },
      { beat: 'exam', name: 'Restless Spirits', groups: [
        g('Haunter', 14, 0.6), g('Kadabra', 4, 1.2, { at: 10 }),
      ] },
      { beat: 'breather', name: 'Incense Hall', payMult: BREATHER_PAY, groups: [
        g('Gloom', 8, 1.0, { hp: 0.7 }), g('Golbat', 4, 1.0, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Séance', groups: [
        g('Haunter', 10, 0.5), g('Kadabra', 2, 3, { threat: 'elite', at: 4 }),
      ] },
      { beat: 'titan', name: 'The Shadow in the Bell', groups: [
        titan(), g('Haunter', 8, 0.8, { at: 2 }), g('Kadabra', 4, 1.2, { at: 12 }),
      ] },
    ],
  },
  // ---- Prime Cup ----------------------------------------------------------
  'mt-silver-crown': {
    titan: 'mewtwo',
    rounds: [
      { beat: 'showcase', name: 'Summit Trails', groups: [
        g('Dragonair', 6, 1.4, { route: 1 }), g('Rhydon', 4, 1.6, { route: 0, at: 8 }),
      ] },
      // The east trail is about 40 units longer: its group leaves 8 s early so
      // both arrive at the shared shelf under the summit together.
      { beat: 'exam', name: 'Converging Trails', groups: [
        g('Persian', 8, 0.6, { route: 1 }), g('Golbat', 8, 0.6, { route: 0, at: 8 }),
      ] },
      { beat: 'breather', name: 'Snowfield', payMult: BREATHER_PAY, groups: [
        g('Dragonair', 4, 1.6, { hp: 0.7 }), g('Lapras', 3, 2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: "Dragon's Den", groups: [
        g('Dragonair', 1, 1, { threat: 'elite', route: 1 }), g('Scyther', 8, 0.6, { route: 1, at: 2 }),
        g('Dragonair', 1, 1, { threat: 'elite', route: 0, at: 8 }),
      ] },
      { beat: 'titan', name: 'The Apex', groups: [
        titan({ route: 1 }), g('Dragonair', 4, 2, { route: 1, at: 6 }), g('Kadabra', 6, 0.9, { route: 0, at: 8 }),
      ] },
    ],
  },
  'seafoam-islands': {
    titan: 'articuno',
    rounds: [
      { beat: 'showcase', name: 'Frozen Strait', groups: [
        g('Lapras', 6, 1.8), g('Golduck', 6, 1.0, { at: 4 }),
      ] },
      { beat: 'exam', name: 'Over the Ice', groups: [
        g('Lapras', 8, 1.0, { hp: 1.1 }), g('Golbat', 8, 0.5, { at: 6 }),
      ] },
      { beat: 'breather', name: 'Still Water', payMult: BREATHER_PAY, groups: [
        g('Golduck', 8, 0.9, { hp: 0.7 }), g('Lapras', 2, 2, { hp: 0.7 }),
      ] },
      { beat: 'gauntlet', name: 'Whiteout', groups: [
        g('Lapras', 2, 4, { threat: 'elite' }), g('Scyther', 10, 0.5, { at: 2 }),
      ] },
      { beat: 'titan', name: 'The Frostbird', groups: [
        titan(), g('Lapras', 4, 2.5, { at: 2 }), g('Golbat', 8, 0.5, { at: 8 }),
      ] },
    ],
  },
};

/** The final a course plays, if it has one. */
export function finalFor(mapId: string | undefined): CourseFinal | null {
  return mapId ? FINALS[mapId] ?? null : null;
}
