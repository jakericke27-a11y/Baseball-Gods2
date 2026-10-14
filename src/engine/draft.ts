/**
 * The Draft, two kinds on one engine:
 *  - The founding draft opens every new league: all 30 teams build their 40-man rosters from one generated pool
 *    (about 25% more players than spots), a 40-round snake in a random order. The undrafted are Year 1's free agents.
 *  - The four-year draft, the winter after Years 4, 8, 12...: ten rounds from every amateur aged 18–22. Order by the
 *    cycle's combined record, worst first, with a weighted lottery among the ten worst for picks 1–6; the same order
 *    every round. Picks join the team's prospect pool (off the 40) until their rights run out at the next draft.
 *
 * Until scouting exists (4.5) everyone, you and the AI, sees prospects the same blurry way: current ratings, and a
 * projected ceiling whose band narrows with age. Each player's read is off by a fixed amount (the same every time you
 * look), so busts and steals happen to everybody.
 */
import { playerValue, RATING_KEYS } from './development';
import type { Rng } from './rng';
import type { League, Player, Position, Team } from './types';

export const DRAFT = {
  rounds: 10, cycle: 4, foundingRounds: 40, poolExtra: 0.25,
  minAge: 18, maxAge: 22,
  lotteryTeams: 10, lotteryPicks: 6,
  /** Lottery weights, worst cycle record first. */
  lotteryWeights: [18, 16, 14, 12, 10, 9, 7, 6, 4, 4],
};

export const isDraftYear = (year: number) => year % DRAFT.cycle === 0;

// ---------------------------------------------------------------- the blurry view

