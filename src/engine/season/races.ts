/**
 * Races and storylines (step 2.1): who's in, who's out, and who's chasing what. Everything here reads the
 * season and changes nothing; the RNG for playoff odds is its own, seeded from the year and day, so asking
 * for odds never shifts the season's dice.
 *
 *  - Playoff odds: the rest of the regular schedule as weighted coin flips (log5 of each team's strength,
 *    a run-differential estimate pulled toward .500, plus a small home edge), run a few hundred times.
 *  - Magic and elimination numbers, the usual formula: (their wins + their games left) − your wins + 1.
 *  - Clinched and eliminated are proofs, not estimates: clinched means you're in even if you lose out and
 *    everyone else wins out; eliminated means you're out even if you win out and everyone else loses out.
 *  - Streaks run game by game through the season's results (regular season only).
 */
import { BAT_FIELDS, PITCH_FIELDS } from '../history';
import type { BatLine, GameResult, PitchLine } from '../game/types';
import { createRng } from '../rng';
import type { League } from '../types';
import type { Season, StandingRow } from './season';

// ---------------------------------------------------------------- the playoff picture

/** Postseason berths per league: three division winners and two wild cards. */
export const BERTHS = { divisions: 3, wildCards: 2 } as const;
/** Home teams win a little more often (MLB ≈ .535). */
const HOME_EDGE = 0.035;
/** Games of .500 ball blended into each team's run-differential estimate. */
const REGRESS_GAMES = 40;

export interface TeamRace {
  teamId: number; league: number; division: number;
  W: number; L: number; left: number;
  /** Playoff odds from the simulation, 0–1. */
  odds: { division: number; berth: number };
  /** Games to clinch the division (leader) or a berth (wild card holders); null otherwise. */
  magic: number | null;
  /** Games from elimination (teams outside a spot); null for teams in a spot. */
  elim: number | null;
  clinched: 'division' | 'berth' | null;
  /** Out of the playoffs for certain. */
  eliminated: boolean;
  /** Out of the division race for certain (can still be a wild card). */
  divisionOut: boolean;
  /** Where the team sits today. */
  spot: 'division' | 'wildcard' | null;
}

const pctOf = (r: { W: number; L: number }) => (r.W + r.L ? r.W / (r.W + r.L) : 0.5);

/** Regular-season games left per team (from the next day to simulate). */
export function gamesLeft(s: Season): Map<number, number> {
  const left = new Map(s.league.teams.map((t) => [t.id, 0]));
  for (let d = s.day; d < s.regularDays; d++) for (const g of s.schedule.byDay[d] ?? []) {
    if (g.kind) continue;
    left.set(g.home, left.get(g.home)! + 1); left.set(g.away, left.get(g.away)! + 1);
  }
  return left;
}

/** A team's true-talent guess: Pythagorean record (exponent 1.83) pulled toward .500. */
function strength(r: StandingRow): number {
  const G = r.W + r.L;
  const pyth = r.RS + r.RA ? r.RS ** 1.83 / (r.RS ** 1.83 + r.RA ** 1.83) : 0.5;
  return (pyth * G + 0.5 * REGRESS_GAMES) / (G + REGRESS_GAMES);
}
const log5 = (a: number, b: number) => (a - a * b) / (a + b - 2 * a * b);

/** Seed one league from final win totals: division winners, then wild cards. Ties break by `tie`. */
function berthsOf(teams: Array<{ teamId: number; division: number; W: number; tie: number }>) {
  const byRec = [...teams].sort((a, b) => b.W - a.W || b.tie - a.tie);
  const winners = [0, 1, 2].map((d) => byRec.find((t) => t.division === d)!.teamId);
  const wild = byRec.filter((t) => !winners.includes(t.teamId)).slice(0, BERTHS.wildCards).map((t) => t.teamId);
  return { winners, wild };
}

/**
 * Proof checks for one team, against fixed final win totals for everyone else. `worst` ties go against the
 * team (clinch check); otherwise ties go its way (elimination check, since a tie means a Game 163).
 */
function makesIt(team: number, totals: Map<number, number>, teams: Array<{ teamId: number; division: number }>, ties: 'against' | 'for') {
  const tie = (id: number) => (id === team ? (ties === 'for' ? 1 : -1) : 0);
  const { winners, wild } = berthsOf(teams.map((t) => ({ ...t, W: totals.get(t.teamId)!, tie: tie(t.teamId) })));
  return { division: winners.includes(team), berth: winners.includes(team) || wild.includes(team) };
}

