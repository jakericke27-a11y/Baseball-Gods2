/**
 * Win probability and the Drama index (step 2.8).
 *
 * Win probability: from the inning, half, outs, bases and score, the chance the home team wins. The current half scores
 * from its base-out state (2019 run expectancy and the chance of scoring at all), every half-inning left scores like a
 * fresh one, and a tie after nine is a coin flip with a small home edge. No dice; the same state is always the same
 * number, so a game's story can be read straight off its log.
 *
 * Drama: how hard a game pulled. The total swing in win probability over every play, the biggest single swing, lead
 * changes and extra innings, on a 0–100 scale where a typical game sits near 40 and about one in ten tops 75. It decides
 * which of your games make a decision card, and later which moments become minigames.
 */
import { decodeEvents, type GameEvent } from './text';

// 2019 run expectancy and chance of scoring, by bases (bit 1 first, 2 second, 4 third) and outs.
const RE: number[][] = [[0.50, 0.27, 0.10], [0.88, 0.52, 0.22], [1.12, 0.68, 0.32], [1.47, 0.91, 0.44], [1.36, 0.95, 0.37], [1.79, 1.14, 0.48], [2.00, 1.40, 0.57], [2.29, 1.53, 0.73]];
const SCORE: number[][] = [[0.27, 0.16, 0.07], [0.42, 0.27, 0.13], [0.62, 0.41, 0.22], [0.62, 0.43, 0.23], [0.85, 0.66, 0.28], [0.87, 0.65, 0.30], [0.86, 0.69, 0.27], [0.87, 0.67, 0.33]];
const MAX = 20;
const HOME_EXTRAS = 0.52;

/** Runs from here to the end of the half: none with 1 − P(score), otherwise geometric with the right mean. */
function halfDist(bases: number, outs: number): number[] {
  const m = RE[bases][outs], r = SCORE[bases][outs];
  const c = Math.max(1.0001, m / r), q = 1 - 1 / c;
  const d = new Array(MAX + 1).fill(0);
  d[0] = 1 - r;
  for (let k = 1; k <= MAX; k++) d[k] = r * (1 - q) * q ** (k - 1);
  return d;
}
const FRESH = halfDist(0, 0);
function conv(a: number[], b: number[]): number[] {
  const out = new Array(Math.min(2 * MAX, a.length + b.length - 2) + 1).fill(0);
  for (let i = 0; i < a.length; i++) if (a[i] > 1e-9) for (let j = 0; j < b.length; j++) { const k = Math.min(out.length - 1, i + j); out[k] += a[i] * b[j]; }
  return out;
}
const freshN: number[][] = [[1]];
const fresh = (n: number) => { while (freshN.length <= n) freshN.push(conv(freshN[freshN.length - 1], FRESH)); return freshN[n]; };

