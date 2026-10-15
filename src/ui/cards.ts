/**
 * Decision cards and missions (step 2.8): the framework. What's on your desk, what's been decided, the effects still
 * running, the follow-ups waiting to land, and missions in progress, all saved with the league.
 *
 * When cards come (your rules):
 *   - SIM DAY and SIM WEEK: one storyline card each week, plus one for each of your games that clears the Drama bar.
 *   - SIM MONTH: four to six storyline cards over the month, none from games.
 *   - TO END: nothing in season; season simmers get extra cards in the winter instead.
 *   - Weekly cards are time-sensitive (one to three weeks); an unanswered card takes its "expired" outcome.
 *   - A card can come at most twice in a week, and never twice for the same player.
 * The desk is where you open them. Every card can be rolled (the bench coach picks).
 *
 * Effects run through the player's ratings with a ledger, so temporary ones come back off on time (and every one comes
 * off before the winter's development). Card dice are their own (seeded from the league, the day and the card), so the
 * season's own dice, and the 20-year baseline, never move.
 */
import { DRAMA_CARD, gameDrama } from '../engine/game/drama';
import type { GameResult } from '../engine/game/types';
import { activeOf } from '../engine/roster';
import { createRng, type Rng } from '../engine/rng';
import type { Player, Ratings } from '../engine/types';
import { CARD_DEFS, MISSION_DEFS } from './carddefs';
import type { Game } from './state';

export type Rating = keyof Ratings;
/** Who and what a card is about. */
export interface Bind { p?: number[]; n?: number; game?: number; text?: string }

export type Effect =
  | { kind: 'rating'; pid: number; rating: Rating; delta: number; days?: number }
  | { kind: 'team'; rating: Rating; delta: number; days: number }
  | { kind: 'potential'; pid: number; delta: number }
  | { kind: 'headline'; text: string; big?: boolean }
  | { kind: 'flag'; key: string; delta: number }
  | { kind: 'later'; days: [number, number]; effects?: Effect[]; card?: string; bind?: Bind; note?: string }
  | { kind: 'mission'; mission: string; bind: Bind }
  | { kind: 'note'; text: string };

export interface Ctx { g: Game; rng: Rng; book: CardBook; result?: GameResult; resultIndex?: number }
export interface Choice {
  label: string | ((c: Ctx, b: Bind) => string); hint: string;
  /** The effects of picking it (dice allowed: they're the card's own). */
  effects: (c: Ctx, b: Bind) => Effect[];
  /** How likely the bench coach is to pick it when you roll (default 1). */
  coach?: number;
}
export interface CardDef {
  id: string; title: string;
  kind: 'story' | 'game' | 'winter' | 'followup' | 'mission';
  weight?: number;
  /** Days to answer; an unanswered card takes `expire`. */
  deadline: [number, number];
  /** Who it's about, or null if it can't come up now. */
  bind: (c: Ctx) => Bind | null;
  text: (c: Ctx, b: Bind) => string;
  choices: Choice[];
  expire?: (c: Ctx, b: Bind) => Effect[];
  expireText?: string;
}
export interface MissionDef {
  id: string; title: string; days: number;
  goal: (c: Ctx, b: Bind, target: number) => string;
  target: (c: Ctx, b: Bind) => number;
  /** Progress so far toward the target (from the snapshot taken when it started). */
  progress: (c: Ctx, m: MissionInst) => number;
  base: (c: Ctx, b: Bind) => number[];
  success: (c: Ctx, b: Bind) => Effect[];
  failure: (c: Ctx, b: Bind) => Effect[];
}

export interface CardInst { uid: number; def: string; bind: Bind; year: number; day: number; expires: number; title: string; text: string }
export interface MissionInst { uid: number; def: string; bind: Bind; title: string; goal: string; target: number; base: number[]; start: number; until: number; status: 'active' | 'done' | 'failed'; progress: number }
export interface LogEntry { uid: number; title: string; choice: string; how: 'chose' | 'rolled' | 'expired' | 'later' | 'mission'; year: number; day: number; result: string }
export interface CardBook {
  next: number;
  desk: CardInst[];
  log: LogEntry[];
  /** Temporary rating changes still running: the delta actually applied, and when it comes off. */
  temps: Array<{ pid: number; rating: Rating; delta: number; until: number }>;
  later: Array<{ at: number; effects?: Effect[]; card?: string; bind?: Bind; note?: string; from: string }>;
  missions: MissionInst[];
  flags: Record<string, number>;
  /** This week's cards and the players they were about (repeat rule). */
  week: { key: number; seen: Array<[string, number]> };
  /** Days of this season simmed with TO END (extra winter cards). */
  simmedToEnd: number;
  /** Days left in a SIM MONTH plan that bring a storyline card. */
  monthDays: number[];
}
export const newBook = (): CardBook => ({ next: 1, desk: [], log: [], temps: [], later: [], missions: [], flags: {}, week: { key: -1, seen: [] }, simmedToEnd: 0, monthDays: [] });

