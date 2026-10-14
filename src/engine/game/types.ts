/**
 * Game-layer types. Positions use standard scoring numbers:
 * 1 P, 2 C, 3 1B, 4 2B, 5 3B, 6 SS, 7 LF, 8 CF, 9 RF (0 = DH in a lineup slot).
 */
import type { Player } from '../types';

/** Final result of a plate appearance once runners and outs are known. */
export const enum Play {
  StrikeoutSwinging = 0, StrikeoutLooking = 1, Walk = 2, HitByPitch = 3,
  Single = 4, Double = 5, Triple = 6, HomeRun = 7,
  GroundOut = 8, FlyOut = 9, LineOut = 10, PopOut = 11,
  ReachedOnError = 12, DoublePlay = 13, FieldersChoice = 14, SacFly = 15, TriplePlay = 16,
}

/** Event types in the per-game log. */
export const enum Ev { PlateAppearance = 0, Steal = 1, PitchingChange = 2, WildPitch = 3 }

/** Clutch / notable moments tagged during the game ("Notable Moments" from the old design). */
export const enum Moment {
  GrandSlam = 0, WalkOff = 1, GoAheadLateHomer = 2, ClutchHit = 3, LongAtBat = 4,
  ImmaculateInning = 5, Cycle = 6, ThreeHomers = 7, GoldenSombrero = 8,
  NoHitter = 9, PerfectGame = 10, ShutoutCG = 11, TriplePlay = 12,
}
export const MOMENT_NAMES = [
  'Grand slam', 'Walk-off', 'Go-ahead homer (7th+)', 'Clutch hit (RISP, late & close)', 'Long at-bat (10+ pitches)',
  'Immaculate inning', 'Cycle', 'Three-homer game', 'Golden sombrero', 'No-hitter', 'Perfect game', 'Complete-game shutout', 'Triple play',
];

export type BullpenRole = 'CL' | 'SU' | 'MR' | 'LR';

export interface LineupSlot { player: Player; pos: number }
export interface BullpenArm { player: Player; role: BullpenRole }

export interface TeamGameSetup {
  teamId: number;
  /** Batting order, 9 slots; pos 2–9 fields, 0 = DH. */
  lineup: LineupSlot[];
  starter: Player;
  bullpen: BullpenArm[];
  /** Pre-game fatigue 0–100: shrinks the pitch budget and gates reliever availability. */
  fatigue: (playerId: number) => number;
}

export interface BatLine {
  PA: number; AB: number; R: number; H: number; D: number; T: number; HR: number; RBI: number;
  BB: number; K: number; HBP: number; SF: number; SB: number; CS: number; GIDP: number; ROE: number; P: number;
}
export interface PitchLine {
  G: number; GS: number; outs: number; BF: number; H: number; R: number; ER: number;
  BB: number; K: number; HR: number; HBP: number; P: number; W: number; L: number; SV: number;
}
export const newBatLine = (): BatLine => ({
  PA: 0, AB: 0, R: 0, H: 0, D: 0, T: 0, HR: 0, RBI: 0, BB: 0, K: 0, HBP: 0, SF: 0, SB: 0, CS: 0, GIDP: 0, ROE: 0, P: 0,
});
export const newPitchLine = (): PitchLine => ({
  G: 0, GS: 0, outs: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, K: 0, HR: 0, HBP: 0, P: 0, W: 0, L: 0, SV: 0,
});

export interface GameMoment { kind: Moment; playerId: number; inning: number; value: number }

export interface GameResult {
  /** Calendar day of the season and first-pitch time (minutes after midnight); set by the season loop. */
  day: number;
  start: number;
  teamIds: [number, number];          // [away, home]
  score: [number, number];
  innings: number;
  lineScore: [number[], number[]];
  hits: [number, number];
  errors: [number, number];           // errors committed BY each team
  lob: [number, number];
  /** Outs recorded by each side's defense (for integrity checks). */
  outsRecorded: [number, number];
  batting: Map<number, BatLine>;
  pitching: Map<number, PitchLine>;
  lineups: [LineupSlot[], LineupSlot[]];
  pitchersUsed: [number[], number[]];
  decisions: { win: number; loss: number; save: number };
  budgets: Map<number, number>;
  pitchResults: number[];             // counts by PitchResult
  moments: GameMoment[];
  log: Uint8Array | null;
}
