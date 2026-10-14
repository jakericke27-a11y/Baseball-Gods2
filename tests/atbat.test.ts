import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PitchResult, pitchResultOf, Outcome } from '../src/engine/atbat/codes';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { runPaSeason } from '../tools/lib/pa-season';
import { measure } from '../tools/curves';

const env = JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment;
const P = applyEnvironment(DEFAULT_PARAMS, env);
const league = generateLeague(31337);

describe('determinism', () => {
  it('same seed produces a byte-identical pitch log', () => {
    const a = runPaSeason(league, P, 5, { log: true }).log!;
    const b = runPaSeason(league, P, 5, { log: true }).log!;
    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('count rules hold for every logged at-bat', () => {
  it('walks end on ball four, strikeouts on strike three, two-strike fouls never add a strike', () => {
    const log = runPaSeason(league, P, 6, { log: true }).log!;
    let i = 0, checked = 0;
    const violations: string[] = [];
    while (i < log.length) {
      const outcome = log[i + 4], n = log[i + 7];
      let balls = 0, strikes = 0;
      for (let k = 0; k < n; k++) {
        const r = pitchResultOf(log[i + 8 + k]);
        const last = k === n - 1;
        if (r === PitchResult.Ball) balls++;
        else if (r === PitchResult.CalledStrike || r === PitchResult.SwingingStrike) strikes++;
        else if (r === PitchResult.Foul) { if (strikes < 2) strikes++; }
        else if (!last) violations.push(`PA ${checked}: ball in play / HBP before the last pitch`);
        if (!last && (balls >= 4 || strikes >= 3)) violations.push(`PA ${checked}: count ${balls}-${strikes} mid at-bat`);
      }
      if (outcome === Outcome.Walk && balls !== 4) violations.push(`PA ${checked}: walk on ${balls} balls`);
      if ((outcome === Outcome.StrikeoutSwinging || outcome === Outcome.StrikeoutLooking) && strikes !== 3)
        violations.push(`PA ${checked}: strikeout on ${strikes} strikes`);
      i += 8 + n; checked++;
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(150_000);
  });
});

describe('every rating does what it says', () => {
  const N = 60_000;
  const lo = 35, hi = 65;
  it('power raises home runs', () => expect(measure(P, { power: hi }, {}, N).HR600).toBeGreaterThan(measure(P, { power: lo }, {}, N).HR600 * 1.8));
  it('contact lowers strikeouts', () => expect(measure(P, { contact: hi }, {}, N).K).toBeLessThan(measure(P, { contact: lo }, {}, N).K - 0.05));
  it('discipline raises walks', () => expect(measure(P, { discipline: hi }, {}, N).BB).toBeGreaterThan(measure(P, { discipline: lo }, {}, N).BB + 0.05));
  it('speed raises batting average', () => expect(measure(P, { speed: hi }, {}, N).AVG).toBeGreaterThan(measure(P, { speed: lo }, {}, N).AVG + 0.010));
  it('velocity raises strikeouts', () => expect(measure(P, {}, { velocity: hi }, N).K).toBeGreaterThan(measure(P, {}, { velocity: lo }, N).K + 0.03));
  it('movement suppresses home runs', () => expect(measure(P, {}, { movement: hi }, N).HR600).toBeLessThan(measure(P, {}, { movement: lo }, N).HR600 * 0.75));
  it('control lowers walks', () => expect(measure(P, {}, { control: hi }, N).BB).toBeLessThan(measure(P, {}, { control: lo }, N).BB - 0.03));
});
// League-level calibration is checked through real games in game.test.ts.