/** P(home − away runs still to come = x), as a map from x + offset; cached by state. */
const cache = new Map<string, { off: number; p: Float64Array }>();
function diffDist(inning: number, half: number, outs: number, bases: number) {
  const inn = Math.min(inning, 9);
  const key = `${inn}:${half}:${outs}:${bases}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const cur = outs >= 3 ? [1] : halfDist(bases, outs);
  // halves left after this one, for each side
  const awayLeft = half === 0 ? 9 - inn : 9 - inn;
  const homeLeft = half === 0 ? 10 - inn : 9 - inn;
  const away = half === 0 ? conv(cur, fresh(awayLeft)) : fresh(awayLeft);
  const home = half === 1 ? conv(cur, fresh(homeLeft)) : fresh(homeLeft);
  const off = away.length;
  const p = new Float64Array(off + home.length);
  for (let a = 0; a < away.length; a++) for (let h = 0; h < home.length; h++) p[h - a + off] += away[a] * home[h];
  hit = { off, p };
  cache.set(key, hit);
  return hit;
}

/**
 * The home team's chance to win. `diff` is home runs minus away runs now. Outs 3 means the half just ended (the next
 * half starts fresh). Game over states (home ahead after the top of the 9th or later, or a walk-off) are 1 or 0.
 */
export function winProb(inning: number, half: number, outs: number, bases: number, diff: number): number {
  if (outs >= 3) { // the half is over: move to the next one
    if (half === 0) { if (inning >= 9 && diff > 0) return 1; return winProb(inning, 1, 0, 0, diff); }
    if (inning >= 9 && diff !== 0) return diff > 0 ? 1 : 0;
    return winProb(inning + 1, 0, 0, 0, diff);
  }
  if (half === 1 && inning >= 9 && diff > 0) return 1; // walk-off
  const { off, p } = diffDist(inning, half, outs, bases);
  let win = 0, tie = 0;
  for (let i = 0; i < p.length; i++) {
    const final = i - off + diff;
    if (final > 0) win += p[i]; else if (final === 0) tie += p[i];
  }
  return win + tie * HOME_EXTRAS;
}

export interface DramaSwing { batter: number; pitcher: number; inning: number; half: 0 | 1; delta: number }
export interface Drama {
  /** 0–100. */
  score: number;
  /** Total win-probability swing over the game (0–1 per play, summed). */
  swing: number;
  leadChanges: number;
  /** The biggest single plate appearance (delta from the home team's view). */
  biggest: DramaSwing | null;
  /** The home team's win probability after every event, for a chart. */
  curve: number[];
  extra: boolean;
}

const sdCache = new WeakMap<Uint8Array, Drama>();

/** A finished game's Drama, read from its log. */
export function gameDrama(log: Uint8Array, innings: number): Drama {
  const hit = sdCache.get(log);
  if (hit) return hit;
  const events: GameEvent[] = decodeEvents(log);
  let inning = 1, half: 0 | 1 = 0, outs = 0, bases = 0;
  const score = [0, 0];
  let wp = winProb(1, 0, 0, 0, 0);
  const curve = [wp];
  let swing = 0, leadChanges = 0, lead = 0;
  let biggest: DramaSwing | null = null;
  const advance = (ev: GameEvent) => {
    if (ev.inning !== inning || ev.half !== half) { inning = ev.inning; half = ev.half; outs = 0; bases = 0; }
  };
  for (const ev of events) {
    if (ev.type === 'change' || ev.type === 'sub') continue;
    advance(ev);
    let runs = 0;
    if (ev.type === 'pa') {
      runs = ev.runs;
      outs = ev.outsBefore;
      bases = ev.basesBefore;
      const before = winProb(inning, half, outs, bases, score[1] - score[0]);
      score[half] += runs;
      const k = (ev.play === 0 || ev.play === 1 ? 1 : 0) + ev.moves.filter((m) => m.to === 0 || m.to >= 5).length;
      outs += k;
      let b = bases;
      for (const m of ev.moves) { if (m.from >= 1) b &= ~(1 << (m.from - 1)); }
      for (const m of ev.moves) { if (m.to >= 1 && m.to <= 3) b |= 1 << (m.to - 1); }
      bases = outs >= 3 ? 0 : b;
      wp = winProb(inning, half, Math.min(3, outs), bases, score[1] - score[0]);
      const d = wp - before;
      if (!biggest || Math.abs(d) > Math.abs(biggest.delta)) biggest = { batter: ev.batter, pitcher: ev.pitcher, inning, half, delta: d };
      swing += Math.abs(d);
    } else {
      const before = wp;
      if (ev.type === 'steal') {
        bases &= ~(1 << (ev.base - 2));
        if (ev.safe) bases |= 1 << (ev.base - 1); else outs++;
      } else { // wild pitch
        for (const m of ev.moves) { if (m.from >= 1) bases &= ~(1 << (m.from - 1)); if (m.to === 4) runs++; }
        for (const m of ev.moves) if (m.to >= 1 && m.to <= 3) bases |= 1 << (m.to - 1);
        score[half] += runs;
      }
      wp = winProb(inning, half, Math.min(3, outs), outs >= 3 ? 0 : bases, score[1] - score[0]);
      swing += Math.abs(wp - before);
    }
    curve.push(wp);
    const now = Math.sign(score[1] - score[0]);
    if (now !== 0 && now !== lead) { if (lead !== 0) leadChanges++; lead = now; }
  }
  const extra = innings > 9;
  const big = biggest ? Math.abs(biggest.delta) : 0;
  // Scale: a typical game ~40, about one in ten above 75 (see npm run drama).
  const raw = 6 + 11 * swing + 30 * big + 4 * leadChanges + (extra ? 4 + 2 * Math.min(6, innings - 10) : 0);
  const score100 = Math.max(0, Math.min(100, Math.round(raw)));
  const out: Drama = { score: score100, swing, leadChanges, biggest, curve, extra };
  sdCache.set(log, out);
  return out;
}

/** A game of yours at or above this Drama makes a decision card (week and day sims). About one game in twelve. */
export const DRAMA_CARD = 78;
