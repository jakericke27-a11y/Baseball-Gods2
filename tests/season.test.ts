import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { buildSchedule, lightingAt, weekdayOf } from '../src/engine/season/schedule';
import { createSeason, FATIGUE, simToEnd } from '../src/engine/season/season';
import { runGameSeason } from '../tools/lib/game-season';

const env = JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment;
const P = applyEnvironment(DEFAULT_PARAMS, env);
const league = generateLeague(9090);
const teams = new Map(league.teams.map((t) => [t.id, t]));

describe('schedule (2019 division-heavy format)', () => {
  const sched = buildSchedule(league, 1, 3);
  it('every team plays exactly 162, 81 at home, never twice in a day', () => {
    for (const t of league.teams) {
      const mine = sched.games.filter((g) => g.home === t.id || g.away === t.id);
      expect(mine.length).toBe(162);
      expect(mine.filter((g) => g.home === t.id).length).toBe(81);
      expect(new Set(mine.map((g) => g.day)).size).toBe(162);
    }
  });
  it('every game has a first-pitch time: weeknights mostly night, Sundays mostly day', () => {
    const light = (gs: typeof sched.games) => gs.map((g) => lightingAt(g.start));
    const sundays = light(sched.games.filter((g) => weekdayOf(g.day) === 0));
    const weeknights = light(sched.games.filter((g) => weekdayOf(g.day) >= 1 && weekdayOf(g.day) <= 4));
    expect(sched.games.every((g) => g.start > 0)).toBe(true);
    expect(sundays.filter((l) => l === 'day').length / sundays.length).toBeGreaterThan(0.6);
    expect(weeknights.filter((l) => l !== 'day').length / weeknights.length).toBeGreaterThan(0.6);
  });
  it('19 vs each division rival, six 7-game and four 6-game league opponents, 4 vs each team of one interleague division', () => {
    for (const t of league.teams) {
      const vs = new Map<number, number>();
      for (const g of sched.games) {
        if (g.home === t.id) vs.set(g.away, (vs.get(g.away) ?? 0) + 1);
        if (g.away === t.id) vs.set(g.home, (vs.get(g.home) ?? 0) + 1);
      }
      const counts = { div: [] as number[], lg: [] as number[], inter: [] as number[] };
      for (const [id, n] of vs) {
        const o = teams.get(id)!;
        (o.conference !== t.conference ? counts.inter : o.division === t.division ? counts.div : counts.lg).push(n);
      }
      expect(counts.div).toEqual([19, 19, 19, 19]);
      expect(counts.lg.filter((n) => n === 7).length).toBe(6);
      expect(counts.lg.filter((n) => n === 6).length).toBe(4);
      expect(counts.inter).toEqual([4, 4, 4, 4, 4]);
    }
  });
});

describe('season engine', () => {
  const r = runGameSeason(league, P, 21);
  it('standings add up: every team 162 decisions, total wins = total losses', () => {
    let w = 0, l = 0;
    for (const row of r.season.standings.values()) { expect(row.W + row.L).toBe(162); w += row.W; l += row.L; }
    expect(w).toBe(l);
  });
  it('bullpen philosophy: about 3 pitchers per team-game, most games use 3 or fewer', () => {
    const tg = 2 * r.games;
    const avg = r.pitchersUsed.reduce((a, c, k) => a + c * k, 0) / tg;
    expect(avg).toBeGreaterThan(2.6); expect(avg).toBeLessThan(3.4);
    expect((r.pitchersUsed[1] + r.pitchersUsed[2] + r.pitchersUsed[3]) / tg).toBeGreaterThan(0.6);
  });
  it('rotations hold: nobody starts more often than his rotation allows', () => {
    for (const [teamId, plan] of r.season.plans) {
      const cap = Math.ceil(162 / plan.strategy.rotationSize) + 4;
      for (const p of plan.rotation) expect(r.pitching.get(p.id)?.GS ?? 0, `team ${teamId}`).toBeLessThanOrEqual(cap);
    }
  });
  it('a bounce-back ability enables short-rest starts, capped at two days of rest', () => {
    const lg = generateLeague(9090);
    const s = createSeason(lg, P, { year: 1, seed: 21 });
    const plan = [...s.plans.values()].find((p) => p.strategy.rotationSize === 5)!;
    const ace = plan.rotation[0];
    ace.abilities = { bounceBack: 1.0 }; // recovers twice as fast
    simToEnd(s);
    const gs = s.pitching.get(ace.id)!.GS;
    expect(gs).toBeGreaterThan(Math.ceil(162 / 5) + 4);
    expect(gs).toBeLessThanOrEqual(Math.ceil(s.schedule.days / FATIGUE.minDaysBetweenStarts)); // two days' rest minimum
  });
});
