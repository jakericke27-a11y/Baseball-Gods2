import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { createRng } from '../src/engine/rng';
import { createSeason, simDays, simToEnd, type Season } from '../src/engine/season/season';
import { restoreSeason, snapshotSeason, upgradeSnapshot, SNAPSHOT_VERSION } from '../src/engine/snapshot';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const fresh = (logs: boolean) => createSeason(generateLeague(4242), P, { year: 1, seed: 4242, logs });
const summary = (s: Season) => JSON.stringify({
  day: s.day, rng: s.rng.state(), standings: [...s.standings.values()], bat: [...s.batting], pit: [...s.pitching], fat: [...s.fatigue],
  results: s.results.map((g) => [g.day, g.score, g.innings, g.decisions, g.log ? g.log.length : -1]),
});

describe('rng state', () => {
  it('a generator rebuilt from its state continues the same sequence', () => {
    const a = createRng(77);
    for (let i = 0; i < 1001; i++) a.normal();
    const b = createRng(0, a.state());
    for (let i = 0; i < 500; i++) expect(b.next()).toBe(a.next());
    expect(b.normal()).toBe(a.normal());
  });
});

describe('season snapshots', () => {
  it('stopping mid-season, saving through JSON and restoring finishes the same year', () => {
    const straight = fresh(true); simToEnd(straight);
    const first = fresh(true); simDays(first, 63);
    const { data, logs } = snapshotSeason(first);
    const back = restoreSeason(JSON.parse(JSON.stringify(data)), logs);
    expect(summary(back)).toBe(summary(first));
    simToEnd(back);
    expect(summary(back)).toBe(summary(straight));
    const i = back.results.length - 1;
    expect(back.results[i].log).toEqual(straight.results[i].log);
    expect(back.results[10].log).toEqual(straight.results[10].log);
  }, 60000);
  it('a snapshot is a copy: simming the live season leaves it alone', () => {
    const s = fresh(false); simDays(s, 10);
    const { data } = snapshotSeason(s);
    const before = JSON.stringify(data);
    simDays(s, 5);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('rejects saves from a newer game', () => {
    const { data } = snapshotSeason(fresh(false));
    expect(() => upgradeSnapshot({ ...data, v: SNAPSHOT_VERSION + 1 })).toThrow(/newer/);
  });
});
