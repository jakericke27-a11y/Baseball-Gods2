/**
 * Modifiers (step 2.2): one system for every bounded effect the game stacks on the honest baseline.
 * Each modifier has a source, a target, a layer and a duration, and its effect is written in the engine's
 * own units, so they stack predictably, the calibration tools can measure them, and screens can explain them.
 *
 * Layers apply in order: 'real' first (weather, injuries, later), then 'divine' (decrees, the Gods, cards).
 * Today every modifier targets the league and shifts its dials (environment.ts). Team and player targets
 * (ratings shifts) arrive with the systems that need them: weather, injuries, cards, traits.
 *
 * When a modifier ends, a share of it ("linger") stays in the league's own dials for good. That's how a run of
 * decrees leaves eras behind; nothing pulls the dials back to their targets.
 */
import { applyEnvironment, shiftEnvironment, type LeagueEnvironment } from './atbat/environment';
import { DEFAULT_PARAMS, type AtBatParams } from './atbat/params';
import type { League } from './types';

export type ModifierLayer = 'real' | 'divine';

export interface Modifier {
  /** Unique within the league, e.g. "decree-3". */
  id: string;
  /** What it's called on screens, e.g. "The Year of the Mighty Home Run". */
  label: string;
  /** Where it came from (more kinds arrive with weather, cards and the rest). */
  source: 'decree';
  layer: ModifierLayer;
  target: { kind: 'league' };
  /** Dial shifts in the engine's units (log-odds; spread is star power). */
  dials: Partial<LeagueEnvironment>;
  /** Active from the start of year `from` through the end of year `until`. */
  from: number;
  until: number;
  /** Share of the shift left in the league's dials for good once it ends (0–1). */
  linger: number;
  /** In plain words, measured by `npm run decrees` (e.g. "home runs +16%"). */
  effect: string;
}

/** The league's own dials (born from calibration, nudged by every modifier that ends). */
export const leagueEnv = (L: League): LeagueEnvironment => L.env;

export const activeModifiers = (L: League, year: number): Modifier[] => L.modifiers.filter((m) => m.from <= year && year <= m.until);

/** The environment a year plays in: the league's dials, then the real layer, then the divine layer. */
export function yearEnvironment(L: League, year: number): LeagueEnvironment {
  let env = leagueEnv(L);
  const on = activeModifiers(L, year);
  for (const layer of ['real', 'divine'] as const) for (const m of on) if (m.layer === layer) env = shiftEnvironment(env, m.dials);
  return env;
}

export const yearParams = (L: League, year: number, base: AtBatParams = DEFAULT_PARAMS): AtBatParams => applyEnvironment(base, yearEnvironment(L, year));

/** Close out a finished year: modifiers ending with it leave their linger in the league's dials. Returns them. */
export function settleYear(L: League, year: number): Modifier[] {
  const ending = L.modifiers.filter((m) => m.until === year && m.linger > 0);
  let env = leagueEnv(L);
  for (const m of ending) env = shiftEnvironment(env, m.dials, m.linger);
  L.env = env;
  return ending;
}

export function addModifier(L: League, m: Modifier): void { L.modifiers.push(m); }
