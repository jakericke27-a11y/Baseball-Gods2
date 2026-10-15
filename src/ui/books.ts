/**
 * The record books (step 2.9): what goes on each page. Book 1 is one team's history, Book 2 the league's.
 * One stat or one view per page, up to `per` rows (20 on a laptop, 10 on a short window); long lists run on
 * to the next page. Each tab starts on a left-hand page. The books count everything through today, so the
 * season in progress shows (marked with *) next to the finished ones.
 *
 * VALUE is an interim stand-in for the WAR-style stat of step 3.6: batting runs above average from linear
 * weights, pitching runs saved, each with a replacement-level allowance, in wins (10 runs). No fielding yet.
 */
import { addSplits, byDrama, greatGames, leagueSplits, SPLIT_DEFS, type GameRow, type SplitRow } from '../engine/chronicle';
import type { BatLine, PitchLine } from '../engine/game/types';
import { BAT_FIELDS, PITCH_FIELDS, type LineRow, type TeamYear, type YearSummary } from '../engine/history';
import { BAT, PIT, type Cat } from './leaders';
import { FINAL_NAME } from './post';
import type { Game } from './state';
import { avg, era2, obp, rate3, slg } from './stats';
import { LEAGUES, teamName } from './teams';
import { esc, link, teamChip } from './views/common';
import { shortDate } from './calendar';

// ---------------------------------------------------------------- the seasons, finished and in progress

type Year = Pick<YearSummary, 'year' | 'champion' | 'teams' | 'series' | 'batting' | 'pitching' | 'decree'> & { live: boolean; games: () => GameRow[]; splits: () => Record<string, SplitRow> | undefined };

const cache = new WeakMap<Game, Map<string, unknown>>();
function memo<T>(g: Game, key: string, make: () => T): T {
  let m = cache.get(g);
  if (!m) cache.set(g, (m = new Map()));
  const k = `${g.year}:${g.day}:${g.season.results.length}:${g.league.history.length}:${key}`;
  if (!m.has(k)) { for (const old of [...m.keys()]) if (old.endsWith(`:${key}`)) m.delete(old); m.set(k, make()); }
  return m.get(k) as T;
}

function liveYear(g: Game): Year | null {
  const s = g.season;
  if (!s.results.length) return null;
  const seeds = s.post?.seeds ?? [];
  const teams: TeamYear[] = g.league.teams.map((t) => {
    const r = s.standings.get(t.id)!;
    const div = g.league.teams.filter((x) => x.conference === t.conference && x.division === t.division).map((x) => s.standings.get(x.id)!)
      .sort((a, b) => b.W / Math.max(1, b.W + b.L) - a.W / Math.max(1, a.W + a.L) || (b.RS - b.RA) - (a.RS - a.RA));
    return { teamId: t.id, W: r.W, L: r.L, RS: r.RS, RA: r.RA, place: div.findIndex((x) => x.teamId === t.id) + 1, seed: (seeds[t.conference]?.indexOf(t.id) ?? -1) + 1 };
  });
  const rows = <T extends object>(m: Map<number, T>, fields: readonly string[]): LineRow[] => [...m].map(([id, l]) => [id, g.teamOf.get(id) ?? 0, ...fields.map((f) => (l as Record<string, number>)[f])]);
  return {
    year: s.year, live: true, champion: s.post?.champion ?? 0, teams,
    series: (s.post?.series ?? []).map(({ id, round, league, high, low, wins, winner }) => ({ id, round, league, high, low, wins: [...wins] as [number, number], winner })),
    batting: rows(s.batting, BAT_FIELDS), pitching: rows(s.pitching, PITCH_FIELDS),
    games: () => memo(g, 'live-games', () => greatGames(s.results)),
    splits: () => memo(g, 'live-splits', () => leagueSplits(s.results, s.players)),
  };
}

/** Every season with games: the finished ones, then this one. */
export function years(g: Game): Year[] {
  return memo(g, 'years', () => {
    const done: Year[] = g.league.history.map((y) => ({ ...y, live: false, games: () => y.games ?? [], splits: () => y.splits }));
    const now = liveYear(g);
    return now ? [...done, now] : done;
  });
}

const yearLabel = (y: Year) => `Y${y.year}${y.live ? '*' : ''}`;
const lineOf = <T>(row: LineRow, fields: readonly string[]): T => Object.fromEntries(fields.map((f, i) => [f, row[2 + i]])) as T;
type Both = BatLine & PitchLine;
const sumInto = <T extends object>(into: T | undefined, l: T): T => {
  if (!into) return { ...l };
  for (const k in l) (into as Record<string, number>)[k] += (l as Record<string, number>)[k];
  return into;
};

// ---------------------------------------------------------------- value (interim)

/** Each season's league rates, for value. */
function leagueRates(y: Year) {
  let lw = 0, PA = 0, R = 0, outs = 0;
  for (const r of y.batting) { const l = lineOf<BatLine>(r, BAT_FIELDS); lw += lwRuns(l); PA += l.PA; }
  for (const r of y.pitching) { const l = lineOf<PitchLine>(r, PITCH_FIELDS); R += l.R; outs += l.outs; }
  return { lwPA: PA ? lw / PA : 0, ra9: outs ? (27 * R) / outs : 4.5 };
}
const lwRuns = (l: BatLine) => 0.47 * (l.H - l.D - l.T - l.HR) + 0.77 * l.D + 1.04 * l.T + 1.4 * l.HR + 0.31 * l.BB + 0.33 * l.HBP + 0.2 * l.SB - 0.4 * l.CS - 0.26 * (l.AB - l.H);
/**
 * Batting: runs above average plus 18 per 600 PA. Pitching: runs saved against 1.2x the league's run rate. In wins.
 * The two allowances are set so a season's value adds up to about 1,000 wins across the league, split about 55/45
 * between hitters and pitchers, as real WAR does.
 */
