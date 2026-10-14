/**
 * Rating response curves: vary one rating 20→80 (everything else 50) against a
 * league-average opponent and measure the outcome rates. This is how we check that
 * every rating does what it says, and how big the star/scrub gap is.
 *   npx tsx tools/curves.ts [preset]
 */
import { readFileSync } from 'node:fs';
import { simulateAtBat, MAX_PITCHES } from '../src/engine/atbat/atbat';
import { Outcome, isAtBat, isHit, isStrikeout } from '../src/engine/atbat/codes';
import { DEFAULT_PARAMS, type AtBatParams } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { createRng } from '../src/engine/rng';
import type { Player, Ratings } from '../src/engine/types';

export function avgRatings(): Ratings {
  return {
    power: 50, contact: 50, discipline: 50, speed: 50, velocity: 50, control: 50, movement: 50, stamina: 50,
    instincts: 50, glove: 50, cannon: 50, clutchRisp: 50, clutchPressure: 50,
  };
}
const mk = (ratings: Ratings, isPitcher: boolean, hand: 'L' | 'R'): Player => ({
  id: 1, name: 'x', age: 27, regionId: 1, bats: hand, throws: hand, position: isPitcher ? 'P' : 'DH', ratings,
});

export function measure(P: AtBatParams, bat: Partial<Ratings>, pit: Partial<Ratings>, n: number, seed = 7) {
  const rng = createRng(seed);
  const scratch = new Uint8Array(MAX_PITCHES + 4);
  const b = { ...avgRatings(), ...bat }, p = { ...avgRatings(), ...pit };
  let PA = 0, AB = 0, H = 0, HR = 0, BB = 0, K = 0, TB = 0, HBP = 0;
  for (let i = 0; i < n; i++) {
    // alternate handedness so the platoon effect averages out
    const r = simulateAtBat(mk(b, false, i % 2 ? 'L' : 'R'), mk(p, true, i % 4 < 2 ? 'L' : 'R'), { fatigue: 0 }, P, rng, scratch);
    const o = r.outcome;
    PA++; if (isAtBat(o)) AB++; if (isHit(o)) H++; if (isStrikeout(o)) K++;
    if (o === Outcome.Walk) BB++; if (o === Outcome.HitByPitch) HBP++; if (o === Outcome.HomeRun) HR++;
    TB += o === Outcome.Single ? 1 : o === Outcome.Double ? 2 : o === Outcome.Triple ? 3 : o === Outcome.HomeRun ? 4 : 0;
  }
  return { K: K / PA, BB: BB / PA, AVG: H / AB, OBP: (H + BB + HBP) / PA, SLG: TB / AB, HR600: (600 * HR) / PA };
}

const isMain = process.argv[1]?.endsWith('curves.ts');
if (isMain) {
  const preset = process.argv[2] ?? 'baseline';
  const env = JSON.parse(readFileSync(`calibration/${preset}.json`, 'utf8')) as LeagueEnvironment;
  const P = applyEnvironment(DEFAULT_PARAMS, env);
  const levels = [30, 40, 50, 60, 70, 80];
  const N = 120_000;
  const row = (label: string, f: (v: number) => ReturnType<typeof measure>, pick: (m: ReturnType<typeof measure>) => string) =>
    console.log(label.padEnd(26) + levels.map((v) => pick(f(v)).padStart(8)).join(''));
  console.log(''.padEnd(26) + levels.map((v) => String(v).padStart(8)).join(''));
  row('batter power → HR/600', (v) => measure(P, { power: v }, {}, N), (m) => m.HR600.toFixed(1));
  row('batter contact → K%', (v) => measure(P, { contact: v }, {}, N), (m) => (100 * m.K).toFixed(1));
  row('batter contact → AVG', (v) => measure(P, { contact: v }, {}, N), (m) => m.AVG.toFixed(3));
  row('batter discipline → BB%', (v) => measure(P, { discipline: v }, {}, N), (m) => (100 * m.BB).toFixed(1));
  row('batter discipline → OBP', (v) => measure(P, { discipline: v }, {}, N), (m) => m.OBP.toFixed(3));
  row('batter speed → AVG', (v) => measure(P, { speed: v }, {}, N), (m) => m.AVG.toFixed(3));
  row('pitcher velocity → K%', (v) => measure(P, {}, { velocity: v }, N), (m) => (100 * m.K).toFixed(1));
  row('pitcher movement → HR/600', (v) => measure(P, {}, { movement: v }, N), (m) => m.HR600.toFixed(1));
  row('pitcher movement → K%', (v) => measure(P, {}, { movement: v }, N), (m) => (100 * m.K).toFixed(1));
  row('pitcher control → BB%', (v) => measure(P, {}, { control: v }, N), (m) => (100 * m.BB).toFixed(1));
  row('pitcher control → SLG', (v) => measure(P, {}, { control: v }, N), (m) => m.SLG.toFixed(3));

  console.log('\nArchetypes vs a league-average pitcher:');
  const profiles: Array<[string, Partial<Ratings>]> = [
    ['Average regular (all 50)', {}],
    ['Three true outcomes', { power: 72, contact: 32, discipline: 66 }],
    ['Contact specialist', { contact: 75, power: 38, discipline: 55 }],
    ['Speedster', { speed: 78, contact: 58, power: 35 }],
    ['Elite slugger (80/65/60)', { power: 80, contact: 65, discipline: 60 }],
  ];
  for (const [label, r] of profiles) {
    const m = measure(P, r, {}, 200_000);
    console.log(`  ${label.padEnd(26)} K ${(100 * m.K).toFixed(1)}%  BB ${(100 * m.BB).toFixed(1)}%  ` +
      `${m.AVG.toFixed(3)}/${m.OBP.toFixed(3)}/${m.SLG.toFixed(3)}  HR/600 ${m.HR600.toFixed(1)}`);
  }
}