/** The whole playoff picture for both leagues. `sims` = 0 skips the odds (they come back as NaN). */
export function playoffRace(s: Season, sims = 400): TeamRace[] {
  const left = gamesLeft(s);
  const out: TeamRace[] = [];
  const over = s.day >= s.regularDays;
  // odds
  const div = new Map<number, number>(), berth = new Map<number, number>();
  if (sims > 0 && !over) {
    const rng = createRng((s.year * 7919 + s.day * 104729) ^ 0x2545f491);
    const str = new Map(s.league.teams.map((t) => [t.id, strength(s.standings.get(t.id)!)]));
    const games: Array<[number, number, number]> = []; // home, away, P(home wins)
    for (let d = s.day; d < s.regularDays; d++) for (const g of s.schedule.byDay[d] ?? []) {
      if (!g.kind) games.push([g.home, g.away, Math.min(0.97, log5(str.get(g.home)!, str.get(g.away)!) + HOME_EDGE)]);
    }
    const W = new Map<number, number>();
    for (let k = 0; k < sims; k++) {
      for (const t of s.league.teams) W.set(t.id, s.standings.get(t.id)!.W);
      for (const [h, a, p] of games) { const w = rng.next() < p ? h : a; W.set(w, W.get(w)! + 1); }
      for (const lg of [0, 1]) {
        const teams = s.league.teams.filter((t) => t.conference === lg).map((t) => ({ teamId: t.id, division: t.division, W: W.get(t.id)!, tie: rng.next() }));
        const { winners, wild } = berthsOf(teams);
        for (const id of winners) { div.set(id, (div.get(id) ?? 0) + 1); berth.set(id, (berth.get(id) ?? 0) + 1); }
        for (const id of wild) berth.set(id, (berth.get(id) ?? 0) + 1);
      }
    }
  }
  /** After the regular season the seeds are the answer; with no sims, the odds are unknown (NaN). */
  const odds = (id: number, lg: number, clinched: TeamRace['clinched'], bestCase: { division: boolean; berth: boolean }, n: number) => {
    if (over) {
      const seeds = s.post?.seeds[lg] ?? [];
      if (seeds.length) return { division: seeds.slice(0, 3).includes(id) ? 1 : 0, berth: seeds.includes(id) ? 1 : 0 };
      // Game 163s still to play: a coin flip for whatever is still open
      return { division: clinched === 'division' ? 1 : bestCase.division ? 0.5 : 0, berth: clinched ? 1 : bestCase.berth ? 0.5 : 0 };
    }
    if (sims <= 0) return { division: NaN, berth: NaN };
    return {
      division: clinched === 'division' ? 1 : !bestCase.division ? 0 : (div.get(id) ?? 0) / n,
      berth: clinched ? 1 : !bestCase.berth ? 0 : (berth.get(id) ?? 0) / n,
    };
  };
  for (const lg of [0, 1]) {
    const teams = s.league.teams.filter((t) => t.conference === lg).map((t) => ({ teamId: t.id, division: t.division }));
    const row = (id: number) => s.standings.get(id)!;
    const best = (id: number) => row(id).W + left.get(id)!;
    // today's spots (by winning percentage, as the standings show them)
    const ranked = teams.map((t) => ({ ...t, r: row(t.teamId) })).sort((a, b) => pctOf(b.r) - pctOf(a.r) || (b.r.RS - b.r.RA) - (a.r.RS - a.r.RA));
    const leaders = [0, 1, 2].map((d) => ranked.find((t) => t.division === d)!.teamId);
    const chasers = ranked.filter((t) => !leaders.includes(t.teamId)).map((t) => t.teamId);
    const holders = chasers.slice(0, BERTHS.wildCards), lineTeam = holders[holders.length - 1];
    for (const t of teams) {
      const id = t.teamId, me = row(id);
      const divLeader = leaders[t.division];
      const spot = leaders.includes(id) ? 'division' : holders.includes(id) ? 'wildcard' : null;
      let magic: number | null = null, elim: number | null = null;
      if (spot === 'division') {
        const rivals = teams.filter((x) => x.division === t.division && x.teamId !== id);
        magic = Math.max(0, Math.max(...rivals.map((x) => best(x.teamId))) - me.W + 1);
      } else if (spot === 'wildcard') {
        const behind = chasers.slice(BERTHS.wildCards);
        magic = behind.length ? Math.max(0, Math.max(...behind.map(best)) - me.W + 1) : 0;
      } else {
        const toDiv = best(id) - row(divLeader).W + 1, toWild = best(id) - row(lineTeam).W + 1;
        elim = Math.max(0, Math.max(toDiv, toWild));
      }
      // proofs
      const lose = new Map(teams.map((x) => [x.teamId, x.teamId === id ? me.W : best(x.teamId)]));
      const win = new Map(teams.map((x) => [x.teamId, x.teamId === id ? best(id) : row(x.teamId).W]));
      const worst = makesIt(id, lose, teams, 'against'), bestCase = makesIt(id, win, teams, 'for');
      const clinched = worst.division ? 'division' : worst.berth ? 'berth' : null;
      const n = Math.max(1, sims);
      out.push({
        teamId: id, league: lg, division: t.division, W: me.W, L: me.L, left: left.get(id)!,
        odds: odds(id, lg, clinched, bestCase, n),
        magic, elim, clinched, eliminated: !bestCase.berth, divisionOut: !bestCase.division, spot,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- streaks

export interface StreakBook {
  /** Results already counted (an index into season.results). */
  upTo: number;
  /** Consecutive games with a hit (games without an at-bat don't count either way). */
  hit: Map<number, number>;
  /** Consecutive games reaching base (hit, walk or hit by pitch). */
  onBase: Map<number, number>;
  /** Consecutive scoreless innings, in outs, counted by whole appearances. */
  scoreless: Map<number, number>;
  /** The best of each this season: [value, playerId]. */
  best: { hit: [number, number]; onBase: [number, number]; scoreless: [number, number] };
}

export const newStreakBook = (): StreakBook => ({ upTo: 0, hit: new Map(), onBase: new Map(), scoreless: new Map(), best: { hit: [0, 0], onBase: [0, 0], scoreless: [0, 0] } });

/** One game's change to the streaks: [playerId, before, after] for each kind. */
export interface StreakChange { kind: 'hit' | 'onBase' | 'scoreless'; playerId: number; before: number; after: number }

export function extendStreaks(book: StreakBook, g: GameResult): StreakChange[] {
  const out: StreakChange[] = [];
  if (g.kind === 'post') return out;
  const bump = (kind: StreakChange['kind'], id: number, after: number) => {
    const m = book[kind], before = m.get(id) ?? 0;
    if (after === before) return;
    m.set(id, after);
    out.push({ kind, playerId: id, before, after });
    if (after > book.best[kind][0]) book.best[kind] = [after, id];
  };
  for (const [id, b] of g.batting) {
    if (b.AB > 0) bump('hit', id, b.H > 0 ? (book.hit.get(id) ?? 0) + 1 : 0);
    if (b.PA > 0) bump('onBase', id, b.H + b.BB + b.HBP > 0 ? (book.onBase.get(id) ?? 0) + 1 : 0);
  }
  for (const [id, p] of g.pitching) if (p.outs > 0 || p.R > 0) bump('scoreless', id, p.R === 0 ? (book.scoreless.get(id) ?? 0) + p.outs : 0);
  return out;
}

/** Bring a book up to date with the season's results; returns the changes, in order. */
export function catchUpStreaks(book: StreakBook, results: GameResult[]): StreakChange[] {
  const out: StreakChange[] = [];
  for (; book.upTo < results.length; book.upTo++) out.push(...extendStreaks(book, results[book.upTo]));
  return out;
}

// ---------------------------------------------------------------- recent form

/** Batting and pitching lines over the regular-season games from `fromDay` on. */
export function linesSince(results: GameResult[], fromDay: number): { batting: Map<number, BatLine>; pitching: Map<number, PitchLine> } {
  const batting = new Map<number, BatLine>(), pitching = new Map<number, PitchLine>();
  const add = <T extends object>(m: Map<number, T>, id: number, l: T) => {
    const cur = m.get(id) as Record<string, number> | undefined;
    if (!cur) { m.set(id, { ...l }); return; }
    for (const k in l) cur[k] += (l as Record<string, number>)[k];
  };
  for (let i = results.length - 1; i >= 0 && results[i].day >= fromDay; i--) {
    const g = results[i];
    if (g.kind === 'post') continue;
    for (const [id, b] of g.batting) add(batting, id, b);
    for (const [id, p] of g.pitching) add(pitching, id, p);
  }
  return { batting, pitching };
}

// ---------------------------------------------------------------- records and careers

export type RecordKey = 'HR' | 'H' | 'RBI' | 'SB' | 'AVG' | 'W' | 'SO' | 'SV' | 'ERA';
export interface SeasonRecord { key: RecordKey; value: number; playerId: number; year: number }

/** Lower is better for these. */
export const LOW_IS_GOOD: ReadonlySet<RecordKey> = new Set(['ERA']);
const BAT_KEY: Partial<Record<RecordKey, string>> = { HR: 'HR', H: 'H', RBI: 'RBI', SB: 'SB' };
const PIT_KEY: Partial<Record<RecordKey, string>> = { W: 'W', SO: 'K', SV: 'SV' };

/** Single-season league records from history (qualified for the rate stats: 3.1 PA or 1 inning per team game). */
export function seasonRecords(league: League): Map<RecordKey, SeasonRecord> {
  const rec = new Map<RecordKey, SeasonRecord>();
  const offer = (key: RecordKey, value: number, playerId: number, year: number) => {
    const cur = rec.get(key);
    if (!cur || (LOW_IS_GOOD.has(key) ? value < cur.value : value > cur.value)) rec.set(key, { key, value, playerId, year });
  };
  const bi = (f: string) => 2 + BAT_FIELDS.indexOf(f as (typeof BAT_FIELDS)[number]);
  const pi = (f: string) => 2 + PITCH_FIELDS.indexOf(f as (typeof PITCH_FIELDS)[number]);
  for (const y of league.history) {
    const games = new Map(y.teams.map((t) => [t.teamId, t.W + t.L]));
    for (const r of y.batting) {
      for (const [k, f] of Object.entries(BAT_KEY)) if (r[bi(f!)] > 0) offer(k as RecordKey, r[bi(f!)], r[0], y.year);
      if (r[bi('PA')] >= 3.1 * (games.get(r[1]) ?? 162) && r[bi('AB')] > 0) offer('AVG', r[bi('H')] / r[bi('AB')], r[0], y.year);
    }
    for (const r of y.pitching) {
      for (const [k, f] of Object.entries(PIT_KEY)) if (r[pi(f!)] > 0) offer(k as RecordKey, r[pi(f!)], r[0], y.year);
      if (r[pi('outs')] >= 3 * (games.get(r[1]) ?? 162)) offer('ERA', (27 * r[pi('ER')]) / r[pi('outs')], r[0], y.year);
    }
  }
  return rec;
}

export type CareerKey = 'HR' | 'H' | 'W' | 'SO' | 'SV';
/** Career marks worth a countdown, and how close counts as "closing in". */
export const MILESTONES: Record<CareerKey, { marks: number[]; near: number; label: string }> = {
  HR: { marks: [300, 400, 500, 600, 700], near: 15, label: 'home runs' },
  H: { marks: [2000, 2500, 3000, 3500, 4000], near: 60, label: 'hits' },
  W: { marks: [200, 250, 300, 350], near: 8, label: 'wins' },
  SO: { marks: [2000, 2500, 3000, 3500, 4000], near: 80, label: 'strikeouts' },
  SV: { marks: [300, 400, 500, 600], near: 15, label: 'saves' },
};

/** Career totals before this season, for everyone with history: key → playerId → total. */
export function careerBefore(league: League): Record<CareerKey, Map<number, number>> {
  const out = { HR: new Map(), H: new Map(), W: new Map(), SO: new Map(), SV: new Map() } as Record<CareerKey, Map<number, number>>;
  const bi = (f: string) => 2 + BAT_FIELDS.indexOf(f as (typeof BAT_FIELDS)[number]);
  const pi = (f: string) => 2 + PITCH_FIELDS.indexOf(f as (typeof PITCH_FIELDS)[number]);
  const add = (k: CareerKey, id: number, v: number) => { if (v) out[k].set(id, (out[k].get(id) ?? 0) + v); };
  for (const y of league.history) {
    for (const r of y.batting) { add('HR', r[0], r[bi('HR')]); add('H', r[0], r[bi('H')]); }
    for (const r of y.pitching) { add('W', r[0], r[pi('W')]); add('SO', r[0], r[pi('K')]); add('SV', r[0], r[pi('SV')]); }
  }
  return out;
}

/** The next mark above `total` for a career stat, or undefined past the last one. */
export const nextMark = (key: CareerKey, total: number) => MILESTONES[key].marks.find((m) => m > total);