const batValue = (l: BatLine, lg: { lwPA: number }) => (lwRuns(l) - l.PA * lg.lwPA + (18 * l.PA) / 600) / 10;
const pitValue = (l: PitchLine, lg: { ra9: number }) => ((1.2 * lg.ra9 * l.outs) / 27 - l.R) / 10;

/** One entry per player, season and team. */
function seasonValues(g: Game): Array<{ id: number; team: number; year: number; live: boolean; value: number }> {
  return memo(g, 'values', () => {
    const out: Array<{ id: number; team: number; year: number; live: boolean; value: number }> = [];
    for (const y of years(g)) {
      const lg = leagueRates(y);
      const key = (id: number, t: number) => `${id}:${t}`;
      const by = new Map<string, { id: number; team: number; year: number; live: boolean; value: number }>();
      const put = (id: number, team: number, v: number) => { const k = key(id, team); const cur = by.get(k); if (cur) cur.value += v; else by.set(k, { id, team, year: y.year, live: y.live, value: v }); };
      for (const r of y.batting) put(r[0], r[1], batValue(lineOf<BatLine>(r, BAT_FIELDS), lg));
      for (const r of y.pitching) put(r[0], r[1], pitValue(lineOf<PitchLine>(r, PITCH_FIELDS), lg));
      out.push(...by.values());
    }
    return out;
  });
}
const v1 = (x: number) => x.toFixed(1);

/** Career milestones that put a retired player on the honor roll on their own. */
const MILESTONES: Array<{ key: keyof Both; at: number; label: string; pitching: boolean }> = [
  { key: 'HR', at: 500, label: '500 HR', pitching: false }, { key: 'H', at: 3000, label: '3,000 H', pitching: false },
  { key: 'W', at: 300, label: '300 W', pitching: true }, { key: 'K', at: 3000, label: '3,000 SO', pitching: true },
];
/** Career value for the honor roll (interim, until the Hall of Fame of step 3.7). */
export const HONOR_VALUE = 45;

interface Career { id: number; value: number; bat?: BatLine; pit?: PitchLine; first: number; last: number; seasons: number }
function careers(g: Game): Map<number, Career> {
  return memo(g, 'careers', () => {
    const out = new Map<number, Career>();
    const get = (id: number, year: number) => {
      let c = out.get(id);
      if (!c) out.set(id, (c = { id, value: 0, first: year, last: year, seasons: 0 }));
      return c;
    };
    for (const y of years(g)) {
      const seen = new Set<number>();
      for (const r of y.batting) { const c = get(r[0], y.year); c.bat = sumInto(c.bat, lineOf<BatLine>(r, BAT_FIELDS)); seen.add(r[0]); }
      for (const r of y.pitching) { const c = get(r[0], y.year); c.pit = sumInto(c.pit, lineOf<PitchLine>(r, PITCH_FIELDS)); seen.add(r[0]); }
      for (const id of seen) { const c = out.get(id)!; c.seasons++; c.last = y.year; }
    }
    for (const v of seasonValues(g)) out.get(v.id)!.value += v.value;
    return out;
  });
}
const isRetired = (g: Game, id: number) => !g.players.has(id);
function honorRoll(g: Game): Array<{ c: Career; why: string }> {
  return memo(g, 'honor', () => {
    const out: Array<{ c: Career; why: string }> = [];
    for (const c of careers(g).values()) {
      if (!isRetired(g, c.id)) continue;
      const marks = MILESTONES.filter((m) => ((m.pitching ? c.pit : c.bat) as Both | undefined)?.[m.key] as number >= m.at).map((m) => m.label);
      if (c.value >= HONOR_VALUE || marks.length) out.push({ c, why: [c.value >= HONOR_VALUE ? `${v1(c.value)} value` : '', ...marks].filter(Boolean).join(' · ') });
    }
    return out.sort((a, b) => b.c.value - a.c.value);
  });
}

// ---------------------------------------------------------------- pages

export type BookId = 'team' | 'league';
export interface BookRow { cells: string[]; mine?: boolean }
export interface BookPage {
  tab: string; title: string; sub?: string;
  /** Column labels and widths (grid track sizes). */
  cols?: Array<[string, string]>;
  rows?: BookRow[];
  /** Free HTML instead of rows (the title page, notes). */
  html?: string;
  empty?: string; note?: string;
  blank?: boolean;
}
export interface Book { id: BookId; title: string; tabs: Array<{ tab: string; page: number }>; pages: BookPage[] }

const who = (g: Game, id: number, team?: number) => {
  const t = team ?? g.teamOf.get(id) ?? g.league.retired.find((p) => p.id === id)?.lastTeam ?? 0;
  return `${t ? `<span title="${esc(teamName(t))}">${teamChip(t)}</span>` : ''}${link(g.name(id), 'player', { id })}`;
};
const mineId = (g: Game, id: number) => g.teamOf.get(id) === g.userTeam;
const span = (a: number, b: number) => (a === b ? `Y${a}` : `Y${a}–${b}`);
const rank = (i: number) => `<span class="bk-rank">${i + 1}</span>`;

/** A list long enough to run onto more pages, each page `per` rows. */
function run(tab: string, title: string, cols: Array<[string, string]>, rows: BookRow[], per: number, extra: Partial<BookPage> = {}): BookPage[] {
  if (!rows.length) return [{ tab, title, cols, rows: [], ...extra }];
  const out: BookPage[] = [];
  for (let i = 0; i < rows.length; i += per) out.push({ tab, title: i ? `${title} (cont.)` : title, cols, rows: rows.slice(i, i + per), ...extra });
  return out;
}

