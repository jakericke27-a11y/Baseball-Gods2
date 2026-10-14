/**
 * Leaderboards for the Leaders screen (step 2.3): one category table that serves this season and all time, the
 * whole league or one of its two leagues, and the records report (single-season and career marks, and who's close).
 */
import { BAT_FIELDS, PITCH_FIELDS } from '../engine/history';
import type { BatLine, PitchLine } from '../engine/game/types';
import type { Game } from './state';
import { avg, era, era2, ip, obp, rate3, slg, whip } from './stats';

export type Scope = 'all' | 0 | 1;
export type When = 'season' | 'alltime';

export interface Cat {
  key: string; label: string; pitching: boolean;
  /** A rate stat (needs a qualifier). */
  rate?: boolean;
  /** Lower is better. */
  low?: boolean;
  value: (l: BatLine & PitchLine) => number;
  fmt: (v: number) => string;
}

const n = (v: number) => String(Math.round(v));
const per9 = (x: number, outs: number) => (outs ? (27 * x) / outs : 0);
export const BAT: Cat[] = [
  { key: 'AVG', label: 'Batting average', pitching: false, rate: true, value: avg, fmt: rate3 },
  { key: 'OBP', label: 'On-base percentage', pitching: false, rate: true, value: obp, fmt: rate3 },
  { key: 'SLG', label: 'Slugging', pitching: false, rate: true, value: slg, fmt: rate3 },
  { key: 'OPS', label: 'On-base plus slugging', pitching: false, rate: true, value: (l) => obp(l) + slg(l), fmt: rate3 },
  { key: 'HR', label: 'Home runs', pitching: false, value: (l) => l.HR, fmt: n },
  { key: 'RBI', label: 'Runs batted in', pitching: false, value: (l) => l.RBI, fmt: n },
  { key: 'R', label: 'Runs', pitching: false, value: (l) => l.R, fmt: n },
  { key: 'H', label: 'Hits', pitching: false, value: (l) => l.H, fmt: n },
  { key: '2B', label: 'Doubles', pitching: false, value: (l) => l.D, fmt: n },
  { key: '3B', label: 'Triples', pitching: false, value: (l) => l.T, fmt: n },
  { key: 'SB', label: 'Stolen bases', pitching: false, value: (l) => l.SB, fmt: n },
  { key: 'BB', label: 'Walks', pitching: false, value: (l) => l.BB, fmt: n },
];
export const PIT: Cat[] = [
  { key: 'ERA', label: 'Earned run average', pitching: true, rate: true, low: true, value: era, fmt: era2 },
  { key: 'WHIP', label: 'Walks + hits per inning', pitching: true, rate: true, low: true, value: whip, fmt: (v) => v.toFixed(2) },
  { key: 'W', label: 'Wins', pitching: true, value: (l) => l.W, fmt: n },
  { key: 'SO', label: 'Strikeouts', pitching: true, value: (l) => l.K, fmt: n },
  { key: 'SV', label: 'Saves', pitching: true, value: (l) => l.SV, fmt: n },
  { key: 'IP', label: 'Innings pitched', pitching: true, value: (l) => l.outs, fmt: (v) => ip(v) },
  { key: 'K9', label: 'Strikeouts per nine', pitching: true, rate: true, value: (l) => per9(l.K, l.outs), fmt: (v) => v.toFixed(1) },
  { key: 'BB9', label: 'Walks per nine', pitching: true, rate: true, low: true, value: (l) => per9(l.BB, l.outs), fmt: (v) => v.toFixed(1) },
  { key: 'HR9', label: 'Homers per nine', pitching: true, rate: true, low: true, value: (l) => per9(l.HR, l.outs), fmt: (v) => v.toFixed(2) },
  { key: 'G', label: 'Games pitched', pitching: true, value: (l) => l.G, fmt: n },
];
export const catOf = (key: string) => [...BAT, ...PIT].find((c) => c.key === key)!;

/** Career qualifiers for the all-time rate leaders: a third of a regular's load per completed season, up to a cap. */
export const CAREER_MIN = { PA: 1000, outs: 900, perYear: { PA: 325, outs: 300 } };
export const careerMin = (years: number) => ({ PA: Math.min(CAREER_MIN.PA, CAREER_MIN.perYear.PA * years), outs: Math.min(CAREER_MIN.outs, CAREER_MIN.perYear.outs * years) });

interface Pool { bat: Map<number, BatLine>; pit: Map<number, PitchLine>; league: Map<number, number>; qualB: (id: number, l: BatLine) => boolean; qualP: (id: number, l: PitchLine) => boolean }

