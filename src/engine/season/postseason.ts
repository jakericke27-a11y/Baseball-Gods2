/**
 * The postseason, 2019 format: per league three division winners (seeds 1–3 by record) and two wild
 * cards (4–5). One-game wild card at the 4 seed; best-of-5 division series (2-2-1: 1 vs the wild card
 * winner, 2 vs 3); best-of-7 league championship (2-3-2); best-of-7 final (2-3-2, home field to the
 * better record).
 *
 * Ties for a division title or the last wild card are played off (Game 163). Those games count in the
 * regular-season standings and stats, so playing one breaks the tie by itself; a three-way tie becomes a
 * ladder over consecutive days. Other seeding ties go to head-to-head, then run differential.
 *
 * Calendar ("real October"): an off day after the regular season (none if a Game 163 was played), the
 * wild card games, then each round on a fixed start with travel days inside the series, so a sweep
 * earns rest. Rounds start on fixed days whatever happens in the round before.
 */
import type { ScheduledGame } from './schedule';
import type { Season, StandingRow } from './season';

export type Round = 'WC' | 'DS' | 'LCS' | 'WS';
export const ROUND_GAMES: Record<Round, number> = { WC: 1, DS: 5, LCS: 7, WS: 7 };
const OFFSETS: Record<number, number[]> = { 1: [0], 5: [0, 1, 3, 4, 6], 7: [0, 1, 3, 4, 5, 7, 8] };
const HIGH_HOME: Record<number, boolean[]> = { 1: [true], 5: [true, true, false, false, true], 7: [true, true, false, false, false, true, true] };
/** Days from one round's start to the next round's start. */
const NEXT_ROUND: Record<Round, number> = { WC: 2, DS: 8, LCS: 10, WS: 0 };
const ORDER: Round[] = ['WC', 'DS', 'LCS', 'WS'];
const MAX_TIEBREAK_ROUNDS = 4;

export interface Series {
  id: string;
  round: Round;
  /** 0 or 1; -1 for the final. */
  league: number;
  /** The higher seed (home field), and the other team. */
  high: number;
  low: number;
  wins: [number, number];
  start: number;
  winner: number;
}

export interface Postseason {
  phase: 'tiebreak' | 'post' | 'done';
  tiebreakRounds: number;
  /** Seeds 1–5 per league, once the field is set. */
  seeds: number[][];
  series: Series[];
  champion: number;
}

export const newPostseason = (): Postseason => ({ phase: 'tiebreak', tiebreakRounds: 0, seeds: [], series: [], champion: 0 });

// ---------------------------------------------------------------- standings helpers

/** a's win share vs b's, exactly: positive if a is ahead. Works for unequal games played (a Game 163). */
const cmpPct = (a: StandingRow, b: StandingRow) => a.W * (b.W + b.L) - b.W * (a.W + a.L);

/** Wins by a over b this regular season (Game 163s included). */
export function headToHead(s: Season, a: number, b: number): number {
  let w = 0;
  for (const g of s.results) {
    if (g.kind === 'post') continue;
    const [away, home] = g.teamIds;
    if ((away === a && home === b) || (away === b && home === a)) {
      const winner = g.score[1] > g.score[0] ? home : away;
      if (winner === a) w++;
    }
  }
  return w;
}

/** Sort tied teams: head-to-head record among them, then run differential, then team id (stable). */
function tieOrder(s: Season, ids: number[]): number[] {
  const h2h = (id: number) => ids.reduce((n, o) => n + (o === id ? 0 : headToHead(s, id, o) - headToHead(s, o, id)), 0);
  const diff = (id: number) => { const r = s.standings.get(id)!; return r.RS - r.RA; };
  return [...ids].sort((a, b) => h2h(b) - h2h(a) || diff(b) - diff(a) || a - b);
}