const unit = (seed: number, id: number) => {
  let h = Math.imul(seed ^ 0x51ed27, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1; // -1..1, fixed per player
};

/** What everyone sees: the ceiling (his value grown into his potential), misread by a fixed error that shrinks with age. */
export function projection(p: Player, seed: number): { now: number; mid: number; lo: number; hi: number } {
  const now = playerValue(p);
  const ceiling = p.dev ? playerValue({ ...p, ratings: { ...p.ratings, ...Object.fromEntries(RATING_KEYS.map((k) => [k, Math.max(p.ratings[k], p.dev!.potential[k])])) } }) : now;
  const band = Math.max(2, (26 - p.age) * 1.2);
  const mid = Math.max(now, ceiling + unit(seed, p.id) * band * 0.8);
  return { now: Math.round(now), mid: Math.round(mid), lo: Math.round(Math.max(now, mid - band)), hi: Math.round(mid + band) };
}

// ---------------------------------------------------------------- draft state

export interface DraftPick { overall: number; round: number; teamId: number; playerId: number; name: string; age: number; pos: string; lo: number; hi: number; reason: string }
export interface DraftState {
  kind: 'founding' | 'cycle';
  /** The league year the draft belongs to (0 for the founding draft). */
  year: number;
  rounds: number;
  /** Team on the clock for each pick of round 1 (snake drafts reverse it in even rounds). */
  order: number[];
  snake: boolean;
  /** Ids still on the board. */
  pool: number[];
  picks: DraftPick[];
  /** Lottery result, for draft night: [teamId, pick won] for the lottery teams. */
  lottery: Array<[number, number]>;
}

export const totalPicks = (d: DraftState) => d.rounds * d.order.length;
export const done = (d: DraftState) => d.picks.length >= totalPicks(d) || d.pool.length === 0;
export function onClock(d: DraftState): number {
  const n = d.order.length, i = d.picks.length, round = Math.floor(i / n), k = i % n;
  return d.snake && round % 2 === 1 ? d.order[n - 1 - k] : d.order[k];
}

/** Where a player waiting to be drafted lives: the founding pool is the free agents, the four-year pool the amateurs. */
const poolPlayers = (L: League, d: DraftState) => (d.kind === 'founding' ? L.freeAgents : L.amateurs);

// ---------------------------------------------------------------- what teams want

/** Founding rosters: 22 position players (3 C and 2 at every other spot), 18 pitchers (at least 6 starters). */
const NEEDS: Partial<Record<Position, number>> = { C: 3, '1B': 2, '2B': 2, '3B': 2, SS: 2, LF: 2, CF: 2, RF: 2 };
interface Counts { hitters: number; arms: number; sp: number; byPos: Map<string, number>; short: number }
function counts(L: League, t: Team): Counts {
  const P = new Map(L.players.map((x) => [x.id, x]));
  const mine = t.playerIds.map((id) => P.get(id)!);
  const byPos = new Map<string, number>();
  for (const h of mine) if (h.position !== 'P') byPos.set(h.position, (byPos.get(h.position) ?? 0) + 1);
  const short = (Object.entries(NEEDS) as Array<[Position, number]>).reduce((n, [pos, k]) => n + Math.max(0, k - (byPos.get(pos) ?? 0)), 0);
  const arms = mine.filter((x) => x.position === 'P');
  return { hitters: mine.length - arms.length, arms: arms.length, sp: arms.filter((x) => x.pitcherRole === 'SP').length, byPos, short };
}
function foundingNeed(c: Counts, p: Player): number {
  if (p.position === 'P') {
    if (c.arms >= 18) return -999;
    return p.pitcherRole === 'SP' && c.sp < 6 ? 3 : 0;
  }
  if (c.hitters >= 22) return -999;
  const fills = (NEEDS[p.position] ?? 0) > (c.byPos.get(p.position) ?? 0);
  if (!fills && c.short >= 22 - c.hitters) return -999; // every remaining bat spot is spoken for by a position
  return fills ? 2 : 0;
}

/** The board's order for a team: founding drafts weigh what a player is now; four-year drafts weigh the ceiling. */
/** Projections don't change during a draft, so each is worked out once per draft. */
const cache = new WeakMap<DraftState, Map<number, ReturnType<typeof projection>>>();
function proj(L: League, d: DraftState, p: Player) {
  let m = cache.get(d);
  if (!m) cache.set(d, (m = new Map()));
  let v = m.get(p.id);
  if (!v) m.set(p.id, (v = projection(p, L.seed)));
  return v;
}

function score(L: League, d: DraftState, c: Counts | null, p: Player): number {
  const pr = proj(L, d, p);
  if (c) return pr.now + 0.25 * (pr.mid - pr.now) - (p.age >= 34 ? (p.age - 33) * 1.5 : 0) + foundingNeed(c, p);
  return 0.65 * pr.mid + 0.35 * pr.now + (p.age <= 19 ? 1 : 0);
}

function reasonFor(d: DraftState, p: Player, seed: number, need: number): string {
  const pr = projection(p, seed);
  const kind = p.position === 'P' ? (p.pitcherRole === 'SP' ? 'starter' : 'arm') : 'bat';
  if (d.kind === 'founding') {
    if (need > 0 && d.picks.length >= d.order.length * 8) return p.position === 'P' ? 'needs another starter' : `needs a ${p.position}`;
    if (pr.now >= 60) return `the best ${kind} on the board`;
    if (pr.mid - pr.now >= 6 && p.age <= 25) return `young, with room to grow (ceiling ${pr.lo}–${pr.hi})`;
    if (p.age >= 32) return `a veteran ${kind} to win now`;
    return p.position === 'P' ? `fills out the staff` : `fills a need at ${p.position}`;
  }
  if (pr.hi - pr.lo >= 14) return `a big swing: raw at ${p.age}, ceiling ${pr.lo}–${pr.hi}`;
  if (pr.now >= 50) return `polished: could help soon`;
  if (need === 1) return `the highest ceiling left (${pr.lo}–${pr.hi})`;
  return `ceiling ${pr.lo}–${pr.hi}`;
}

/** The AI's pick for whoever is on the clock: best score on the board. */
export function aiChoice(L: League, d: DraftState): { id: number; reason: string } {
  const t = L.teams.find((x) => x.id === onClock(d))!;
  const pool = poolPlayers(L, d), on = new Set(d.pool);
  const c = d.kind === 'founding' ? counts(L, t) : null;
  let best: Player | null = null, bestScore = -Infinity;
  for (const p of pool) {
    if (!on.has(p.id)) continue;
    const sc = score(L, d, c, p);
    if (sc > bestScore || (sc === bestScore && best && p.id < best.id)) { best = p; bestScore = sc; }
  }
  return { id: best!.id, reason: reasonFor(d, best!, L.seed, c ? foundingNeed(c, best!) : d.picks.length < d.order.length ? 1 : 0) };
}

/** Make a pick for whoever is on the clock. */
export function pick(L: League, d: DraftState, playerId: number, reason = 'your pick'): DraftPick {
  const teamId = onClock(d), t = L.teams.find((x) => x.id === teamId)!;
  const pool = poolPlayers(L, d), p = pool.find((x) => x.id === playerId);
  if (!p || !d.pool.includes(playerId)) throw new Error('not on the board');
  const n = d.order.length, overall = d.picks.length + 1, pr = projection(p, L.seed);
  const rec: DraftPick = { overall, round: Math.floor((overall - 1) / n) + 1, teamId, playerId, name: p.name, age: p.age, pos: p.position === 'P' ? p.pitcherRole ?? 'P' : p.position, lo: pr.lo, hi: pr.hi, reason };
  d.picks.push(rec);
  d.pool = d.pool.filter((x) => x !== playerId);
  pool.splice(pool.indexOf(p), 1);
  if (d.kind === 'founding') { t.playerIds.push(p.id); L.players.push(p); }
  else L.prospects.push({ player: p, teamId, until: d.year + DRAFT.cycle, overall });
  return rec;
}

/** One AI pick for whoever is on the clock. Your team (when `board` is yours) takes the top name left on your board first. */
export function autoPick(L: League, d: DraftState, board?: { team: number; ids: number[] }): DraftPick {
  if (board && onClock(d) === board.team) {
    const want = board.ids.find((id) => d.pool.includes(id));
    if (want !== undefined) return pick(L, d, want, 'from your board');
  }
  const c = aiChoice(L, d);
  return pick(L, d, c.id, c.reason);
}

/** AI picks until it's `stopFor`'s turn (0: never stop) or the draft is over. */
export function autoPicks(L: League, d: DraftState, stopFor = 0, board?: { team: number; ids: number[] }): DraftPick[] {
  const out: DraftPick[] = [];
  while (!done(d) && onClock(d) !== stopFor) out.push(autoPick(L, d, board));
  return out;
}

/** The founding draft's board: every generated player, a random snake order. */
export function foundingDraft(L: League, rng: Rng): DraftState {
  const order = L.teams.map((t) => t.id);
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return { kind: 'founding', year: 0, rounds: DRAFT.foundingRounds, order, snake: true, pool: L.freeAgents.map((p) => p.id), picks: [], lottery: [] };
}

/** The four-year draft after `year`: the board is every amateur 18–22; the order comes from the cycle's records and the lottery. */
/** The next four-year draft at or after a year (it follows that year's season). */
export const nextDraftYear = (year: number) => Math.ceil(year / DRAFT.cycle) * DRAFT.cycle;

export interface CycleRecord { teamId: number; W: number; L: number; diff: number }
/**
 * Teams worst to best by the cycle's combined record: the completed seasons of the cycle ending with `year`, plus
 * `extra` records still being played (this season's standings, for the draft preview).
 */
export function cycleOrder(L: League, year: number, extra: CycleRecord[] = []): CycleRecord[] {
  const years = L.history.filter((y) => y.year > year - DRAFT.cycle && y.year <= year);
  const rec = new Map<number, CycleRecord>(L.teams.map((t) => [t.id, { teamId: t.id, W: 0, L: 0, diff: 0 }]));
  for (const y of years) for (const t of y.teams) { const r = rec.get(t.teamId)!; r.W += t.W; r.L += t.L; r.diff += t.RS - t.RA; }
  for (const e of extra) { const r = rec.get(e.teamId)!; r.W += e.W; r.L += e.L; r.diff += e.diff; }
  const pct = (r: CycleRecord) => (r.W + r.L ? r.W / (r.W + r.L) : 0.5);
  return [...rec.values()].sort((a, b) => pct(a) - pct(b) || a.diff - b.diff || a.teamId - b.teamId);
}

/** Chance of each lottery team landing a top-6 pick, by its place among the ten worst (exact, from the weights). */
export function lotteryOdds(): number[] {
  const w = DRAFT.lotteryWeights, n = w.length, odds = new Array(n).fill(0);
  const go = (taken: number[], p: number) => {
    if (taken.length === DRAFT.lotteryPicks) { for (const i of taken) odds[i] += p; return; }
    const left = w.reduce((a, b, i) => a + (taken.includes(i) ? 0 : b), 0);
    for (let i = 0; i < n; i++) if (!taken.includes(i)) go([...taken, i], (p * w[i]) / left);
  };
  go([], 1);
  return odds;
}

export function cycleDraft(L: League, year: number, rng: Rng): DraftState {
  const worst = cycleOrder(L, year).map((r) => r.teamId);
  const pool = worst.slice(0, DRAFT.lotteryTeams), weights = DRAFT.lotteryWeights.slice(0, pool.length);
  const winners: number[] = [];
  for (let k = 0; k < DRAFT.lotteryPicks; k++) {
    const total = weights.reduce((a, b, i) => a + (winners.includes(pool[i]) ? 0 : b), 0);
    let r = rng.next() * total, i = 0;
    for (; i < pool.length; i++) { if (winners.includes(pool[i])) continue; r -= weights[i]; if (r <= 0) break; }
    winners.push(pool[Math.min(i, pool.length - 1)]);
  }
  const order = [...winners, ...worst.filter((id) => !winners.includes(id))];
  const board = L.amateurs.filter((p) => p.age >= DRAFT.minAge && p.age <= DRAFT.maxAge).map((p) => p.id);
  return { kind: 'cycle', year, rounds: DRAFT.rounds, order, snake: false, pool: board, picks: [], lottery: pool.map((id) => [id, order.indexOf(id) + 1]) };
}

/** Rights run out at the next draft: prospects go back to the amateur pool (18–22, draftable again) or become free agents. */
export function expireRights(L: League, year: number): void {
  const keep = [];
  for (const pr of L.prospects) {
    if (pr.until > year) { keep.push(pr); continue; }
    if (pr.player.age <= DRAFT.maxAge) L.amateurs.push(pr.player); else L.freeAgents.push(pr.player);
  }
  L.prospects = keep;
}

/** Keep the record of a finished draft (draft night history, busts and steals later). */
export function recordDraft(L: League, d: DraftState): void {
  L.drafts.push({ year: d.year, kind: d.kind, picks: d.picks });
}