/** Career qualifiers for rate stats: a third of a regular's load per season counted, up to a cap (as on Leaders). */
function careerQual(g: Game) {
  const n = Math.max(1, years(g).filter((y) => !y.live).length + (years(g).some((y) => y.live) ? 0.5 : 0));
  return { PA: Math.min(1000, 325 * n), outs: Math.min(900, 300 * n) };
}

/** Career leaders in one category, over all teams or one team's seasons only. */
function careerBoard(g: Game, cat: Cat, per: number, team?: number): BookRow[] {
  const lines = new Map<number, { l: Both; first: number; last: number }>();
  for (const y of years(g)) for (const r of cat.pitching ? y.pitching : y.batting) {
    if (team !== undefined && r[1] !== team) continue;
    const cur = lines.get(r[0]);
    const l = lineOf<Both>(r, cat.pitching ? PITCH_FIELDS : BAT_FIELDS);
    if (cur) { sumInto(cur.l, l); cur.last = y.year; } else lines.set(r[0], { l, first: y.year, last: y.year });
  }
  const q = careerQual(g);
  const rows = [...lines].map(([id, x]) => ({ id, ...x, v: cat.value(x.l) }))
    .filter((x) => Number.isFinite(x.v) && (cat.rate ? (cat.pitching ? x.l.outs >= q.outs : x.l.PA >= q.PA && x.l.AB > 0) : x.v > 0))
    .sort((a, b) => (cat.low ? a.v - b.v : b.v - a.v) || a.id - b.id).slice(0, per);
  return rows.map((x, i) => ({ cells: [rank(i), who(g, x.id, team), span(x.first, x.last), `<b>${cat.fmt(x.v)}</b>`], mine: team === undefined && mineId(g, x.id) }));
}

/** Single-season bests in one category (qualified for rate stats by the team's games played). */
function seasonBoard(g: Game, cat: Cat, per: number, team?: number): BookRow[] {
  const out: Array<{ id: number; team: number; y: Year; v: number }> = [];
  for (const y of years(g)) {
    const games = new Map(y.teams.map((t) => [t.teamId, t.W + t.L]));
    for (const r of cat.pitching ? y.pitching : y.batting) {
      if (team !== undefined && r[1] !== team) continue;
      const l = lineOf<Both>(r, cat.pitching ? PITCH_FIELDS : BAT_FIELDS), G = games.get(r[1]) ?? 162;
      if (cat.rate && (y.live && G < 30 || !(cat.pitching ? l.outs >= 3 * G : l.PA >= 3.1 * G && l.AB > 0))) continue;
      const v = cat.value(l);
      if (!Number.isFinite(v) || (!cat.rate && v <= 0)) continue;
      out.push({ id: r[0], team: r[1], y, v });
    }
  }
  return out.sort((a, b) => (cat.low ? a.v - b.v : b.v - a.v) || a.y.year - b.y.year).slice(0, per)
    .map((x, i) => ({ cells: [rank(i), who(g, x.id, x.team), yearLabel(x.y), `<b>${cat.fmt(x.v)}</b>`], mine: team === undefined && x.team === g.userTeam && mineId(g, x.id) }));
}

const BOOK_BAT = ['H', 'HR', 'RBI', 'R', '2B', '3B', 'SB', 'BB', 'AVG', 'OBP', 'SLG', 'OPS'];
const BOOK_PIT = ['W', 'SO', 'SV', 'IP', 'G', 'ERA', 'WHIP', 'K9'];
const SEASON_CATS = ['HR', 'H', 'RBI', 'R', 'SB', 'AVG', 'OPS', 'W', 'SO', 'SV', 'ERA', 'WHIP'];
const catBy = (k: string) => [...BAT, ...PIT].find((c) => c.key === k)!;
const LEAD_COLS: Array<[string, string]> = [['#', '36px'], ['PLAYER', 'minmax(0, 1fr)'], ['YEARS', '96px'], ['', '84px']];
const SEASON_COLS: Array<[string, string]> = [['#', '36px'], ['PLAYER', 'minmax(0, 1fr)'], ['YEAR', '64px'], ['', '84px']];
const withStat = (cols: Array<[string, string]>, k: string): Array<[string, string]> => cols.map(([l, w], i) => [i === cols.length - 1 ? k : l, w]);

/** The round a team went out in (or won it all), for a finished or running postseason. */
function postResult(y: Year, id: number): string {
  if (y.champion === id) return `Won the ${FINAL_NAME}`;
  const mine = y.series.filter((s) => s.high === id || s.low === id);
  if (!mine.length) return y.live && !y.champion ? '' : '—';
  const last = mine[mine.length - 1];
  const name = (r: string) => ({ WC: 'wild card', DS: 'DS', LCS: 'CS', WS: 'final' })[r] ?? r;
  if (!last.winner) return `In the ${name(last.round)}`;
  return last.winner === id ? `Won the ${name(last.round)}` : `Lost the ${name(last.round)}`;
}
const place = (n: number) => ['1st', '2nd', '3rd', '4th', '5th'][n - 1] ?? `${n}th`;
const pctOf = (W: number, L: number) => (W + L ? rate3(W / (W + L)) : '—');

/** Team totals for one season (players' lines credited to their team at season's end). */
function teamLines(y: Year, id: number) {
  const bat = y.batting.filter((r) => r[1] === id).reduce<BatLine | undefined>((a, r) => sumInto(a, lineOf<BatLine>(r, BAT_FIELDS)), undefined);
  const pit = y.pitching.filter((r) => r[1] === id).reduce<PitchLine | undefined>((a, r) => sumInto(a, lineOf<PitchLine>(r, PITCH_FIELDS)), undefined);
  return { bat, pit };
}