/** Teams ordered by record, ties broken by tieOrder. */
function ranked(s: Season, ids: number[]): number[] {
  const groups: number[][] = [];
  const sorted = [...ids].sort((a, b) => -cmpPct(s.standings.get(a)!, s.standings.get(b)!));
  for (const id of sorted) {
    const last = groups.at(-1);
    if (last && cmpPct(s.standings.get(last[0])!, s.standings.get(id)!) === 0) last.push(id); else groups.push([id]);
  }
  return groups.flatMap((g) => (g.length > 1 ? tieOrder(s, g) : g));
}

const teamsIn = (s: Season, league: number, division?: number) =>
  s.league.teams.filter((t) => t.conference === league && (division === undefined || t.division === division)).map((t) => t.id);

/** Groups of teams tied for a spot that a Game 163 settles: division titles first, then the last wild card. */
function contested(s: Season, league: number): number[][] {
  const row = (id: number) => s.standings.get(id)!;
  const divTies: number[][] = [];
  const winners: number[] = [];
  for (const dv of [0, 1, 2]) {
    const ids = teamsIn(s, league, dv), top = ranked(s, ids)[0];
    const tied = ids.filter((id) => cmpPct(row(id), row(top)) === 0);
    if (tied.length > 1) divTies.push(tied);
    winners.push(top);
  }
  if (divTies.length) return divTies;
  const pool = ranked(s, teamsIn(s, league).filter((id) => !winners.includes(id)));
  const line = row(pool[1]);
  const ahead = pool.filter((id) => cmpPct(row(id), line) > 0).length;
  const tied = pool.filter((id) => cmpPct(row(id), line) === 0);
  return ahead + tied.length > 2 ? [tied] : [];
}

/** Seeds 1–5 for a league from the final standings. */
function seedLeague(s: Season, league: number): number[] {
  const winners = [0, 1, 2].map((dv) => ranked(s, teamsIn(s, league, dv))[0]);
  const wild = ranked(s, teamsIn(s, league).filter((id) => !winners.includes(id))).slice(0, 2);
  return [...ranked(s, winners), ...wild];
}

// ---------------------------------------------------------------- the calendar

function addGame(s: Season, g: Omit<ScheduledGame, 'id' | 'start'>): void {
  const id = s.schedule.games.reduce((m, x) => Math.max(m, x.id), -1) + 1;
  const game: ScheduledGame = { ...g, id, start: 0 };
  s.schedule.games.push(game);
  while (s.schedule.byDay.length <= g.day) s.schedule.byDay.push([]);
  s.schedule.byDay[g.day].push(game);
  s.schedule.days = Math.max(s.schedule.days, g.day + 1);
  setStarts(s.schedule.byDay[g.day]);
}

/** First-pitch times for a day of October games: spread out so each gets its own window. */
const STARTS: Record<number, number[]> = { 1: [1148], 2: [978, 1188], 3: [785, 978, 1188], 4: [785, 965, 1148, 1308] };
function setStarts(day: ScheduledGame[]): void {
  const times = STARTS[Math.min(4, day.length)] ?? STARTS[4];
  day.forEach((g, i) => { g.start = times[Math.min(i, times.length - 1)]; });
}

function removeGame(s: Season, g: ScheduledGame): void {
  s.schedule.games.splice(s.schedule.games.indexOf(g), 1);
  const day = s.schedule.byDay[g.day];
  day.splice(day.indexOf(g), 1);
  setStarts(day);
}

function trimDays(s: Season): void {
  let last = s.day - 1;
  for (const g of s.schedule.games) last = Math.max(last, g.day);
  s.schedule.days = Math.max(s.day, last + 1);
  s.schedule.byDay.length = Math.max(s.schedule.byDay.length, s.schedule.days);
}

