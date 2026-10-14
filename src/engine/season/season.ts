/**
 * A season, one day at a time.
 *
 * Pitcher usage (approved design):
 *  - The rotation ORDER is the structure; each team's size (4/5/6) is locked.
 *  - Fatigue decides skips: if the due starter is still above the start threshold, the next
 *    rested man in the order goes; if nobody is rested, a long reliever makes a spot start.
 *  - "Skip the fifth": after an off day, some teams start the rested ace instead of the #5.
 *  - Short-rest starts only happen for pitchers whose recovery is boosted (abilities.bounceBack):
 *    they clear the threshold early and may jump the line. Normal arms never start out of turn.
 *
 * Fatigue (0–100): each appearance adds 25 + 80 × pitches/budget; everyone recovers 25 a day
 * (× (1 + bounceBack)), so a full start clears in four days. Relievers can enter at ≤ 20, so a typical arm can't go back-to-back, but a
 * high-stamina reliever (bigger budget) can — that's how a rare superstar piles up 100+ innings.
 */
import type { AtBatParams } from '../atbat/params';
import { simulateGame } from '../game/game';
import { newBatLine, newPitchLine, type BatLine, type GameResult, type PitchLine, type TeamGameSetup } from '../game/types';
import { createRng, type Rng } from '../rng';
import type { League, Player } from '../types';
import { rosterMorning } from '../roster';
import { postseasonAfterDay, type Postseason } from './postseason';
import { buildSchedule, type Schedule } from './schedule';
import { buildTeamPlans, type TeamPlan } from './teams';

export const FATIGUE = {
  appearance: 25,
  perBudget: 80,
  recovery: 25,
  /** Minimum days from one start to the next: 3 = at least two full days of rest. A dial: loosen it for broken combos later. */
  minDaysBetweenStarts: 3,
  /** A starter can take the ball at or below this; four-man rotations run hotter by design. */
  startMax: { 4: 30, 5: 20, 6: 20 } as Record<4 | 5 | 6, number>,
  /** Postseason starters go on normal rest: four full days between starts. */
  postseasonRest: 5,
};

export interface StandingRow {
  teamId: number; W: number; L: number; RS: number; RA: number;
  homeW: number; homeL: number; awayW: number; awayL: number;
  /** +n = won n straight, -n = lost n straight. */
  streak: number;
  last10: number[];
}

export interface Season {
  year: number;
  league: League;
  players: Map<number, Player>;
  params: AtBatParams;
  rng: Rng;
  schedule: Schedule;
  /** Next calendar day to simulate. */
  day: number;
  plans: Map<number, TeamPlan>;
  rotationNext: Map<number, number>;
  lastGameDay: Map<number, number>;
  lastStartDay: Map<number, number>;
  fatigue: Map<number, number>;
  standings: Map<number, StandingRow>;
  batting: Map<number, BatLine>;
  pitching: Map<number, PitchLine>;
  results: GameResult[];
  keepLogs: boolean;
  /** Days in the regular schedule. The schedule grows past it for Game 163s and the postseason. */
  regularDays: number;
  /** Play the postseason after the regular season (the game does; calibration and stat tools don't). */
  postseason: boolean;
  post: Postseason | null;
  /** Postseason stats, kept apart from the regular season's (Game 163s count as regular season). */
  postBatting: Map<number, BatLine>;
  postPitching: Map<number, PitchLine>;
  /** Roster rules run each morning (waivers, weekly AI moves): the game does; tools don't. */
  rosterRules: boolean;
  /** Your team (0: none), whose AUTO switches the AI respects. */
  userTeam: number;
}

export function createSeason(
  league: League, params: AtBatParams, opts: { year: number; seed: number; logs?: boolean; schedule?: Schedule; postseason?: boolean; rosterRules?: boolean; userTeam?: number },
): Season {
  const standings = new Map<number, StandingRow>();
  for (const t of league.teams) {
    standings.set(t.id, { teamId: t.id, W: 0, L: 0, RS: 0, RA: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0, streak: 0, last10: [] });
  }
  const schedule = opts.schedule ?? buildSchedule(league, opts.year, opts.seed ^ 0x5bd1e995);
  return {
    year: opts.year, league, players: new Map(league.players.map((p) => [p.id, p])), params,
    rng: createRng(opts.seed), schedule, day: 0,
    plans: buildTeamPlans(league), rotationNext: new Map(), lastGameDay: new Map(), lastStartDay: new Map(), fatigue: new Map(),
    standings, batting: new Map(), pitching: new Map(), results: [], keepLogs: !!opts.logs,
    regularDays: schedule.days, postseason: !!opts.postseason, post: null, postBatting: new Map(), postPitching: new Map(),
    rosterRules: !!opts.rosterRules, userTeam: opts.userTeam ?? 0,
  };
}

