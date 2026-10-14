import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { decodeEvents } from '../src/engine/game/text';
import { restoreSeason, snapshotSeason } from '../src/engine/snapshot';
import { generateLeague } from '../src/engine/generate';
import { createSeason, liveStep, simDay, simDays, startLiveDay, type Season } from '../src/engine/season/season';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const season = () => { const s = createSeason(generateLeague(21), P, { year: 1, seed: 21, logs: true, rosterRules: true, userTeam: 7 }); simDays(s, 20); return s; };
/** Days until team 7 plays. */
const toGameDay = (s: Season) => { while (!(s.schedule.byDay[s.day] ?? []).some((g) => g.home === 7 || g.away === 7)) simDay(s); };

describe('live games', () => {
  it('a live day where nobody moves is the same day as a simmed one', () => {
    const a = season(), b = season();
    toGameDay(a); toGameDay(b);
    const simmed = simDay(a);
    const day = startLiveDay(b, 7)!;
    let calls = 0;
    while (day.call) { liveStep(day); calls++; }
    expect(calls).toBeGreaterThan(50);
    expect(day.results.map((r) => r.score)).toEqual(simmed.map((r) => r.score));
    expect(b.rng.state()).toEqual(a.rng.state());
    expect(b.day).toBe(a.day);
  });

  it('a pinch hitter bats right away, shows in the box and the log, and the starter is out of the game', () => {
    const s = season(); toGameDay(s);
    const day = startLiveDay(s, 7)!;
    const mine = day.setups[0].teamId === 7 ? 0 : 1;
    while (day.call && day.call.half !== mine) liveStep(day);
    const call = day.call!, bench = day.setups[mine].bench!;
    expect(bench.length).toBeGreaterThan(0);
    const ph = bench[0], out = call.batter;
    liveStep(day, [{ kind: 'sub', side: mine, slot: call.slot, id: ph.id, why: 'hitter' }]);
    while (day.call) liveStep(day);
    const res = day.results.find((r) => r.teamIds.includes(7))!;
    expect(res.batting.get(ph.id)!.PA).toBeGreaterThan(0);
    expect(res.subs).toEqual([expect.objectContaining({ incoming: ph.id, outgoing: out, why: 'hitter' })]);
    expect(decodeEvents(res.log!).some((e) => e.type === 'sub' && e.incoming === ph.id)).toBe(true);
    expect(res.lineups[mine].some((l) => l.player.id === out)).toBe(true); // the box keeps the starting lineup; subs listed apart
    const { data, logs } = snapshotSeason(s);
    const back = restoreSeason(data, logs).results.find((r) => r.teamIds.includes(7) && r.day === res.day)!;
    expect(back.subs).toEqual(res.subs); // and saves keep them
  });

  it('the manager can bring in a reliever, or keep the AI from pulling his pitcher', () => {
    const s = season(); toGameDay(s);
    const day = startLiveDay(s, 7)!;
    const mine = day.setups[0].teamId === 7 ? 0 : 1, fld = mine;
    // when the other side bats, we're pitching: wave in a reliever
    while (day.call && day.call.half === mine) liveStep(day);
    const arm = day.setups[fld].bullpen[0].player.id;
    liveStep(day, [{ kind: 'pitcher', side: fld, id: arm }]);
    expect(day.call?.pitchers[fld].id).toBe(arm);
    // and later, whenever the AI wants him out, say no: he stays until the half ends
    let kept = 0;
    while (day.call) {
      const c = day.call;
      if (c.half !== mine && c.aiPitch[fld]) {
        const before = c.pitchers[fld].id;
        liveStep(day, [{ kind: 'keep', side: fld }]);
        expect(day.call!.aiPitch[fld]).toBe(0); // decided: the AI stands down this time
        expect(day.call!.pitchers[fld].id).toBe(before); // and he's still out there to face the batter
        kept++;
        liveStep(day); // play on
      } else liveStep(day);
    }
    expect(kept).toBeGreaterThan(0);
  });
});
