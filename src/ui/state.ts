/**
 * The running game: league, season, your team, headlines, saves.
 * A save is just (seed, team, day): the engine is deterministic, so loading replays the year to that day.
 */
import baseline from '../../calibration/baseline.json';
import { DEFAULT_PARAMS } from '../engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../engine/atbat/environment';
import { generateLeague } from '../engine/generate';
import { ordinal } from '../engine/game/text';
import { Moment, type BullpenRole, type GameMove, type GameResult } from '../engine/game/types';
import { beginWinter, finishWinter, type OffseasonReport, type Winter } from '../engine/offseason';
import { refreshPlan } from '../engine/roster';
import { createSeason, isOver, liveStep, simDay, startLiveDay, type LiveDay, type Season } from '../engine/season/season';
import type { League, Player } from '../engine/types';
import { postHeadlines } from './post';
import { raceHeadlines, raceStatus } from './races';
import { catchUpStreaks, newStreakBook, type StreakBook } from '../engine/season/races';
import { teamName } from './teams';
import { cardsAfterDay, cardsBeforeWinter, cardsNewYear, newBook, type CardBook, type CardInst, type SimMode } from './cards';

export const PARAMS = applyEnvironment(DEFAULT_PARAMS, baseline as LeagueEnvironment);
/** Bump when engine changes would replay an old save differently. */
export const SAVE_VERSION = 1;

export interface Headline { day: number; text: string; teamId: number; big: boolean }

export class Game {
  readonly seed: number;
  league!: League;
  season!: Season;
  players!: Map<number, Player>;
  teamOf = new Map<number, number>();
  userTeam: number;
  /** This year's headlines. */
  headlines: Headline[] = [];
  /** Result indices (into season.results) by calendar day. */
  byDay = new Map<number, number[]>();
  /** What happened over the last winter (Year 2 on). */
  offseason: OffseasonReport | null = null;
  /** A winter in progress (a draft waiting for you). Not saved: a reload replays the winter exactly from the year-end save. */
  winter: Winter | null = null;
  /** Running streaks (hitting, on-base, scoreless), kept up to date with the season's results. */
  streaks: StreakBook = newStreakBook();
  /** You made founding-draft picks yourself (then the Year 1 password, which replays an auto-drafted league, can't help). */
  draftedByHand = false;
  /** You made a move in a live game that the bench coach wouldn't have (then the Year 1 password can't replay the year). */
  movedByHand = false;
  /** Decision cards and missions (cards.ts): saved with the league. */
  cards: CardBook = newBook();
  /** How the days are being simmed right now, for the card rules. */
  simMode: SimMode = 'day';
  /** Replaying a year from its password: no cards come up. */
  replaying = false;
  /** Cards that just landed on your desk (the app shows the pop-up and clears this). */
  landed: CardInst[] = [];

  /** A new league, or (with `season`) one restored from a save. */
  constructor(seed: number, userTeam: number, league?: League, season?: Season) {
    this.seed = seed;
    this.userTeam = userTeam;
    this.bind(season ?? createSeason(league ?? generateLeague(seed), PARAMS, { year: 1, seed, logs: true, postseason: true, rosterRules: true, userTeam }));
  }

  private bind(season: Season): void {
    this.season = season;
    season.rosterRules = true;
    season.userTeam = this.userTeam;
    const mine = season.league.teams.find((t) => t.id === this.userTeam);
    if (mine && !mine.auto) mine.auto = { lineup: true, staff: true, roster: true };
    this.league = season.league;
    this.players = season.players;
    this.teamOf = new Map();
    for (const t of this.league.teams) for (const id of t.playerIds) this.teamOf.set(id, t.id);
    this.byDay = new Map();
    season.results.forEach((g, i) => { const a = this.byDay.get(g.day) ?? []; a.push(i); this.byDay.set(g.day, a); });
    this.streaks = newStreakBook();
    catchUpStreaks(this.streaks, season.results);
  }

  get year() { return this.season.year; }
  get team() { return this.league.teams.find((t) => t.id === this.userTeam)!; }
  get plan() { return this.season.plans.get(this.userTeam)!; }

  // ---------------------------------------------------------------- your roster (roster.ts has the rules)