function gameRows(g: Game, rows: Array<{ row: GameRow; y: Year }>, per: number, team?: number): BookRow[] {
  return rows.slice(0, per).map(({ row, y }, i) => {
    const [day, away, home, ar, hr, inn, drama, kind] = row;
    const tag = kind === 2 ? ' <span class="bk-tag">POST</span>' : kind === 1 ? ' <span class="bk-tag">G163</span>' : '';
    const match = team !== undefined
      ? `${away === team ? 'at' : 'vs'} ${teamChip(away === team ? home : away)}${esc(teamName(away === team ? home : away))}`
      : `${teamChip(away)}${esc(teamName(away))} at ${teamChip(home)}${esc(teamName(home))}`;
    let score = `${ar}-${hr}`;
    if (team !== undefined) { const us = away === team ? ar : hr, them = away === team ? hr : ar; score = `<span class="${us > them ? 'pos' : 'neg'}">${us > them ? 'W' : 'L'} ${us}-${them}</span>`; }
    const when = `${yearLabel(y)} ${shortDate(day)}`;
    const idx = y.live ? g.season.results.findIndex((r) => r.day === day && r.teamIds[0] === away && r.teamIds[1] === home) : -1;
    const open = idx >= 0 ? ` <button type="button" class="link bk-open" data-act="go" data-to="games" data-index="${idx}" data-key="bk-game:${idx}" title="Box score">BOX</button>` : '';
    return { cells: [rank(i), when, `${match}${tag}`, `${score}${inn > 9 ? ` <span class="muted">(${inn})</span>` : ''}${open}`, `<b>${drama}</b>`], mine: team === undefined && (away === g.userTeam || home === g.userTeam) };
  });
}
const GAME_COLS: Array<[string, string]> = [['#', '36px'], ['DATE', '108px'], ['GAME', 'minmax(0, 1fr)'], ['FINAL', '176px'], ['DRAMA', '64px']];

// ---------------------------------------------------------------- Book 1: one team

