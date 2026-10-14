import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { catchUpStreaks, linesSince, newStreakBook, playoffRace, type TeamRace } from '../src/engine/season/races';
import { createSeason, regularOver, simDay, simDays } from '../src/engine/season/season';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const season = (seed: number) => createSeason(generateLeague(seed), P, { year: 1, seed, postseason: true });

describe('the playoff race', () => {
  it('asking for odds never moves the season: the same seed plays the same year', () => {
    const a = season(3), b = season(3);
    simDays(a, 90); simDays(b, 90);
    playoffRace(a, 200);
    simDays(a, 30); simDays(b, 30);
    expect([...a.standings.values()].map((r) => r.W)).toEqual([...b.standings.values()].map((r) => r.W));
  });

  it('odds are deterministic for a day, sum to the berths, and respect the proofs', () => {
    const s = season(5); simDays(s, 150);
    const r1 = playoffRace(s, 300), r2 = playoffRace(s, 300);
    expect(r1.map((t) => t.odds)).toEqual(r2.map((t) => t.odds));
    for (const lg of [0, 1]) {
      const teams = r1.filter((t) => t.league === lg);
      expect(teams.reduce((n, t) => n + t.odds.division, 0)).toBeCloseTo(3, 0);
      expect(teams.reduce((n, t) => n + t.odds.berth, 0)).toBeCloseTo(5, 0);
    }
    for (const t of r1) {
      if (t.eliminated) expect(t.odds.berth).toBe(0);
      if (t.clinched) expect(t.odds.berth).toBe(1);
      expect(t.odds.berth).toBeGreaterThanOrEqual(t.odds.division);
    }
  });

  it('clinches are never wrong and eliminations never come back, all the way to the field', () => {
    const s = season(11);
    const seen = new Map<number, TeamRace>();
    let clinches = 0, outs = 0;
    while (!regularOver(s)) {
      simDay(s);
      if (s.regularDays - s.day > 70) continue;
      for (const t of playoffRace(s, 0)) {
        const was = seen.get(t.teamId);
        if (was?.eliminated) expect(t.eliminated).toBe(true);
        if (was?.clinched) expect(t.clinched).toBeTruthy();
        if (was?.clinched === 'division') expect(t.clinched).toBe('division');
        if (t.clinched && !was?.clinched) clinches++;
        if (t.eliminated && !was?.eliminated) outs++;
        seen.set(t.teamId, t);
      }
    }
    const seeds = s.post!.seeds;
    for (const t of seen.values()) {
      const lg = seeds[t.league];
      if (t.clinched) expect(lg).toContain(t.teamId);
      if (t.clinched === 'division') expect(lg.slice(0, 3)).toContain(t.teamId);
      if (t.eliminated) expect(lg).not.toContain(t.teamId);
    }
    expect(clinches).toBeGreaterThanOrEqual(10);
    expect(outs).toBeGreaterThanOrEqual(15);
  });

  it('magic numbers count down to zero for the team that clinches', () => {
    const s = season(7);
    simDays(s, s.regularDays - 3);
    const leader = playoffRace(s, 0).find((t) => t.spot === 'division' && t.clinched === 'division');
    if (leader) expect(leader.magic).toBe(0);
    for (const t of playoffRace(s, 0)) if (t.spot === 'division' && !t.clinched) expect(t.magic).toBeGreaterThan(0);
  });
});

describe('streaks and recent form', () => {
  const s = season(9); simDays(s, 100);
  it('a hitting streak is the run of games with an at-bat that all had a hit', () => {
    const book = newStreakBook(); catchUpStreaks(book, s.results);
    const [id, n] = [...book.hit].sort((a, b) => b[1] - a[1])[0];
    const games = s.results.filter((g) => (g.batting.get(id)?.AB ?? 0) > 0);
    const tail = games.slice(-n);
    expect(tail.every((g) => g.batting.get(id)!.H > 0)).toBe(true);
    if (games.length > n) expect(games[games.length - n - 1].batting.get(id)!.H).toBe(0);
    expect(book.best.hit[0]).toBeGreaterThanOrEqual(n);
  });
  it('catching up twice changes nothing', () => {
    const book = newStreakBook(); catchUpStreaks(book, s.results);
    expect(catchUpStreaks(book, s.results)).toEqual([]);
  });
  it('lines since a day add up to the season over the whole season', () => {
    const { batting } = linesSince(s.results, 0);
    for (const [id, l] of s.batting) expect(batting.get(id)!.H).toBe(l.H);
  });
});
