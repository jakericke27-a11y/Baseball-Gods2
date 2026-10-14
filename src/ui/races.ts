/**
 * Races and storylines for the screens and the headlines (step 2.1): the playoff race with odds, leader
 * races, the Triple Crown watch, milestone and record chases, hot and cold players, and streaks.
 * The math lives in engine/season/races.ts; this file words it.
 */
import { ordinal } from '../engine/game/text';
import type { BatLine, GameResult, PitchLine } from '../engine/game/types';
import {
  careerBefore, catchUpStreaks, gamesLeft, LOW_IS_GOOD, linesSince, MILESTONES, nextMark, playoffRace, seasonRecords,
  type CareerKey, type RecordKey, type SeasonRecord, type StreakChange, type TeamRace,
} from '../engine/season/races';
import { regularOver } from '../engine/season/season';
import type { Game, Headline } from './state';
import { avg, era, era2, ip, leaders, obp, rate3, slg } from './stats';
import { DIVISIONS, LEAGUES, teamName } from './teams';

// ---------------------------------------------------------------- caches (per game, per day)

const cache = new WeakMap<Game, Map<string, unknown>>();
function memo<T>(g: Game, key: string, make: () => T): T {
  let m = cache.get(g);
  if (!m) cache.set(g, (m = new Map()));
  const k = `${g.year}:${g.day}:${g.season.results.length}:${key}`;
  if (!m.has(k)) {
    for (const old of m.keys()) if (old.endsWith(`:${key}`)) m.delete(old);
    m.set(k, make());
  }
  return m.get(k) as T;
}

/** The playoff race with odds (a few hundred sims, cached for the day). */
export const playoffPicture = (g: Game): TeamRace[] => memo(g, 'race', () => playoffRace(g.season, 300));
export const recordsOf = (g: Game) => memo(g, 'records', () => seasonRecords(g.league));
const careers = (g: Game) => memo(g, 'careers', () => careerBefore(g.league));