function teamBook(g: Game, team: number, per: number): BookPage[] {
  const Y = years(g), done = Y.filter((y) => !y.live);
  const tys = Y.map((y) => ({ y, t: y.teams.find((t) => t.teamId === team)! })).filter((x) => x.t);
  const pages: BookPage[] = [];
  // HISTORY
  const W = tys.reduce((a, x) => a + x.t.W, 0), L = tys.reduce((a, x) => a + x.t.L, 0), RS = tys.reduce((a, x) => a + x.t.RS, 0), RA = tys.reduce((a, x) => a + x.t.RA, 0);
  const fin = tys.filter((x) => !x.y.live);
  const apps = fin.filter((x) => x.t.seed > 0).length, divs = fin.filter((x) => x.t.place === 1).length;
  const pennants = done.filter((y) => y.series.some((s) => s.round === 'LCS' && s.winner === team)).length, titles = done.filter((y) => y.champion === team).length;
  const best = [...fin].sort((a, b) => b.t.W / Math.max(1, b.t.W + b.t.L) - a.t.W / Math.max(1, a.t.W + a.t.L))[0];
  const worst = [...fin].sort((a, b) => a.t.W / Math.max(1, a.t.W + a.t.L) - b.t.W / Math.max(1, b.t.W + b.t.L))[0];
  let drought = 0;
  for (const x of [...fin].reverse()) { if (x.t.seed > 0) break; drought++; }
  const kv = (k: string, v: string) => ({ cells: [k, `<b>${v}</b>`] });
  pages.push({ tab: 'HISTORY', title: 'At a Glance', cols: [['', 'minmax(0, 1fr)'], ['', 'auto']], rows: [
    kv('All-time record', `${W}-${L} (${pctOf(W, L)})`), kv('Run differential', `${RS - RA > 0 ? '+' : ''}${RS - RA}`), kv('Seasons', `${fin.length}${Y.some((y) => y.live) ? ' + this one' : ''}`),
    kv('Playoff appearances', String(apps)), kv('Division titles', String(divs)), kv('Pennants', String(pennants)), kv(`${FINAL_NAME} titles`, String(titles)),
    kv('Best season', best ? `Y${best.y.year}, ${best.t.W}-${best.t.L}` : '—'), kv('Worst season', worst ? `Y${worst.y.year}, ${worst.t.W}-${worst.t.L}` : '—'),
    kv('Playoff drought', fin.length ? (drought ? `${drought} season${drought === 1 ? '' : 's'}` : 'none') : '—'),
  ] });
  pages.push(...run('HISTORY', 'Year by Year', [['YEAR', '64px'], ['W-L', '84px'], ['PCT', '64px'], ['DIV', '52px'], ['RS', '56px'], ['RA', '56px'], ['POSTSEASON', 'minmax(0, 1fr)']],
    [...tys].reverse().map(({ y, t }) => ({ cells: [yearLabel(y), `${t.W}-${t.L}`, pctOf(t.W, t.L), place(t.place), String(t.RS), String(t.RA), esc(postResult(y, team))] })), per));
  // postseason by round, then every series
  const rounds = ['WC', 'DS', 'LCS', 'WS'] as const;
  const rname = { WC: 'Wild card', DS: 'Division series', LCS: 'Championship series', WS: FINAL_NAME };
  const ser = Y.flatMap((y) => y.series.filter((s) => (s.high === team || s.low === team) && s.winner).map((s) => ({ y, s })));
  const byRound = rounds.map((r) => {
    const xs = ser.filter((x) => x.s.round === r);
    const sw = xs.filter((x) => x.s.winner === team).length;
    const gw = xs.reduce((a, x) => a + x.s.wins[x.s.high === team ? 0 : 1], 0), gl = xs.reduce((a, x) => a + x.s.wins[x.s.high === team ? 1 : 0], 0);
    return { cells: [rname[r], `${sw}-${xs.length - sw}`, `${gw}-${gl}`] };
  });
  pages.push({ tab: 'HISTORY', title: 'Postseason by Round', cols: [['ROUND', 'minmax(0, 1fr)'], ['SERIES', '84px'], ['GAMES', '84px']], rows: byRound, note: `${apps} appearance${apps === 1 ? '' : 's'}, ${titles} title${titles === 1 ? '' : 's'}.` });
  pages.push(...run('HISTORY', 'Every Series', [['YEAR', '64px'], ['ROUND', '120px'], ['OPPONENT', 'minmax(0, 1fr)'], ['RESULT', '96px']],
    [...ser].reverse().map(({ y, s }) => { const opp = s.high === team ? s.low : s.high, w = s.wins[s.high === team ? 0 : 1], l = s.wins[s.high === team ? 1 : 0];
      return { cells: [yearLabel(y), s.round === 'WS' ? 'Final' : s.round, `${teamChip(opp)}${esc(teamName(opp))}`, `<span class="${s.winner === team ? 'pos' : 'neg'}">${s.winner === team ? 'Won' : 'Lost'} ${w}-${l}</span>`] }; }), per,
    { empty: 'No postseason series yet.' }));
  pages.push(...run('HISTORY', 'Team Batting by Year', [['YEAR', '64px'], ['AVG', '64px'], ['OBP', '64px'], ['SLG', '64px'], ['HR', '56px'], ['R', '56px'], ['SB', '56px']],
    [...tys].reverse().map(({ y }) => { const b = teamLines(y, team).bat; return { cells: b ? [yearLabel(y), rate3(avg(b)), rate3(obp(b)), rate3(slg(b)), String(b.HR), String(b.R), String(b.SB)] : [yearLabel(y), '—', '—', '—', '—', '—', '—'] }; }), per,
    { note: 'Players count for the team they finished the season with.' }));
  pages.push(...run('HISTORY', 'Team Pitching by Year', [['YEAR', '64px'], ['ERA', '64px'], ['RA/9', '64px'], ['SO', '60px'], ['BB', '60px'], ['HR', '56px'], ['SV', '56px']],
    [...tys].reverse().map(({ y }) => { const p = teamLines(y, team).pit; return { cells: p ? [yearLabel(y), era2((27 * p.ER) / Math.max(1, p.outs)), era2((27 * p.R) / Math.max(1, p.outs)), String(p.K), String(p.BB), String(p.HR), String(p.SV)] : [yearLabel(y), '—', '—', '—', '—', '—', '—'] }; }), per));
  // PLAYERS
  const withTeam = new Map<number, { value: number; seasons: number; first: number; last: number }>();
  for (const y of Y) {
    const here = new Set([...y.batting, ...y.pitching].filter((r) => r[1] === team).map((r) => r[0]));
    for (const id of here) { const x = withTeam.get(id); if (x) { x.seasons++; x.last = y.year; } else withTeam.set(id, { value: 0, seasons: 1, first: y.year, last: y.year }); }
  }
  for (const v of seasonValues(g)) if (v.team === team) { const x = withTeam.get(v.id); if (x) x.value += v.value; }
  const greats = [...withTeam].sort((a, b) => b[1].value - a[1].value).slice(0, per);
  pages.push({ tab: 'PLAYERS', title: 'Greatest Players', sub: 'VALUE WITH THIS TEAM', cols: [['#', '36px'], ['PLAYER', 'minmax(0, 1fr)'], ['YEARS', '96px'], ['SEAS', '52px'], ['VALUE', '72px']],
    rows: greats.map(([id, x], i) => ({ cells: [rank(i), who(g, id, team), span(x.first, x.last), String(x.seasons), `<b>${v1(x.value)}</b>`] })),
    note: 'VALUE is interim: batting and pitching runs above replacement, in wins. No fielding until the value stat (step 3.6).' });
  const tenured = [...withTeam].sort((a, b) => b[1].seasons - a[1].seasons || b[1].value - a[1].value).slice(0, per);
  pages.push({ tab: 'PLAYERS', title: 'Longest Tenured', cols: [['#', '36px'], ['PLAYER', 'minmax(0, 1fr)'], ['YEARS', '96px'], ['VALUE', '72px'], ['SEAS', '52px']],
    rows: tenured.map(([id, x], i) => ({ cells: [rank(i), who(g, id, team), span(x.first, x.last), v1(x.value), `<b>${x.seasons}</b>`] })) });
  const legends = honorRoll(g).filter((h) => withTeam.has(h.c.id));
  pages.push(...run('PLAYERS', 'Legends Who Played Here', [['PLAYER', 'minmax(0, 1fr)'], ['HERE', '96px'], ['CAREER', 'minmax(0, 1fr)']],
    legends.map((h) => { const x = withTeam.get(h.c.id)!; return { cells: [who(g, h.c.id), span(x.first, x.last), `<span class="small">${esc(h.why)}</span>`] }; }), per,
    { empty: 'No legends yet. The honor roll in the League Records fills as great careers end.' }));
  pages.push({ tab: 'PLAYERS', title: 'Awards', html: '<p class="bk-empty">Awards and voting arrive with the value stat (step 3.6): MVP, Cy Young, Rookie of the Year, Gold Gloves and the rest. Every award your players win will be counted here.</p>' });
  // BATTING, PITCHING, SEASONS, GAMES
  for (const k of BOOK_BAT) pages.push({ tab: 'BATTING', title: catBy(k).label, sub: `CAREER WITH ${teamName(team).toUpperCase()}`, cols: withStat(LEAD_COLS, k), rows: careerBoard(g, catBy(k), per, team), empty: 'Nobody qualifies yet.' });
  for (const k of BOOK_PIT) pages.push({ tab: 'PITCHING', title: catBy(k).label, sub: `CAREER WITH ${teamName(team).toUpperCase()}`, cols: withStat(LEAD_COLS, k), rows: careerBoard(g, catBy(k), per, team), empty: 'Nobody qualifies yet.' });
  for (const k of SEASON_CATS) pages.push({ tab: 'SEASONS', title: catBy(k).label, sub: 'BEST SEASONS FOR THE TEAM', cols: withStat(SEASON_COLS, k), rows: seasonBoard(g, catBy(k), per, team), empty: 'No qualified seasons yet.' });
  const games = Y.flatMap((y) => y.games().filter((r) => r[1] === team || r[2] === team).map((row) => ({ row, y }))).sort((a, b) => byDrama(a.row, b.row) || b.y.year - a.y.year);
  pages.push({ tab: 'GAMES', title: 'Greatest Games', sub: 'BY DRAMA', cols: GAME_COLS, rows: gameRows(g, games, per, team), empty: 'No games yet.', note: g.league.history.some((y) => !y.games) ? 'Seasons before this book was started kept no game logs.' : 'Drama: how hard the win probability swung, 0 to 100.' });
  return pages;
}

