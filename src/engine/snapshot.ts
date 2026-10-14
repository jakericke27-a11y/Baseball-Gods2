/**
 * A season's whole state as plain data, and back. Restoring a snapshot and simming on gives exactly
 * the season you'd have had without stopping (the RNG's state is part of it).
 *
 * The data is JSON-safe (Maps become entry lists, players become ids) except the pitch logs, which
 * come out as a separate list of byte arrays so a save file can store them as raw bytes.
 * Bump SNAPSHOT_VERSION when the shape changes, and add an upgrade step in UPGRADES.
 */
import type { AtBatParams } from './atbat/params';
import { seedPipeline } from './generate';
import type { BatLine, BullpenRole, GameMoment, GameResult, PitchLine } from './game/types';
import { createRng, type RngState } from './rng';
import type { Postseason } from './season/postseason';
import type { Schedule, ScheduledGame } from './season/schedule';
import type { Season, StandingRow } from './season/season';
import type { TeamPlan } from './season/teams';
import type { League, TeamStrategy } from './types';

export const SNAPSHOT_VERSION = 4;

type Entries<V> = Array<[number, V]>;

interface PlanSnap { teamId: number; lineup: Array<[number, number]>; rotation: number[]; bullpen: Array<[number, BullpenRole]>; strategy: TeamStrategy }

export interface ResultSnap {
  day: number; start: number; teamIds: [number, number]; score: [number, number]; innings: number;
  lineScore: [number[], number[]]; hits: [number, number]; errors: [number, number]; lob: [number, number];
  outsRecorded: [number, number]; batting: Entries<BatLine>; pitching: Entries<PitchLine>;
  lineups: [Array<[number, number]>, Array<[number, number]>]; pitchersUsed: [number[], number[]];
  decisions: { win: number; loss: number; save: number }; budgets: Entries<number>; pitchResults: number[];
  moments: GameMoment[];
  /** Index into the snapshot's log list, or -1 when the game kept no log. */
  log: number;
  kind?: 'tiebreak' | 'post'; series?: string; game?: number;
}

export interface SeasonSnap {
  v: number;
  year: number;
  league: League;
  params: AtBatParams;
  rng: RngState;
  schedule: { days: number; allStarBreak: number; games: ScheduledGame[] };
  day: number;
  plans: PlanSnap[];
  rotationNext: Entries<number>;
  lastGameDay: Entries<number>;
  lastStartDay: Entries<number>;
  fatigue: Entries<number>;
  standings: StandingRow[];
  batting: Entries<BatLine>;
  pitching: Entries<PitchLine>;
  results: ResultSnap[];
  keepLogs: boolean;
  // v2: the postseason
  regularDays: number;
  postseason: boolean;
  post: Postseason | null;
  postBatting: Entries<BatLine>;
  postPitching: Entries<PitchLine>;
}

const ents = <V>(m: Map<number, V>): Entries<V> => [...m];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function snapshotSeason(s: Season): { data: SeasonSnap; logs: Uint8Array[] } {
  const logs: Uint8Array[] = [];
  const results = s.results.map((g): ResultSnap => {
    let log = -1;
    if (g.log) { log = logs.length; logs.push(g.log); }
    return {
      day: g.day, start: g.start, teamIds: g.teamIds, score: g.score, innings: g.innings, lineScore: g.lineScore,
      hits: g.hits, errors: g.errors, lob: g.lob, outsRecorded: g.outsRecorded, batting: ents(g.batting), pitching: ents(g.pitching),
      lineups: [g.lineups[0].map((l) => [l.player.id, l.pos]), g.lineups[1].map((l) => [l.player.id, l.pos])],
      pitchersUsed: g.pitchersUsed, decisions: g.decisions, budgets: ents(g.budgets), pitchResults: g.pitchResults, moments: g.moments, log,
      ...(g.kind ? { kind: g.kind } : {}), ...(g.series ? { series: g.series, game: g.game } : {}),
    };
  });
  const data: SeasonSnap = {
    v: SNAPSHOT_VERSION, year: s.year, league: s.league, params: s.params, rng: s.rng.state(),
    schedule: { days: s.schedule.days, allStarBreak: s.schedule.allStarBreak, games: s.schedule.games },
    day: s.day,
    plans: [...s.plans.values()].map((p) => ({
      teamId: p.teamId, lineup: p.lineup.map((l) => [l.player.id, l.pos]), rotation: p.rotation.map((r) => r.id),
      bullpen: p.bullpen.map((a) => [a.player.id, a.role]), strategy: p.strategy,
    })),
    rotationNext: ents(s.rotationNext), lastGameDay: ents(s.lastGameDay), lastStartDay: ents(s.lastStartDay), fatigue: ents(s.fatigue),
    standings: [...s.standings.values()], batting: ents(s.batting), pitching: ents(s.pitching), results, keepLogs: s.keepLogs,
    regularDays: s.regularDays, postseason: s.postseason, post: s.post, postBatting: ents(s.postBatting), postPitching: ents(s.postPitching),
  };
  // A deep copy, so the snapshot never shares objects with the live season.
  return { data: clone(data), logs: logs.map((l) => l.slice()) };
}