const cache = new WeakMap<Game, Map<string, unknown>>();
function memo<T>(g: Game, key: string, make: () => T): T {
  let m = cache.get(g);
  if (!m) cache.set(g, (m = new Map()));
  const k = `${g.year}:${g.day}:${g.season.results.length}:${g.league.history.length}:${key}`;
  if (!m.has(k)) { for (const old of m.keys()) if (old.endsWith(`:${key}`)) m.delete(old); m.set(k, make()); }
  return m.get(k) as T;
}

const sumInto = <T extends object>(m: Map<number, T>, id: number, l: T) => {
  const cur = m.get(id) as Record<string, number> | undefined;
  if (!cur) { m.set(id, { ...l }); return; }
  for (const k in l) cur[k] += (l as Record<string, number>)[k];
};
const lineOf = <T>(row: number[], fields: readonly string[]): T => Object.fromEntries(fields.map((f, i) => [f, row[2 + i]])) as T;

/** This season's lines, or career lines from history (completed seasons only). Each player's league: his team's now, or his last team's. */
function pool(g: Game, when: When): Pool {
  return memo(g, `pool:${when}`, () => {
    const confOf = new Map(g.league.teams.map((t) => [t.id, t.conference]));
    const league = new Map<number, number>();
    if (when === 'season') {
      for (const [id, t] of g.teamOf) league.set(id, confOf.get(t) ?? 0);
      const games = (id: number) => { const r = g.season.standings.get(g.teamOf.get(id) ?? 0); return r ? r.W + r.L : 0; };
      return {
        bat: g.season.batting, pit: g.season.pitching, league,
        qualB: (id, l) => l.PA >= 3.1 * games(id) && l.AB > 0, qualP: (id, l) => l.outs >= 3 * games(id) && l.outs > 0,
      };
    }
    const bat = new Map<number, BatLine>(), pit = new Map<number, PitchLine>();
    for (const y of g.league.history) {
      for (const r of y.batting) { sumInto(bat, r[0], lineOf<BatLine>(r, BAT_FIELDS)); league.set(r[0], confOf.get(r[1]) ?? 0); }
      for (const r of y.pitching) { sumInto(pit, r[0], lineOf<PitchLine>(r, PITCH_FIELDS)); league.set(r[0], confOf.get(r[1]) ?? 0); }
    }
    const min = careerMin(g.league.history.length);
    return { bat, pit, league, qualB: (_, l) => l.PA >= min.PA, qualP: (_, l) => l.outs >= min.outs };
  });
}

export interface Row { id: number; value: number; shown: string }

/** The top n in a category. */
export function board(g: Game, cat: Cat, when: When, scope: Scope, count = 10): Row[] {
  const P = pool(g, when);
  const out: Row[] = [];
  const lines = (cat.pitching ? P.pit : P.bat) as Map<number, BatLine & PitchLine>;
  for (const [id, l] of lines) {
    if (scope !== 'all' && P.league.get(id) !== scope) continue;
    if (cat.rate && !(cat.pitching ? P.qualP(id, l) : P.qualB(id, l))) continue;
    const v = cat.value(l);
    if (!Number.isFinite(v) || (!cat.rate && v <= 0)) continue;
    out.push({ id, value: v, shown: cat.fmt(v) });
  }
  return out.sort((a, b) => (cat.low ? a.value - b.value : b.value - a.value) || a.id - b.id).slice(0, count);
}

// ---------------------------------------------------------------- records

export interface RecordRow {
  cat: Cat;
  /** The mark to beat: best in history. */
  best?: { id: number; value: number; year?: number };
  /** Someone within reach of it now, and how close (0–1, 1 = level). */
  chase?: { id: number; value: number; pace?: number; closeness: number };
}

