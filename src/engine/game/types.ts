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
export const enum Ev { PlateAppearance = 0, Steal = 1, PitchingChange = 2, WildPitch = 3, Substitution = 4 }

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
  /** Active position players not in the lineup: pinch hitters, pinch runners, defensive subs (live games). */
  bench?: Player[];
}

/**
 * A manager's move at a live game's decision point (before a plate appearance). Moves take effect at once and the
 * game waits again at the same point; sending no moves plays on.
 */
export type GameMove =
  | { kind: 'pitcher'; side: number; id: number }      // bring in a reliever from the bullpen
  | { kind: 'keep'; side: number }                     // leave the pitcher in (overrides the AI this time)
  | { kind: 'sub'; side: number; slot: number; id: number; why: 'hitter' | 'field' } // replace a lineup slot (same position)
  | { kind: 'runner'; side: number; base: number; id: number } // pinch-run for the runner on base 0–2
  | { kind: 'call'; side: number; bat?: BatCall | null; pitch?: PitchCall | null } // this plate appearance only
  | { kind: 'align'; side: number; infield?: InfieldAlign; outfield?: OutfieldAlign }; // stays until changed

/**
 * Manager calls for one plate appearance. Batting: Tie the Game Now! (power), Move the Runner! (move),
 * Draw the Walk! (walk), Hit and Run! (hitrun). Pitching: go for the strikeout (k), a grounder (gb), a fly ball (fb),
 * Dot the Corners (corners), the intentional walk (ibb). Shifts are banned, so alignments are depths only.
 */
export type BatCall = 'power' | 'move' | 'walk' | 'hitrun';
export type PitchCall = 'k' | 'gb' | 'fb' | 'corners' | 'ibb';
export type InfieldAlign = 'normal' | 'in' | 'dp' | 'lines';
export type OutfieldAlign = 'normal' | 'deep' | 'shallow';
export interface Alignment { infield: InfieldAlign; outfield: OutfieldAlign }

/** A substitution, for the box score and the log. */
export interface Sub { side: number; slot: number; incoming: number; outgoing: number; why: 'hitter' | 'runner' | 'field'; inning: number }

/** What a live game shows at a decision point: the state before the next plate appearance. */
export interface GameCall {
  inning: number; half: 0 | 1; outs: number;
  /** Runner ids on first, second, third (0: empty). */
  bases: [number, number, number];
  score: [number, number];
  /** The batting side's next slot and hitter. */
  slot: number; batter: number;
  /** Each side's pitcher now: [away, home]. */
  pitchers: Array<{ id: number; pitches: number; budget: number; starter: boolean }>;
  /** Who the AI would bring in for each side right now (0: no change, or the manager already decided this time). */
  aiPitch: [number, number];
  /** Each side's lineup now ([player id, position] per slot). */
  lineups: Array<Array<[number, number]>>;
  /** Players already used (and so unavailable): pitchers who've pitched, players subbed out or in. */
  used: [number[], number[]];
  /** The event log so far, for the watch screen. */
  log: Uint8Array | null;
  pitchersUsed: [number[], number[]];
  /** Calls set for the coming plate appearance ([away, home]; the batting side's bat call, the fielding side's pitch call). */
  calls: { bat: [BatCall | null, BatCall | null]; pitch: [PitchCall | null, PitchCall | null] };
  /** Each side's defensive alignment. */
  align: [Alignment, Alignment];
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
  /** Substitutions made in the game (live games). */
  subs?: Sub[];
  /** Copied from the scheduled game by the season loop: regular (unset), a Game 163, or postseason. */
  kind?: 'tiebreak' | 'post';
  series?: string;
  game?: number;
}
