/**
 * Calibration harness: a season of plate appearances without baserunning.
 * Each team bats until 27 outs against the other team's rotation/bullpen, so
 * PA counts, pitcher usage and in-game fatigue are realistic. Runs are estimated
 * from the batting line (BaseRuns) until the real game loop exists.
 */
import { simulateAtBat, MAX_PITCHES } from '../../src/engine/atbat/atbat';
import {
  BattedBall, Loc, Outcome, PitchResult, isAtBat, isHit, isStrikeout, pitchLocOf, pitchResultOf,
} from '../../src/engine/atbat/codes';
import type { AtBatParams } from '../../src/engine/atbat/params';
import { ByteLog } from '../../src/engine/log';
import { createRng, type Rng } from '../../src/engine/rng';
import type { League, Player } from '../../src/engine/types';

export interface Line {
  PA: number; AB: number; H: number; D: number; T: number; HR: number;
  BB: number; HBP: number; K: number; P: number; outs: number; GS: number;
}
const newLine = (): Line => ({ PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, BB: 0, HBP: 0, K: 0, P: 0, outs: 0, GS: 0 });

export interface Totals extends Line {
  pitchResults: number[];       // by PitchResult
  pitchesByLoc: number[];       // by Loc
  swingsByLoc: number[];
  contactByLoc: number[];
  bipByType: number[];          // by BattedBall
  hrByType: number[];
  hitsByType: number[];
  paLength: number[];           // index = pitches in the PA
  threePitchK: number;
  tenPlusK: number;
  firstPitchHR: number;
  fullCountWalks: number;
  kLooking: number;
  games: number;
}

export interface SeasonResult {
  totals: Totals;
  batting: Map<number, Line>;
  pitching: Map<number, Line>;
  players: Map<number, Player>;
  log: Uint8Array | null;
  ms: number;
}

interface TeamUnit { lineup: Player[]; rotation: Player[]; bullpen: Player[] }

const batScore = (p: Player) => p.ratings.power + p.ratings.contact + p.ratings.discipline + 0.3 * p.ratings.speed;
const pitchScore = (p: Player) => p.ratings.velocity + p.ratings.control + p.ratings.movement + 0.4 * p.ratings.stamina;

function buildUnits(league: League): { units: TeamUnit[]; players: Map<number, Player> } {
  const players = new Map(league.players.map((p) => [p.id, p]));
  const units = league.teams.map((t) => {
    const roster = t.playerIds.map((id) => players.get(id)!);
    const hitters = roster.filter((p) => p.position !== 'P');
    const lineup: Player[] = [];
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const) {
      const best = hitters.filter((h) => h.position === pos && !lineup.includes(h)).sort((a, b) => batScore(b) - batScore(a))[0];
      if (best) lineup.push(best);
    }
    const dh = hitters.filter((h) => !lineup.includes(h)).sort((a, b) => batScore(b) - batScore(a))[0];
    lineup.push(dh);
    lineup.sort((a, b) => batScore(b) - batScore(a));
    const pitchers = roster.filter((p) => p.position === 'P');
    const rotation = pitchers.filter((p) => p.pitcherRole === 'SP').sort((a, b) => pitchScore(b) - pitchScore(a)).slice(0, 5);
    const bullpen = pitchers.filter((p) => p.pitcherRole !== 'SP').sort((a, b) => pitchScore(b) - pitchScore(a)).slice(0, 8);
    return { lineup, rotation, bullpen };
  });
  return { units, players };
}

