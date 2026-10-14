/**
 * The offseason, between the final and Opening Day: everyone ages a year and develops, players retire,
 * a new class of 16-year-olds appears, amateurs who turn 23 undrafted become free agents, and every team
 * refills its 40-man roster (22 position players, 18 pitchers) from the free agents, worst record first,
 * then makes a few upgrades. Nothing pulls the league back to its targets: the league's dials carry over
 * unchanged, and the league line moves only as far as the players do.
 *
 * Contracts, free agency and the draft replace the signing logic later (steps 1.6 and 4.3).
 */
import { develop, playerValue, roleFor } from './development';
import { PIPELINE, rollAmateur } from './generate';
import { autoPicks, cycleDraft, done as draftDone, expireRights, isDraftYear, recordDraft, type DraftPick, type DraftState } from './draft';
import { decreeWinter, type Decree } from './decree';
import { summarizeSeason } from './history';
import { yearParams } from './modifiers';
import { createRng } from './rng';
import { refreshPlan, rosterWinter, setAllActive } from './roster';
import type { Rng } from './rng';
import { createSeason, type Season } from './season/season';
import type { League, Player, Position, Prospect, Team } from './types';

export const ROSTER = { hitters: 22, pitchers: 18, upgrades: 2, upgradeMargin: 4, freeAgentPool: 250 };
/** Position players a team keeps at each spot (the rest are utility men). */
const NEEDS: Partial<Record<Position, number>> = { C: 3, '1B': 2, '2B': 2, '3B': 2, SS: 2, LF: 2, CF: 2, RF: 2 };
const MIN_STARTERS = 6;

/** Retirement chance by age, before the player's value moves it. */
function retireBase(age: number): number {
  if (age <= 29) return 0.002;
  if (age <= 32) return 0.03;
  if (age <= 34) return 0.10;
  if (age <= 36) return 0.22;
  if (age <= 38) return 0.40;
  if (age <= 40) return 0.60;
  return 0.85;
}
/** Good players hang on, fringe players get pushed out: ×4 at value 40, ×¼ at 56. */
const retireChance = (p: Player) => Math.min(0.97, retireBase(p.age) * Math.max(0.25, Math.min(4, Math.exp((48 - playerValue(p)) / 6))));

export interface OffseasonMove { id: number; name: string; age: number; teamId: number; value: number }
export interface OffseasonReport {
  /** The year that just ended. */
  year: number;
  retirements: OffseasonMove[];
  signings: Array<OffseasonMove & { from: 'amateur' | 'free agent' }>;
  releases: OffseasonMove[];
  /** Rostered players whose value moved most over the winter. */
  risers: Array<OffseasonMove & { change: number }>;
  fallers: Array<OffseasonMove & { change: number }>;
  newClass: number;
  /** Prospects who joined a 40-man roster. */
  promotions: OffseasonMove[];
  /** The draft, in a draft winter (every pick). */
  draft: DraftPick[];
  /** The Gods' decree for the coming year (from Year 2). */
  decree?: Decree;
}

const move = (p: Player, teamId: number): OffseasonMove => ({ id: p.id, name: p.name, age: p.age, teamId, value: Math.round(playerValue(p)) });

/** The whole winter in one go (no draft): tests and tools. */
export function runOffseason(league: League, year: number, rng: Rng, worstFirst: number[]): OffseasonReport {
  const report = winterBefore(league, year, rng);
  winterAfter(league, report, worstFirst, 0);
  return report;
}

