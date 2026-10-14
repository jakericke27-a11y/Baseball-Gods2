import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/game/game';
import type { TeamGameSetup } from '../src/engine/game/types';
import { createRng } from '../src/engine/rng';
import { runGameSeason } from '../tools/lib/game-season';
import { buildTeamPlans } from '../src/engine/season/teams';
import { baseRuns, rates } from '../tools/lib/pa-season';

const env = JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment;
const P = applyEnvironment(DEFAULT_PARAMS, env);
const league = generateLeague(8080); // a league the calibrator never saw
const season = runGameSeason(league, P, 11);
const tg = 2 * season.games;

describe('game loop', () => {
  it('same seed replays a game byte for byte', () => {
    const plans = [...buildTeamPlans(league).values()];
    const mk = (i: number): TeamGameSetup => ({
      teamId: plans[i].teamId, lineup: plans[i].lineup, starter: plans[i].rotation[0], bullpen: plans[i].bullpen, fatigue: () => 0,
    });
    const a = simulateGame(mk(0), mk(1), P, createRng(3), { log: true }).log!;
    const b = simulateGame(mk(0), mk(1), P, createRng(3), { log: true }).log!;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('every run is credited and charged, RBI never exceed runs, outs reconcile, every game has a W and an L', () => {
    expect(season.integrity).toEqual({ runsMismatch: 0, rbiOverRuns: 0, erOverRuns: 0, outsMismatch: 0, missingDecision: 0 });
  });

  it('runs match what the batting line implies (within 4%), and RBI per run looks like MLB', () => {
    expect(Math.abs(season.runs / baseRuns(season.totals) - 1)).toBeLessThan(0.04);
    const rbiPerRun = season.totals.RBI / season.runs;
    expect(rbiPerRun).toBeGreaterThan(0.92);
    expect(rbiPerRun).toBeLessThan(0.99);
  });

  it('running game and defense land near 2019', () => {
    const per = (x: number) => x / tg;
    expect(per(season.totals.SB)).toBeGreaterThan(0.30); expect(per(season.totals.SB)).toBeLessThan(0.65);
    expect(per(season.totals.GIDP)).toBeGreaterThan(0.55); expect(per(season.totals.GIDP)).toBeLessThan(0.85);
    expect(per(season.errors)).toBeGreaterThan(0.45); expect(per(season.errors)).toBeLessThan(0.75);
    expect(per(season.totals.SF)).toBeGreaterThan(0.15); expect(per(season.totals.SF)).toBeLessThan(0.32);
  });

  it('baseline targets hold through real games on an unseen league', () => {
    const r = rates(season.totals);
    expect(Math.abs(r.K - 0.20)).toBeLessThan(0.015);
    expect(Math.abs(r.BB - 0.085)).toBeLessThan(0.008);
    expect(Math.abs(r.AVG - 0.252)).toBeLessThan(0.011);
    expect(Math.abs(r.HR600 - 20)).toBeLessThan(1.8);
    const rpg = season.runs / season.games;
    expect(rpg).toBeGreaterThan(9.2); expect(rpg).toBeLessThan(10.9);
  });
});

describe('event log replays every game exactly', () => {
  it('outs, bases, score, hits and errors rebuilt from events match the box score for a full season', async () => {
    const { createSeason, simToEnd } = await import('../src/engine/season/season');
    const { decodeEvents, applyMoves, outsOnPlay } = await import('../src/engine/game/text');
    const { Play } = await import('../src/engine/game/types');
    const s = createSeason(generateLeague(4242), P, { year: 1, seed: 77, logs: true });
    simToEnd(s);
    const problems: string[] = [];
    for (const [gi, g] of s.results.entries()) {
      const score = [0, 0], hits = [0, 0], errors = [0, 0];
      let half = -1, outs = 0, bases = 0;
      const bad = (msg: string) => { if (problems.length < 5) problems.push(`game ${gi}: ${msg}`); };
      for (const ev of decodeEvents(g.log!)) {
        const key = ev.inning * 2 + ev.half;
        if (key !== half) {
          if (half >= 0 && outs !== 3) bad(`half ${half} ended with ${outs} outs`);
          half = key; outs = 0; bases = 0;
        }
        if (ev.type === 'steal') {
          if (!(bases & (1 << (ev.base - 2)))) bad('steal from an empty base');
          bases &= ~(1 << (ev.base - 2));
          if (ev.safe) bases |= 1 << (ev.base - 1); else outs++;
        } else if (ev.type === 'wp') {
          for (const m of ev.moves) if (!(bases & (1 << (m.from - 1)))) bad('wild pitch moved a runner who was not on');
          bases = applyMoves(bases, ev.moves);
          score[ev.half] += ev.moves.filter((m) => m.to === 4).length;
        } else if (ev.type === 'pa') {
          if (ev.outsBefore !== outs || ev.basesBefore !== bases) bad(`PA state ${ev.outsBefore}/${ev.basesBefore} vs replay ${outs}/${bases}`);
          if (ev.runs !== ev.moves.filter((m) => m.to === 4).length) bad('runs do not match runners home');
          outs += outsOnPlay(ev);
          bases = applyMoves(bases, ev.moves);
          score[ev.half] += ev.runs;
          if (ev.play >= Play.Single && ev.play <= Play.HomeRun) hits[ev.half]++;
          if (ev.play === Play.ReachedOnError) errors[1 - ev.half]++;
        }
      }
      if (score[0] !== g.score[0] || score[1] !== g.score[1]) bad(`score ${score} vs ${g.score}`);
      if (hits[0] !== g.hits[0] || hits[1] !== g.hits[1]) bad(`hits ${hits} vs ${g.hits}`);
      if (errors[0] !== g.errors[0] || errors[1] !== g.errors[1]) bad(`errors ${errors} vs ${g.errors}`);
    }
    expect(problems).toEqual([]);
    expect(s.results.length).toBe(2430);
  });
});
