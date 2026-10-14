/**
 * League generation, ported from PROJECT_SPEC.md §7 and regions_and_generation.sql.
 *   30 teams (2 conferences × 3 divisions × 5), 40-man rosters (22 hitters + 18 pitchers),
 *   attributes = region tendency + Normal(0, stdev), clamped to 20–80.
 */
import { expectedGap, RATING_KEYS, rollDev } from './development';
import { createRng, type Rng } from './rng';
import { setAllActive } from './roster';
import { REGIONS, type Region, type TendencyKey } from './regions';
import type { Bats, League, Player, PitcherRole, Position, RatingKey, Ratings, Team, Throws } from './types';

/** Ages on a Year 1 roster, shaped like a settled league (about 28.5 on average, few under 23). Only the ages
 *  changed from the first build: the draws happen in the same order, so every rating is what it was. */
const AGE_BANDS: Array<[number, number, number]> = [
  [21, 23, 0.10], [24, 26, 0.25], [27, 29, 0.27], [30, 32, 0.20], [33, 35, 0.12], [36, 40, 0.06],
];

const HITTER_SLOTS: Position[] = [
  'C', 'C', 'C', '1B', '1B', '2B', '2B', '3B', '3B', 'SS', 'SS',
  'LF', 'LF', 'CF', 'CF', 'RF', 'RF', 'DH', 'UT', 'UT',
];
// 20 named slots + 2 more utility/bench bats = 22 position players
const EXTRA_HITTERS: Position[] = ['UT', 'UT'];