/** Single-season records (from completed seasons) and who in this season is on course for one. */
export function seasonRecords(g: Game, side: 'bat' | 'pit'): RecordRow[] {
  return memo(g, `srec:${side}`, () => {
    const cats = side === 'bat' ? BAT : PIT;
    const best = new Map<string, { id: number; value: number; year: number }>();
    for (const y of g.league.history) {
      const games = new Map(y.teams.map((t) => [t.teamId, t.W + t.L]));
      const rows = side === 'bat' ? y.batting : y.pitching;
      for (const r of rows) {
        const l = (side === 'bat' ? lineOf<BatLine>(r, BAT_FIELDS) : lineOf<PitchLine>(r, PITCH_FIELDS)) as BatLine & PitchLine;
        const G = games.get(r[1]) ?? 162;
        const q = side === 'bat' ? l.PA >= 3.1 * G && l.AB > 0 : l.outs >= 3 * G;
        for (const c of cats) {
          if (c.rate && !q) continue;
          const v = c.value(l);
          if (!Number.isFinite(v) || (!c.rate && v <= 0)) continue;
          const cur = best.get(c.key);
          if (!cur || (c.low ? v < cur.value : v > cur.value)) best.set(c.key, { id: r[0], value: v, year: y.year });
        }
      }
    }
    const done = g.day >= g.season.regularDays;
    return cats.map((c) => {
      const b = best.get(c.key);
      const lead = board(g, c, 'season', 'all', 1)[0];
      let chase: RecordRow['chase'];
      if (b && lead && !done) {
        const team = g.season.standings.get(g.teamOf.get(lead.id) ?? 0);
        const played = team ? team.W + team.L : 0;
        if (played >= 30) {
          if (c.rate) {
            const closeness = c.low ? b.value / Math.max(lead.value, 1e-9) : lead.value / b.value;
            if (closeness >= 0.97) chase = { id: lead.id, value: lead.value, closeness };
          } else {
            const pace = (lead.value * 162) / played;
            if (pace >= 0.9 * b.value) chase = { id: lead.id, value: lead.value, pace: Math.round(pace), closeness: pace / b.value };
          }
        }
      }
      return { cat: c, best: b, chase };
    });
  });
}

/** Career records (completed seasons) and the active player closest to each, counting this season. */
export function careerRecords(g: Game, side: 'bat' | 'pit'): RecordRow[] {
  return memo(g, `crec:${side}`, () => {
    const cats = (side === 'bat' ? BAT : PIT).filter((c) => !c.rate);
    const P = pool(g, 'alltime');
    const lines = (side === 'bat' ? P.bat : P.pit) as Map<number, BatLine & PitchLine>;
    const cur = (side === 'bat' ? g.season.batting : g.season.pitching) as Map<number, BatLine & PitchLine>;
    return cats.map((c) => {
      let best: RecordRow['best'];
      for (const [id, l] of lines) { const v = c.value(l); if (v > 0 && (!best || v > best.value)) best = { id, value: v }; }
      let chase: RecordRow['chase'];
      if (best) for (const id of g.teamOf.keys()) {
        if (id === best.id) continue;
        const v = c.value((lines.get(id) ?? {}) as BatLine & PitchLine) || 0;
        const now = v + (c.value((cur.get(id) ?? {}) as BatLine & PitchLine) || 0);
        const closeness = now / best.value;
        if (closeness >= 0.75 && (!chase || closeness > chase.closeness)) chase = { id, value: now, closeness };
      }
      return { cat: c, best, chase };
    });
  });
}

// ---------------------------------------------------------------- percentiles

/** Where a season value sits among this year's qualified players: +1 top tenth, -1 bottom tenth, 0 between. */
export function percentileTone(g: Game, cat: Cat, value: number): number {
  const sorted = memo(g, `pct:${cat.key}`, () => board(g, cat, 'season', 'all', 100000).map((r) => r.value).sort((a, b) => a - b));
  if (sorted.length < 20 || !Number.isFinite(value)) return 0;
  const below = sorted.filter((v) => v < value).length / sorted.length;
  const top = cat.low ? below <= 0.1 : below >= 0.9, bottom = cat.low ? below >= 0.9 : below <= 0.1;
  return top ? 1 : bottom ? -1 : 0;
}

/** A player's season line as labeled values, each colored by percentile once he qualifies. */
export function seasonLine(g: Game, id: number, pitching: boolean): string {
  const P = pool(g, 'season');
  const l = (pitching ? P.pit.get(id) : P.bat.get(id)) as (BatLine & PitchLine) | undefined;
  if (!l) return '';
  const qual = pitching ? P.qualP(id, l) : P.qualB(id, l);
  const keys = pitching ? ['ERA', 'W', 'IP', 'SO', 'BB9', 'WHIP', 'SV', 'K9'] : ['AVG', 'OBP', 'SLG', 'HR', 'RBI', 'R', 'SB', 'BB'];
  const parts = keys.map((k) => {
    const c = catOf(k), v = c.value(l);
    // counting stats only colored for regulars too, so a September call-up's 2 HR isn't "bottom tenth"
    const t = qual ? percentileTone(g, c, v) : 0;
    return `<span class="st${t > 0 ? ' pos' : t < 0 ? ' neg' : ''}"><b>${c.fmt(v)}</b> ${k === 'K9' ? 'K/9' : k === 'BB9' ? 'BB/9' : k}</span>`;
  });
  const extra = pitching ? `${l.W}-${l.L} · ${l.G} G, ${l.GS} GS` : `${l.PA} PA · ${l.K} K`;
  return `${parts.join('')}<span class="st muted">${extra}</span>`;
}
