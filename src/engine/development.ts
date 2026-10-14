/**
 * How players grow and age. Each rating has a growth phase (closing the gap to its hidden potential),
 * a plateau, and a decline, on its own clock: speed and range peak first and fade first; discipline and
 * control mature last and hold longest (the shape of real aging curves). Two hidden per-player factors
 * bend it: growth (busts and late bloomers) and aging (who falls off a cliff, who ages gracefully).
 */
import type { Rng } from './rng';
import type { Player, PlayerDev, RatingKey } from './types';

export const RATING_KEYS: RatingKey[] = ['power', 'contact', 'discipline', 'speed', 'velocity', 'control', 'movement', 'stamina', 'instincts', 'glove', 'cannon'];

interface Curve { /** Growth ends (age). */ peak: number; /** Decline starts (age). */ decline: number; /** Points lost the first year of decline; grows with age. */ loss: number }
export const CURVES: Record<RatingKey, Curve> = {
  speed:      { peak: 24, decline: 27, loss: 1.2 },
  instincts:  { peak: 25, decline: 28, loss: 1.0 },
  cannon:     { peak: 26, decline: 30, loss: 0.8 },
  velocity:   { peak: 26, decline: 29, loss: 0.9 },
  power:      { peak: 28, decline: 31, loss: 0.9 },
  contact:    { peak: 27, decline: 31, loss: 0.8 },
  glove:      { peak: 27, decline: 32, loss: 0.6 },
  movement:   { peak: 27, decline: 31, loss: 0.7 },
  stamina:    { peak: 27, decline: 31, loss: 0.8 },
  discipline: { peak: 29, decline: 33, loss: 0.5 },
  control:    { peak: 29, decline: 32, loss: 0.4 },
};

export const DEV = {
  /** At 16 a rating sits this far under its potential, on average. */
  gapAt16: 26,
  /** Random wobble per year: growing, on the plateau, declining. */
  noiseGrow: 1.4, noisePlateau: 0.7, noiseDecline: 0.8,
  /** Each extra year of decline costs this much more (×). */
  lossRamp: 0.25,
  /** Young potentials drift a little each year until 24, so late bloomers and busts surprise. */
  potentialDrift: 0.9,
};

const clamp = (x: number) => Math.max(20, Math.min(80, Math.round(x)));

/** Yearly share of the remaining gap closed during growth, so the gap is about 1 point at the peak age. */
const rate = (k: RatingKey) => 1 - Math.pow(1 / DEV.gapAt16, 1 / (CURVES[k].peak - 16));

/** The expected gap between a rating and its potential at an age (0 from the peak on). */
export function expectedGap(k: RatingKey, age: number): number {
  const c = CURVES[k];
  if (age >= c.peak) return 0;
  return DEV.gapAt16 * Math.pow(1 - rate(k), Math.max(0, age - 16));
}

/** Hidden traits. Growth and aging are log-normal around 1; potential follows from current ratings and age. */
export function rollDev(rng: Rng, p: Player, potentialFrom?: Record<RatingKey, number>): PlayerDev {
  const growth = Math.exp(0.3 * rng.normal());
  const aging = Math.exp(0.25 * rng.normal());
  const potential = {} as Record<RatingKey, number>;
  for (const k of RATING_KEYS) potential[k] = potentialFrom?.[k] ?? clamp(p.ratings[k] + expectedGap(k, p.age) * growth);
  return { potential, growth, aging };
}

/** One offseason: a year older, and every rating grows, holds or declines on its own curve. */
export function develop(p: Player, rng: Rng): void {
  const d = p.dev;
  p.age++;
  if (!d) return;
  for (const k of RATING_KEYS) {
    const c = CURVES[k], r = p.ratings[k];
    if (p.age <= 24) d.potential[k] = Math.max(20, Math.min(80, d.potential[k] + DEV.potentialDrift * rng.normal()));
    let next: number;
    if (p.age <= c.peak) next = r + Math.max(0, d.potential[k] - r) * rate(k) * d.growth + DEV.noiseGrow * rng.normal();
    else if (p.age < c.decline) next = r + DEV.noisePlateau * rng.normal();
    else next = r - c.loss * (1 + DEV.lossRamp * (p.age - c.decline)) * d.aging + DEV.noiseDecline * rng.normal();
    p.ratings[k] = clamp(next);
  }
}

/** Fielding weight in a position player's value: up the middle counts most. */
const FIELD_WEIGHT: Record<string, number> = { C: 0.35, SS: 0.35, CF: 0.3, '2B': 0.25, '3B': 0.22, LF: 0.12, RF: 0.14, '1B': 0.08, UT: 0.2, DH: 0 };

/** One number for how good a player is now, on the 20–80 scale. AI roster moves and retirement use it. */
export function playerValue(p: Player): number {
  const R = p.ratings;
  if (p.position === 'P') {
    const stuff = (R.velocity + R.control + R.movement) / 3;
    return p.pitcherRole === 'SP' ? 0.85 * stuff + 0.15 * R.stamina : stuff;
  }
  const bat = (R.power + R.contact + 0.8 * R.discipline + 0.3 * R.speed) / 3.1;
  const field = (R.instincts + R.glove + R.cannon) / 3;
  const w = FIELD_WEIGHT[p.position] ?? 0.15;
  return bat * (1 - w) + field * w;
}

/** A pitcher's role from his ratings (closers keep theirs). */
export const roleFor = (p: Player): Player['pitcherRole'] => (p.pitcherRole === 'CL' ? 'CL' : p.ratings.stamina >= 50 ? 'SP' : 'RP');