// ---------------------------------------------------------------- Book 2: the league

const ERA_STATS: Array<{ title: string; cols: Array<[string, string]>; cells: (b: BatLine, p: PitchLine, games: number) => string[] }> = [
  { title: 'The Slash Line', cols: [['AVG', 'minmax(0, 1fr)'], ['OBP', 'minmax(0, 1fr)'], ['SLG', 'minmax(0, 1fr)'], ['OPS', 'minmax(0, 1fr)']], cells: (b) => [rate3(avg(b)), rate3(obp(b)), rate3(slg(b)), rate3(obp(b) + slg(b))] },
  { title: 'Runs and Homers', cols: [['R/G', 'minmax(0, 1fr)'], ['HR/G', 'minmax(0, 1fr)'], ['SB/G', 'minmax(0, 1fr)'], ['2B/G', 'minmax(0, 1fr)']], cells: (b, _, n) => [(b.R / n / 2).toFixed(2), (b.HR / n / 2).toFixed(2), (b.SB / n / 2).toFixed(2), (b.D / n / 2).toFixed(2)] },
  { title: 'Strikeouts and Walks', cols: [['K%', 'minmax(0, 1fr)'], ['BB%', 'minmax(0, 1fr)'], ['K/BB', 'minmax(0, 1fr)'], ['HBP%', 'minmax(0, 1fr)']], cells: (b) => [`${((100 * b.K) / b.PA).toFixed(1)}`, `${((100 * b.BB) / b.PA).toFixed(1)}`, (b.K / Math.max(1, b.BB)).toFixed(2), `${((100 * b.HBP) / b.PA).toFixed(1)}`] },
  { title: 'Pitching', cols: [['ERA', 'minmax(0, 1fr)'], ['WHIP', 'minmax(0, 1fr)'], ['K/9', 'minmax(0, 1fr)'], ['HR/9', 'minmax(0, 1fr)']], cells: (_, p) => [era2((27 * p.ER) / p.outs), ((3 * (p.BB + p.H)) / p.outs).toFixed(2), ((27 * p.K) / p.outs).toFixed(1), ((27 * p.HR) / p.outs).toFixed(2)] },
];

