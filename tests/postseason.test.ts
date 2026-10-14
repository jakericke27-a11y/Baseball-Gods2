import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { postseasonAfterDay } from '../src/engine/season/postseason';
import { createSeason, isOver, regularOver, simDay, simToEnd } from '../src/engine/season/season';
import { restoreSeason, snapshotSeason } from '../src/engine/snapshot';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const season = (seed: number) => createSeason(generateLeague(seed), P, { year: 1, seed, postseason: true });

describe('postseason (2019 format)', () => {
  // seed 1 has a Game 163
  const s = season(1); simToEnd(s);
  const post = s.post!;
  it('ten teams, five per league, seeded 1–5; a champion at the end', () => {
    expect(isOver(s)).toBe(true);
    expect(post.phase).toBe('done');
    expect(post.seeds.map((x) => x.length)).toEqual([5, 5]);
    for (const lg of [0, 1]) for (const id of post.seeds[lg]) expect(s.league.teams.find((t) => t.id === id)!.conference).toBe(lg);
    const ws = post.series.find((x) => x.round === 'WS')!;
    expect(post.champion).toBe(ws.winner);
    expect(post.series.filter((x) => x.round === 'LCS').map((x) => x.winner).sort()).toEqual([ws.high, ws.low].sort());
  });
  it('series run the right lengths and end when someone clinches', () => {
    const need = { WC: 1, DS: 3, LCS: 4, WS: 4 };
    for (const sr of post.series) {
      expect(Math.max(...sr.wins)).toBe(need[sr.round]);
      expect(Math.min(...sr.wins)).toBeLessThan(need[sr.round]);
      const games = s.results.filter((r) => r.series === sr.id);
      expect(games.length).toBe(sr.wins[0] + sr.wins[1]);
      expect(games.map((g) => g.game)).toEqual(games.map((_, i) => i + 1));
    }
    expect(post.series.map((x) => x.round).join()).toBe('WC,WC,DS,DS,DS,DS,LCS,LCS,WS');
  });
  it('the 1 seed meets the wild card winner; 2 meets 3; home field follows the seeds (2-2-1, 2-3-2)', () => {
    for (const lg of [0, 1]) {
      const [s1, s2, s3] = post.seeds[lg];
      const wc = post.series.find((x) => x.id === `WC-${lg}`)!.winner;
      const ds = post.series.filter((x) => x.round === 'DS' && x.league === lg);
      expect(ds.map((x) => [x.high, x.low])).toEqual([[s1, wc], [s2, s3]]);
      const g = s.results.filter((r) => r.series === ds[0].id);
      expect(g.map((r) => r.teamIds[1] === s1)).toEqual([true, true, false, false, true].slice(0, g.length));
    }
  });
  it('Game 163 counts in the regular-season standings; postseason stats are kept apart', () => {
    const tb = s.results.filter((r) => r.kind === 'tiebreak');
    expect(tb.length).toBeGreaterThan(0);
    for (const r of tb) for (const id of r.teamIds) { const row = s.standings.get(id)!; expect(row.W + row.L).toBe(163); }
    const sumPA = (kinds: Array<string | undefined>) => s.results.filter((r) => kinds.includes(r.kind)).reduce((n, r) => n + [...r.batting.values()].reduce((a, b) => a + b.PA, 0), 0);
    expect([...s.batting.values()].reduce((a, b) => a + b.PA, 0)).toBe(sumPA([undefined, 'tiebreak']));
    expect([...s.postBatting.values()].reduce((a, b) => a + b.PA, 0)).toBe(sumPA(['post']));
    expect(regularOver(s)).toBe(true);
  });
  it('October aces: game 1 of every series after the wild card usually goes to the ace; after the wild card, nobody starts on short rest', () => {
    let ace = 0, n = 0;
    for (const r of s.results.filter((x) => x.kind === 'post')) {
      for (const side of [0, 1]) {
        const sp = r.pitchersUsed[side][0];
        const prev = s.results.filter((x) => x.day < r.day && x.pitchersUsed.some((u) => u[0] === sp)).at(-1);
        // (the wild card game can't wait: a team that used its whole rotation in the final days may start a man on short rest)
        if (prev && !r.series!.startsWith('WC') && !s.players.get(sp)!.abilities?.bounceBack) expect(r.day - prev.day).toBeGreaterThanOrEqual(5);
        if (r.game === 1 && !r.series!.startsWith('WC')) { n++; if (s.plans.get(r.teamIds[side])!.rotation[0].id === sp) ace++; }
      }
    }
    expect(ace / n).toBeGreaterThan(0.6);
  });
});

describe('tiebreakers', () => {
  it('a tie for a division title is played off, and the winner takes the division', () => {
    const s = season(5);
    s.day = s.regularDays; // pretend the year is over with these standings
    const div = s.league.teams.filter((t) => t.conference === 0 && t.division === 0).map((t) => t.id);
    let k = 0; s.standings.forEach((r) => { r.W = 60 + k; r.L = 102 - k; k++; }); // all different
    for (const id of div.slice(0, 2)) { const r = s.standings.get(id)!; r.W = 95; r.L = 67; }
    postseasonAfterDay(s);
    const tb = s.schedule.byDay[s.day].filter((g) => g.kind === 'tiebreak');
    expect(tb.length).toBe(1);
    expect([tb[0].home, tb[0].away].sort()).toEqual(div.slice(0, 2).sort());
    simDay(s);
    const winner = s.results.at(-1)!;
    const w = winner.score[1] > winner.score[0] ? winner.teamIds[1] : winner.teamIds[0];
    expect(s.post!.phase).toBe('post');
    expect(s.post!.seeds[0].slice(0, 3)).toContain(w);
    expect(s.post!.seeds[0].slice(3)).toContain(div.find((id) => id !== w && div.slice(0, 2).includes(id)));
  });
});

describe('postseason saves', () => {
  it('a snapshot taken mid-October restores and finishes the same', () => {
    const a = season(2), b = season(2);
    while (!(a.post && a.post.phase === 'post' && a.post.series.some((x) => x.round === 'DS'))) { simDay(a); simDay(b); }
    simDay(a); simDay(b);
    const { data, logs } = snapshotSeason(a);
    const c = restoreSeason(JSON.parse(JSON.stringify(data)), logs);
    simToEnd(b); simToEnd(c);
    expect(c.post).toEqual(b.post);
    expect(c.schedule.days).toBe(b.schedule.days);
    expect([...c.postPitching]).toEqual([...b.postPitching]);
  }, 60000);
  it('version-1 snapshots (before the postseason) upgrade', () => {
    const s = createSeason(generateLeague(3), P, { year: 1, seed: 3 });
    const { data, logs } = snapshotSeason(s);
    const v1 = { ...data, v: 1 } as Record<string, unknown>;
    for (const k of ['regularDays', 'postseason', 'post', 'postBatting', 'postPitching']) delete v1[k];
    const back = restoreSeason(v1 as never, logs);
    expect(back.postseason).toBe(true);
    expect(back.regularDays).toBe(s.schedule.days);
  });
});
