/**
 * History: what's left of each season once it's over. Season lines for every player (regular season and
 * postseason), every team's record and finish, the postseason bracket and champion, and a ratings snapshot
 * (the ratings each player carried that year, for scouting lookbacks). Kept as compact rows; only the
 * current season keeps games and pitch logs.
 *
 * Ratings change only over the winter today, so one snapshot per season is exact. When something changes
 * ratings mid-season (injuries, cards), add snapshots at more dates.
 */
import { decreeFor } from './decree';
import { RATING_KEYS } from './development';
import type { BatLine, PitchLine } from './game/types';
import type { Series } from './season/postseason';
import type { Season } from './season/season';
import type { League, Player } from './types';

export const BAT_FIELDS = ['PA', 'AB', 'R', 'H', 'D', 'T', 'HR', 'RBI', 'BB', 'K', 'HBP', 'SF', 'SB', 'CS', 'GIDP', 'ROE', 'P'] as const;
export const PITCH_FIELDS = ['G', 'GS', 'outs', 'BF', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'HBP', 'P', 'W', 'L', 'SV'] as const;

/** [playerId, teamId, ...BAT_FIELDS] or [playerId, teamId, ...PITCH_FIELDS]. */
export type LineRow = number[];
/** [playerId, age, ...RATING_KEYS] */
export type RatingRow = number[];

export interface TeamYear { teamId: number; W: number; L: number; RS: number; RA: number; /** 1–5 in the division */ place: number; seed: number }

export interface YearSummary {
  year: number;
  champion: number;
  teams: TeamYear[];
  series: Array<Pick<Series, 'id' | 'round' | 'league' | 'high' | 'low' | 'wins' | 'winner'>>;
  batting: LineRow[];
  pitching: LineRow[];
  postBatting: LineRow[];
  postPitching: LineRow[];
  /** Everyone in the game that year: rostered, free agents and amateurs. */
  ratings: RatingRow[];
  /** The Gods' decree that year, if any ("The Year of the Mighty Home Run"). */
  decree?: string;
}

const rows = <T extends object>(m: Map<number, T>, fields: readonly string[], teamOf: (id: number) => number): LineRow[] =>
  [...m].map(([id, l]) => [id, teamOf(id), ...fields.map((f) => (l as Record<string, number>)[f])]);

export const ratingRow = (p: Player): RatingRow => [p.id, p.age, ...RATING_KEYS.map((k) => p.ratings[k])];

/** Boil a finished season down to its summary (call before the offseason changes anyone). */
export function summarizeSeason(s: Season): YearSummary {
  const teamOf = new Map<number, number>();
  for (const t of s.league.teams) for (const id of t.playerIds) teamOf.set(id, t.id);
  const tOf = (id: number) => teamOf.get(id) ?? 0;
  const seeds = s.post?.seeds ?? [];
  const teams: TeamYear[] = s.league.teams.map((t) => {
    const r = s.standings.get(t.id)!;
    const div = s.league.teams.filter((x) => x.conference === t.conference && x.division === t.division)
      .map((x) => s.standings.get(x.id)!).sort((a, b) => b.W / Math.max(1, b.W + b.L) - a.W / Math.max(1, a.W + a.L) || (b.RS - b.RA) - (a.RS - a.RA));
    return { teamId: t.id, W: r.W, L: r.L, RS: r.RS, RA: r.RA, place: div.findIndex((x) => x.teamId === t.id) + 1, seed: (seeds[t.conference]?.indexOf(t.id) ?? -1) + 1 };
  });
  return {
    year: s.year,
    champion: s.post?.champion ?? 0,
    teams,
    series: (s.post?.series ?? []).map(({ id, round, league, high, low, wins, winner }) => ({ id, round, league, high, low, wins: [...wins] as [number, number], winner })),
    batting: rows(s.batting, BAT_FIELDS, tOf),
    pitching: rows(s.pitching, PITCH_FIELDS, tOf),
    postBatting: rows(s.postBatting, BAT_FIELDS, tOf),
    postPitching: rows(s.postPitching, PITCH_FIELDS, tOf),
    ratings: [...s.league.players, ...s.league.freeAgents, ...s.league.amateurs].map(ratingRow),
    ...(decreeFor(s.league, s.year) ? { decree: decreeFor(s.league, s.year)!.label } : {}),
  };
}

const toLine = <T>(row: LineRow, fields: readonly string[]): T => Object.fromEntries(fields.map((f, i) => [f, row[2 + i]])) as T;

export interface CareerYear<T> { year: number; teamId: number; line: T }

/** A player's season lines across history (regular season, or postseason with `post`). */
export function careerBatting(league: League, id: number, post = false): Array<CareerYear<BatLine>> {
  return league.history.flatMap((y) => (post ? y.postBatting : y.batting).filter((r) => r[0] === id).map((r) => ({ year: y.year, teamId: r[1], line: toLine<BatLine>(r, BAT_FIELDS) })));
}
export function careerPitching(league: League, id: number, post = false): Array<CareerYear<PitchLine>> {
  return league.history.flatMap((y) => (post ? y.postPitching : y.pitching).filter((r) => r[0] === id).map((r) => ({ year: y.year, teamId: r[1], line: toLine<PitchLine>(r, PITCH_FIELDS) })));
}

/** What a player's ratings were in a past year (the scouting lookback), or undefined if he wasn't around. */
export function ratingsIn(league: League, id: number, year: number): { age: number; ratings: Record<string, number> } | undefined {
  const r = league.history.find((y) => y.year === year)?.ratings.find((x) => x[0] === id);
  return r ? { age: r[1], ratings: Object.fromEntries(RATING_KEYS.map((k, i) => [k, r[2 + i]])) } : undefined;
}

/** Sum season lines into one. */
export function total<T extends object>(lines: T[]): T | null {
  if (!lines.length) return null;
  const out = { ...lines[0] } as Record<string, number>;
  for (const l of lines.slice(1)) for (const k in l) out[k] += (l as Record<string, number>)[k];
  return out as T;
}