export type SimMode = 'day' | 'week' | 'month' | 'end';

const abs = (year: number, day: number) => year * 1000 + day;
export const nowAbs = (g: Game) => abs(g.year, g.day);
const defOf = (id: string) => CARD_DEFS.find((d) => d.id === id);
const missionOf = (id: string) => MISSION_DEFS.find((d) => d.id === id);

function cardRng(g: Game, salt: number): Rng {
  return createRng((g.seed ^ Math.imul(nowAbs(g) + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0);
}
const ctx = (g: Game, salt: number, result?: GameResult): Ctx => ({ g, rng: cardRng(g, salt), book: g.cards, ...(result ? { result } : {}) });

// ---------------------------------------------------------------- picking players

/** Your active players, by kind. */
export function mine(g: Game, kind: 'bat' | 'arm' | 'sp' | 'rp' | 'all' = 'all'): Player[] {
  const ids = activeOf(g.team);
  const ps = ids.map((id) => g.players.get(id)!).filter(Boolean);
  if (kind === 'bat') return ps.filter((p) => p.position !== 'P');
  if (kind === 'arm') return ps.filter((p) => p.position === 'P');
  if (kind === 'sp') return g.plan.rotation.slice();
  if (kind === 'rp') return g.plan.bullpen.map((a) => a.player);
  return ps;
}
export const regulars = (g: Game) => g.plan.lineup.map((l) => l.player);
export const pick = <T,>(rng: Rng, xs: T[]): T | undefined => (xs.length ? xs[rng.int(xs.length)] : undefined);

// ---------------------------------------------------------------- effects

function playerById(g: Game, id: number): Player | undefined {
  return g.players.get(id) ?? g.league.freeAgents.find((p) => p.id === id);
}
const clamp = (v: number) => Math.max(20, Math.min(85, v));

/** Apply effects now. Returns a short line for the log. */
export function applyEffects(g: Game, effects: Effect[], from: string): string {
  const book = g.cards, now = nowAbs(g), out: string[] = [];
  if (effects.length) g.movedByHand = true; // a decided card makes the year something a password replay can't reproduce
  for (const e of effects) {
    if (e.kind === 'rating' || e.kind === 'team') {
      const ids = e.kind === 'rating' ? [e.pid] : activeOf(g.team);
      for (const id of ids) {
        const p = playerById(g, id);
        if (!p) continue;
        const before = p.ratings[e.rating];
        p.ratings[e.rating] = clamp(before + e.delta);
        const applied = p.ratings[e.rating] - before;
        if (applied && e.days) book.temps.push({ pid: id, rating: e.rating, delta: applied, until: now + e.days });
      }
      const who = e.kind === 'rating' ? g.name(e.pid) : 'the team';
      out.push(`${who} ${e.delta > 0 ? '+' : ''}${e.delta} ${RATING_WORD[e.rating]}${e.days ? ` for ${e.days} days` : ''}`);
      g.movedByHand = true;
    } else if (e.kind === 'potential') {
      const p = playerById(g, e.pid);
      if (p?.dev) for (const k of Object.keys(p.dev.potential) as Array<keyof typeof p.dev.potential>) p.dev.potential[k] = Math.min(80, p.dev.potential[k] + e.delta);
      out.push(`${g.name(e.pid)}'s ceiling ${e.delta > 0 ? 'rises' : 'drops'}`);
      g.movedByHand = true;
    } else if (e.kind === 'headline') {
      g.headlines.push({ day: g.day, text: e.text, teamId: g.userTeam, big: !!e.big });
    } else if (e.kind === 'flag') {
      book.flags[e.key] = (book.flags[e.key] ?? 0) + e.delta;
    } else if (e.kind === 'later') {
      const [a, b] = e.days;
      const r = cardRng(g, book.next * 7 + book.later.length);
      book.later.push({ at: now + a + r.int(b - a + 1), from, ...(e.effects ? { effects: e.effects } : {}), ...(e.card ? { card: e.card, bind: e.bind ?? {} } : {}), ...(e.note ? { note: e.note } : {}) });
    } else if (e.kind === 'mission') {
      startMission(g, e.mission, e.bind);
      out.push(`mission: ${missionOf(e.mission)?.title ?? e.mission}`);
    } else if (e.kind === 'note') {
      out.push(e.text);
    }
  }
  return out.join('; ') || 'nothing changes';
}

export const RATING_WORD: Record<Rating, string> = {
  power: 'power', contact: 'contact', discipline: 'eye', speed: 'speed', velocity: 'velocity', control: 'control', movement: 'movement', stamina: 'stamina',
  instincts: 'range', glove: 'glove', cannon: 'arm', clutchRisp: 'clutch (RISP)', clutchPressure: 'clutch (pressure)',
};

/** Take every running temporary effect off (the winter, before development; or a player's time is up). */
function revertTemps(g: Game, all: boolean): void {
  const now = nowAbs(g);
  g.cards.temps = g.cards.temps.filter((t) => {
    if (!all && t.until > now) return true;
    const p = playerById(g, t.pid);
    if (p) p.ratings[t.rating] = clamp(p.ratings[t.rating] - t.delta);
    return false;
  });
}

// ---------------------------------------------------------------- drawing cards

function repeatOk(book: CardBook, def: string, b: Bind): boolean {
  const same = book.week.seen.filter(([d]) => d === def);
  if (same.length >= 2) return false;
  return !(b.p ?? []).some((pid) => same.some(([, q]) => q === pid));
}

function makeCard(g: Game, def: CardDef, b: Bind, c: Ctx): CardInst {
  const book = g.cards;
  const [lo, hi] = def.deadline;
  const days = lo + c.rng.int(hi - lo + 1);
  const inst: CardInst = { uid: book.next++, def: def.id, bind: b, year: g.year, day: g.day, expires: nowAbs(g) + days, title: def.title, text: def.text(c, b) };
  book.desk.push(inst);
  for (const pid of b.p?.length ? b.p : [0]) book.week.seen.push([def.id, pid]);
  return inst;
}

/** Draw one card of a kind (weighted), if any can come up now. */
function draw(g: Game, kind: CardDef['kind'], result?: GameResult): CardInst | null {
  const c = ctx(g, g.cards.next * 31 + kind.length, result);
  const options: Array<[CardDef, Bind]> = [];
  for (const d of CARD_DEFS) {
    if (d.kind !== kind) continue;
    if (g.cards.desk.some((x) => x.def === d.id)) continue; // one of each on the desk at a time
    const b = d.bind(c);
    if (b && repeatOk(g.cards, d.id, b)) options.push([d, b]);
  }
  if (!options.length) return null;
  let total = options.reduce((s, [d]) => s + (d.weight ?? 1), 0), r = c.rng.next() * total;
  for (const [d, b] of options) { r -= d.weight ?? 1; if (r <= 0) return makeCard(g, d, b, c); }
  const [d, b] = options[options.length - 1];
  return makeCard(g, d, b, c);
}

// ---------------------------------------------------------------- missions

function startMission(g: Game, id: string, b: Bind): void {
  const def = missionOf(id);
  if (!def) return;
  const c = ctx(g, g.cards.next);
  const target = def.target(c, b);
  g.cards.missions.push({ uid: g.cards.next++, def: id, bind: b, title: def.title, goal: def.goal(c, b, target), target, base: def.base(c, b), start: nowAbs(g), until: nowAbs(g) + def.days, status: 'active', progress: 0 });
}

function tickMissions(g: Game): void {
  const now = nowAbs(g);
  for (const m of g.cards.missions) {
    if (m.status !== 'active') continue;
    const def = missionOf(m.def)!;
    const c = ctx(g, m.uid);
    const p = def.progress(c, m);
    m.progress = Math.max(0, p);
    const over = now >= m.until || g.over || p < 0; // a negative progress means it can't be done any more
    if (p >= m.target) {
      m.status = 'done';
      const res = applyEffects(g, def.success(c, m.bind), m.title);
      g.cards.log.push({ uid: m.uid, title: m.title, choice: 'Mission complete', how: 'mission', year: g.year, day: g.day, result: res });
    } else if (over) {
      m.status = 'failed';
      const res = applyEffects(g, def.failure(c, m.bind), m.title);
      g.cards.log.push({ uid: m.uid, title: m.title, choice: 'Mission failed', how: 'mission', year: g.year, day: g.day, result: res });
    }
  }
  // keep the last few finished ones to show
  const done = g.cards.missions.filter((m) => m.status !== 'active');
  if (done.length > 6) g.cards.missions = g.cards.missions.filter((m) => m.status === 'active' || done.slice(-6).includes(m));
}

// ---------------------------------------------------------------- answering

export function answerCard(g: Game, uid: number, choice: number | 'roll'): LogEntry | null {
  const book = g.cards, i = book.desk.findIndex((x) => x.uid === uid);
  if (i < 0) return null;
  const inst = book.desk[i], def = defOf(inst.def);
  book.desk.splice(i, 1);
  if (!def) return null;
  const c = ctx(g, inst.uid * 13 + 5);
  let k = choice === 'roll' ? -1 : choice;
  if (k < 0) {
    const w = def.choices.map((ch) => ch.coach ?? 1), total = w.reduce((a, b) => a + b, 0);
    let r = c.rng.next() * total; k = 0;
    for (; k < w.length - 1; k++) { r -= w[k]; if (r <= 0) break; }
  }
  const ch = def.choices[Math.max(0, Math.min(def.choices.length - 1, k))];
  const result = applyEffects(g, ch.effects(c, inst.bind), inst.title);
  const entry: LogEntry = { uid, title: inst.title, choice: choiceLabel(ch, c, inst.bind), how: choice === 'roll' ? 'rolled' : 'chose', year: g.year, day: g.day, result };
  book.log.push(entry);
  if (book.log.length > 60) book.log.splice(0, book.log.length - 60);
  return entry;
}

// ---------------------------------------------------------------- the daily tick

/**
 * After a day is played: effects come off, follow-ups land, missions move, unanswered cards expire, and new cards are
 * drawn by the sim's rules. Returns the cards that just landed on your desk.
 */
export function cardsAfterDay(g: Game, day: number, results: GameResult[], mode: SimMode): CardInst[] {
  const book = g.cards, now = nowAbs(g), out: CardInst[] = [];
  if (g.over) { revertTemps(g, true); return out; }
  revertTemps(g, false);
  // follow-ups
  for (const l of book.later.filter((x) => x.at <= now && !(x.card && mode === 'end'))) { // a follow-up card waits out a season sim
    book.later.splice(book.later.indexOf(l), 1);
    if (l.card) { const d = defOf(l.card); if (d) out.push(makeCard(g, d, l.bind ?? {}, ctx(g, book.next))); }
    if (l.effects) {
      const res = applyEffects(g, l.effects, l.from);
      book.log.push({ uid: book.next++, title: l.from, choice: l.note ?? 'It came back around', how: 'later', year: g.year, day: g.day, result: res });
    }
  }
  tickMissions(g);
  // expiries
  for (const inst of book.desk.filter((x) => x.expires <= now)) {
    book.desk.splice(book.desk.indexOf(inst), 1);
    const def = defOf(inst.def);
    const res = def?.expire ? applyEffects(g, def.expire(ctx(g, inst.uid), inst.bind), inst.title) : 'nothing changes';
    book.log.push({ uid: inst.uid, title: inst.title, choice: def?.expireText ?? 'Left on the desk', how: 'expired', year: g.year, day: g.day, result: res });
  }
  // this week's repeat rule
  const wk = Math.floor(day / 7);
  if (book.week.key !== wk) book.week = { key: wk, seen: [] };
  if (g.season.year && mode === 'end') { book.simmedToEnd++; return out; }
  if (mode === 'month') {
    if (book.monthDays.includes(day)) { const c = draw(g, 'story'); if (c) out.push(c); }
  } else {
    if (day > 0 && day % 7 === 0) { const c = draw(g, 'story'); if (c) out.push(c); }
    for (const r of results) {
      if (!r.teamIds.includes(g.userTeam) || !r.log || r.kind === 'post') continue;
      if (gameDrama(r.log, r.innings).score >= DRAMA_CARD) { const c = draw(g, 'game', r); if (c) out.push(c); }
    }
  }
  return out;
}

/** SIM MONTH: pick the 4–6 days that bring a storyline card. */
export function planMonth(g: Game, days: number): void {
  const r = cardRng(g, 999), n = 4 + r.int(3), from = g.day;
  const set = new Set<number>();
  while (set.size < Math.min(n, days)) set.add(from + 1 + r.int(days));
  g.cards.monthDays = [...set].sort((a, b) => a - b);
}

/** The winter: everything temporary comes off before development. */
export function cardsBeforeWinter(g: Game): void { revertTemps(g, true); }

/** Opening Day of a new year: the winter's cards (the decree, plus more for season simmers). */
export function cardsNewYear(g: Game): CardInst[] {
  const book = g.cards, out: CardInst[] = [];
  book.week = { key: -1, seen: [] };
  book.monthDays = [];
  const extra = book.simmedToEnd >= 100 ? 2 : 0;
  book.simmedToEnd = 0;
  for (let i = 0; i < 1 + extra; i++) { const c = draw(g, 'winter'); if (c) out.push(c); }
  return out;
}

export const choiceLabel = (ch: Choice, c: Ctx, b: Bind) => (typeof ch.label === 'function' ? ch.label(c, b) : ch.label);
/** A context for showing a card (names only: no dice are drawn). */
export const viewCtx = (g: Game): Ctx => ctx(g, 0);
export const daysLeft = (g: Game, inst: CardInst) => Math.max(0, inst.expires - nowAbs(g));
export { defOf, missionOf };
