/**
 * League generation, ported from PROJECT_SPEC.md §7 and regions_and_generation.sql.
 *   30 teams (2 conferences × 3 divisions × 5), 40-man rosters (22 hitters + 18 pitchers),
 *   attributes = region tendency + Normal(0, stdev), clamped to 20–80.
 */
import { createRng, type Rng } from './rng';
import { REGIONS, type Region, type TendencyKey } from './regions';
import type { Bats, League, Player, PitcherRole, Position, Ratings, Team, Throws } from './types';

const AGE_BANDS: Array<[number, number, number]> = [
  [18, 21, 0.20], [22, 25, 0.30], [26, 29, 0.25], [30, 33, 0.15], [34, 37, 0.08], [38, 42, 0.02],
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

function rollPlayer(rng: Rng, id: number, position: Position, role?: PitcherRole): Player {
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
  return { seed, players, teams };
}