/** "64% to make it", "Clinched the division", "Eliminated". */
export function oddsText(t: TeamRace): string {
  if (t.clinched === 'division') return 'Clinched the division';
  if (t.clinched === 'berth') return 'Clinched a playoff spot';
  if (t.eliminated) return 'Eliminated';
  if (Number.isNaN(t.odds.berth)) return '';
  return `${pctText(t.odds.berth, true)} playoff odds`;
}
/** Odds as a percentage. `alive`: still mathematically possible, so a zero from the sims reads "<1%". Certainties show only when proven. */
export const pctText = (p: number, alive = false, sure = false) =>
  p === 0 && alive ? '<1%' : p === 1 && !sure ? '>99%' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(100 * p)}%`;

// ---------------------------------------------------------------- leader races

export interface LeaderRace {
  key: RecordKey; label: string; pitching: boolean;
  top: Array<{ id: number; value: number; shown: string }>;
  /** The gap between first and second, worded ("3 HR", ".004"). */
  gap: string;
  /** How tight it is: 0 = dead even, 1+ = not a race. */
  closeness: number;
  /** Counting stats: the leader's full-season pace. */
  pace: number | null;
  record?: SeasonRecord;
  /** Games left for the leader's team. */
  left: number;
}

const RACE_CATS: Array<{ key: RecordKey; stat: string; label: string; pitching: boolean; unit: string; close: number }> = [
  { key: 'AVG', stat: 'AVG', label: 'Batting title', pitching: false, unit: '', close: 0.012 },
  { key: 'HR', stat: 'HR', label: 'Home runs', pitching: false, unit: 'HR', close: 4 },
  { key: 'RBI', stat: 'RBI', label: 'Runs batted in', pitching: false, unit: 'RBI', close: 8 },
  { key: 'H', stat: 'H', label: 'Hits', pitching: false, unit: 'H', close: 8 },
  { key: 'SB', stat: 'SB', label: 'Stolen bases', pitching: false, unit: 'SB', close: 5 },
  { key: 'ERA', stat: 'ERA', label: 'ERA title', pitching: true, unit: '', close: 0.3 },
  { key: 'W', stat: 'W', label: 'Wins', pitching: true, unit: 'W', close: 2 },
  { key: 'SO', stat: 'SO', label: 'Strikeouts', pitching: true, unit: 'K', close: 15 },
  { key: 'SV', stat: 'SV', label: 'Saves', pitching: true, unit: 'SV', close: 4 },
];

const teamLeft = (g: Game, id: number) => {
  const t = g.teamOf.get(id) ?? 0, r = g.season.standings.get(t);
  return r ? { played: r.W + r.L, left: memo(g, 'left', () => gamesLeft(g.season)).get(t) ?? 0 } : { played: 0, left: 0 };
};
/** Leaders' true values (the leaderboard negates ERA so higher sorts first). */
const trueValue = (key: RecordKey, v: number) => (key === 'ERA' ? -v : v);

export function leaderRaces(g: Game): LeaderRace[] {
  return memo(g, 'leaders', () => RACE_CATS.map((c) => {
    const top = leaders(g, c.stat, 3).map((l) => ({ ...l, value: trueValue(c.key, l.value) }));
    const a = top[0], b = top[1];
    const diff = a && b ? Math.abs(a.value - b.value) : Infinity;
    const gap = !b ? '' : c.key === 'AVG' ? rate3(diff) : c.key === 'ERA' ? diff.toFixed(2) : `${diff} ${c.unit}`;
    const tl = a ? teamLeft(g, a.id) : { played: 0, left: 0 };
    const pace = a && !['AVG', 'ERA'].includes(c.key) && tl.played >= 20 ? Math.round((a.value * (tl.played + tl.left)) / tl.played) : null;
    return { key: c.key, label: c.label, pitching: c.pitching, top, gap, closeness: diff / c.close, pace, record: recordsOf(g).get(c.key), left: tl.left };
  }));
}

/** "64 HR (Year 3, Name)" */
export function recordText(g: Game, r: SeasonRecord): string {
  const v = r.key === 'AVG' ? rate3(r.value) : r.key === 'ERA' ? era2(r.value) : String(r.value);
  return `${v} by ${g.name(r.playerId)}, Year ${r.year}`;
}
const beats = (key: RecordKey, v: number, rec?: SeasonRecord) => !!rec && (LOW_IS_GOOD.has(key) ? v < rec.value : v > rec.value);

// ---------------------------------------------------------------- Triple Crown watch

export interface CrownWatch { pitching: boolean; playerId: number; leads: string[]; chasing: Array<{ cat: string; behind: string }> }

/** Anyone leading two of the three crown categories and close in the third (or leading all three). */
export function crownWatch(g: Game): CrownWatch[] {
  const races = leaderRaces(g), out: CrownWatch[] = [];
  for (const [pitching, cats] of [[false, ['AVG', 'HR', 'RBI']], [true, ['W', 'SO', 'ERA']]] as const) {
    const rs = cats.map((k) => races.find((r) => r.key === k)!);
    const ids = new Set(rs.flatMap((r) => r.top.slice(0, 1).map((t) => t.id)));
    for (const id of ids) {
      const leads = rs.filter((r) => r.top[0]?.id === id);
      if (leads.length < 2) continue;
      const chasing = rs.filter((r) => r.top[0]?.id !== id).flatMap((r) => {
        const me = r.top.find((t) => t.id === id);
        if (!me) return [];
        const behind = Math.abs(r.top[0].value - me.value);
        const cat = RACE_CATS.find((c) => c.key === r.key)!;
        if (behind > cat.close) return [];
        return [{ cat: r.key, behind: r.key === 'AVG' ? rate3(behind) : r.key === 'ERA' ? behind.toFixed(2) : `${behind}` }];
      });
      if (leads.length === 3 || chasing.length) out.push({ pitching, playerId: id, leads: leads.map((r) => r.key), chasing });
    }
  }
  return out;
}

// ---------------------------------------------------------------- milestone and record chases

export interface Chase { playerId: number; text: string; left: number; key: string }

const seasonCount = (g: Game, key: CareerKey, id: number) => {
  const b = g.season.batting.get(id), p = g.season.pitching.get(id);
  return key === 'HR' ? b?.HR ?? 0 : key === 'H' ? b?.H ?? 0 : key === 'W' ? p?.W ?? 0 : key === 'SO' ? p?.K ?? 0 : p?.SV ?? 0;
};

/** Career milestones within reach, closest first. */
export function milestoneChases(g: Game): Chase[] {
  return memo(g, 'milestones', () => {
    const out: Chase[] = [], before = careers(g);
    for (const key of Object.keys(MILESTONES) as CareerKey[]) {
      const ids = new Set([...before[key].keys()]);
      for (const id of ids) {
        if (!g.teamOf.has(id)) continue;
        const total = (before[key].get(id) ?? 0) + seasonCount(g, key, id), mark = nextMark(key, total);
        if (mark === undefined || mark - total > MILESTONES[key].near) continue;
        out.push({ playerId: id, key, left: mark - total, text: `${mark - total} from ${mark} career ${MILESTONES[key].label} (${total})` });
      }
    }
    return out.sort((a, b) => a.left / MILESTONES[a.key as CareerKey].near - b.left / MILESTONES[b.key as CareerKey].near);
  });
}

/** Leaders on pace to break a league single-season record. */
export function recordChases(g: Game): Chase[] {
  const out: Chase[] = [];
  for (const r of leaderRaces(g)) {
    const a = r.top[0];
    if (!a || !r.record) continue;
    if (r.pace !== null && r.pace > r.record.value) out.push({ playerId: a.id, key: r.key, left: r.record.value - a.value, text: `on pace for ${r.pace} ${unitOf(r.key)}; the record is ${recordText(g, r.record)}` });
    if (r.pace === null && beats(r.key, a.value, r.record)) out.push({ playerId: a.id, key: r.key, left: 0, text: `${a.shown} ${r.key} would beat the record of ${recordText(g, r.record)}` });
  }
  return out;
}
const unitOf = (k: RecordKey) => ({ HR: 'homers', H: 'hits', RBI: 'RBI', SB: 'steals', W: 'wins', SO: 'strikeouts', SV: 'saves', AVG: '', ERA: '' })[k];

// ---------------------------------------------------------------- hot and cold

export interface Form { id: number; shown: string; season: string; line: string }
export const FORM_WINDOWS = [7, 14, 30] as const;
const MIN_PA = { 7: 20, 14: 40, 30: 85 } as const;
const MIN_OUTS = { 7: 15, 14: 30, 30: 75 } as const;

export function hotCold(g: Game, days: 7 | 14 | 30) {
  return memo(g, `form${days}`, () => {
    const { batting, pitching } = linesSince(g.season.results, g.day - days);
    const ops = (l: BatLine) => obp(l) + slg(l);
    const bats = [...batting].filter(([, l]) => l.PA >= MIN_PA[days]).map(([id, l]) => {
      const s = g.season.batting.get(id)!;
      return { id, v: ops(l), f: { id, shown: rate3(ops(l)), season: rate3(ops(s)), line: `${l.H}-for-${l.AB}, ${l.HR} HR` } as Form };
    }).sort((a, b) => b.v - a.v);
    const arms = [...pitching].filter(([, l]) => l.outs >= MIN_OUTS[days]).map(([id, l]) => {
      const s = g.season.pitching.get(id)!;
      return { id, v: era(l), f: { id, shown: era2(era(l)), season: era2(era(s)), line: `${ip(l.outs)} IP, ${l.K} K` } as Form };
    }).sort((a, b) => a.v - b.v);
    return {
      hotBats: bats.slice(0, 5).map((x) => x.f), coldBats: bats.slice(-5).reverse().map((x) => x.f),
      hotArms: arms.slice(0, 5).map((x) => x.f), coldArms: arms.slice(-5).reverse().map((x) => x.f),
    };
  });
}

// ---------------------------------------------------------------- streaks

export const inningsText = (outs: number) => { const w = Math.floor(outs / 3), r = outs % 3; return `${w}${r ? (r === 1 ? '⅓' : '⅔') : ''}`; };

/** The longest active streaks of each kind (rostered players). */
export function activeStreaks(g: Game) {
  catchUpStreaks(g.streaks, g.season.results);
  const top = (m: Map<number, number>, min: number) => [...m].filter(([id, v]) => v >= min && g.teamOf.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { hit: top(g.streaks.hit, 5), onBase: top(g.streaks.onBase, 10), scoreless: top(g.streaks.scoreless, 30), best: g.streaks.best };
}

// ---------------------------------------------------------------- headlines

type Status = Map<number, { clinched: TeamRace['clinched']; eliminated: boolean }>;
/** Streak lengths that make the news (set above MLB's usual marks while streaks run long; see DESIGN.md). */
const HIT_STREAK_NEWS = 25, ON_BASE_NEWS = 40;
/** Clinches and eliminations only start to matter in the last ten weeks; skipping earlier days keeps sims fast. */
const RACE_WATCH_DAYS = 75;

/** Today's race status (no odds: just the proofs), for comparing day to day. */
export function raceStatus(g: Game): Status | null {
  if (g.season.regularDays - g.day > RACE_WATCH_DAYS) return null;
  return new Map(playoffRace(g.season, 0).map((t) => [t.teamId, { clinched: t.clinched, eliminated: t.eliminated }]));
}

/**
 * Headlines from the races, after a day is simmed: clinches and eliminations, streaks, career milestones,
 * records falling, and (weekly, late in the year) close leader races and the Triple Crown watch.
 */
export function raceHeadlines(g: Game, day: number, results: GameResult[], before: Status | null, changes: StreakChange[]): Headline[] {
  const out: Headline[] = [];
  const add = (text: string, teamId: number, big = false) => out.push({ day, text, teamId, big });
  const P = (id: number) => g.name(id), T = teamName;
  const tOf = (id: number) => g.teamOf.get(id) ?? 0;
  const regular = results.filter((r) => r.kind !== 'post');

  // clinches and eliminations
  const after = before ? raceStatus(g) : null;
  const out_: number[] = [];
  if (before && after) for (const [id, now] of after) {
    const was = before.get(id)!, t = g.league.teams.find((x) => x.id === id)!;
    if (now.clinched === 'division' && was.clinched !== 'division') add(`${T(id)} clinch the ${LEAGUES[t.conference]} ${DIVISIONS[t.division]}`, id, true);
    else if (now.clinched === 'berth' && !was.clinched) add(`${T(id)} clinch a playoff spot`, id, true);
    if (now.eliminated && !was.eliminated) out_.push(id);
  }
  // eliminations: yours on its own line, the rest of the day's in one
  if (out_.includes(g.userTeam)) add(`${T(g.userTeam)} are eliminated from the postseason race`, g.userTeam, true);
  const others = out_.filter((id) => id !== g.userTeam).map(T);
  if (others.length) add(`${others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)} are` : `${others[0]} are`} eliminated from the postseason race`, 0);

  // streaks
  for (const c of changes) {
    const team = tOf(c.playerId);
    if (c.kind === 'hit') {
      if (c.after >= HIT_STREAK_NEWS && c.after % 5 === 0) add(`${P(c.playerId)} extends his hitting streak to ${c.after} games`, team, c.after >= 35);
      if (c.after === 0 && c.before >= HIT_STREAK_NEWS) add(`${P(c.playerId)}'s ${c.before}-game hitting streak ends`, team);
    } else if (c.kind === 'onBase') {
      if (c.after >= ON_BASE_NEWS && c.after % 5 === 0) add(`${P(c.playerId)} has reached base in ${c.after} straight games`, team, c.after >= 55);
      if (c.after === 0 && c.before >= ON_BASE_NEWS) add(`${P(c.playerId)}'s ${c.before}-game on-base streak ends`, team);
    } else {
      const inn = (o: number) => Math.floor(o / 3);
      if (inn(c.after) >= 25 && Math.floor(inn(c.after) / 5) > Math.floor(inn(c.before) / 5)) add(`${P(c.playerId)} runs his scoreless streak to ${inningsText(c.after)} innings`, team, inn(c.after) >= 40);
      if (c.after === 0 && inn(c.before) >= 25) add(`${P(c.playerId)}'s scoreless streak ends at ${inningsText(c.before)} innings`, team);
    }
  }

  // career milestones and season records, from today's lines
  const today = { batting: new Map<number, BatLine>(), pitching: new Map<number, PitchLine>() };
  for (const r of regular) { for (const [id, l] of r.batting) today.batting.set(id, l); for (const [id, l] of r.pitching) today.pitching.set(id, l); }
  const car = careers(g), recs = recordsOf(g);
  const todayCount = (key: CareerKey, id: number) => {
    const b = today.batting.get(id), p = today.pitching.get(id);
    return key === 'HR' ? b?.HR ?? 0 : key === 'H' ? b?.H ?? 0 : key === 'W' ? p?.W ?? 0 : key === 'SO' ? p?.K ?? 0 : p?.SV ?? 0;
  };
  const verb: Record<CareerKey, string> = { HR: 'hits his', H: 'collects his', W: 'earns his', SO: 'records his', SV: 'nails down his' };
  const noun: Record<CareerKey, string> = { HR: 'career home run', H: 'career hit', W: 'career win', SO: 'career strikeout', SV: 'career save' };
  for (const key of Object.keys(MILESTONES) as CareerKey[]) {
    for (const id of new Set([...today.batting.keys(), ...today.pitching.keys()])) {
      const n = todayCount(key, id);
      if (!n) continue;
      const nowSeason = seasonCount(g, key, id), afterC = (car[key].get(id) ?? 0) + nowSeason, beforeC = afterC - n;
      const mark = MILESTONES[key].marks.find((m) => beforeC < m && afterC >= m);
      if (mark) add(`${P(id)} ${verb[key]} ${mark.toLocaleString('en-US')}th ${noun[key]}`, tOf(id), mark >= MILESTONES[key].marks[2]);
    }
  }
  // single-season records (counting stats) fall the day they're passed, against history and this year alike
  const COUNT: Array<[RecordKey, 'bat' | 'pit', string, string]> = [
    ['HR', 'bat', 'HR', 'home run'], ['H', 'bat', 'H', 'hit'], ['RBI', 'bat', 'RBI', 'RBI'], ['SB', 'bat', 'SB', 'stolen base'],
    ['W', 'pit', 'W', 'win'], ['SO', 'pit', 'K', 'strikeout'], ['SV', 'pit', 'SV', 'save'],
  ];
  for (const [key, side, field, word] of COUNT) {
    const lines = (side === 'bat' ? g.season.batting : g.season.pitching) as unknown as Map<number, Record<string, number>>;
    const todays = (side === 'bat' ? today.batting : today.pitching) as unknown as Map<number, Record<string, number>>;
    const hist = recs.get(key);
    if (!hist || ![...todays.values()].some((l) => l[field] > 0)) continue; // no history yet: Year 1 sets the first marks quietly
    // this morning's two best this year, so each player is measured against everyone else
    const top: Array<[number, number]> = [[-1, 0], [-1, 0]];
    for (const [other, ol] of lines) {
      const v = ol[field] - (todays.get(other)?.[field] ?? 0);
      if (v > top[0][1]) { top[1] = top[0]; top[0] = [other, v]; } else if (v > top[1][1]) top[1] = [other, v];
    }
    for (const [id, l] of todays) {
      const n = l[field], now = lines.get(id)?.[field] ?? 0;
      if (!n) continue;
      const best = top[0][0] === id ? top[1] : top[0];
      let mark = hist.value, holder = hist.playerId, thisYear = false;
      if (best[1] > mark) { mark = best[1]; holder = best[0]; thisYear = true; }
      if (now - n <= mark && now > mark) add(`RECORD: ${P(id)}'s ${ordinal(now)} ${word} passes ${holder === id ? `his own Year ${hist.year} mark` : `${P(holder)}${thisYear ? ' (this year)' : ` (Year ${hist.year})`}`} for the league record`, tOf(id), true);
    }
  }

  // late in the year, weekly: close leader races, the Triple Crown watch, record paces
  const left = g.season.regularDays - g.day;
  if (regular.length && left > 0 && left % 7 === 0 && left <= 42) {
    const close = leaderRaces(g).filter((r) => r.top.length > 1 && r.closeness <= 1 && left <= 28).sort((a, b) => a.closeness - b.closeness).slice(0, 2);
    for (const r of close) {
      const [a, b] = r.top;
      add(`${r.label} race: ${P(a.id)} ${a.shown}, ${P(b.id)} ${b.shown}${r.closeness === 0 ? ' (tied)' : ''} with ${r.left} games left`, tOf(a.id));
    }
    for (const w of crownWatch(g).filter((w) => w.leads.length === 3)) add(`Triple Crown watch: ${P(w.playerId)} leads the league in ${w.pitching ? 'wins, strikeouts and ERA' : 'average, homers and RBI'}`, tOf(w.playerId), true);
  }
  if (regular.length && left > 0 && (left === 60 || left === 30)) {
    for (const c of recordChases(g).slice(0, 2)) add(`${P(c.playerId)} is ${c.text}`, tOf(c.playerId));
  }

  // the regular season's last day: titles and crowns
  if (regular.length && regularOver(g.season) && !g.headlines.some((h) => h.text.startsWith('Regular season over'))) {
    const races = leaderRaces(g), lead = (k: RecordKey) => races.find((r) => r.key === k)?.top[0];
    const bat = lead('AVG'), era1 = lead('ERA');
    add(`Regular season over: ${bat ? `${P(bat.id)} wins the batting title at ${bat.shown}` : 'no batting title qualifier'}${era1 ? `; ${P(era1.id)} takes the ERA title at ${era1.shown}` : ''}`, bat ? tOf(bat.id) : 0, true);
    for (const w of crownWatch(g).filter((x) => x.leads.length === 3)) add(`TRIPLE CROWN: ${P(w.playerId)} leads the league in ${w.pitching ? 'wins, strikeouts and ERA' : 'average, homers and RBI'}`, tOf(w.playerId), true);
    for (const k of ['AVG', 'ERA'] as const) {
      const a = lead(k), rec = recs.get(k);
      if (a && beats(k, a.value, rec)) add(`RECORD: ${P(a.id)}'s ${a.shown} ${k === 'AVG' ? 'average' : 'ERA'} is the best in league history`, tOf(a.id), true);
    }
  }
  return out;
}
