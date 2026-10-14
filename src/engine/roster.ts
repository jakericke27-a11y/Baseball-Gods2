/**
 * Roster rules (our own, built around the four-year draft cycle; numbers in RULES):
 *  - The 40: 26 active (13 position players, 13 pitchers) and 14 on a reserve list that replaces the minors.
 *    Reserves don't play; they develop like everyone else.
 *  - A move is a swap: a reserve called up for an active player sent down, same group (bat for bat, arm for arm).
 *    Six moves per calendar month per team.
 *  - Options: four option years per player; one is used in any season he's sent down. A player out of options
 *    can only go down through waivers (outright): any team can claim him for three days, worst record first.
 *  - Releasing a player puts him on waivers too; unclaimed, he becomes a free agent.
 *  - Free agents can be signed whenever a 40-man roster has room.
 *  - AI teams adjust their 26 once a week and run under the same rules. Your team's AUTO switches hand the
 *    lineup, the pitching staff or the roster back to the AI.
 */
import { playerValue } from './development';
import { dateOfDay } from './season/schedule';
import { planFor, pickActive, type TeamPlan } from './season/teams';
import type { Season } from './season/season';
import type { League, Player, Team, Waiver } from './types';

export const RULES = { active: 26, hitters: 13, pitchers: 13, forty: 40, options: 4, waiverDays: 3, movesPerMonth: 6, aiEveryDays: 7, aiMargin: 4 };

export type MoveError = 'no-moves' | 'not-reserve' | 'not-active' | 'different-group' | 'full-40' | 'not-free-agent' | 'on-waivers';

const isP = (p: Player) => p.position === 'P';
const pmap = (league: League) => new Map(league.players.map((p) => [p.id, p]));
export const activeOf = (t: Team) => t.active ?? t.playerIds;
export const reservesOf = (t: Team) => { const a = new Set(activeOf(t)); return t.playerIds.filter((id) => !a.has(id)); };
export const optionsLeft = (p: Player) => p.options ?? RULES.options;
/** Sending him down uses no new option year if he's already been down this season. */
export const canOption = (p: Player) => !!p.optionedThisYear || optionsLeft(p) > 0;

export function movesLeft(t: Team, day: number): number {
  const month = dateOfDay(day).month;
  return RULES.movesPerMonth - (t.moves && t.moves.month === month ? t.moves.count : 0);
}
function useMove(t: Team, day: number): void {
  const month = dateOfDay(day).month;
  t.moves = t.moves && t.moves.month === month ? { month, count: t.moves.count + 1 } : { month, count: 1 };
}

/** Put the AI's 26 on every team (Opening Day of each year, and old saves). */
export function setAllActive(league: League): void {
  const P = pmap(league);
  for (const t of league.teams) {
    const ai = pickActive(t, t.playerIds.map((id) => P.get(id)!));
    if (!t.auto || t.auto.roster || !t.active) { t.active = ai; continue; }
    // Your hand-set 26: keep whoever is still here, and fill each group back to 13 the AI's way.
    const kept = t.active.filter((id) => t.playerIds.includes(id));
    for (const pitchers of [false, true]) {
      const need = (pitchers ? RULES.pitchers : RULES.hitters) - kept.filter((id) => isP(P.get(id)!) === pitchers).length;
      kept.push(...ai.filter((id) => !kept.includes(id) && isP(P.get(id)!) === pitchers).slice(0, Math.max(0, need)));
    }
    t.active = kept;
  }
}

/**
 * Call up a reserve for an active player, same group. If the one going down is out of options, he goes on
 * outright waivers instead of straight to the reserves (claimable for three days).
 */
export function swap(s: Season, teamId: number, upId: number, downId: number): MoveError | null {
  const L = s.league, t = L.teams.find((x) => x.id === teamId)!;
  const P = pmap(L), up = P.get(upId), down = P.get(downId);
  if (movesLeft(t, s.day) <= 0) return 'no-moves';
  if (!up || !reservesOf(t).includes(upId)) return 'not-reserve';
  if (!down || !activeOf(t).includes(downId)) return 'not-active';
  if (isP(up) !== isP(down)) return 'different-group';
  if (L.waivers.some((w) => w.playerId === upId)) return 'on-waivers';
  t.active = activeOf(t).map((id) => (id === downId ? upId : id));
  useMove(t, s.day);
  if (canOption(down)) down.optionedThisYear = true;
  else L.waivers.push({ playerId: downId, fromTeam: teamId, until: s.day + RULES.waiverDays, kind: 'outright', claims: [] });
  refreshPlan(s, t);
  return null;
}

