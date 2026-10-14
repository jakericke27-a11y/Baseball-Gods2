/**
 * Runs a full season through the real season engine (schedule, rotations, bullpen, fatigue)
 * and aggregates league totals, integrity checks and usage metrics for calibration and reports.
 */
import type { AtBatParams } from '../../src/engine/atbat/params';
import { newBatLine, type BatLine, type GameResult, type PitchLine } from '../../src/engine/game/types';
import { createSeason, isOver, simDay, type Season } from '../../src/engine/season/season';
import { buildSchedule, type Schedule } from '../../src/engine/season/schedule';

/** Schedules are deterministic per league + seed, so calibration reuses them. */
const scheduleCache = new Map<string, Schedule>();
import type { League, Player } from '../../src/engine/types';

export interface GameSeasonResult {
  season: Season;
  batting: Map<number, BatLine>;
  pitching: Map<number, PitchLine>;
  players: Map<number, Player>;
  totals: BatLine;
  pitchResults: number[];
  games: number;
  runs: number;
  errors: number;
  lob: number;
  starterOuts: number;
  allOuts: number;
  starts: number;
  completeGames: number;
  shutouts: number;
  /** Histogram: number of team-games that used k pitchers. */
  pitchersUsed: number[];
  wins: Map<number, number>;
  moments: number[];
  kept: GameResult[];
  logBytes: number;
  integrity: { runsMismatch: number; rbiOverRuns: number; erOverRuns: number; outsMismatch: number; missingDecision: number };
  ms: number;
}

const addInto = <T extends object>(into: T, from: T) => { for (const k in from) (into as Record<string, number>)[k] += (from as Record<string, number>)[k]; };

export function runGameSeason(league: League, params: AtBatParams, seed: number, opts: { log?: boolean; keep?: number } = {}): GameSeasonResult {
  const t0 = performance.now();
  const key = `${league.seed}:${seed}`;
  let schedule = scheduleCache.get(key);
  if (!schedule) { schedule = buildSchedule(league, 1, seed ^ 0x5bd1e995); scheduleCache.set(key, schedule); }
  const season = createSeason(league, params, { year: 1, seed, logs: !!opts.log, schedule });
  const res: GameSeasonResult = {
    season, batting: season.batting, pitching: season.pitching, players: season.players, totals: newBatLine(),
    pitchResults: [0, 0, 0, 0, 0, 0], games: 0, runs: 0, errors: 0, lob: 0, starterOuts: 0, allOuts: 0, starts: 0,
    completeGames: 0, shutouts: 0, pitchersUsed: new Array(12).fill(0), wins: new Map(), moments: new Array(13).fill(0),
    kept: [], logBytes: 0, integrity: { runsMismatch: 0, rbiOverRuns: 0, erOverRuns: 0, outsMismatch: 0, missingDecision: 0 }, ms: 0,
  };
  while (!isOver(season)) {
    for (const game of simDay(season)) {
      res.games++;
      res.runs += game.score[0] + game.score[1];
      res.errors += game.errors[0] + game.errors[1];
      res.lob += game.lob[0] + game.lob[1];
      const winner = game.teamIds[game.score[1] > game.score[0] ? 1 : 0];
      res.wins.set(winner, (res.wins.get(winner) ?? 0) + 1);
      for (let k = 0; k < 6; k++) res.pitchResults[k] += game.pitchResults[k];
      for (const m of game.moments) res.moments[m.kind]++;
      if (game.log) res.logBytes += game.log.length;
      if (opts.keep && res.kept.length < opts.keep) res.kept.push(game);
      for (const b of game.batting.values()) addInto(res.totals, b);

      // Integrity: every run credited to a runner AND charged to a pitcher; RBI never exceed runs; outs reconcile.
      for (const side of [0, 1]) {
        let playerRuns = 0, rbi = 0, charged = 0, earned = 0, outs = 0;
        for (const s of game.lineups[side]) { const b = game.batting.get(s.player.id)!; playerRuns += b.R; rbi += b.RBI; }
        for (const id of game.pitchersUsed[1 - side]) { const p = game.pitching.get(id)!; charged += p.R; earned += p.ER; }
        for (const id of game.pitchersUsed[side]) outs += game.pitching.get(id)!.outs;
        if (playerRuns !== game.score[side] || charged !== game.score[side]) res.integrity.runsMismatch++;
        if (rbi > game.score[side]) res.integrity.rbiOverRuns++;
        if (earned > charged) res.integrity.erOverRuns++;
        if (outs !== game.outsRecorded[side]) res.integrity.outsMismatch++;
        const sp = game.pitching.get(game.pitchersUsed[side][0])!;
        res.starterOuts += sp.outs; res.allOuts += outs; res.starts++;
        res.pitchersUsed[Math.min(11, game.pitchersUsed[side].length)]++;
        if (game.pitchersUsed[side].length === 1) res.completeGames++;
        if (game.score[1 - side] === 0) res.shutouts++;
      }
      if (!game.decisions.win || !game.decisions.loss) res.integrity.missingDecision++;
    }
  }
  res.ms = performance.now() - t0;
  return res;
}
