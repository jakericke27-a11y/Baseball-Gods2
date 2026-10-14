import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { playerValue } from '../src/engine/development';
import { generateLeague } from '../src/engine/generate';
import { nextSeason } from '../src/engine/offseason';
import { activeOf, movesLeft, refreshPlan, release, reservesOf, RULES, signFreeAgent, swap, toggleClaim } from '../src/engine/roster';
import { createSeason, simDays, simToEnd, type Season } from '../src/engine/season/season';
import { planFor } from '../src/engine/season/teams';
import type { Player, Team } from '../src/engine/types';

const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const fresh = (seed = 5, user = 1) => createSeason(generateLeague(seed), P, { year: 1, seed, rosterRules: true, userTeam: user });
const isP = (p: Player) => p.position === 'P';

function legal(s: Season, t: Team): string | null {
  const ids = t.playerIds, act = activeOf(t);
  if (ids.length > RULES.forty) return `${t.id}: ${ids.length} on the 40`;
  if (act.length !== RULES.active) return `${t.id}: ${act.length} active`;
  if (!act.every((id) => ids.includes(id))) return `${t.id}: active player not on the 40`;
  const ps = act.map((id) => s.players.get(id)!);
  if (ps.some((p) => !p)) return `${t.id}: unknown player`;
  if (ps.filter(isP).length !== RULES.pitchers) return `${t.id}: ${ps.filter(isP).length} active pitchers`;
  const plan = s.plans.get(t.id)!;
  if (plan.lineup.length !== 9 || !plan.lineup.every((l) => act.includes(l.player.id))) return `${t.id}: lineup`;
  if (!plan.rotation.every((p) => act.includes(p.id)) || !plan.bullpen.every((a) => act.includes(a.player.id))) return `${t.id}: staff`;
  return null;
}

describe('the 26 and the reserves', () => {
  it('every team starts with 26 active (13 bats, 13 arms) out of 40, and the same plan as before the 26 existed', () => {
    const s = fresh();
    for (const t of s.league.teams) {
      expect(legal(s, t)).toBeNull();
      const all = t.playerIds.map((id) => s.players.get(id)!);
      const before = planFor(t, all), now = s.plans.get(t.id)!;
      expect(now.lineup.map((l) => [l.player.id, l.pos])).toEqual(before.lineup.map((l) => [l.player.id, l.pos]));
      expect(now.rotation.map((p) => p.id)).toEqual(before.rotation.map((p) => p.id));
      expect(now.bullpen.map((a) => [a.player.id, a.role])).toEqual(before.bullpen.map((a) => [a.player.id, a.role]));
    }
  });
});

