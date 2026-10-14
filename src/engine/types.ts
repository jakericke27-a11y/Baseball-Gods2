import type { LeagueEnvironment } from './atbat/environment';
import type { Modifier } from './modifiers';
import type { DraftPick } from './draft';
import type { YearSummary } from './history';

/** All ratings are on the 20–80 scouting scale; 50 is league average. */
export interface Ratings {
  // hitting
  power: number;
  contact: number;
  discipline: number;
  speed: number;
  // pitching
  velocity: number;
  control: number;
  movement: number;
  stamina: number;
  // fielding
  instincts: number; // range
  glove: number;     // sure hands
  cannon: number;    // arm
  // clutch (two-rating system from the April design)
  clutchRisp: number;
  clutchPressure: number;
}

export type Bats = 'L' | 'R' | 'S';
export type Throws = 'L' | 'R';
export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'UT' | 'P';
export type PitcherRole = 'SP' | 'RP' | 'CL';

export interface Player {
  id: number;
  name: string;
  age: number;
  regionId: number;
  bats: Bats;
  throws: Throws;
  position: Position;
  pitcherRole?: PitcherRole;
  ratings: Ratings;
  /** Special abilities (innate or Gods-given). Hook for the outlier layer; empty for now. */
  abilities?: { bounceBack?: number };
  /** Hidden development (offseason.ts). Never shown: scouting and stats are how you learn it. */
  dev?: PlayerDev;
  /** Option years left (4 to start); one is used in any season he's sent to the reserves. */
  options?: number;
  optionedThisYear?: boolean;
}

export type RatingKey = Exclude<keyof Ratings, 'clutchRisp' | 'clutchPressure'>;

export interface PlayerDev {
  /** The ceiling each rating grows toward while young. */
  potential: Record<RatingKey, number>;
  /** How fully he grows into it: 1 is typical, under 0.7 a likely bust, over 1.3 a late bloomer. */
  growth: number;
  /** How hard age hits him: 1 is typical, under 0.7 ages gracefully. */
  aging: number;
}

/** A player who left the game, kept for history. */
export interface RetiredPlayer extends Player { retiredAfter: number; lastTeam: number }

export interface Team {
  id: number;
  name: string;
  conference: number;
  division: number;
  playerIds: number[];
  strategy: TeamStrategy;
  /** The active 26 (roster.ts): 13 position players and 13 pitchers. The rest of the 40 are reserves. */
  active?: number[];
  /** Roster moves this calendar month (call-up + send-down swaps), for the monthly cap. */
  moves?: { month: number; count: number };
  /** Your team only: which parts the AI runs. Editing one turns its AUTO off. */
  auto?: { lineup: boolean; staff: boolean; roster: boolean };
}

export interface TeamStrategy {
  /** Locked rotation size (old design: 15% four-man, 70% five-man, 15% six-man). */
  rotationSize: 4 | 5 | 6;
  /** After an off day, skip the #5 starter if the ace is rested. */
  skipFifthAfterOffDay: boolean;
}

export interface League {
  seed: number;
  /** Everyone on a 40-man roster. */
  players: Player[];
  teams: Team[];
  /** Amateurs aged 16–22, growing up in view; drafted (later) or signable once they turn 23. */
  amateurs: Player[];
  /** Unsigned players any team can sign: undrafted amateurs 23 and up, and released players. */
  freeAgents: Player[];
  retired: RetiredPlayer[];
  /** Next unused player id. */
  nextId: number;
  /** One summary per finished season (history.ts). */
  history: YearSummary[];
  /** The league's own dials: calibrated at birth, nudged by every decree that ends (modifiers.ts). */
  env: LeagueEnvironment;
  /** Every modifier, past, present and coming (modifiers.ts). */
  modifiers: Modifier[];
  /** Your draft board: the prospects you want, in your order (AUTO picks for you take from the top). */
  wishlist: number[];
  /** Players on waivers (roster.ts). */
  waivers: Waiver[];
  /** Drafted players off the 40: the team holds their rights until the next draft (draft.ts). */
  prospects: Prospect[];
  /** Every draft so far (the founding draft is year 0). */
  drafts: Array<{ year: number; kind: 'founding' | 'cycle'; picks: DraftPick[] }>;
}

export interface Prospect { player: Player; teamId: number; /** Rights end at this year's draft. */ until: number; overall: number }

export interface Waiver {
  playerId: number;
  fromTeam: number;
  /** Clears at the start of this day. */
  until: number;
  /** 'outright': out of options, sent down (clears back to his team's reserves). 'release': clears to free agency. */
  kind: 'outright' | 'release';
  /** Teams that put in a claim; the worst record among them gets him. */
  claims: number[];
  /** A released player belongs to nobody while he waits, so he's kept here. */
  player?: Player;
}
