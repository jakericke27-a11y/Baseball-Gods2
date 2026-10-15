import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { byDrama, GAME_KEEP, greatGames, leagueSplits } from '../src/engine/chronicle';
import { gameDrama } from '../src/engine/game/drama';
import { generateLeague } from '../src/engine/generate';
import { createSeason, simDays } from '../src/engine/season/season';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);

describe('the chronicle (what the record books keep)', () => {
  const s = createSeason(generateLeague(21), P, { year: 1, seed: 21, logs: true, postseason: true });
  simDays(s, 40);

  it("keeps every team's highest-Drama games, highest first", () => {
    const rows = greatGames(s.results);
    for (const t of s.league.teams) {
      const mine = s.results.filter((r) => r.teamIds.includes(t.id)).map((r) => gameDrama(r.log!, r.innings));
      const best = Math.max(...mine.map((d) => d.score));
      expect(rows.some((r) => (r[1] === t.id || r[2] === t.id) && r[6] === best)).toBe(true);
      expect(rows.filter((r) => r[1] === t.id || r[2] === t.id).length).toBeGreaterThanOrEqual(Math.min(GAME_KEEP, mine.length));
    }
    expect([...rows].sort(byDrama)).toEqual(rows);
  });

  it("league splits add up to the season's plate appearances, and each family splits the whole", () => {
    const sp = leagueSplits(s.results, s.players);
    let PA = 0, H = 0, HR = 0;
    for (const l of s.batting.values()) { PA += l.PA; H += l.H; HR += l.HR; }
    expect(sp.all[0]).toBe(PA);
    expect(sp.all[2]).toBe(H);
    expect(sp.all[5]).toBe(HR);
    expect(sp.vsL[0] + sp.vsR[0]).toBe(PA);
    expect(sp.same[0] + sp.opp[0]).toBe(PA);
    expect(sp.home[0] + sp.away[0]).toBe(PA);
    expect(sp.o0[0] + sp.o1[0] + sp.o2[0]).toBe(PA);
    expect(sp.empty[0] + sp.on[0]).toBe(PA);
  });
});