describe('moves', () => {
  it('a swap calls one up and sends one down, uses an option and a move; groups must match; six a month', () => {
    const s = fresh();
    const t = s.league.teams[0];
    const res = reservesOf(t).map((id) => s.players.get(id)!), act = activeOf(t).map((id) => s.players.get(id)!);
    const up = res.find((p) => !isP(p))!, down = act.find((p) => !isP(p))!;
    expect(swap(s, t.id, up.id, act.find(isP)!.id)).toBe('different-group');
    expect(swap(s, t.id, up.id, down.id)).toBeNull();
    expect(activeOf(t)).toContain(up.id);
    expect(reservesOf(t)).toContain(down.id);
    expect(down.optionedThisYear).toBe(true);
    expect(movesLeft(t, s.day)).toBe(RULES.movesPerMonth - 1);
    const bat = (ids: number[]) => ids.find((id) => !isP(s.players.get(id)!))!;
    for (let i = 1; i < RULES.movesPerMonth; i++) expect(swap(s, t.id, bat(reservesOf(t)), bat(activeOf(t)))).toBeNull();
    expect(movesLeft(t, s.day)).toBe(0);
    expect(swap(s, t.id, reservesOf(t).find((id) => !isP(s.players.get(id)!))!, activeOf(t).find((id) => !isP(s.players.get(id)!))!)).toBe('no-moves');
    expect(legal(s, t)).toBeNull();
  });
  it('a player out of options goes down through waivers: unclaimed he stays, claimed he leaves', () => {
    const s = fresh(5, 9);
    const t = s.league.teams[3];
    const act = activeOf(t).map((id) => s.players.get(id)!).filter((p) => !isP(p)).sort((x, y) => playerValue(x) - playerValue(y));
    const [a, b] = act; a.options = 0; b.options = 0;
    for (const k of Object.keys(a.ratings) as Array<keyof typeof a.ratings>) a.ratings[k] = 20; // nobody wants him
    const [u1, u2] = reservesOf(t).map((id) => s.players.get(id)!).filter((p) => !isP(p));
    expect(swap(s, t.id, u1.id, a.id)).toBeNull();
    expect(swap(s, t.id, u2.id, b.id)).toBeNull();
    expect(s.league.waivers.map((w) => w.playerId).sort()).toEqual([a.id, b.id].sort());
    toggleClaim(s.league, 9, b.id);
    simDays(s, RULES.waiverDays + 1);
    expect(t.playerIds).toContain(a.id);
    expect(t.playerIds).not.toContain(b.id);
    const claimer = s.league.teams.find((x) => x.playerIds.includes(b.id))!;
    expect(claimer.id).not.toBe(t.id); // your claim (team 9) or an AI team ahead of you in waiver order
    for (const x of s.league.teams) expect(legal(s, x)).toBeNull();
  });
  it('a released player clears to free agency; free agents sign only with room on the 40', () => {
    const s = fresh();
    const t = s.league.teams[5];
    const fa = s.league.freeAgents[0] ?? null;
    if (fa) expect(signFreeAgent(s, t.id, fa.id)).toBe('full-40');
    const gone = activeOf(t).map((id) => s.players.get(id)!).find((p) => !isP(p))!;
    expect(release(s, t.id, gone.id)).toBeNull();
    expect(t.playerIds.length).toBe(39);
    expect(legal(s, t)).toBeNull();
    simDays(s, RULES.waiverDays + 1);
    const onTeam = s.league.teams.some((x) => x.playerIds.includes(gone.id));
    expect(onTeam || s.league.freeAgents.some((p) => p.id === gone.id)).toBe(true);
    const next = s.league.freeAgents.find((p) => p.id !== gone.id)!;
    if (!onTeam || t.playerIds.length < 40) expect(signFreeAgent(s, t.id, next.id)).toBeNull();
  });
  it('your hand-set lineup survives roster changes: the order stays, the hole is filled', () => {
    const s = fresh(5, 2);
    const t = s.league.teams.find((x) => x.id === 2)!;
    t.auto = { lineup: false, staff: true, roster: false };
    const plan = s.plans.get(2)!;
    plan.lineup = [...plan.lineup].reverse();
    const order = plan.lineup.map((l) => l.player.id);
    const out = plan.lineup[4].player;
    const up = reservesOf(t).map((id) => s.players.get(id)!).find((p) => !isP(p))!;
    expect(swap(s, 2, up.id, out.id)).toBeNull();
    const after = s.plans.get(2)!.lineup.map((l) => l.player.id);
    expect(after.filter((id) => id !== out.id).slice(0, 4)).toEqual(order.slice(0, 4));
    expect(after).not.toContain(out.id);
    expect(after.length).toBe(9);
    refreshPlan(s, t);
    expect(s.plans.get(2)!.lineup.length).toBe(9);
  });
});

describe('the AI keeps every roster legal over the years', () => {
  it('eight seasons with weekly AI moves, waivers and winters: always 40, 26, 13 and 13, and options get used', () => {
    let s = fresh(13, 0);
    let swaps = 0;
    for (let y = 1; y <= 8; y++) {
      for (let chunk = 0; chunk < 8 && s.day < s.regularDays; chunk++) {
        simDays(s, 25);
        for (const t of s.league.teams) expect(legal(s, t)).toBeNull();
      }
      swaps += s.league.teams.reduce((n, t) => n + (t.moves?.count ?? 0), 0);
      simToEnd(s);
      for (const t of s.league.teams) expect(legal(s, t)).toBeNull();
      s = nextSeason(s).season;
      for (const t of s.league.teams) { expect(t.playerIds.length).toBe(40); expect(legal(s, t)).toBeNull(); }
    }
    expect(swaps).toBeGreaterThan(0);
    expect(s.league.players.some((p) => (p.options ?? 4) < 4)).toBe(true);
    expect(Math.abs(s.league.players.map(playerValue).reduce((a, b) => a + b, 0) / s.league.players.length - 50)).toBeLessThan(3);
  }, 300000);
});
