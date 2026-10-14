/**
 * Seeded PRNG (xoshiro128**). Same seed → same sequence → same season.
 * Every random draw in the engine goes through an Rng instance, never Math.random().
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Standard normal draw (mean 0, sd 1). */
  normal(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** The generator's whole state, for saves: four words plus the spare normal draw. */
  state(): RngState;
}
export type RngState = [number, number, number, number, number | null];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** A generator from a seed, or picking up exactly where a saved state left off. */
export function createRng(seed: number, from?: RngState): Rng {
  const init = splitmix32(seed);
  let a = init(), b = init(), c = init(), d = init();
  let spare: number | null = null;
  if (from) [a, b, c, d, spare] = from;

  const nextU32 = (): number => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return r;
  };

  const next = (): number => nextU32() / 4294967296;

  return {
    next,
    state: () => [a, b, c, d, spare],
    int: (n: number) => Math.floor(next() * n),
    normal(): number {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mag * Math.cos(2 * Math.PI * v);
    },
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
