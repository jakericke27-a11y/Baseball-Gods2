/**
 * Log-odds ("logit") math.
 *
 * Every probability in the engine is built as:
 *     logit(p) = league_base + sum(sensitivity * rating_shift) + situational shifts
 * then converted back with sigmoid(). A 50-vs-50 matchup sits exactly on the
 * league base, ratings push the odds up or down symmetrically, and nothing can
 * ever fall below 0% or above 100% — no clamps needed.
 */
export const logit = (p: number): number => Math.log(p / (1 - p));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Rating on the 20–80 scale → standard units (one unit = 10 points = ~1 SD). */
export const z = (rating: number): number => (rating - 50) / 10;
