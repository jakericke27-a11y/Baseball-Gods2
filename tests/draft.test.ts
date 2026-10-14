import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { DRAFT, autoPick, autoPicks, lotteryOdds, nextDraftYear, onClock, pick, projection } from '../src/engine/draft';
import { foundingLeague, finishFounding, generateLeague } from '../src/engine/generate';
import { beginWinter, finishWinter, nextSeason } from '../src/engine/offseason';
import { createSeason, simToEnd, type Season } from '../src/engine/season/season';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);

describe('the founding draft', () => {
  it('builds 30 legal 40-man rosters from a bigger pool; the rest are Year 1 free agents', () => {
    const L = generateLeague(3);
    expect(L.drafts[0].kind).toBe('founding');
    expect(L.drafts[0].picks.length).toBe(1200);
    for (const t of L.teams) {
      const r = t.playerIds.map((id) => L.players.find((p) => p.id === id)!);
      expect(r.filter((p) => p.position !== 'P').length).toBe(22);
      expect(r.filter((p) => p.pitcherRole === 'SP').length).toBeGreaterThanOrEqual(6);
      expect(t.active!.length).toBe(26);
    }
    expect(L.freeAgents.length).toBe(300);
  });
  it('is a snake; you can make your own picks, then auto the rest', () => {
    const { league, draft } = foundingLeague(3);
    const first = onClock(draft);
    autoPicks(league, draft, 7);
    expect(onClock(draft)).toBe(7);
    const best = [...league.freeAgents].sort((a, b) => projection(b, league.seed).now - projection(a, league.seed).now)[0];
    pick(league, draft, best.id);
    expect(league.teams.find((t) => t.id === 7)!.playerIds).toContain(best.id);
    autoPicks(league, draft);
    finishFounding(league, draft);
    expect(draft.picks[29].teamId).toBe(draft.picks[30].teamId); // the turn of the snake
    expect(draft.picks[0].teamId).toBe(first);
    expect(league.teams.every((t) => t.playerIds.length === 40)).toBe(true);
  });
  it('the same seed drafts the same league', () => {
    expect(generateLeague(9).teams.map((t) => t.playerIds)).toEqual(generateLeague(9).teams.map((t) => t.playerIds));
  });
});

describe('the four-year draft', () => {
  let s: Season = createSeason(generateLeague(17), P, { year: 1, seed: 17 });
  for (let y = 1; y < 4; y++) { simToEnd(s); s = nextSeason(s).season; }
  simToEnd(s);
  const w = beginWinter(s);
  const d = w.draft!;
  it('comes the winter after Year 4: ten rounds from the amateurs aged 18–22, lottery for 1–6 among the ten worst', () => {
    expect(d.kind).toBe('cycle');
    expect(d.rounds).toBe(DRAFT.rounds);
    expect(d.pool.length).toBeGreaterThan(300);
    for (const id of d.pool) { const p = s.league.amateurs.find((x) => x.id === id)!; expect(p.age).toBeGreaterThanOrEqual(18); expect(p.age).toBeLessThanOrEqual(22); }
    const lotteryTeams = d.lottery.map(([id]) => id);
    expect(lotteryTeams.length).toBe(10);
    expect(lotteryTeams).toEqual(expect.arrayContaining(d.order.slice(0, 6)));
    expect(d.order.slice(6).filter((id) => lotteryTeams.includes(id)).length).toBe(4);
  });
  const { season: y5, report } = finishWinter(w);
  it('every pick goes to its team\'s prospect pool with rights to the next draft; picks have reasons', () => {
    expect(report.draft.length).toBe(300);
    expect(report.draft.every((x) => x.reason.length > 0)).toBe(true);
    const L = y5.league;
    expect(L.drafts.at(-1)!.year).toBe(4);
    const drafted = new Set(report.draft.map((x) => x.playerId));
    const inPool = L.prospects.filter((x) => drafted.has(x.player.id));
    const promoted = report.promotions.filter((x) => drafted.has(x.id));
    expect(inPool.length + promoted.length).toBe(300);
    expect(inPool.every((x) => x.until === 8)).toBe(true);
    expect(L.amateurs.some((p) => drafted.has(p.id))).toBe(false);
    for (const t of L.teams) expect(t.playerIds.length).toBeLessThanOrEqual(40);
  });
  it('rights run out at the next draft: unpromoted prospects go back to the pool or to free agency', () => {
    let t: Season = y5;
    for (let y = 5; y < 8; y++) { simToEnd(t); t = nextSeason(t).season; }
    simToEnd(t);
    const held = t.league.prospects.filter((x) => x.until === 8).map((x) => x.player.id);
    const w8 = beginWinter(t);
    for (const id of held) expect(w8.prev.league.prospects.some((x) => x.player.id === id)).toBe(false);
    expect(w8.draft).not.toBeNull();
    finishWinter(w8);
  }, 120000);
});

describe('your draft board and the preview', () => {
  it('AUTO picks for you take the top name left on your board; other teams ignore it', () => {
    const { league: L, draft: d } = foundingLeague(31);
    const me = onClock(d);
    const want = d.pool[d.pool.length - 1]; // someone the AI would never take first
    L.wishlist = [want];
    const first = autoPick(L, d, { team: me, ids: L.wishlist });
    expect(first.playerId).toBe(want);
    expect(first.reason).toBe('from your board');
    const next = autoPick(L, d, { team: me, ids: L.wishlist }); // someone else's turn: their own choice
    expect(next.teamId).not.toBe(me);
  });
  it('lottery odds: six top-6 picks shared out, the worst team most likely', () => {
    const o = lotteryOdds();
    expect(o.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 6);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeLessThanOrEqual(o[i - 1] + 1e-9);
  });
  it('the next draft year', () => {
    expect([1, 3, 4, 5, 8].map(nextDraftYear)).toEqual([4, 4, 4, 8, 8]);
  });
});