function leagueBook(g: Game, per: number): BookPage[] {
  const Y = years(g), done = Y.filter((y) => !y.live);
  const pages: BookPage[] = [];
  const titles = new Map<number, number>();
  for (const y of done) if (y.champion) titles.set(y.champion, (titles.get(y.champion) ?? 0) + 1);
  const top = [...titles].sort((a, b) => b[1] - a[1])[0];
  const kv = (k: string, v: string) => ({ cells: [k, `<b>${v}</b>`] });
  const H = honorRoll(g), C = [...careers(g).values()];
  const games = Y.reduce((a, y) => a + y.teams.reduce((b, t) => b + t.W, 0), 0);
  pages.push({ tab: 'HISTORY', title: 'The League at a Glance', cols: [['', 'minmax(0, 1fr)'], ['', 'auto']], rows: [
    kv('Seasons played', `${done.length}${Y.some((y) => y.live) ? ' + this one' : ''}`), kv('Games played', games.toLocaleString('en-US')), kv('Players who have played', C.length.toLocaleString('en-US')),
    kv('Champions so far', String(titles.size)), kv('Most titles', top ? `${teamName(top[0])}, ${top[1]}` : '—'),
    kv('On the honor roll', String(H.length)), kv('Decrees handed down', String(Y.filter((y) => y.decree).length)),
  ] });
  pages.push(...run('HISTORY', 'Champions', [['YEAR', '64px'], ['CHAMPION', 'minmax(0, 1fr)'], ['RUNNER-UP', 'minmax(0, 1fr)'], ['FINAL', '64px']],
    [...done].reverse().map((y) => { const ws = y.series.find((s) => s.round === 'WS'), lo = ws ? (ws.winner === ws.high ? ws.low : ws.high) : 0;
      return { cells: [yearLabel(y), y.champion ? `${teamChip(y.champion)}${esc(teamName(y.champion))}` : '—', lo ? `${teamChip(lo)}${esc(teamName(lo))}` : '—', ws ? `${Math.max(...ws.wins)}-${Math.min(...ws.wins)}` : '—'], mine: y.champion === g.userTeam }; }), per,
    { empty: 'The first champion is crowned at the end of Year 1.' }));
  pages.push(...run('HISTORY', 'The Gods’ Decrees', [['YEAR', '64px'], ['DECREE', 'minmax(0, 1fr)']],
    [...Y].reverse().filter((y) => y.decree).map((y) => ({ cells: [yearLabel(y), esc(y.decree!)] })), per, { empty: 'The Gods hand down their first decree in the winter after Year 1.' }));
  const fr = g.league.teams.map((t) => {
    const rows = Y.map((y) => y.teams.find((x) => x.teamId === t.id)!).filter(Boolean);
    const W = rows.reduce((a, r) => a + r.W, 0), L = rows.reduce((a, r) => a + r.L, 0);
    return { id: t.id, W, L, apps: done.filter((y) => y.teams.find((x) => x.teamId === t.id)!.seed > 0).length, pen: done.filter((y) => y.series.some((s) => s.round === 'LCS' && s.winner === t.id)).length, ti: titles.get(t.id) ?? 0 };
  }).sort((a, b) => b.ti - a.ti || b.pen - a.pen || b.W / Math.max(1, b.W + b.L) - a.W / Math.max(1, a.W + a.L));
  pages.push(...run('HISTORY', 'The Franchises', [['#', '36px'], ['TEAM', 'minmax(0, 1fr)'], ['W-L', '96px'], ['PCT', '60px'], ['PO', '44px'], ['PEN', '48px'], ['WON', '48px']],
    fr.map((x, i) => ({ cells: [rank(i), `${teamChip(x.id)}${esc(teamName(x.id))}`, `${x.W}-${x.L}`, pctOf(x.W, x.L), String(x.apps), String(x.pen), `<b>${x.ti}</b>`], mine: x.id === g.userTeam })), per,
    { note: 'PO playoff appearances, PEN pennants, WON titles.' }));
  // LEGENDS
  pages.push(...run('LEGENDS', 'The Honor Roll', [['PLAYER', 'minmax(0, 1fr)'], ['CAREER', '104px'], ['WHY', 'minmax(0, 1fr)']],
    H.map((h) => ({ cells: [who(g, h.c.id), span(h.c.first, h.c.last), `<span class="small">${esc(h.why)}</span>`] })), per,
    { empty: 'Nobody yet. Retired players join with a career value of 45 or a milestone (500 HR, 3,000 hits, 300 wins, 3,000 strikeouts).', note: 'Stands in for the Hall of Fame (step 3.7) and Living Legends (3.8).' }));
  pages.push({ tab: 'LEGENDS', title: 'Greatest Careers', sub: 'CAREER VALUE', cols: [['#', '36px'], ['PLAYER', 'minmax(0, 1fr)'], ['YEARS', '96px'], ['VALUE', '72px']],
    rows: [...C].sort((a, b) => b.value - a.value).slice(0, per).map((c, i) => ({ cells: [rank(i), `${who(g, c.id)}${isRetired(g, c.id) ? ' <span class="muted small">ret.</span>' : ''}`, span(c.first, c.last), `<b>${v1(c.value)}</b>`], mine: mineId(g, c.id) })),
    note: 'VALUE is interim: batting and pitching runs above replacement, in wins. No fielding until step 3.6.' });
  pages.push({ tab: 'LEGENDS', title: 'Greatest Seasons', sub: 'SINGLE-SEASON VALUE', cols: SEASON_COLS.map(([l, w], i) => [i === 3 ? 'VALUE' : l, w]),
    rows: [...seasonValues(g)].sort((a, b) => b.value - a.value).slice(0, per).map((v, i) => ({ cells: [rank(i), who(g, v.id, v.team), `Y${v.year}${v.live ? '*' : ''}`, `<b>${v1(v.value)}</b>`], mine: v.team === g.userTeam && mineId(g, v.id) })) });
  for (const k of BOOK_BAT) pages.push({ tab: 'BATTING', title: catBy(k).label, sub: 'CAREER LEADERS', cols: withStat(LEAD_COLS, k), rows: careerBoard(g, catBy(k), per), empty: 'Nobody qualifies yet.' });
  for (const k of BOOK_PIT) pages.push({ tab: 'PITCHING', title: catBy(k).label, sub: 'CAREER LEADERS', cols: withStat(LEAD_COLS, k), rows: careerBoard(g, catBy(k), per), empty: 'Nobody qualifies yet.' });
  for (const k of SEASON_CATS) pages.push({ tab: 'SEASONS', title: catBy(k).label, sub: 'SINGLE-SEASON RECORDS', cols: withStat(SEASON_COLS, k), rows: seasonBoard(g, catBy(k), per), empty: 'No qualified seasons yet.' });
  const gs = Y.flatMap((y) => y.games().map((row) => ({ row, y }))).sort((a, b) => byDrama(a.row, b.row) || b.y.year - a.y.year);
  pages.push({ tab: 'GAMES', title: 'Greatest Games', sub: 'BY DRAMA', cols: GAME_COLS, rows: gameRows(g, gs, per), empty: 'No games yet.' });
  // ERAS: by year, or by decade once the years don't fit a page
  const byDecade = Y.length > per;
  const groups = new Map<string, { label: string; bat?: BatLine; pit?: PitchLine; games: number }>();
  for (const y of Y) {
    const key = byDecade ? `D${Math.floor((y.year - 1) / 10)}` : `Y${y.year}`;
    const d = Math.floor((y.year - 1) / 10);
    const label = byDecade ? `Y${d * 10 + 1}–${d * 10 + 10}` : yearLabel(y);
    const grp = groups.get(key) ?? { label, games: 0 };
    for (const r of y.batting) grp.bat = sumInto(grp.bat, lineOf<BatLine>(r, BAT_FIELDS));
    for (const r of y.pitching) grp.pit = sumInto(grp.pit, lineOf<PitchLine>(r, PITCH_FIELDS));
    grp.games += y.teams.reduce((a, t) => a + t.W + t.L, 0) / 2;
    if (y.live) grp.label = byDecade ? `${label}*` : grp.label;
    groups.set(key, grp);
  }
  for (const e of ERA_STATS) {
    pages.push(...run('ERAS', e.title, [[byDecade ? 'YEARS' : 'YEAR', byDecade ? '112px' : '64px'], ...e.cols],
      [...groups.values()].filter((x) => x.bat && x.pit && x.games).reverse().map((x) => ({ cells: [x.label, ...e.cells(x.bat!, x.pit!, x.games)] })), per,
      { sub: byDecade ? 'LEAGUE AVERAGES BY DECADE' : 'LEAGUE AVERAGES BY YEAR', note: 'Per game counts both teams’ totals over two.' }));
  }
  // SPLITS, at the back
  const cur = Y.find((y) => y.live), now = cur?.splits(), all: Record<string, SplitRow> = {};
  for (const y of Y) { const s = y.splits(); if (s) addSplits(all, s); }
  const missing = g.league.history.some((y) => !y.splits);
  const groupsOf: Array<[string, Array<(typeof SPLIT_DEFS)[number]['group']>]> = [['Platoon', ['platoon']], ['Home and Road', ['venue']], ['Bases and Outs', ['bases', 'outs']], ['By Inning', ['inning']], ['By Month', ['month']]];
  const cells = (label: string, r?: SplitRow) => {
    if (!r || !r[0]) return [label, '—', '—', '—', '—', '—', '—'];
    const [PA, AB, Hh, D, T, HR, BB, HBP, K, SF] = r, b = { PA, AB, H: Hh, D, T, HR, BB, HBP, K, SF } as BatLine;
    return [label, PA.toLocaleString('en-US'), rate3(avg(b)), rate3(obp(b)), rate3(slg(b)), `${((100 * HR) / PA).toFixed(1)}`, `${((100 * K) / PA).toFixed(1)}`];
  };
  for (const [title, grp] of groupsOf) {
    const defs = SPLIT_DEFS.filter((d) => grp.includes(d.group) && (all[d.key]?.[0] || now?.[d.key]?.[0]));
    const cols: Array<[string, string]> = [['SPLIT', 'minmax(0, 1fr)'], ['PA', '96px'], ['AVG', '60px'], ['OBP', '60px'], ['SLG', '60px'], ['HR%', '56px'], ['K%', '56px']];
    if (now) pages.push(...run('SPLITS', title, cols, defs.map((d) => ({ cells: cells(esc(d.label), now[d.key]) })), per, { sub: `LEAGUE BATTING · YEAR ${cur!.year}` }));
    pages.push(...run('SPLITS', title, cols, defs.map((d) => ({ cells: cells(esc(d.label), all[d.key]) })), per,
      { sub: 'LEAGUE BATTING · ALL TIME', note: missing ? 'All time counts the seasons since the books began keeping splits.' : undefined }));
  }
  return pages;
}

