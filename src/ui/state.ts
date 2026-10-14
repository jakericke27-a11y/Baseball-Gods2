/**
 * The running game: league, season, your team, headlines, saves.
 * A save is just (seed, team, day): the engine is deterministic, so loading replays the year to that day.
 */
import baseline from '../../calibration/baseline.json';
import { DEFAULT_PARAMS } from '../engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../engine/atbat/environment';
import { generateLeague } from '../engine/generate';
import { ordinal } from '../engine/game/text';
import { Moment, type GameResult } from '../engine/game/types';
import { createSeason, isOver, simDay, type Season } from '../engine/season/season';
import type { League, Player } from '../engine/types';
import { postHeadlines } from './post';
import { teamName } from './teams';

export const PARAMS = applyEnvironment(DEFAULT_PARAMS, baseline as LeagueEnvironment);
/** Bump when engine changes would replay an old save differently. */
export const SAVE_VERSION = 1;

export interface Headline { day: number; text: string; teamId: number; big: boolean }

export class Game {
  readonly seed: number;
  readonly league: League;
  readonly season: Season;
  readonly players: Map<number, Player>;
  readonly teamOf = new Map<number, number>();
  userTeam: number;
  headlines: Headline[] = [];
  /** Result indices (into season.results) by calendar day. */
  readonly byDay = new Map<number, number[]>();

  /** A new league, or (with `season`) one restored from a save. */
  constructor(seed: number, userTeam: number, league?: League, season?: Season) {
    this.seed = seed;
    this.userTeam = userTeam;
    this.season = season ?? createSeason(league ?? generateLeague(seed), PARAMS, { year: 1, seed, logs: true, postseason: true });
    this.league = this.season.league;
    this.players = this.season.players;
    for (const t of this.league.teams) for (const id of t.playerIds) this.teamOf.set(id, t.id);
    this.season.results.forEach((g, i) => { const a = this.byDay.get(g.day) ?? []; a.push(i); this.byDay.set(g.day, a); });
  }

  get day() { return this.season.day; }
  get over() { return isOver(this.season); }
  name = (id: number) => this.players.get(id)?.name ?? '?';

  /** Simulate one calendar day (often an off day for some teams, sometimes for everyone). */
  simDay(): GameResult[] {
    const day = this.season.day;
    const results = simDay(this.season);
    const start = this.season.results.length - results.length;
    if (results.length) this.byDay.set(day, results.map((_, i) => start + i));
    this.addHeadlines(day, results);
    this.headlines.push(...postHeadlines(this, day, results));
    return results;
  }

  /** The next day (from today) with at least one game, or -1. */
  nextGameDay(from = this.season.day): number {
    for (let d = from; d < this.season.schedule.days; d++) if (this.season.schedule.byDay[d].length) return d;
    return -1;
  }

  /** A team's scheduled game on a day, if any. */
  gameOn(day: number, teamId: number) {
    return this.season.schedule.byDay[day]?.find((g) => g.home === teamId || g.away === teamId);
  }

  /** The next scheduled game for a team from a day onward. */
  nextGameFor(teamId: number, from = this.season.day) {
    for (let d = from; d < this.season.schedule.days; d++) {
      const g = this.gameOn(d, teamId);
      if (g) return g;
    }
    return undefined;
  }

  resultIndexOf(g: GameResult): number { return this.season.results.indexOf(g); }

