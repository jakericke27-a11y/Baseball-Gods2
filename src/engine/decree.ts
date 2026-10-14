/**
 * The Gods' decree (step 2.2): each winter from the end of Year 1, the Gods name the coming year after one stat,
 * and bless it or curse it: "The Year of the Mighty Home Run", "The Year of the Fallen Walk". A decree is a
 * league modifier on the dials (modifiers.ts) for one year; a quarter of it lingers for good, so runs of decrees
 * leave eras behind.
 *
 * Today the Gods choose alone (never the same stat two winters running). The full "Year of the ___" vote, petitions
 * and vetoes come later; archetypes reacting differently to a decree arrive with development (step 3.5).
 * Sizes are set so a decree moves its stat 10–15% league-wide (`npm run decrees` measures each one; the words in
 * `up` and `down` come from its last run, three leagues per row).
 */
import type { LeagueEnvironment } from './atbat/environment';
import { addModifier, settleYear, type Modifier } from './modifiers';
import type { Rng } from './rng';
import type { League } from './types';

export interface DecreeKind {
  id: string;
  /** The stat, as the scroll names it. */
  stat: string;
  /** The blessing's dial shifts; the curse is the same, reversed. */
  dials: Partial<LeagueEnvironment>;
  /** Measured league-wide effect of the blessing (`npm run decrees`); the curse is about the reverse. */
  up: string;
  down: string;
}

/** The pool (names are working names, on the names-to-pick list). */
export const DECREES: DecreeKind[] = [
  { id: 'homer', stat: 'Home Run', dials: { hr: 0.19 }, up: 'home runs up about 13%', down: 'home runs down about 13%' },
  { id: 'strikeout', stat: 'Strikeout', dials: { protect: -0.38 }, up: 'strikeouts up about 13%', down: 'strikeouts down about 13%' },
  { id: 'walk', stat: 'Walk', dials: { zone: -0.09 }, up: 'walks up about 15%', down: 'walks down about 15%' },
  { id: 'hit', stat: 'Base Hit', dials: { hit: 0.09 }, up: 'batting averages up about 10 points', down: 'batting averages down about 10 points' },
  { id: 'double', stat: 'Double', dials: { xbh: 0.3 }, up: 'doubles up about 14%', down: 'doubles down about 14%' },
  { id: 'triple', stat: 'Triple', dials: { triple: 0.15 }, up: 'triples up about 13%', down: 'triples down about 13%' },
  { id: 'grind', stat: 'Foul Ball', dials: { foul: 0.12 }, up: 'longer at-bats: more strikeouts and more walks', down: 'quicker at-bats: fewer strikeouts and fewer walks' },
  { id: 'star', stat: 'Superstar', dials: { spread: 0.12 }, up: 'the best hitters pull away from the pack', down: 'the best hitters sink back toward the pack' },
];

/** Words for the scroll: a blessed stat and a cursed one. */
const BLESSED = ['Mighty', 'Blessed', 'Golden', 'Roaring', 'Endless'];
const CURSED = ['Fallen', 'Cursed', 'Withered', 'Silent', 'Lost'];

/** Share of a decree that stays in the league's dials after its year. */
export const DECREE_LINGER = 0.25;
/** The first year with a decree (Year 1 plays on the calibrated baseline). */
export const FIRST_DECREE_YEAR = 2;

export interface Decree extends Modifier { kind: string; blessed: boolean }

export const decreeFor = (L: League, year: number): Decree | undefined =>
  L.modifiers.find((m): m is Decree => m.source === 'decree' && m.from === year) as Decree | undefined;

/**
 * The winter's work for the Gods: the ending year's decree settles into the dials, and the coming year's is chosen.
 * Returns the new decree (none before FIRST_DECREE_YEAR).
 */
export function decreeWinter(L: League, endedYear: number, rng: Rng): Decree | undefined {
  settleYear(L, endedYear);
  const year = endedYear + 1;
  if (year < FIRST_DECREE_YEAR || decreeFor(L, year)) return decreeFor(L, year);
  const last = decreeFor(L, endedYear)?.kind;
  const pool = DECREES.filter((d) => d.id !== last);
  const kind = pool[rng.int(pool.length)];
  const blessed = rng.next() < 0.5;
  const word = (blessed ? BLESSED : CURSED)[rng.int(BLESSED.length)];
  const sign = blessed ? 1 : -1;
  const dials = Object.fromEntries(Object.entries(kind.dials).map(([k, v]) => [k, sign * (v as number)])) as Partial<LeagueEnvironment>;
  const d: Decree = {
    id: `decree-${year}`, label: `The Year of the ${word} ${kind.stat}`, source: 'decree', layer: 'divine', target: { kind: 'league' },
    dials, from: year, until: year, linger: DECREE_LINGER, effect: blessed ? kind.up : kind.down, kind: kind.id, blessed,
  };
  addModifier(L, d);
  return d;
}
