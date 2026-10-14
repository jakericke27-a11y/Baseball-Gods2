/**
 * Division-heavy schedule (2019 MLB format), 162 games per team, 81 home / 81 away:
 *   division rivals      4 × 19 = 76   (host 10 vs two rivals, 9 vs the other two)
 *   same league, other   6 × 7 + 4 × 6 = 66
 *   interleague          5 × 4 = 20    (vs one division of the other league; pairing rotates yearly)
 * Games are grouped into 2–4 game series and packed into rounds (every team plays one series at a
 * time), with a league-wide off day every third round and an All-Star break at the halfway point.
 */
import { createRng, type Rng } from '../rng';
import type { League, Team } from '../types';

export interface ScheduledGame {
  id: number; day: number; home: number; away: number;
  /** Local first-pitch time in minutes after midnight (e.g. 1150 = 7:10 PM). Drives day/dusk/night. */
  start: number;
  /** Set for games added after the regular schedule: a Game 163 tiebreaker, or a postseason game. */
  kind?: 'tiebreak' | 'post';
  /** Postseason: the series id (postseason.ts) and the game number in it. */
  series?: string;
  game?: number;
}

export type Lighting = 'day' | 'dusk' | 'night';
/** Day 0 of a year is a Thursday (a classic Opening Day). 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (day: number): number => (day + 4) % 7;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Calendar month (0 = January) and date of a season day; day 0 is March 26. */
export function dateOfDay(day: number): { month: number; date: number } {
  let month = 2, date = 26 + day;
  while (date > MONTH_DAYS[month]) { date -= MONTH_DAYS[month]; month = (month + 1) % 12; }
  return { month, date };
}
export const formatStart = (m: number): string =>
  `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;
/** Light at a given inning: about 20 minutes per inning after first pitch. */
export function lightingAt(start: number, inning = 1): Lighting {
  const t = start + (inning - 1) * 20;
  return t < 17 * 60 + 30 ? 'day' : t < 19 * 60 + 30 ? 'dusk' : 'night';
}
export interface Schedule {
  days: number;
  games: ScheduledGame[];
  byDay: ScheduledGame[][];
  allStarBreak: number; // first day of the break
}
interface Series { host: number; visitor: number; length: number; done: boolean; startDay?: number }

const split = (n: number): number[] => (n === 10 ? [3, 3, 4] : n === 9 ? [3, 3, 3] : [n]);

export function buildSchedule(league: League, year: number, seed: number): Schedule {
  const rng = createRng(seed);
  const groups: Team[][][] = [[[], [], []], [[], [], []]];
  for (const t of league.teams) groups[t.conference][t.division].push(t);

  const series: Series[] = [];
  const add = (host: Team, visitor: Team, games: number) => {
    for (const length of split(games)) series.push({ host: host.id, visitor: visitor.id, length, done: false });
  };

  for (const lg of [0, 1]) {
    // Division: a regular tournament decides who hosts 10 and who hosts 9.
    for (const dv of groups[lg]) {
      for (let a = 0; a < 5; a++) for (const off of [1, 2]) {
        const b = (a + off) % 5;
        add(dv[a], dv[b], 10); add(dv[b], dv[a], 9);
      }
    }
    // Same league, other divisions: each team gets six 7-game opponents and four 6-game opponents.
    // hostsFour = how many of a team's three 7-game pairings vs that division it hosts 4 of (balances to 81 home).
    for (const [d1, d2, hostsFour] of [[0, 1, 2], [0, 2, 1], [1, 2, 2]]) {
      for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) {
        const A = groups[lg][d1][k], B = groups[lg][d2][j];
        const off = (j - k + 5) % 5;
        if (off <= 2) { const aFour = off < hostsFour; add(A, B, aFour ? 4 : 3); add(B, A, aFour ? 3 : 4); }
        else { add(A, B, 3); add(B, A, 3); }
      }
    }
  }
  // Interleague: division d of league 0 meets division (d + year) % 3 of league 1, 2 + 2 games each.
  for (let d = 0; d < 3; d++) {
    for (const A of groups[0][d]) for (const B of groups[1][(d + year) % 3]) { add(A, B, 2); add(B, A, 2); }
  }

  // ---- Pack series into rounds ----
  const teamIds = league.teams.map((t) => t.id);
  const byTeam = new Map<number, Series[]>(teamIds.map((id) => [id, []]));
  for (const s of series) { byTeam.get(s.host)!.push(s); byTeam.get(s.visitor)!.push(s); }
  const remainingGames = (id: number) => byTeam.get(id)!.reduce((n, s) => n + (s.done ? 0 : s.length), 0);
  const totalGames = series.reduce((n, s) => n + s.length, 0);

  const games: ScheduledGame[] = [];
  let day = 0, scheduled = 0, roundsSinceOff = 0, allStarBreak = -1;
  let left = series.length;

  while (left > 0) {
    const counts = [0, 0, 0, 0, 0];
    for (const s of series) if (!s.done) counts[s.length]++;
    const preferred = counts.indexOf(Math.max(...counts));
    let best: Series[] = [], bestScore = -Infinity;
    for (let attempt = 0; attempt < 40; attempt++) {
      const target = attempt % 4 === 3 ? 1 + rng.int(4) : preferred;
      const order = shuffle(teamIds, rng).sort((a, b) => remainingGames(b) - remainingGames(a));
      const busy = new Set<number>();
      const chosen: Series[] = [];
      for (const t of order) {
        if (busy.has(t)) continue;
        const cands = byTeam.get(t)!.filter((s) => !s.done && !busy.has(s.host === t ? s.visitor : s.host));
        if (!cands.length) continue;
        cands.sort((x, y) =>
          (x.length === target ? 0 : 1) - (y.length === target ? 0 : 1) ||
          remainingGames(y.host === t ? y.visitor : y.host) - remainingGames(x.host === t ? x.visitor : x.host) ||
          rng.next() - 0.5);
        const s = cands[0];
        chosen.push(s); busy.add(s.host); busy.add(s.visitor);
      }
      const len = Math.max(...chosen.map((s) => s.length));
      const idle = chosen.reduce((n, s) => n + 2 * (len - s.length), 0) + (teamIds.length - 2 * chosen.length) * len;
      const score = -idle;
      if (score > bestScore) { bestScore = score; best = chosen; }
      if (idle === 0) break;
    }
    const len = Math.max(...best.map((s) => s.length));
    for (const s of best) {
      s.startDay = day;
      for (let g = 0; g < s.length; g++) games.push({ id: games.length, day: day + g, home: s.host, away: s.visitor, start: 0 });
      s.done = true; left--; scheduled += s.length;
    }
    day += len;
    if (++roundsSinceOff === 4) { day += 1; roundsSinceOff = 0; }
    if (allStarBreak < 0 && scheduled >= totalGames / 2) { allStarBreak = day; day += 3; }
  }

  // First-pitch times, from their own random stream so the schedule itself never changes:
  // weeknights are night games, Sundays and getaway days (last game of a series) are day games.
  const timeRng = createRng(seed ^ 0x2f6b9d11);
  const lastDayOfSeries = new Set<string>();
  for (const s of series) lastDayOfSeries.add(`${s.host}:${(s.startDay ?? 0) + s.length - 1}`);
  const pick = (opts: Array<[number, number]>) => { let r = timeRng.next(); for (const [t, w] of opts) { if ((r -= w) <= 0) return t; } return opts[0][0]; };
  for (const g of games) {
    const wd = weekdayOf(g.day);
    const getaway = lastDayOfSeries.has(`${g.home}:${g.day}`);
    if (wd === 0) g.start = pick([[13 * 60 + 35, 0.8], [17 * 60 + 10, 0.1], [19 * 60 + 10, 0.1]]);
    else if (getaway) g.start = pick([[12 * 60 + 35, 0.35], [13 * 60 + 10, 0.35], [19 * 60 + 5, 0.3]]);
    else if (wd === 6) g.start = pick([[13 * 60 + 10, 0.3], [16 * 60 + 10, 0.25], [19 * 60 + 10, 0.45]]);
    else g.start = pick([[19 * 60 + 5, 0.75], [18 * 60 + 40, 0.12], [16 * 60 + 10, 0.08], [13 * 60 + 10, 0.05]]);
  }

  games.sort((a, b) => a.day - b.day || a.home - b.home);
  games.forEach((g, i) => { g.id = i; });
  const byDay: ScheduledGame[][] = Array.from({ length: day }, () => []);
  for (const g of games) byDay[g.day].push(g);
  return { days: day, games, byDay, allStarBreak };
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
