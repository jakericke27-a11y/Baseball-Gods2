/**
 * What each decree does to a season: every blessing and curse, one regular season each on the same leagues,
 * against the same seasons with no decree. Use it to size the decrees in engine/decree.ts.
 *   npm run decrees [seeds]
 */
import { BASELINE_ENVIRONMENT, applyEnvironment, shiftEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { DECREES } from '../src/engine/decree';
import { generateLeague } from '../src/engine/generate';
import { createSeason, simToEnd } from '../src/engine/season/season';

const SEEDS = Array.from({ length: Number(process.argv[2] ?? 2) }, (_, i) => 101 + i * 7);
type Line = Record<'AVG' | 'HR' | 'K' | 'BB' | 'D' | 'T' | 'PPA' | 'RG' | 'TOP', number>;

function season(env: LeagueEnvironment, seed: number): Line {
  const s = createSeason(generateLeague(seed), applyEnvironment(DEFAULT_PARAMS, env), { year: 1, seed });
  simToEnd(s);
  let PA = 0, AB = 0, H = 0, HR = 0, K = 0, BB = 0, D = 0, T = 0, P = 0, R = 0;
  const ops: number[] = [];
  for (const b of s.batting.values()) {
    PA += b.PA; AB += b.AB; H += b.H; HR += b.HR; K += b.K; BB += b.BB; D += b.D; T += b.T; P += b.P; R += b.R;
    if (b.PA >= 400) ops.push((b.H + b.BB + b.HBP) / (b.AB + b.BB + b.HBP + b.SF) + (b.H + b.D + 2 * b.T + 3 * b.HR) / b.AB);
  }
  ops.sort((a, b) => b - a);
  const median = ops[Math.floor(ops.length / 2)];
  return { AVG: H / AB, HR: (600 * HR) / PA, K: K / PA, BB: BB / PA, D: (600 * D) / PA, T: (600 * T) / PA, PPA: P / PA, RG: R / s.results.length, TOP: ops.slice(0, 20).reduce((a, b) => a + b, 0) / 20 - median };
}
const avgOf = (ls: Line[]) => Object.fromEntries(Object.keys(ls[0]).map((k) => [k, ls.reduce((a, l) => a + l[k as keyof Line], 0) / ls.length])) as Line;
const run = (env: LeagueEnvironment) => avgOf(SEEDS.map((s) => season(env, s)));

const t0 = performance.now();
const base = run(BASELINE_ENVIRONMENT);
const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${((100 * (b - a)) / a).toFixed(0)}%`.padStart(6);
console.log(`neutral: AVG ${base.AVG.toFixed(3)} HR/600 ${base.HR.toFixed(1)} K ${(100 * base.K).toFixed(1)}% BB ${(100 * base.BB).toFixed(1)}% 2B ${base.D.toFixed(1)} 3B ${base.T.toFixed(1)} P/PA ${base.PPA.toFixed(2)} R/G ${base.RG.toFixed(2)} top-20 OPS over median ${base.TOP.toFixed(3)}`);
console.log(`\n${'decree'.padEnd(24)}   AVG      HR      K     BB     2B     3B   P/PA    R/G    TOP`);
for (const d of DECREES) for (const sign of [1, -1]) {
  const l = run(shiftEnvironment(BASELINE_ENVIRONMENT, d.dials, sign));
  console.log(`${(sign > 0 ? '+ ' : '- ') + d.stat}`.padEnd(24) + ` ${(l.AVG - base.AVG >= 0 ? '+' : '') + (1000 * (l.AVG - base.AVG)).toFixed(0).padStart(3)}pt` +
    [pct(base.HR, l.HR), pct(base.K, l.K), pct(base.BB, l.BB), pct(base.D, l.D), pct(base.T, l.T), pct(base.PPA, l.PPA), pct(base.RG, l.RG), pct(base.TOP, l.TOP)].join(' '));
}
console.log(`\n${SEEDS.length} leagues per row, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