/** Release a player: off the 40 onto waivers; unclaimed he's a free agent. An active player is replaced by the best reserve. */
export function release(s: Season, teamId: number, id: number): MoveError | null {
  const L = s.league, t = L.teams.find((x) => x.id === teamId)!;
  if (!t.playerIds.includes(id)) return 'not-active';
  const P = pmap(L), p = P.get(id)!;
  if (activeOf(t).includes(id)) {
    const sub = reservesOf(t).map((r) => P.get(r)!).filter((r) => isP(r) === isP(p) && !L.waivers.some((w) => w.playerId === r.id))
      .sort((a, b) => playerValue(b) - playerValue(a) || a.id - b.id)[0];
    t.active = activeOf(t).filter((x) => x !== id).concat(sub ? [sub.id] : []);
  }
  t.playerIds = t.playerIds.filter((x) => x !== id);
  L.players = L.players.filter((x) => x.id !== id);
  s.players.delete(id);
  L.waivers = L.waivers.filter((w) => w.playerId !== id);
  L.waivers.push({ playerId: id, fromTeam: teamId, until: s.day + RULES.waiverDays, kind: 'release', claims: [], player: p });
  refreshPlan(s, t);
  return null;
}

/** Sign a free agent to a 40-man roster with room; he joins the reserves. */
export function signFreeAgent(s: Season, teamId: number, id: number): MoveError | null {
  const L = s.league, t = L.teams.find((x) => x.id === teamId)!;
  const p = L.freeAgents.find((x) => x.id === id);
  if (!p) return 'not-free-agent';
  if (t.playerIds.length >= RULES.forty) return 'full-40';
  L.freeAgents = L.freeAgents.filter((x) => x !== p);
  t.playerIds.push(id); L.players.push(p); s.players.set(id, p);
  return null;
}

/** Put in (or take back) a waiver claim. */
export function toggleClaim(L: League, teamId: number, playerId: number): void {
  const w = L.waivers.find((x) => x.playerId === playerId);
  if (!w || w.fromTeam === teamId) return;
  w.claims = w.claims.includes(teamId) ? w.claims.filter((c) => c !== teamId) : [...w.claims, teamId];
}

/** The waiver player behind an entry (rostered for outright waivers, parked for releases). */
export function waiverPlayer(L: League, w: Waiver): Player | undefined {
  return w.kind === 'release' ? w.player : L.players.find((p) => p.id === w.playerId);
}

const pct = (s: Season, id: number) => { const r = s.standings.get(id)!; return r.W / Math.max(1, r.W + r.L); };

/** AI claims: a team claims a player clearly better than the worst of his group on its 40, if it can make room. */
function aiClaims(s: Season, userTeam: number): void {
  const L = s.league, P = pmap(L);
  for (const w of L.waivers) {
    const p = waiverPlayer(L, w);
    if (!p) continue;
    for (const t of L.teams) {
      if (t.id === w.fromTeam || t.id === userTeam || w.claims.includes(t.id)) continue;
      const pool = t.playerIds.map((id) => P.get(id)!).filter((q) => isP(q) === isP(p));
      const worst = Math.min(...pool.map(playerValue));
      if (playerValue(p) >= worst + RULES.aiMargin + 2) w.claims.push(t.id);
    }
  }
}

/** Waivers that run out today: the worst-record claimant gets him (dropping his worst player if the 40 is full). */
function settleWaivers(s: Season): void {
  const L = s.league;
  const due = L.waivers.filter((w) => w.until <= s.day);
  L.waivers = L.waivers.filter((w) => w.until > s.day);
  for (const w of due) {
    const p = waiverPlayer(L, w);
    if (!p) continue;
    const from = L.teams.find((t) => t.id === w.fromTeam)!;
    const claimer = [...w.claims].sort((a, b) => pct(s, a) - pct(s, b) || a - b).map((id) => L.teams.find((t) => t.id === id)!)[0];
    if (claimer) {
      if (w.kind === 'outright') { from.playerIds = from.playerIds.filter((x) => x !== p.id); L.players = L.players.filter((x) => x !== p); s.players.delete(p.id); }
      if (claimer.playerIds.length >= RULES.forty) {
        const P = pmap(L);
        const drop = reservesOf(claimer).map((id) => P.get(id)!).filter((q) => isP(q) === isP(p)).sort((a, b) => playerValue(a) - playerValue(b) || a.id - b.id)[0]
          ?? reservesOf(claimer).map((id) => P.get(id)!).sort((a, b) => playerValue(a) - playerValue(b))[0];
        if (drop) { claimer.playerIds = claimer.playerIds.filter((x) => x !== drop.id); L.players = L.players.filter((x) => x !== drop); s.players.delete(drop.id); L.freeAgents.push(drop); }
      }
      claimer.playerIds.push(p.id); L.players.push(p); s.players.set(p.id, p);
      p.optionedThisYear = false;
    } else if (w.kind === 'release') {
      L.freeAgents.push(p);
    } // an outright that clears just stays on his team's reserves
  }
}