  /** Hand a part back to the AI (rebuilt now), or take it over. */
  setAuto(part: 'lineup' | 'staff' | 'roster', on: boolean): void {
    this.team.auto![part] = on;
    if (on && part !== 'roster') refreshPlan(this.season, this.team);
  }
  private byHand(part: 'lineup' | 'staff') { this.team.auto![part] = false; }
  lineupMove(i: number, dir: number): void {
    const L = this.plan.lineup, j = i + dir;
    if (j < 0 || j >= L.length) return;
    [L[i], L[j]] = [L[j], L[i]];
    this.byHand('lineup');
  }
  /** Give slot i a position; whoever had it takes slot i's old one. */
  lineupPos(i: number, pos: number): void {
    const L = this.plan.lineup, k = L.findIndex((l) => l.pos === pos);
    if (k >= 0) L[k] = { ...L[k], pos: L[i].pos };
    L[i] = { ...L[i], pos };
    this.byHand('lineup');
  }
  /** Put an active bench player into slot i (same position, same spot in the order). */
  lineupSub(i: number, playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || this.plan.lineup.some((l) => l.player.id === playerId)) return;
    this.plan.lineup[i] = { player: p, pos: this.plan.lineup[i].pos };
    this.byHand('lineup');
  }
  rotationMove(i: number, dir: number): void {
    const R = this.plan.rotation, j = i + dir;
    if (j < 0 || j >= R.length) return;
    [R[i], R[j]] = [R[j], R[i]];
    this.byHand('staff');
  }
  /** Swap a starter with a bullpen arm: the reliever takes his rotation spot, the starter his bullpen role. */
  rotationSwap(i: number, playerId: number): void {
    const pen = this.plan.bullpen, k = pen.findIndex((a) => a.player.id === playerId);
    if (k < 0) return;
    const starter = this.plan.rotation[i];
    this.plan.rotation[i] = pen[k].player;
    pen[k] = { player: starter, role: pen[k].role };
    this.byHand('staff');
  }
  /** A bullpen role. Naming a new closer moves the old one to setup. */
  penRole(i: number, role: BullpenRole): void {
    const pen = this.plan.bullpen;
    if (role === 'CL') pen.forEach((a, k) => { if (a.role === 'CL' && k !== i) pen[k] = { ...a, role: 'SU' }; });
    pen[i] = { ...pen[i], role };
    this.byHand('staff');
  }

  /** After the final: the first half of the winter. In a draft year a draft is waiting (this.winter.draft). */
  beginWinter(): Winter {
    if (!this.over) throw new Error('the year is not over');
    cardsBeforeWinter(this);
    this.winter = beginWinter(this.season);
    return this.winter;
  }
  /** The rest of the winter (any picks left are the AI's), then Opening Day of the next year. */
  finishWinter(): OffseasonReport {
    const w = this.winter ?? this.beginWinter();
    const { season, report } = finishWinter(w);
    this.winter = null;
    this.bind(season);
    this.headlines = [];
    if (report.decree) this.headlines.push({ day: 0, text: `The Gods decree ${report.decree.label.toUpperCase()}: ${report.decree.effect}`, teamId: 0, big: true });
    this.offseason = report;
    this.landed.push(...cardsNewYear(this));
    return report;
  }
  startNextYear(): OffseasonReport { this.beginWinter(); return this.finishWinter(); }

  get day() { return this.season.day; }
  get over() { return isOver(this.season); }
  /** Anyone's name: current players, then retired ones (record holders, career lines). */
  name = (id: number) => this.players.get(id)?.name ?? this.league.retired.find((p) => p.id === id)?.name ?? '?';

  /** Simulate one calendar day (often an off day for some teams, sometimes for everyone). */
  simDay(): GameResult[] {
    const day = this.season.day;
    const before = raceStatus(this);
    const results = simDay(this.season);
    this.afterDay(day, results, before);
    return results;
  }

  private afterDay(day: number, results: GameResult[], before: ReturnType<typeof raceStatus>): void {
    const start = this.season.results.length - results.length;
    if (results.length) this.byDay.set(day, results.map((_, i) => start + i));
    this.addHeadlines(day, results);
    this.headlines.push(...postHeadlines(this, day, results));
    this.headlines.push(...raceHeadlines(this, day, results, before, catchUpStreaks(this.streaks, this.season.results)));
    if (!this.replaying) this.landed.push(...cardsAfterDay(this, day, results, this.simMode));
  }

  // ---------------------------------------------------------------- your game, live

  /** Today, with your game played live (the rest of the day sims around it). Null if you're off today. */
  live: { day: LiveDay; date: number; before: ReturnType<typeof raceStatus> } | null = null;

  startLive(): boolean {
    if (this.live || this.over) return !!this.live;
    const date = this.season.day, before = raceStatus(this);
    const day = startLiveDay(this.season, this.userTeam);
    if (!day) return false;
    this.live = { day, date, before };
    if (!day.call) this.endLive();
    return true;
  }
  /** Your side in the live game (0 away, 1 home). */
  get liveSide(): number { const d = this.live?.day; return d ? (d.setups[0].teamId === this.userTeam ? 0 : 1) : 0; }
  /** A move takes effect now; the game waits for you again. */
  liveMove(m: GameMove): void {
    const c = this.live?.day.call;
    if (!c) return;
    if (!(m.kind === 'pitcher' && c.aiPitch[m.side] === m.id)) this.movedByHand = true; // saying yes to the bench coach changes nothing
    liveStep(this.live!.day, [m]);
  }
  /** Play on to the next decision point. Returns your finished game when it ends. */
  liveAdvance(): GameResult | null {
    if (!this.live) return null;
    const res = liveStep(this.live.day, []);
    if (res || !this.live.day.call) return this.endLive();
    return null;
  }
  /** Let the AI finish your game (leaving early). */
  liveFinish(): GameResult | null {
    let res: GameResult | null = null;
    while (this.live && !res) res = this.liveAdvance();
    return res;
  }
  private endLive(): GameResult | null {
    const l = this.live!;
    this.live = null;
    this.afterDay(l.date, l.day.results, l.before);
    return l.day.results.find((r) => r.teamIds.includes(this.userTeam)) ?? null;
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