function openSeries(s: Season, round: Round, league: number, high: number, low: number, start: number): Series {
  const n = ROUND_GAMES[round];
  const id = `${round}${league < 0 ? '' : '-' + league}${round === 'DS' ? '-' + s.post!.series.filter((x) => x.round === 'DS' && x.league === league).length : ''}`;
  const series: Series = { id, round, league, high, low, wins: [0, 0], start, winner: 0 };
  s.post!.series.push(series);
  OFFSETS[n].forEach((off, k) => {
    const highHome = HIGH_HOME[n][k];
    addGame(s, { day: start + off, home: highHome ? high : low, away: highHome ? low : high, kind: 'post', series: id, game: k + 1 });
  });
  return series;
}

// ---------------------------------------------------------------- the day loop

/** Called by simDay after every day once the postseason is on: tiebreaks, seeding, series and rounds. */
export function postseasonAfterDay(s: Season): void {
  if (!s.postseason || s.day < s.regularDays) return;
  if (!s.post) s.post = newPostseason();
  const P = s.post;
  if (P.phase === 'done') return;
  if (P.phase === 'tiebreak') {
    if (s.schedule.games.some((g) => g.day >= s.day)) return; // a Game 163 is still to play
    const groups = P.tiebreakRounds < MAX_TIEBREAK_ROUNDS ? [0, 1].flatMap((lg) => contested(s, lg)) : [];
    if (groups.length) {
      for (const g of groups) {
        const order = tieOrder(s, g); // best first; the two at the bottom play, the winner meets the next one up tomorrow
        const [high, low] = order.slice(-2);
        addGame(s, { day: s.day, home: high, away: low, kind: 'tiebreak' });
      }
      P.tiebreakRounds++;
      return;
    }
    P.seeds = [seedLeague(s, 0), seedLeague(s, 1)];
    P.phase = 'post';
    const wcDay = P.tiebreakRounds ? s.day : s.day + 1;
    for (const lg of [0, 1]) openSeries(s, 'WC', lg, P.seeds[lg][3], P.seeds[lg][4], wcDay);
    return;
  }
  // phase 'post': count today's wins, close won series, open the next round when this one is done
  for (const r of s.results) {
    if (r.kind !== 'post' || r.day !== s.day - 1) continue;
    const sr = P.series.find((x) => x.id === r.series)!;
    const winner = r.score[1] > r.score[0] ? r.teamIds[1] : r.teamIds[0];
    sr.wins[winner === sr.high ? 0 : 1]++;
    if (Math.max(...sr.wins) * 2 > ROUND_GAMES[sr.round]) {
      sr.winner = winner;
      for (const g of s.schedule.games.filter((x) => x.series === sr.id && x.day >= s.day)) removeGame(s, g);
    }
  }
  trimDays(s);
  const round = P.series.at(-1)!.round;
  const current = P.series.filter((x) => x.round === round);
  if (current.some((x) => !x.winner)) return;
  if (round === 'WS') { P.champion = current[0].winner; P.phase = 'done'; trimDays(s); return; }
  const next = ORDER[ORDER.indexOf(round) + 1];
  const start = current[0].start + NEXT_ROUND[round];
  const seedOf = (id: number) => P.seeds.flatMap((x) => x).indexOf(id) % 5;
  if (next === 'DS') {
    for (const lg of [0, 1]) {
      const [s1, s2, s3] = P.seeds[lg], wc = current.find((x) => x.league === lg)!.winner;
      openSeries(s, 'DS', lg, s1, wc, start);
      openSeries(s, 'DS', lg, s2, s3, start);
    }
  } else if (next === 'LCS') {
    for (const lg of [0, 1]) {
      const [a, b] = current.filter((x) => x.league === lg).map((x) => x.winner).sort((x, y) => seedOf(x) - seedOf(y));
      openSeries(s, 'LCS', lg, a, b, start);
    }
  } else {
    const [a, b] = current.map((x) => x.winner);
    const better = ranked(s, [a, b]);
    openSeries(s, 'WS', -1, better[0], better[1], start);
  }
}

/** The series a team is in right now (or most recently), if any. */
export const seriesFor = (s: Season, teamId: number): Series | undefined =>
  [...(s.post?.series ?? [])].reverse().find((x) => x.high === teamId || x.low === teamId);