function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function runPaSeason(league: League, params: AtBatParams, seed: number, opts: { log: boolean }): SeasonResult {
  const t0 = performance.now();
  const rng = createRng(seed);
  const { units, players } = buildUnits(league);
  const batting = new Map<number, Line>();
  const pitching = new Map<number, Line>();
  const line = (m: Map<number, Line>, id: number) => { let l = m.get(id); if (!l) m.set(id, (l = newLine())); return l; };
  const T: Totals = {
    ...newLine(),
    pitchResults: new Array(6).fill(0), pitchesByLoc: [0, 0, 0], swingsByLoc: [0, 0, 0], contactByLoc: [0, 0, 0],
    bipByType: new Array(5).fill(0), hrByType: new Array(5).fill(0), hitsByType: new Array(5).fill(0),
    paLength: new Array(MAX_PITCHES + 1).fill(0), threePitchK: 0, tenPlusK: 0, firstPitchHR: 0, fullCountWalks: 0, kLooking: 0, games: 0,
  };
  const log = opts.log ? new ByteLog(4 << 20) : null;
  const scratch = new Uint8Array(MAX_PITCHES + 4);

  const halfGame = (bat: TeamUnit, fld: TeamUnit, day: number) => {
    let outs = 0, order = 0;
    let pitcher = fld.rotation[day % fld.rotation.length];
    let starter = true, pitches = 0, outsThisPitcher = 0;
    line(pitching, pitcher.id).GS++;
    const budgetOf = (p: Player) => 35 + p.ratings.stamina;
    let budget = budgetOf(pitcher);
    const bringReliever = () => {
      let next = fld.bullpen[rng.int(fld.bullpen.length)];
      if (next === pitcher) next = fld.bullpen[(fld.bullpen.indexOf(next) + 1) % fld.bullpen.length];
      pitcher = next; starter = false; pitches = 0; outsThisPitcher = 0; budget = budgetOf(pitcher);
    };
    while (outs < 26) {
      if (starter && (pitches >= budget || outs >= 23)) bringReliever();
      else if (!starter && ((outsThisPitcher >= 3 && outs % 3 === 0) || pitches >= budget)) bringReliever();

      const batter = bat.lineup[order++ % 9];
      const fatigue = Math.max(0, (pitches / budget - 0.6) / 0.4);
      const r = simulateAtBat(batter, pitcher, { fatigue }, params, rng, scratch);
      pitches += r.pitches;

      const B = line(batting, batter.id), Pl = line(pitching, pitcher.id);
      const o = r.outcome;
      for (const L of [B, Pl, T]) {
        L.PA++; L.P += r.pitches;
        if (isAtBat(o)) L.AB++;
        if (isHit(o)) L.H++;
        if (o === Outcome.Double) L.D++;
        if (o === Outcome.Triple) L.T++;
        if (o === Outcome.HomeRun) L.HR++;
        if (o === Outcome.Walk) L.BB++;
        if (o === Outcome.HitByPitch) L.HBP++;
        if (isStrikeout(o)) L.K++;
      }
      const isOut = isStrikeout(o) || o >= Outcome.GroundOut;
      if (isOut) { outs++; outsThisPitcher++; Pl.outs++; T.outs++; }

      // League pitch-level metrics, read straight from the logged pitch bytes.
      for (let i = 0; i < r.pitches; i++) {
        const res = pitchResultOf(scratch[i]), loc = pitchLocOf(scratch[i]);
        T.pitchResults[res]++; T.pitchesByLoc[loc]++;
        if (res === PitchResult.SwingingStrike || res === PitchResult.Foul || res === PitchResult.InPlay) {
          T.swingsByLoc[loc]++;
          if (res !== PitchResult.SwingingStrike) T.contactByLoc[loc]++;
        }
      }
      T.paLength[r.pitches]++;
      if (r.battedBall !== BattedBall.None) {
        T.bipByType[r.battedBall]++;
        if (o === Outcome.HomeRun) T.hrByType[r.battedBall]++;
        if (isHit(o)) T.hitsByType[r.battedBall]++;
      }
      if (o === Outcome.StrikeoutLooking) T.kLooking++;
      if (isStrikeout(o) && r.pitches === 3) T.threePitchK++;
      if (isStrikeout(o) && r.pitches >= 10) T.tenPlusK++;
      if (o === Outcome.HomeRun && r.pitches === 1) T.firstPitchHR++;
      if (o === Outcome.Walk && countBeforeLast(scratch, r.pitches) === 32) T.fullCountWalks++;

      if (log) {
        log.u16(batter.id); log.u16(pitcher.id);
        log.u8(o); log.u8(r.battedBall); log.i8(Number.isNaN(r.quality) ? -128 : r.quality * 20);
        log.u8(r.pitches); log.bytes(scratch, r.pitches);
      }
    }
  };

  for (let day = 0; day < 162; day++) {
    const order = shuffled(units.length, rng);
    for (let g = 0; g < units.length / 2; g++) {
      const home = units[order[2 * g]], away = units[order[2 * g + 1]];
      halfGame(away, home, day);
      halfGame(home, away, day);
      T.games++;
    }
  }
  return { totals: T, batting, pitching, players, log: log ? log.toBytes() : null, ms: performance.now() - t0 };
}

/** Balls*10 + strikes before the final pitch of a PA (32 = full count). */
function countBeforeLast(pitches: Uint8Array, n: number): number {
  let b = 0, s = 0;
  for (let i = 0; i < n - 1; i++) {
    const r = pitchResultOf(pitches[i]);
    if (r === PitchResult.Ball) b++;
    else if (r === PitchResult.CalledStrike || r === PitchResult.SwingingStrike) s++;
    else if (r === PitchResult.Foul && s < 2) s++;
  }
  return b * 10 + s;
}

/** The batting fields the rate helpers need (works for pseudo-season Lines and game BatLines). */
export type BatCore = Pick<Line, 'PA' | 'AB' | 'H' | 'D' | 'T' | 'HR' | 'BB' | 'HBP' | 'K' | 'P'>;

/** BaseRuns run estimate for a batting line (validated against real MLB seasons). */
export function baseRuns(l: BatCore): number {
  const singles = l.H - l.D - l.T - l.HR;
  const TB = singles + 2 * l.D + 3 * l.T + 4 * l.HR;
  const A = l.H + l.BB + l.HBP - l.HR;
  const B = (1.4 * TB - 0.6 * l.H - 3 * l.HR + 0.1 * (l.BB + l.HBP)) * 1.02;
  const C = l.AB - l.H;
  return (A * B) / (B + C) + l.HR;
}

/**
 * Estimated runs per game (both teams). Real MLB averages ~25.8 PA-ending outs per team-game
 * (the rest of the 27 come from double plays, caught stealing, skipped bottom-9ths), so
 * PA per game = 25.8 / (1 - OBP). Checked against Lahman: 2023 → 9.3 est vs 9.23 actual.
 */
export function estRunsPerGame(l: BatCore): number {
  const obp = (l.H + l.BB + l.HBP) / l.PA;
  return 2 * (baseRuns(l) / l.PA) * (25.8 / (1 - obp));
}

export function rates(l: BatCore) {
  const singles = l.H - l.D - l.T - l.HR;
  const TB = singles + 2 * l.D + 3 * l.T + 4 * l.HR;
  const BIPouts = l.AB - l.H - l.K;
  return {
    AVG: l.H / l.AB,
    OBP: (l.H + l.BB + l.HBP) / l.PA,
    SLG: TB / l.AB,
    K: l.K / l.PA,
    BB: l.BB / l.PA,
    HBP: l.HBP / l.PA,
    HR600: (600 * l.HR) / l.PA,
    D600: (600 * l.D) / l.PA,
    T600: (600 * l.T) / l.PA,
    BABIP: (l.H - l.HR) / (l.H - l.HR + BIPouts),
    PperPA: l.P / l.PA,
  };
}

export { Loc };