  private addHeadlines(day: number, results: GameResult[]): void {
    const P = this.name, T = (id: number) => teamName(id);
    const add = (text: string, teamId: number, big = false) => this.headlines.push({ day, text, teamId, big });
    for (const g of results) {
      const [away, home] = g.teamIds;
      const walkoffBy = new Set(g.moments.filter((m) => m.kind === Moment.WalkOff).map((m) => m.playerId));
      for (const m of g.moments) {
        const team = this.teamOf.get(m.playerId) ?? 0;
        const opp = team === away ? home : away;
        switch (m.kind) {
          case Moment.GrandSlam: add(`${P(m.playerId)} hits a grand slam for ${T(team)}`, team); break;
          case Moment.WalkOff:
            if (team === home) add(`${P(m.playerId)} walks it off for ${T(home)} in the ${ordinal(m.inning)}`, home);
            else add(`${T(home)} walk off on a wild pitch by ${P(m.playerId)}`, home);
            break;
          case Moment.GoAheadLateHomer:
            if (!walkoffBy.has(m.playerId)) add(`${P(m.playerId)}'s go-ahead homer in the ${ordinal(m.inning)} lifts ${T(team)}`, team);
            break;
          case Moment.Cycle: add(`${P(m.playerId)} hits for the cycle`, team, true); break;
          case Moment.ThreeHomers: add(`${P(m.playerId)} homers three times`, team, true); break;
          case Moment.GoldenSombrero: add(`${P(m.playerId)} wears the golden sombrero: four strikeouts`, team); break;
          case Moment.NoHitter:
            if (m.playerId) add(`${P(m.playerId)} no-hits ${T(opp)}`, team, true);
            else add(`${T(g.score[0] > g.score[1] ? away : home)} combine on a no-hitter`, g.score[0] > g.score[1] ? away : home, true);
            break;
          case Moment.PerfectGame: add(`PERFECT GAME: ${P(m.playerId)} retires all 27 ${T(opp)} hitters`, team, true); break;
          case Moment.ImmaculateInning: add(`${P(m.playerId)} throws an immaculate inning: 9 pitches, 3 strikeouts`, team, true); break;
          case Moment.TriplePlay: add(`${T(opp)} turn a triple play on ${P(m.playerId)}`, opp, true); break;
          case Moment.ShutoutCG: add(`${P(m.playerId)} throws a complete-game shutout`, team); break;
        }
      }
      // Home run milestones: 20, 30, 40... (regular season)
      if (g.kind !== 'post') for (const [id, line] of g.batting) {
        if (!line.HR) continue;
        const after = this.season.batting.get(id)?.HR ?? 0, before = after - line.HR;
        const mark = Math.floor(after / 10) * 10;
        if (mark >= 20 && before < mark) add(`${P(id)} hits his ${ordinal(mark)} home run`, this.teamOf.get(id) ?? 0, mark >= 50);
      }
    }
    // Streaks reaching 7, 10, 13...
    const played = new Set(results.filter((g) => g.kind !== 'post').flatMap((g) => g.teamIds));
    for (const id of played) {
      const st = this.season.standings.get(id)!.streak, n = Math.abs(st);
      if (n >= 7 && (n - 7) % 3 === 0) add(st > 0 ? `${T(id)} have won ${n} straight` : `${T(id)} have lost ${n} straight`, id, n >= 10);
    }
  }
}

// ---------------------------------------------------------------- saves

export interface SaveData { v: number; seed: number; team: number; day: number }
const KEY = 'baseball-gods/save';

export function writeSave(s: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: the password still works */ }
}
export function readSave(): SaveData | null {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SaveData | null;
    return j && j.v === SAVE_VERSION && Number.isInteger(j.seed) && j.team >= 1 && j.team <= 30 && j.day >= 0 ? j : null;
  } catch { return null; }
}
export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

// A ten-character password, NES style: version(2) seed(31) team(5) day(8) check(4) = 50 bits = 10 base-32 characters.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const check = (v: number, seed: number, team: number, day: number) => (v ^ seed ^ (seed >>> 8) ^ (seed >>> 16) ^ (seed >>> 24) ^ (team * 7) ^ (day * 13)) & 15;

export function toPassword(s: SaveData): string {
  let n = BigInt(s.v & 3);
  n = (n << 31n) | BigInt(s.seed >>> 0 & 0x7fffffff);
  n = (n << 5n) | BigInt(s.team & 31);
  n = (n << 8n) | BigInt(s.day & 255);
  n = (n << 4n) | BigInt(check(s.v, s.seed, s.team, s.day));
  let out = '';
  for (let i = 0; i < 10; i++) { out = B32[Number(n & 31n)] + out; n >>= 5n; }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function fromPassword(text: string): SaveData | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-Z]{10}$/.test(clean)) return null;
  let n = 0n;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    n = (n << 5n) | BigInt(v);
  }
  const chk = Number(n & 15n); n >>= 4n;
  const day = Number(n & 255n); n >>= 8n;
  const team = Number(n & 31n); n >>= 5n;
  const seed = Number(n & 0x7fffffffn); n >>= 31n;
  const v = Number(n & 3n);
  if (chk !== check(v, seed, team, day) || v !== SAVE_VERSION || team < 1 || team > 30) return null;
  return { v, seed, team, day };
}

export const newSeed = (): number => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff; }
  catch { return Math.floor(Math.random() * 0x7fffffff); }
};