// ---------------------------------------------------------------- assembly

/** A book, paged: a title page and a glance, then each tab starting on a left-hand page. */
export function buildBook(g: Game, id: BookId, team: number, per: number): Book {
  const body = memo(g, `book:${id}:${team}:${per}`, () => (id === 'team' ? teamBook(g, team, per) : leagueBook(g, per)));
  const title = id === 'team' ? `${teamName(team)} Record Book` : 'League Record Book';
  const pages: BookPage[] = [];
  const tabs: Book['tabs'] = [];
  const glance = body[0];
  pages.push({ tab: 'CONTENTS', title, html: '' }, glance);
  for (const p of body.slice(1)) {
    if (!tabs.length || tabs[tabs.length - 1].tab !== p.tab) {
      if (pages.length % 2) pages.push({ tab: pages[pages.length - 1].tab, title: '', blank: true });
      tabs.push({ tab: p.tab, page: pages.length });
    }
    pages.push(p);
  }
  if (pages.length % 2) pages.push({ tab: pages[pages.length - 1].tab, title: '', blank: true });
  const Y = years(g);
  const range = Y.length ? `Year ${Y[0].year}${Y.length > 1 ? ` to Year ${Y[Y.length - 1].year}` : ''}` : 'Before Opening Day';
  const contents = tabs.map((t) => `<li><button type="button" class="link" data-act="book-tab" data-page="${t.page}" data-key="book-tab:${t.page}">${esc(t.tab)}</button><span class="bk-dots" aria-hidden="true"></span><span>${t.page + 1}</span></li>`).join('');
  pages[0] = { tab: 'CONTENTS', title, sub: range.toUpperCase(), html: `<div class="bk-title">${id === 'team' ? teamChip(team) : ''}<p class="bk-kicker">${id === 'team' ? 'BOOK ONE' : 'BOOK TWO'}</p><p class="bk-name">${esc(id === 'team' ? teamName(team) : LEAGUES.join(' & '))}</p><p class="bk-range">${esc(range)}</p></div><!--picker--><ol class="bk-contents">${contents}</ol>`, note: Y.some((y) => y.live) ? '* the season in progress, counted through today.' : undefined };
  return { id, title, tabs: [{ tab: 'CONTENTS', page: 0 }, ...tabs], pages };
}