/** The year is done: the regular season, and the postseason when it's on. */
export const isOver = (s: Season) => s.day >= s.schedule.days && (!s.postseason || s.post?.phase === 'done');
/** The regular season (Game 163s included) is done. */
export const regularOver = (s: Season) => s.day >= s.regularDays && (!s.postseason || (!!s.post && s.post.phase !== 'tiebreak'));
export const inPostseason = (s: Season) => s.post?.phase === 'post';

/** Simulate one calendar day (may be an off day for everyone). */
export function simDay(s: Season): GameResult[] {
  if (isOver(s)) return [];
  if (s.rosterRules) rosterMorning(s, s.userTeam);
  for (const [id, f] of s.fatigue) {
    if (f <= 0) continue;
    const bonus = s.players.get(id)?.abilities?.bounceBack ?? 0;
    s.fatigue.set(id, Math.max(0, f - FATIGUE.recovery * (1 + bonus)));
  }
  const played: GameResult[] = [];
  for (const g of s.schedule.byDay[s.day] ?? []) {
    const post = g.kind === 'post';
    const away = setupFor(s, g.away, post), home = setupFor(s, g.home, post);
    const res = simulateGame(away, home, s.params, s.rng, { log: s.keepLogs });
    res.day = s.day; res.start = g.start;
    if (g.kind) res.kind = g.kind;
    if (g.series) { res.series = g.series; res.game = g.game; }
    record(s, res);
    played.push(res);
  }
  s.day++;
  postseasonAfterDay(s);
  return played;
}

export function simDays(s: Season, n: number): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n && !isOver(s); i++) out.push(...simDay(s));
  return out;
}

export function simToEnd(s: Season): void { while (!isOver(s)) simDay(s); }

/** Fatigue a pitcher will carry into today's game once the morning's recovery is applied. */
export function recoveredFatigue(s: Season, id: number): number {
  const f = s.fatigue.get(id) ?? 0;
  const bonus = s.players.get(id)?.abilities?.bounceBack ?? 0;
  return Math.max(0, f - FATIGUE.recovery * (1 + bonus));
}

interface StartPlan { starter: Player; next: number; bullpen: TeamGameSetup['bullpen'] }

/** Rotation logic. Pure: reads the season, changes nothing. */
function planStart(s: Season, teamId: number, fat: (id: number) => number, post = false): StartPlan {
  const plan = s.plans.get(teamId)!;
  const rot = plan.rotation, N = rot.length;
  const startMax = FATIGUE.startMax[plan.strategy.rotationSize];
  const ready = (p: Player) => fat(p.id) <= startMax && s.day - (s.lastStartDay.get(p.id) ?? -99) >= FATIGUE.minDaysBetweenStarts;
  let due = s.rotationNext.get(teamId) ?? 0;

  // October: the best rested arm of the top four (then the rest of the rotation), on normal rest; short rest only for boosted recovery.
  if (post) {
    const rest = (p: Player) => ((p.abilities?.bounceBack ?? 0) > 0 ? FATIGUE.minDaysBetweenStarts : FATIGUE.postseasonRest);
    const ace = [...rot.slice(0, Math.min(4, N)), ...rot.slice(4)].find((p) => fat(p.id) <= startMax && s.day - (s.lastStartDay.get(p.id) ?? -99) >= rest(p));
    if (ace) return { starter: ace, next: due, bullpen: plan.bullpen };
  }

  // Skip the fifth after an off day if the ace is ready.
  const offDayBefore = (s.lastGameDay.get(teamId) ?? -99) < s.day - 1;
  if (plan.strategy.skipFifthAfterOffDay && N >= 5 && offDayBefore && due === N - 1 && ready(rot[0])) due = 0;

  // Due man if rested; otherwise skip down the order.
  let starter: Player | undefined, next = due;
  for (let k = 0; k < N; k++) {
    const i = (due + k) % N;
    if (ready(rot[i])) { starter = rot[i]; next = (i + 1) % N; break; }
  }
  // Short rest: a better starter with boosted recovery who is already rested takes the ball; the due man waits a day.
  const rank = starter ? rot.indexOf(starter) : N;
  const bounce = rot.find((p, i) => i < rank && (p.abilities?.bounceBack ?? 0) > 0 && ready(p));
  if (bounce) { starter = bounce; next = due; }

  let bullpen = plan.bullpen;
  if (!starter) {
    // Nobody rested: spot start from the long men, else the least-tired rotation arm.
    const spot = plan.bullpen.filter((a) => a.role === 'LR').sort((a, b) => fat(a.player.id) - fat(b.player.id))[0];
    if (spot && ready(spot.player)) { starter = spot.player; bullpen = plan.bullpen.filter((a) => a !== spot); }
    else { starter = [...rot].sort((a, b) => fat(a.id) - fat(b.id))[0]; next = (rot.indexOf(starter) + 1) % N; }
  }
  return { starter, next, bullpen };
}