/** The first half of the winter: aging and development, retirements, the amateur pipeline. */
export function winterBefore(league: League, year: number, rng: Rng): OffseasonReport {
  const report: OffseasonReport = { year, retirements: [], signings: [], releases: [], risers: [], fallers: [], newClass: 0, promotions: [], draft: [] };
  const teamOf = new Map<number, Team>();
  for (const t of league.teams) for (const id of t.playerIds) teamOf.set(id, t);
  const byId = new Map(league.players.map((p) => [p.id, p]));

  // 1. A year older for everyone, and development.
  const before = new Map(league.players.map((p) => [p.id, playerValue(p)]));
  for (const p of [...league.players, ...league.freeAgents, ...league.amateurs, ...league.prospects.map((x) => x.player)]) develop(p, rng);
  for (const p of league.players) if (p.position === 'P') p.pitcherRole = roleFor(p);
  const changes = league.players.map((p) => ({ ...move(p, teamOf.get(p.id)!.id), change: Math.round(playerValue(p) - before.get(p.id)!) }));
  changes.sort((a, b) => b.change - a.change || a.id - b.id);
  report.risers = changes.slice(0, 10);
  report.fallers = changes.slice(-10).reverse();

  // 2. Retirements: rostered players by age and value; free agents who've gone a year unsigned past 30, or are 34+.
  for (const p of [...league.players]) {
    if (rng.next() >= retireChance(p)) continue;
    const t = teamOf.get(p.id)!;
    report.retirements.push(move(p, t.id));
    t.playerIds.splice(t.playerIds.indexOf(p.id), 1);
    league.players.splice(league.players.indexOf(p), 1);
    byId.delete(p.id);
    league.retired.push({ ...p, retiredAfter: year, lastTeam: t.id });
  }
  // Unsigned free agents: the old ones retire, and the pool keeps only its best (the rest leave the game unnoticed).
  league.freeAgents.sort((a, b) => playerValue(b) - playerValue(a) || a.id - b.id);
  league.freeAgents = league.freeAgents.filter((p, i) => {
    const gone = p.age >= 34 || (p.age >= 31 && rng.next() < 0.5);
    if (gone) league.retired.push({ ...p, retiredAfter: year, lastTeam: 0 });
    return !gone && i < ROSTER.freeAgentPool;
  });

  // 3. The pipeline: undrafted amateurs who turn 23 become free agents; a new class of 16-year-olds appears.
  const aged = league.amateurs.filter((p) => p.age >= PIPELINE.signAge);
  league.amateurs = league.amateurs.filter((p) => p.age < PIPELINE.signAge);
  const fromAmateurs = new Set(aged.map((p) => p.id));
  league.freeAgents.push(...aged);
  for (let i = 0; i < PIPELINE.classSize; i++) league.amateurs.push(rollAmateur(rng, league.nextId++, PIPELINE.firstAge));
  report.newClass = PIPELINE.classSize;

  return report;
}

/**
 * The second half, after any draft: teams promote prospects who are ready (your team only on AUTO ROSTER), then
 * refill to 22 + 18 from the free agents, worst record first, then make a few upgrades.
 */
export function winterAfter(league: League, report: OffseasonReport, worstFirst: number[], userTeam: number): void {
  const teamOf = new Map<number, Team>();
  for (const t of league.teams) for (const id of t.playerIds) teamOf.set(id, t);
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const fromAmateurs = new Set(league.freeAgents.filter((p) => p.age === PIPELINE.signAge && !report.retirements.some((r) => r.id === p.id)).map((p) => p.id));
  const order = worstFirst.map((id) => league.teams.find((t) => t.id === id)!);
  // 4a. Prospects ready to help join the 40, in place of the weakest of their kind if the 40 is full.
  for (const t of order) {
    if (t.id === userTeam && t.auto && !t.auto.roster) continue;
    const mine = league.prospects.filter((x) => x.teamId === t.id && x.player.age >= PROSPECT_READY_AGE).sort((a, b) => playerValue(b.player) - playerValue(a.player) || a.overall - b.overall);
    for (const pr of mine) {
      const p = pr.player, kind = (q: Player) => (q.position === 'P') === (p.position === 'P');
      const group = t.playerIds.map((id) => byId.get(id)!).filter(kind);
      const cap = p.position === 'P' ? ROSTER.pitchers : ROSTER.hitters;
      const worst = group.reduce<Player | null>((w, q) => (!w || playerValue(q) < playerValue(w) ? q : w), null);
      if (group.length >= cap) {
        if (!worst || playerValue(p) < playerValue(worst) + ROSTER.upgradeMargin) continue;
        t.playerIds.splice(t.playerIds.indexOf(worst.id), 1);
        league.players.splice(league.players.indexOf(worst), 1);
        byId.delete(worst.id);
        league.freeAgents.push(worst);
        report.releases.push(move(worst, t.id));
      } else if (playerValue(p) < (worst ? playerValue(worst) - 6 : 0)) continue; // not ready to beat what's there yet
      promote(league, t, pr);
      byId.set(p.id, p);
      report.promotions.push(move(p, t.id));
    }
  }
  const sign = (t: Team, p: Player) => {
    league.freeAgents.splice(league.freeAgents.indexOf(p), 1);
    if (p.position === 'P') p.pitcherRole = roleFor(p);
    t.playerIds.push(p.id); league.players.push(p); byId.set(p.id, p);
    report.signings.push({ ...move(p, t.id), from: fromAmateurs.has(p.id) ? 'amateur' : 'free agent' });
  };
  const roster = (t: Team) => t.playerIds.map((id) => byId.get(id)!);
  const best = (pool: Player[]) => pool.reduce<Player | null>((b, p) => (!b || playerValue(p) > playerValue(b) ? p : b), null);
  for (const t of order) {
    for (;;) {
      const r = roster(t), hitters = r.filter((p) => p.position !== 'P'), arms = r.filter((p) => p.position === 'P');
      if (hitters.length < ROSTER.hitters) {
        const short = (Object.entries(NEEDS) as Array<[Position, number]>).filter(([pos, n]) => hitters.filter((h) => h.position === pos).length < n).map(([pos]) => pos);
        const pick = best(league.freeAgents.filter((p) => p.position !== 'P' && (!short.length || short.includes(p.position))))
          ?? best(league.freeAgents.filter((p) => p.position !== 'P'));
        if (!pick) break;
        sign(t, pick);
      } else if (arms.length < ROSTER.pitchers) {
        const needSP = arms.filter((p) => p.pitcherRole === 'SP').length < MIN_STARTERS;
        const pick = (needSP ? best(league.freeAgents.filter((p) => p.position === 'P' && roleFor(p) === 'SP')) : null)
          ?? best(league.freeAgents.filter((p) => p.position === 'P'));
        if (!pick) break;
        sign(t, pick);
      } else break;
    }
  }
  for (const t of order) {
    for (let n = 0; n < ROSTER.upgrades; n++) {
      const r = roster(t);
      const worst = r.reduce((w, p) => (playerValue(p) < playerValue(w) ? p : w));
      const same = (p: Player) => (worst.position === 'P' ? p.position === 'P' : p.position === worst.position || (p.position !== 'P' && worst.position === 'UT'));
      const pick = best(league.freeAgents.filter(same));
      if (!pick || playerValue(pick) < playerValue(worst) + ROSTER.upgradeMargin) break;
      t.playerIds.splice(t.playerIds.indexOf(worst.id), 1);
      league.players.splice(league.players.indexOf(worst), 1);
      byId.delete(worst.id);
      league.freeAgents.push(worst);
      report.releases.push(move(worst, t.id));
      sign(t, pick);
    }
  }
}

