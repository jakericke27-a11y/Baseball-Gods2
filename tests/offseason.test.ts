import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { develop, playerValue, RATING_KEYS } from '../src/engine/development';
import { generateLeague, PIPELINE } from '../src/engine/generate';
import { nextSeason } from '../src/engine/offseason';
import { createRng } from '../src/engine/rng';
import { createSeason, simToEnd, type Season } from '../src/engine/season/season';
import { restoreSeason, snapshotSeason } from '../src/engine/snapshot';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('development', () => {
  const league = generateLeague(11);
  it('the pipeline is hidden extra: Year 1 rosters and ratings are untouched by it', () => {
    const a = generateLeague(11);
    expect(a.players.map((p) => p.ratings)).toEqual(league.players.map((p) => p.ratings));
    expect(league.players.every((p) => p.dev && RATING_KEYS.every((k) => p.dev!.potential[k] >= 20 && p.dev!.potential[k] <= 80))).toBe(true);
    expect(league.amateurs.length).toBe(PIPELINE.classSize * (PIPELINE.signAge - PIPELINE.firstAge));
    expect(Math.min(...league.amateurs.map((p) => p.age))).toBe(16);
  });
  it('young players grow, old players decline, and nobody leaves 20–80', () => {
    const rng = createRng(5);
    const kids = league.amateurs.filter((p) => p.age === 18).map((p) => structuredClone(p));
    const vets = league.players.filter((p) => p.age >= 34).map((p) => structuredClone(p));
    const v0k = mean(kids.map(playerValue)), v0v = mean(vets.map(playerValue));
    for (let y = 0; y < 3; y++) for (const p of [...kids, ...vets]) develop(p, rng);
    expect(mean(kids.map(playerValue))).toBeGreaterThan(v0k + 4);
    expect(mean(vets.map(playerValue))).toBeLessThan(v0v - 2);
    for (const p of [...kids, ...vets]) for (const k of RATING_KEYS) { expect(p.ratings[k]).toBeGreaterThanOrEqual(20); expect(p.ratings[k]).toBeLessThanOrEqual(80); }
  });
});

describe('offseason and Year 2', () => {
  const run = (seed: number, years: number) => {
    let s: Season = createSeason(generateLeague(seed), P, { year: 1, seed });
    const reports = [];
    for (let y = 1; y < years; y++) { simToEnd(s); const n = nextSeason(s); reports.push(n.report); s = n.season; }
    return { s, reports };
  };
  const { s, reports } = run(21, 4);
  it('the year turns over: Year 4, a fresh schedule, standings at 0-0, the same dials', () => {
    expect(s.year).toBe(4);
    expect(s.day).toBe(0);
    expect([...s.standings.values()].every((r) => r.W + r.L === 0)).toBe(true);
    expect(s.params).toEqual(P);
    expect(s.schedule.games.length).toBe(15 * 162);
  });
  it('every team carries 22 position players and 18 pitchers, with a full lineup', () => {
    for (const t of s.league.teams) {
      const r = t.playerIds.map((id) => s.players.get(id)!);
      expect(r.filter((p) => p.position !== 'P').length).toBe(22);
      expect(r.filter((p) => p.position === 'P').length).toBe(18);
      expect(s.plans.get(t.id)!.lineup.length).toBe(9);
    }
  });
  it('players retire, sign and age; ids stay unique; nobody is in two places', () => {
    for (const r of reports) { expect(r.retirements.length).toBeGreaterThan(40); expect(r.signings.length).toBeGreaterThan(40); }
    const L = s.league;
    const ids = [...L.players, ...L.freeAgents, ...L.amateurs, ...L.retired].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(L.teams.flatMap((t) => t.playerIds).length).toBe(L.players.length);
    expect(L.retired.length).toBe(reports.reduce((n, r) => n + r.retirements.length, 0) + L.retired.filter((p) => p.lastTeam === 0).length);
  });
  it('the league stays settled: ages and talent near where they started', () => {
    const y1 = generateLeague(21).players;
    expect(Math.abs(mean(s.league.players.map((p) => p.age)) - mean(y1.map((p) => p.age)))).toBeLessThan(1.5);
    expect(Math.abs(mean(s.league.players.map(playerValue)) - mean(y1.map(playerValue)))).toBeLessThan(1.5);
  });
  it('is deterministic, and a Year 3 snapshot restores and plays on the same', () => {
    const again = run(21, 4).s;
    expect(again.league.players.map((p) => [p.id, p.age, p.ratings])).toEqual(s.league.players.map((p) => [p.id, p.age, p.ratings]));
    const { s: y3 } = run(33, 3);
    const twin = run(33, 3).s;
    const { data, logs } = snapshotSeason(y3);
    const back = restoreSeason(JSON.parse(JSON.stringify(data)), logs);
    simToEnd(back); simToEnd(twin);
    expect(JSON.stringify([...back.standings.values()])).toBe(JSON.stringify([...twin.standings.values()]));
    expect(nextSeason(back).report).toEqual(nextSeason(twin).report);
  }, 120000);
  it('version-2 snapshots (before the pipeline) gain one on load', () => {
    const fresh = createSeason(generateLeague(8), P, { year: 1, seed: 8 });
    const { data, logs } = snapshotSeason(fresh);
    const old = JSON.parse(JSON.stringify(data));
    old.v = 2;
    delete old.league.amateurs; delete old.league.freeAgents; delete old.league.retired; delete old.league.nextId;
    for (const p of old.league.players) delete p.dev;
    const back = restoreSeason(old, logs);
    expect(back.league.amateurs.length).toBeGreaterThan(0);
    expect(back.league.players.every((p) => p.dev)).toBe(true);
  });
});