function pickWeighted<T>(rng: Rng, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = rng.next() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

const clampRating = (x: number): number => Math.max(20, Math.min(80, Math.round(x)));

function rollAttr(rng: Rng, region: Region, key: TendencyKey): number {
  return clampRating(region.tendencies[key] + rng.normal() * region.stdev);
}

function rollAge(rng: Rng): number {
  const band = pickWeighted(rng, AGE_BANDS, (b) => b[2]);
  return band[0] + rng.int(band[1] - band[0] + 1);
}

// Placeholder names until the real naming rules exist (deferred in the spec).
const FIRST = ['Marcus', 'Kai', 'Dex', 'Juno', 'Rafe', 'Teo', 'Bram', 'Cass', 'Odell', 'Nico', 'Jett',
  'Silas', 'Ezra', 'Moss', 'Aldo', 'Rook', 'Lenny', 'Vance', 'Otis', 'Hollis', 'Quinn', 'Arlo', 'Benny',
  'Cruz', 'Dario', 'Emil', 'Fitz', 'Gus', 'Hank', 'Ike', 'Jory', 'Knox', 'Luca', 'Milo', 'Nate', 'Ozzie'];
const LAST_A = ['Bell', 'Stone', 'Reed', 'Hale', 'Cole', 'Vance', 'Lowe', 'Marsh', 'Pike', 'Crane',
  'Holt', 'Shaw', 'Fenn', 'Dunn', 'Rourke', 'Gale', 'Thorne', 'Wick', 'Barlow', 'Kemp'];
const LAST_B = ['', '', '', 'well', 'ford', 'man', 'ley', 'by', 'ton', 'more', 'ridge', 'shaw'];

function rollName(rng: Rng): string {
  const first = FIRST[rng.int(FIRST.length)];
  const last = LAST_A[rng.int(LAST_A.length)] + LAST_B[rng.int(LAST_B.length)];
  return `${first} ${last}`;
}

export function rollPlayer(rng: Rng, id: number, position: Position, role?: PitcherRole): Player {
  const region = pickWeighted(rng, REGIONS, (r) => r.spawnWeight);
  const a = (k: TendencyKey) => rollAttr(rng, region, k);
  const ratings: Ratings = {
    power: a('power'), contact: a('contact'), discipline: a('discipline'), speed: a('speed'),
    velocity: a('velocity'), control: a('control'), movement: a('movement'), stamina: a('stamina'),
    instincts: a('instincts'), glove: a('glove'), cannon: a('cannon'),
    clutchRisp: 50, clutchPressure: 50,
  };
  // Clutch leans toward stars without walls (April design): mean shifts with overall, sd 15.
  const overall = position === 'P'
    ? (ratings.velocity + ratings.control + ratings.movement) / 3
    : (ratings.power + ratings.contact + ratings.discipline) / 3;
  const clutchLean = region.tendencies.clutch - 48; // Gallows End players lean clutch
  const clutchMean = 50 + (overall - 50) * 0.25 + clutchLean * 0.5;
  ratings.clutchRisp = clampRating(clutchMean + rng.normal() * 15);
  ratings.clutchPressure = clampRating(clutchMean + rng.normal() * 15);

  // Starters need stamina, relievers don't: nudge stamina by role so the roles make sense.
  if (role === 'SP') ratings.stamina = clampRating(ratings.stamina + 10);
  if (role === 'RP' || role === 'CL') ratings.stamina = clampRating(ratings.stamina - 12);

  const batsRoll = rng.next();
  const bats: Bats = batsRoll < 0.6 ? 'R' : batsRoll < 0.9 ? 'L' : 'S';
  const throws: Throws = position === 'P' ? (rng.next() < 0.72 ? 'R' : 'L') : (rng.next() < 0.85 ? 'R' : 'L');

  return {
    id, name: rollName(rng), age: rollAge(rng), regionId: region.id,
    bats, throws, position, pitcherRole: role, ratings,
  };
}

export function generateLeague(seed: number): League {
  const rng = createRng(seed);
  const players: Player[] = [];
  const teams: Team[] = [];
  let nextId = 1;

  for (let t = 0; t < 30; t++) {
    const team: Team = {
      id: t + 1,
      name: `Team ${String(t + 1).padStart(2, '0')}`,
      conference: Math.floor(t / 15),
      division: Math.floor((t % 15) / 5),
      playerIds: [],
      strategy: {
        rotationSize: ((r) => (r < 0.15 ? 4 : r < 0.85 ? 5 : 6))(rng.next()) as 4 | 5 | 6,
        skipFifthAfterOffDay: rng.next() < 0.5,
      },
    };
    for (const pos of [...HITTER_SLOTS, ...EXTRA_HITTERS]) {
      const p = rollPlayer(rng, nextId++, pos);
      players.push(p);
      team.playerIds.push(p.id);
    }
    const nSP = 6 + rng.int(2);          // 6–7
    const nCL = 1 + rng.int(2);          // 1–2
    const nRP = 18 - nSP - nCL;          // 9–11
    const roles: PitcherRole[] = [
      ...Array<PitcherRole>(nSP).fill('SP'),
      ...Array<PitcherRole>(nRP).fill('RP'),
      ...Array<PitcherRole>(nCL).fill('CL'),
    ];
    for (const role of roles) {
      const p = rollPlayer(rng, nextId++, 'P', role);
      players.push(p);
      team.playerIds.push(p.id);
    }
    teams.push(team);
  }
  const league: League = { seed, players, teams, amateurs: [], freeAgents: [], retired: [], nextId, history: [], waivers: [] };
  seedPipeline(league);
  setAllActive(league);
  return league;
}

// ---------------------------------------------------------------- the amateur pipeline

export const PIPELINE = {
  /** New 16-year-olds each year, across the regions. */
  classSize: 150,
  /** Amateur potentials sit this far above a league roll (the pool is the raw material; teams sign the best). */
  lift: 0,
  firstAge: 16,
  /** Signable by anyone from this age (no draft yet: 1.6 adds it at 18–22). */
  signAge: 23,
};

const AMATEUR_POSITIONS: Position[] = [...HITTER_SLOTS, ...EXTRA_HITTERS];

/** A new amateur at an age: rolled like a league player, but those rolls are his potential, and he grows into them. */
export function rollAmateur(rng: Rng, id: number, age: number): Player {
  const pitcher = rng.next() < 0.45;
  const position = pitcher ? 'P' : AMATEUR_POSITIONS[rng.int(AMATEUR_POSITIONS.length)];
  const role: PitcherRole | undefined = pitcher ? (rng.next() < 0.4 ? 'SP' : 'RP') : undefined;
  const p = rollPlayer(rng, id, position, role);
  p.age = age;
  const potential = {} as Record<RatingKey, number>;
  for (const k of RATING_KEYS) potential[k] = Math.max(20, Math.min(80, p.ratings[k] + PIPELINE.lift));
  p.dev = rollDev(rng, p, potential);
  for (const k of RATING_KEYS) p.ratings[k] = Math.max(20, Math.min(80, Math.round(potential[k] - expectedGap(k, age) / Math.max(0.5, p.dev.growth))));
  return p;
}

/**
 * Hidden development for everyone on a roster, and amateur classes aged 16–22. A separate random stream,
 * so a league's rosters and ratings are exactly what they were before the pipeline existed.
 */
export function seedPipeline(league: League): void {
  const rng = createRng(league.seed ^ 0x2545f491);
  for (const p of league.players) if (!p.dev) p.dev = rollDev(rng, p);
  for (let age = PIPELINE.firstAge; age < PIPELINE.signAge; age++) {
    for (let i = 0; i < PIPELINE.classSize; i++) league.amateurs.push(rollAmateur(rng, league.nextId++, age));
  }
}