/** Today's probable starter for a team (call before the day is simmed). Changes nothing. */
export function peekStarter(s: Season, teamId: number): Player {
  const post = s.schedule.byDay[s.day]?.some((g) => g.kind === 'post' && (g.home === teamId || g.away === teamId)) ?? false;
  return planStart(s, teamId, (id) => recoveredFatigue(s, id), post).starter;
}

function setupFor(s: Season, teamId: number, post: boolean): TeamGameSetup {
  const fat = (id: number) => s.fatigue.get(id) ?? 0;
  const { starter, next, bullpen } = planStart(s, teamId, fat, post);
  s.rotationNext.set(teamId, next);
  s.lastStartDay.set(starter.id, s.day);
  return { teamId, lineup: s.plans.get(teamId)!.lineup, starter, bullpen, fatigue: fat };
}

const addInto = <T extends object>(into: T, from: T) => { for (const k in from) (into as Record<string, number>)[k] += (from as Record<string, number>)[k]; };

function record(s: Season, g: GameResult): void {
  s.results.push(g);
  const [away, home] = g.teamIds;
  const post = g.kind === 'post';
  const batting = post ? s.postBatting : s.batting, pitching = post ? s.postPitching : s.pitching;
  for (const [id, b] of g.batting) { let l = batting.get(id); if (!l) batting.set(id, (l = newBatLine())); addInto(l, b); }
  for (const [id, p] of g.pitching) {
    let l = pitching.get(id); if (!l) pitching.set(id, (l = newPitchLine())); addInto(l, p);
    const budget = g.budgets.get(id) ?? 100;
    s.fatigue.set(id, Math.min(100, (s.fatigue.get(id) ?? 0) + FATIGUE.appearance + FATIGUE.perBudget * (p.P / budget)));
  }
  for (const id of g.teamIds) s.lastGameDay.set(id, s.day);
  if (post) return;
  const homeWon = g.score[1] > g.score[0];
  for (const [id, won, rs, ra, isHome] of [[away, !homeWon, g.score[0], g.score[1], false], [home, homeWon, g.score[1], g.score[0], true]] as const) {
    const row = s.standings.get(id)!;
    row.RS += rs; row.RA += ra;
    if (won) { row.W++; if (isHome) row.homeW++; else row.awayW++; row.streak = row.streak > 0 ? row.streak + 1 : 1; }
    else { row.L++; if (isHome) row.homeL++; else row.awayL++; row.streak = row.streak < 0 ? row.streak - 1 : -1; }
    row.last10.push(won ? 1 : 0); if (row.last10.length > 10) row.last10.shift();
  }
}

export interface DivisionTable { league: number; division: number; rows: Array<StandingRow & { gb: number }> }

export function divisionStandings(s: Season): DivisionTable[] {
  const tables: DivisionTable[] = [];
  for (const lg of [0, 1]) for (const dv of [0, 1, 2]) {
    const rows = s.league.teams.filter((t) => t.conference === lg && t.division === dv)
      .map((t) => s.standings.get(t.id)!)
      .sort((a, b) => b.W / Math.max(1, b.W + b.L) - a.W / Math.max(1, a.W + a.L) || (b.RS - b.RA) - (a.RS - a.RA));
    const lead = rows[0];
    tables.push({ league: lg, division: dv, rows: rows.map((r) => ({ ...r, gb: ((lead.W - r.W) + (r.L - lead.L)) / 2 })) });
  }
  return tables;
}
