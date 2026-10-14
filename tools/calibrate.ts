/**
 * Calibrator. Tunes the league environment so a neutral season hits the targets,
 * then verifies on fresh leagues/seeds. Replaces the old hand-tune-balance.py loop.
 *
 *   npx tsx tools/calibrate.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { logit } from '../src/engine/math';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, NEUTRAL_ENVIRONMENT, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { rates, runPaSeason, estRunsPerGame } from './lib/pa-season';
import { runGameSeason } from './lib/game-season';
const GAMES = process.argv.includes('--games');

const spreadArg = process.argv.find((a) => a.startsWith('--spread='));
const BASE = { HBP: 0.010, D600: 28, T600: 4.5, PperPA: 3.85, SwStr: 0.085 };
export const PRESETS = {
  // Your April targets: .265-.278 AVG, 24-28 HR/600, 18% K, 10.5% BB
  slugfest: { ...BASE, K: 0.18, BB: 0.105, AVG: 0.270, HR600: 26 },
  // 1999-2000 offense with a little extra pop
  steroid: { ...BASE, K: 0.17, BB: 0.095, AVG: 0.268, HR600: 22 },
  // DEFAULT. Roughly 2019 MLB (~9.9 runs/game). Outliers come from stacked factors, not the baseline.
  baseline: { ...BASE, K: 0.20, BB: 0.085, AVG: 0.252, HR600: 20, SwStr: 0.095, T600: 3.0 },
};
const presetName = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'baseline') as keyof typeof PRESETS;
const outName = spreadArg ? `${presetName}-spread${spreadArg.split('=')[1]}` : presetName;
const TARGETS = PRESETS[presetName];
console.log(`Calibrating preset "${presetName}":`, TARGETS);

import { existsSync } from 'node:fs';
const warm = existsSync(`calibration/${process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'baseline'}.json`) && !spreadArg;
const env: LeagueEnvironment = warm ? { ...NEUTRAL_ENVIRONMENT, ...JSON.parse(readFileSync(`calibration/${process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'baseline'}.json`, 'utf8')) } : { ...NEUTRAL_ENVIRONMENT, spread: spreadArg ? Number(spreadArg.split('=')[1]) : 1 };
const league = generateLeague(1001);

const ITERS = warm ? 20 : 40;
for (let it = 1; it <= ITERS; it++) {
  const pr = applyEnvironment(DEFAULT_PARAMS, env);
  let r, swStr;
  if (GAMES) { const g = runGameSeason(league, pr, 777); r = rates(g.totals); swStr = g.pitchResults[2] / g.totals.P; }
  else { const tot = runPaSeason(league, pr, 777, { log: false }).totals; r = rates(tot); swStr = tot.pitchResults[2] / tot.P; }
  env.zone += 0.35 * (logit(r.BB) - logit(TARGETS.BB));
  env.contact += 0.80 * (logit(swStr) - logit(TARGETS.SwStr));
  env.protect += 0.80 * (logit(r.K) - logit(TARGETS.K));
  env.foul += 0.80 * (TARGETS.PperPA - r.PperPA);
  env.hr += 1.00 * (Math.log(TARGETS.HR600) - Math.log(r.HR600));
  env.hit += 1.60 * (logit(TARGETS.AVG) - logit(r.AVG));
  env.xbh += 1.20 * (Math.log(TARGETS.D600) - Math.log(r.D600));
  env.triple += 1.00 * (Math.log(TARGETS.T600) - Math.log(r.T600));
  env.hbp += 1.00 * (Math.log(TARGETS.HBP) - Math.log(r.HBP));
  if (it % 5 === 0 || it === 1 || it === ITERS) {
    console.log(`iter ${String(it).padStart(2)}  K ${(100 * r.K).toFixed(1)}  BB ${(100 * r.BB).toFixed(1)}  ` +
      `AVG ${r.AVG.toFixed(3)}  HR/600 ${r.HR600.toFixed(1)}  2B/600 ${r.D600.toFixed(1)}  ` +
      `3B/600 ${r.T600.toFixed(1)}  P/PA ${r.PperPA.toFixed(2)}  SwStr ${(100 * swStr).toFixed(1)}`);
  }
}

console.log('\nCalibrated environment:', Object.fromEntries(Object.entries(env).map(([k, v]) => [k, +v.toFixed(3)])));
mkdirSync('calibration', { recursive: true });
writeFileSync(`calibration/${outName}.json`, JSON.stringify(env, null, 2));

// Verify on leagues and seeds the calibrator never saw.
console.log('\nVerification on 5 fresh leagues:');
const params = applyEnvironment(DEFAULT_PARAMS, env);
for (let i = 0; i < 5; i++) {
  const res = GAMES ? runGameSeason(generateLeague(5000 + i), params, 9000 + i) : runPaSeason(generateLeague(5000 + i), params, 9000 + i, { log: false });
  const r = rates(res.totals);
  const rpg = 'runs' in res ? (res as { runs: number }).runs / 2430 : estRunsPerGame(res.totals);
  console.log(`  league ${i + 1}: K ${(100 * r.K).toFixed(1)}  BB ${(100 * r.BB).toFixed(1)}  AVG ${r.AVG.toFixed(3)}  ` +
    `OBP ${r.OBP.toFixed(3)}  SLG ${r.SLG.toFixed(3)}  HR/600 ${r.HR600.toFixed(1)}  P/PA ${r.PperPA.toFixed(2)}  ` +
    `${GAMES ? 'actual' : 'est.'} R/G ${rpg.toFixed(2)}  (${res.ms.toFixed(0)} ms)`);
}
