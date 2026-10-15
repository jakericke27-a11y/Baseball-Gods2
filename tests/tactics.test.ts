import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { decodeEvents } from '../src/engine/game/text';
import { Play } from '../src/engine/game/types';
import { tacticFor, NORMAL_ALIGN } from '../src/engine/game/tactics';
import { generateLeague } from '../src/engine/generate';
import { createSeason, liveStep, simDay, simDays, startLiveDay, type Season } from '../src/engine/season/season';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const season = () => { const s = createSeason(generateLeague(21), P, { year: 1, seed: 21, logs: true, rosterRules: true, userTeam: 7 }); simDays(s, 20); return s; };
const toGameDay = (s: Season) => { while (!(s.schedule.byDay[s.day] ?? []).some((g) => g.home === 7 || g.away === 7)) simDay(s); };

describe('manager calls and alignments', () => {
  it('nothing called and normal depth is no tactic at all', () => {
    expect(tacticFor(null, null, NORMAL_ALIGN)).toBeUndefined();
    expect(tacticFor('power', null, NORMAL_ALIGN)).toBeDefined();
  });

  it('a call lasts one plate appearance; an alignment stays; the intentional walk is four balls', () => {
    const s = season(); toGameDay(s);
    const day = startLiveDay(s, 7)!;
    const mine = day.setups[0].teamId === 7 ? 0 : 1;
    while (day.call && day.call.half === mine) liveStep(day); // to your half in the field
    liveStep(day, [{ kind: 'align', side: mine, outfield: 'deep' }, { kind: 'call', side: mine, pitch: 'ibb' }]);
    expect(day.call!.calls.pitch[mine]).toBe('ibb');
    expect(day.call!.align[mine].outfield).toBe('deep');
    const batter = day.call!.batter;
    liveStep(day);
    expect(day.call!.calls.pitch[mine]).toBeNull();
    expect(day.call!.align[mine].outfield).toBe('deep');
    while (day.call) liveStep(day);
    const res = day.results.find((r) => r.teamIds.includes(7))!;
    const ev = decodeEvents(res.log!).find((e) => e.type === 'pa' && e.batter === batter);
    expect(ev && ev.type === 'pa' && ev.play === Play.Walk && ev.pitches.length === 4).toBe(true);
  });

  it('a call made for the other side does nothing', () => {
    const s = season(); toGameDay(s);
    const day = startLiveDay(s, 7)!;
    const mine = day.setups[0].teamId === 7 ? 0 : 1;
    while (day.call && day.call.half !== mine) liveStep(day);
    liveStep(day, [{ kind: 'call', side: mine, pitch: 'k' }]); // you're batting: no pitch call for you
    expect(day.call!.calls.pitch[mine]).toBeNull();
  });
});