/** Upgrade steps: UPGRADES[n] turns a version-n snapshot into version n+1. */
const UPGRADES: Record<number, (s: SeasonSnap) => SeasonSnap> = {
  // v1 → v2: the postseason. Only the game wrote v1 saves, and the game plays the postseason.
  1: (s) => ({ ...s, v: 2, regularDays: s.schedule.days, postseason: true, post: null, postBatting: [], postPitching: [] }),
  // v2 → v3: hidden development and the amateur pipeline (deterministic from the league's seed).
  2: (s) => {
    const L = s.league as Partial<League> & League;
    L.amateurs ??= []; L.freeAgents ??= []; L.retired ??= [];
    L.nextId ??= L.players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    seedPipeline(L);
    return { ...s, v: 3 };
  },
  // v3 → v4: history.
  3: (s) => { const L = s.league as Partial<League> & League; L.history ??= []; return { ...s, v: 4 }; },
};

export function upgradeSnapshot(s: SeasonSnap): SeasonSnap {
  let cur = s;
  while (cur.v < SNAPSHOT_VERSION) {
    const up = UPGRADES[cur.v];
    if (!up) throw new Error(`no upgrade from save version ${cur.v}`);
    cur = up(cur);
  }
  if (cur.v > SNAPSHOT_VERSION) throw new Error(`this save is from a newer version of the game (${cur.v})`);
  return cur;
}

export function restoreSeason(snap: SeasonSnap, logs: Uint8Array[]): Season {
  const d = upgradeSnapshot(clone(snap));
  const league = d.league;
  const players = new Map(league.players.map((p) => [p.id, p]));
  const P = (id: number) => { const p = players.get(id); if (!p) throw new Error(`save names a missing player ${id}`); return p; };
  const byDay: ScheduledGame[][] = Array.from({ length: d.schedule.days }, () => []);
  for (const g of d.schedule.games) byDay[g.day].push(g);
  const schedule: Schedule = { days: d.schedule.days, allStarBreak: d.schedule.allStarBreak, games: d.schedule.games, byDay };
  const plans = new Map<number, TeamPlan>(d.plans.map((p) => [p.teamId, {
    teamId: p.teamId, lineup: p.lineup.map(([id, pos]) => ({ player: P(id), pos })), rotation: p.rotation.map(P),
    bullpen: p.bullpen.map(([id, role]) => ({ player: P(id), role })), strategy: p.strategy,
  }]));
  const results = d.results.map((r): GameResult => ({
    day: r.day, start: r.start, teamIds: r.teamIds, score: r.score, innings: r.innings, lineScore: r.lineScore, hits: r.hits,
    errors: r.errors, lob: r.lob, outsRecorded: r.outsRecorded, batting: new Map(r.batting), pitching: new Map(r.pitching),
    lineups: [r.lineups[0].map(([id, pos]) => ({ player: P(id), pos })), r.lineups[1].map(([id, pos]) => ({ player: P(id), pos }))],
    pitchersUsed: r.pitchersUsed, decisions: r.decisions, budgets: new Map(r.budgets), pitchResults: r.pitchResults, moments: r.moments,
    log: r.log >= 0 ? logs[r.log] ?? null : null,
    ...(r.kind ? { kind: r.kind } : {}), ...(r.series ? { series: r.series, game: r.game } : {}),
  }));
  return {
    year: d.year, league, players, params: d.params, rng: createRng(0, d.rng), schedule, day: d.day, plans,
    rotationNext: new Map(d.rotationNext), lastGameDay: new Map(d.lastGameDay), lastStartDay: new Map(d.lastStartDay),
    fatigue: new Map(d.fatigue), standings: new Map(d.standings.map((r) => [r.teamId, r])),
    batting: new Map(d.batting), pitching: new Map(d.pitching), results, keepLogs: d.keepLogs,
    regularDays: d.regularDays, postseason: d.postseason, post: d.post, postBatting: new Map(d.postBatting), postPitching: new Map(d.postPitching),
  };
}