/** Your team's AUTO switches, or all on for AI teams. */
const autoFor = (t: Team) => t.auto ?? { lineup: true, staff: true, roster: true };

/**
 * Rebuild a team's plan after a roster change. AUTO parts are rebuilt by the AI; parts you set by hand keep
 * your choices, with anyone who left the 26 replaced (the AI fills the hole the way it would).
 */
export function refreshPlan(s: Season, t: Team): void {
  const P = s.players;
  const active = activeOf(t).map((id) => P.get(id)).filter((p): p is Player => !!p);
  const fresh = planFor(t, active);
  const old = s.plans.get(t.id);
  const a = autoFor(t);
  if (!old) { s.plans.set(t.id, fresh); return; }
  const ok = new Set(active.map((p) => p.id));
  const plan: TeamPlan = { ...fresh };
  if (!a.lineup) {
    const kept = old.lineup.filter((l) => ok.has(l.player.id)).map((l) => ({ player: P.get(l.player.id)!, pos: l.pos }));
    for (const f of fresh.lineup) if (kept.length < 9 && !kept.some((k) => k.pos === f.pos) && !kept.some((k) => k.player.id === f.player.id)) kept.push(f);
    for (const f of fresh.lineup) if (kept.length < 9 && !kept.some((k) => k.player.id === f.player.id)) kept.push({ player: f.player, pos: [2, 3, 4, 5, 6, 7, 8, 9, 0].find((n) => !kept.some((k) => k.pos === n))! });
    plan.lineup = kept;
  }
  if (!a.staff) {
    const rot = old.rotation.filter((p) => ok.has(p.id)).map((p) => P.get(p.id)!);
    for (const p of fresh.rotation) if (rot.length < fresh.rotation.length && !rot.includes(p)) rot.push(p);
    const pen = old.bullpen.filter((x) => ok.has(x.player.id) && !rot.some((r) => r.id === x.player.id)).map((x) => ({ player: P.get(x.player.id)!, role: x.role }));
    const arms = active.filter((p) => isP(p) && !rot.includes(p) && !pen.some((x) => x.player === p));
    for (const p of arms) pen.push({ player: p, role: 'MR' });
    if (!pen.some((x) => x.role === 'CL') && pen.length) pen[0] = { ...pen[0], role: 'CL' };
    plan.rotation = rot; plan.bullpen = pen;
  }
  s.plans.set(t.id, plan);
}

/** One AI swap if a reserve is clearly better than an active player of his group (options and moves permitting). */
function aiAdjust(s: Season, t: Team): void {
  if (movesLeft(t, s.day) <= 0) return;
  const P = s.players;
  for (const pitchers of [false, true]) {
    const act = activeOf(t).map((id) => P.get(id)!).filter((p) => isP(p) === pitchers);
    const res = reservesOf(t).map((id) => P.get(id)!).filter((p) => p && isP(p) === pitchers && !s.league.waivers.some((w) => w.playerId === p.id));
    if (!act.length || !res.length) continue;
    const worst = act.reduce((w, p) => (playerValue(p) < playerValue(w) ? p : w));
    const best = res.reduce((b, p) => (playerValue(p) > playerValue(b) ? p : b));
    const margin = canOption(worst) ? RULES.aiMargin : RULES.aiMargin * 2; // out of options: only for a clear upgrade
    if (playerValue(best) >= playerValue(worst) + margin) { swap(s, t.id, best.id, worst.id); return; }
  }
}

/** Morning roster business, before the day's games: waivers settle; once a week AI teams adjust their 26. */
export function rosterMorning(s: Season, userTeam: number): void {
  if (s.post?.phase === 'post' || s.day >= s.regularDays) { settleWaivers(s); return; }
  aiClaims(s, userTeam);
  settleWaivers(s);
  if (s.day > 0 && s.day % RULES.aiEveryDays === 0) {
    for (const t of s.league.teams) {
      if (t.id === userTeam && !autoFor(t).roster) continue;
      aiAdjust(s, t);
    }
  }
}

/** The winter: option years used are spent, monthly counts reset, waivers end, and every AI 26 is reset. */
export function rosterWinter(league: League): void {
  for (const p of [...league.players, ...league.freeAgents]) {
    if (p.optionedThisYear) p.options = Math.max(0, optionsLeft(p) - 1);
    p.optionedThisYear = false;
  }
  for (const w of league.waivers) {
    if (w.kind !== 'release') continue;
    if (w.player) league.freeAgents.push(w.player);
  }
  league.waivers = [];
  for (const t of league.teams) t.moves = undefined;
}
