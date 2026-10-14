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
}

export interface Team {
  id: number;
  name: string;
  conference: number;
  division: number;
  playerIds: number[];
  strategy: TeamStrategy;
}

export interface TeamStrategy {
  /** Locked rotation size (old design: 15% four-man, 70% five-man, 15% six-man). */
  rotationSize: 4 | 5 | 6;
  /** After an off day, skip the #5 starter if the ace is rested. */
  skipFifthAfterOffDay: boolean;
}

export interface League {
  seed: number;
  players: Player[];
  teams: Team[];
}
