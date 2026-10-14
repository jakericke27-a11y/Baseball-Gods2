/**
 * Many years back to back: is the league stable? Ages, talent (spread and top end), the league line,
 * retirements and signings, year by year. Nothing is recalibrated between years.
 *   npm run years -- 20 [seed]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { playerValue } from '../src/engine/development';
import { decreeFor } from '../src/engine/decree';
import { yearParams } from '../src/engine/modifiers';
import { generateLeague } from '../src/engine/generate';
import { nextSeason } from '../src/engine/offseason';
import { activeOf, RULES } from '../src/engine/roster';
import { createSeason, simDays, simToEnd, type Season } from '../src/engine/season/season';

const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith('--')));
const nums = args.filter((a) => !a.startsWith('--'));
const N = Number(nums[0] ?? 20), SEED = Number(nums[1] ?? 2026);
const BASELINE = `calibration/years-baseline${process.argv.includes('--no-gods') ? '-no-gods' : ''}.json`;
const rows: { RG: number; AVG: number; HR600: number; K: number; BB: number; age: number; val: number; hit: number; pit: number }[] = [];
const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const f = (x: number, d = 1) => x.toFixed(d);

function line(s: Season) {
  let PA = 0, AB = 0, H = 0, HR = 0, K = 0, BB = 0, R = 0;
  for (const b of s.batting.values()) { PA += b.PA; AB += b.AB; H += b.H; HR += b.HR; K += b.K; BB += b.BB; R += b.R; }
  const games = s.results.filter((g) => g.kind !== 'post').length;
  return { AVG: H / AB, HR600: (600 * HR) / PA, K: K / PA, BB: BB / PA, RG: R / games };
}

const NO_GODS = flags.has('--no-gods');
console.log(`year  age   <25%  33+%   val   sd   top30  hit   pit  |  AVG   HR/600  K%    BB%   R/G  | retire sign  FA   champ  decree`);
let s = createSeason(generateLeague(SEED), P, { year: 1, seed: SEED, postseason: true, rosterRules: true });
const t0 = performance.now();
let illegal = 0, moves = 0;
for (let y = 1; y <= N; y++) {
  const L = s.league.players;
  const vals = L.map(playerValue).sort((a, b) => b - a);
  // roster legality, checked every 20 days through the year
  for (; s.day < s.regularDays; simDays(s, 20)) for (const t of s.league.teams) {
    const act = activeOf(t), arms = act.filter((id) => s.players.get(id)?.position === 'P').length;
    if (t.playerIds.length > RULES.forty || act.length !== RULES.active || arms !== RULES.pitchers || !act.every((id) => t.playerIds.includes(id))) illegal++;
  }
  simToEnd(s);
  moves += s.league.teams.reduce((n, t) => n + (t.moves?.count ?? 0), 0);
  const l = line(s);
  const champ = s.post?.champion ?? 0;
  rows.push({ RG: l.RG, AVG: l.AVG, HR600: l.HR600, K: 100 * l.K, BB: 100 * l.BB, age: mean(L.map((p) => p.age)), val: mean(vals),
    hit: mean(L.filter((p) => p.position !== 'P').map(playerValue)), pit: mean(L.filter((p) => p.position === 'P').map(playerValue)) });
  const { season, report } = y < N ? nextSeason(s) : { season: s, report: null };
  console.log(`${String(y).padStart(4)}  ${f(mean(L.map((p) => p.age)))}  ${f(100 * L.filter((p) => p.age < 25).length / L.length, 0).padStart(4)}  ${f(100 * L.filter((p) => p.age >= 33).length / L.length, 0).padStart(4)}  ` +
    `${f(mean(vals))}  ${f(sd(vals))}  ${f(mean(vals.slice(0, 30)))}  ${f(mean(L.filter((p) => p.position !== 'P').map(playerValue)))}  ${f(mean(L.filter((p) => p.position === 'P').map(playerValue)))}  |  ` +
    `${l.AVG.toFixed(3)}  ${f(l.HR600).padStart(5)}  ${f(100 * l.K)}  ${f(100 * l.BB, 1).padStart(4)}  ${f(l.RG, 2)}  |  ${String(report?.retirements.length ?? '').padStart(4)}  ${String(report?.signings.length ?? '').padStart(4)}  ${String(s.league.freeAgents.length).padStart(4)}  ${String(champ).padStart(5)}  ${decreeFor(s.league, y)?.label ?? ''}`);
  // --no-gods: no decrees, so the run shows the players' drift alone
  if (NO_GODS) { season.league.modifiers = []; season.params = yearParams(season.league, season.year); }
  s = season;
}
console.log(`\n${N} years in ${f((performance.now() - t0) / 1000)} s · illegal rosters seen: ${illegal} · AI moves in the last month of each year: ${moves}`);

// Regression baseline: the first five and last five years of a run, compared with tolerances.
//   npm run years -- 20 --save    record the current league as the baseline
//   npm run years -- 20 --check   compare against it; exits 1 if anything moved past its tolerance
//   --no-gods                     no decrees (the players' drift alone); the baseline is recorded with the Gods on
type Row = (typeof rows)[number];
const span = (rs: Row[]) => Object.fromEntries((Object.keys(rs[0]) as (keyof Row)[]).map((k) => [k, mean(rs.map((r) => r[k]))])) as Row;
const summary = { years: N, seed: SEED, illegal, early: span(rows.slice(0, 5)), late: span(rows.slice(-5)) };
const TOL: Record<keyof Row, number> = { RG: 0.35, AVG: 0.006, HR600: 1.2, K: 1.0, BB: 0.6, age: 0.4, val: 0.6, hit: 0.6, pit: 0.6 };
if (flags.has('--save')) { writeFileSync(BASELINE, JSON.stringify(summary, null, 2) + '\n'); console.log(`saved ${BASELINE}`); }
if (flags.has('--check')) {
  if (!existsSync(BASELINE)) { console.log(`no ${BASELINE}; run with --save first`); process.exit(1); }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof summary;
  if (base.years !== N || base.seed !== SEED) console.log(`note: baseline is ${base.years} years, seed ${base.seed}`);
  let bad = illegal > 0 ? 1 : 0;
  console.log(`\n${'check'.padEnd(10)} ${'base'.padStart(8)} ${'now'.padStart(8)} ${'tol'.padStart(7)}`);
  for (const part of ['early', 'late'] as const) for (const k of Object.keys(TOL) as (keyof Row)[]) {
    const a = base[part][k], b = summary[part][k], over = Math.abs(b - a) > TOL[k];
    if (over) bad++;
    console.log(`${(part + ' ' + k).padEnd(10)} ${a.toFixed(3).padStart(8)} ${b.toFixed(3).padStart(8)} ${TOL[k].toFixed(3).padStart(7)}${over ? '  MOVED' : ''}`);
  }
  console.log(bad ? `\n${bad} check(s) moved past tolerance${illegal ? ` (illegal rosters: ${illegal})` : ''}` : '\nall within tolerance');
  process.exit(bad ? 1 : 0);
}