/** Prospects don't help a big-league roster before this age. */
export const PROSPECT_READY_AGE = 20;

/** A prospect joins his team's 40 (to the reserves; the 26 is set on Opening Day). */
export function promote(league: League, t: Team, pr: Prospect): void {
  league.prospects.splice(league.prospects.indexOf(pr), 1);
  if (pr.player.position === 'P') pr.player.pitcherRole = roleFor(pr.player);
  t.playerIds.push(pr.player.id);
  league.players.push(pr.player);
}

/** Teams worst to best by the year's record (run differential, then id, breaks ties). */
export function worstFirst(s: Season): number[] {
  return [...s.standings.values()].sort((a, b) => a.W / Math.max(1, a.W + a.L) - b.W / Math.max(1, b.W + b.L) || (a.RS - a.RA) - (b.RS - b.RA) || a.teamId - b.teamId).map((r) => r.teamId);
}

/** Seed for a year's season (its RNG and schedule): the league's seed and the year, mixed. */
export const yearSeed = (leagueSeed: number, year: number) => (Math.imul(leagueSeed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(year, 0xc2b2ae35)) >>> 0 & 0x7fffffff;

/** A winter in progress: the first half done, a draft maybe waiting, the second half to come. */
export interface Winter { prev: Season; report: OffseasonReport; draft: DraftState | null; worst: number[] }

/** Close the season and start the winter: history, roster resets, aging, retirements, the pipeline, and in a draft
 *  year the expired rights and the draft board with its lottery. */
export function beginWinter(prev: Season): Winter {
  const L = prev.league;
  L.history.push(summarizeSeason(prev));
  rosterWinter(L);
  const report = winterBefore(L, prev.year, prev.rng);
  // The Gods settle last year's decree into the dials and name the next year (their own dice, so the rest of the winter is untouched).
  report.decree = decreeWinter(L, prev.year, createRng(yearSeed(L.seed, prev.year + 1) ^ 0x60d5));
  let draft: DraftState | null = null;
  if (isDraftYear(prev.year)) {
    expireRights(L, prev.year);
    draft = cycleDraft(L, prev.year, prev.rng);
  }
  return { prev, report, draft, worst: worstFirst(prev) };
}

/** Finish the winter (the draft must be done): signings, the 26s, and the new season. */
export function finishWinter(w: Winter): { season: Season; report: OffseasonReport } {
  const { prev, report } = w, L = prev.league;
  if (w.draft) { if (!draftDone(w.draft)) autoPicks(L, w.draft); recordDraft(L, w.draft); report.draft = w.draft.picks; }
  winterAfter(L, report, w.worst, prev.userTeam);
  setAllActive(L);
  const year = prev.year + 1;
  const season = createSeason(L, yearParams(L, year), {
    year, seed: yearSeed(L.seed, year), logs: prev.keepLogs, postseason: prev.postseason, rosterRules: prev.rosterRules, userTeam: prev.userTeam,
  });
  // Your hand-set lineup and staff carry into the new year (repaired for whoever left).
  const mine = L.teams.find((t) => t.id === prev.userTeam);
  const old = prev.plans.get(prev.userTeam);
  if (mine && old && mine.auto && (!mine.auto.lineup || !mine.auto.staff)) { season.plans.set(mine.id, old); refreshPlan(season, mine); }
  return { season, report };
}

/** The winter after a season, and the new season it leads to (the AI makes every draft pick). */
export function nextSeason(prev: Season): { season: Season; report: OffseasonReport } {
  return finishWinter(beginWinter(prev));
}
