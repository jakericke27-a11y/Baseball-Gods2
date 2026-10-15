/**
 * Pitch-by-pitch plate appearance.
 *
 * Each pitch asks, in order:
 *   1. Where is it?      zone vs chase (control, count, fatigue); heart vs edge (command)
 *   2. Does he swing?    discipline vs deception, count
 *   3. Contact?          contact vs stuff (velocity + movement), location, 2-strike protect
 *   4. Foul or fair?     location, contact skill, 2-strike spoiling
 *   5. If fair: quality  power/contact vs movement/velocity, location, count
 *      then launch type  (ground / line / fly / popup) and the outcome.
 *
 * Pitch counts, deep-count battles, first-pitch homers and full-count walks are
 * not rolled separately — they fall out of the count.
 */
import { sigmoid, z } from '../math';
import type { Rng } from '../rng';
import type { Bats, Player, Throws } from '../types';
import { BattedBall, Loc, Outcome, PitchResult, encodePitch } from './codes';
import type { AtBatParams } from './params';

export interface AtBatContext {
  /** In-game pitcher fatigue: 0 = fresh; 1 = fully spent (degrades control most, then velocity, movement). */
  fatigue: number;
  /** Situational clutch shift in log-odds (+ favors the batter). Computed by the game layer. */
  clutch?: number;
  /** Fielders by scoring position (1 = P ... 9 = RF). Omitted = league-average defense. */
  defense?: Defense;
  /** Manager calls and alignments, as log-odds shifts (game layer builds them). Omitted = nobody called anything. */
  tactic?: Tactic;
}

/** Bounded shifts from manager calls, in the at-bat's own log-odds units. Every field defaults to 0. */
export interface Tactic {
  zone?: number; heart?: number; swingZone?: number; swingChase?: number; contact?: number; quality?: number;
  /** Batted-ball type, relative to a ground ball. */
  typeLD?: number; typeFB?: number; typePU?: number;
  /** Hit chances on ground balls and on balls in the air; extra bases once it's a hit. */
  hitGB?: number; hitAir?: number; xbh?: number;
}

export interface Defense {
  fielders: Array<Player['ratings'] | undefined>;
}

export interface AtBatResult {
  outcome: Outcome;
  pitches: number;
  battedBall: BattedBall;
  /** Exit quality in SD units (0 = league-average contact); NaN when the ball wasn't put in play. */
  quality: number;
  /** Scoring position of the fielder who made the play / retrieved the hit (0 = no ball in play). */
  fielder: number;
}

/** Max pitches written to the scratch buffer; a 40+ pitch at-bat is forced into play. */
export const MAX_PITCHES = 40;

/** +1: batter has the platoon edge (or is a switch hitter). -1: pitcher has it. */
export function platoonEdge(bats: Bats, throws: Throws): number {
  if (bats === 'S') return 1;
  return bats === throws ? -1 : 1;
}

/**
 * Simulate one plate appearance. Pitch bytes are written to `pitchLog` (length >= MAX_PITCHES).
 */
export function simulateAtBat(
  batter: Player,
  pitcher: Player,
  ctx: AtBatContext,
  P: AtBatParams,
  rng: Rng,
  pitchLog: Uint8Array,
): AtBatResult {
  const b = batter.ratings, p = pitcher.ratings, s = P.s;
  const f = ctx.fatigue;

  // Ratings in SD units. Fatigue erodes command first, then velocity, then movement.
  const con = z(b.contact), pow = z(b.power), eye = z(b.discipline), spd = z(b.speed);
  const ctl = z(p.control) - 0.8 * f;
  const vel = z(p.velocity) - 0.6 * f;
  const mov = z(p.movement) - 0.5 * f;
  const stuff = 0.6 * vel + 0.4 * mov;
  const plat = platoonEdge(batter.bats, pitcher.throws);
  const clutch = ctx.clutch ?? 0;
  const t = ctx.tactic;

  // Per-PA terms that don't change pitch to pitch. (Tactic shifts are exactly 0 when nothing was called.)
  const zoneBase = P.zone + s.zoneControl * ctl + (t?.zone ?? 0);
  const heartProb = sigmoid(P.heart + s.heartControl * ctl + (t?.heart ?? 0));
  const swingChaseBase = P.swingChase + s.chaseDiscipline * eye + s.chaseMovement * mov - 0.5 * clutch + (t?.swingChase ?? 0);
  const swingEdgeBase = P.swingEdge + s.edgeDiscipline * eye + (t?.swingZone ?? 0);
  const swingHeart = P.swingHeart + (t?.swingZone ?? 0);
  const contactShift = s.contactContact * con + s.contactStuff * stuff + s.platoon * plat + clutch + (t?.contact ?? 0);
  const foulBase = P.foul + s.foulContact * con;
  const hbpProb = sigmoid(P.hbp + s.hbpControl * ctl);
  const qualityBase =
    s.qualityPower * pow + s.qualityContact * con +
    s.qualityMovement * mov + s.qualityVelocity * vel + s.platoon * plat + 0.8 * clutch + (t?.quality ?? 0);

  let balls = 0, strikes = 0, n = 0;

  for (;;) {
    // 1. Location
    let loc: Loc;
    if (rng.next() < sigmoid(zoneBase + P.zoneCount[balls][strikes])) {
      loc = rng.next() < heartProb ? Loc.Heart : Loc.Edge;
    } else {
      loc = Loc.Chase;
    }

    // 2. Swing decision
    const swingL = loc === Loc.Chase
      ? swingChaseBase + P.swingChaseCount[balls][strikes]
      : (loc === Loc.Heart ? swingHeart : swingEdgeBase) + P.swingZoneCount[balls][strikes];

    if (rng.next() >= sigmoid(swingL)) {
      // Taken pitch
      if (loc === Loc.Chase) {
        if (rng.next() < hbpProb) {
          pitchLog[n++] = encodePitch(PitchResult.HitByPitch, loc);
          return { outcome: Outcome.HitByPitch, pitches: n, battedBall: BattedBall.None, quality: NaN, fielder: 0 };
        }
        pitchLog[n++] = encodePitch(PitchResult.Ball, loc);
        if (++balls === 4) return { outcome: Outcome.Walk, pitches: n, battedBall: BattedBall.None, quality: NaN, fielder: 0 };
      } else {
        pitchLog[n++] = encodePitch(PitchResult.CalledStrike, loc);
        if (++strikes === 3) return { outcome: Outcome.StrikeoutLooking, pitches: n, battedBall: BattedBall.None, quality: NaN, fielder: 0 };
      }
      continue;
    }

    // 3. Contact
    const contactL =
      (loc === Loc.Heart ? P.contactHeart : loc === Loc.Edge ? P.contactEdge : P.contactChase) +
      contactShift + (strikes === 2 ? P.contactTwoStrike : 0);
    if (rng.next() >= sigmoid(contactL)) {
      pitchLog[n++] = encodePitch(PitchResult.SwingingStrike, loc);
      if (++strikes === 3) return { outcome: Outcome.StrikeoutSwinging, pitches: n, battedBall: BattedBall.None, quality: NaN, fielder: 0 };
      continue;
    }

    // 4. Foul or fair
    const foulL = foulBase +
      (loc === Loc.Edge ? P.foulEdge : loc === Loc.Chase ? P.foulChase : 0) +
      (strikes === 2 ? P.foulTwoStrike : 0);
    if (n < MAX_PITCHES - 1 && rng.next() < sigmoid(foulL)) {
      pitchLog[n++] = encodePitch(PitchResult.Foul, loc);
      if (strikes < 2) strikes++;
      continue;
    }

    // 5. Ball in play
    pitchLog[n++] = encodePitch(PitchResult.InPlay, loc);
    const q =
      qualityBase +
      (loc === Loc.Heart ? P.qualityHeart : loc === Loc.Edge ? P.qualityEdge : P.qualityChase) +
      P.qualityCount[balls][strikes] + (strikes === 2 ? P.qualityTwoStrike : 0) +
      rng.normal();
    const side = batter.bats === 'S' ? (pitcher.throws === 'R' ? 'L' : 'R') : batter.bats;
    return resolveBattedBall(q, loc, con, pow, mov, spd, side, ctx.defense, P, rng, n, t);
  }
}

// Spray tables in the right-handed hitter's frame: [position, cumulative probability].
// Directions: 0 = pull, 1 = center, 2 = opposite field. Lefties are mirrored (3↔5, 4↔6, 7↔9).
type Spray = Array<[number, number]>;
const cum = (rows: Array<[number, number]>): Spray => { let c = 0; return rows.map(([p, w]) => [p, (c += w)]); };
const SPRAY: Record<number, Spray[]> = {
  [BattedBall.Ground]: [cum([[5, .45], [6, .55]]), cum([[6, .40], [4, .40], [1, .20]]), cum([[4, .55], [3, .45]])],
  [BattedBall.Line]: [cum([[7, .62], [5, .15], [6, .23]]), cum([[8, .62], [6, .19], [4, .19]]), cum([[9, .62], [4, .18], [3, .20]])],
  [BattedBall.Fly]: [cum([[7, .88], [6, .07], [5, .05]]), cum([[8, .92], [6, .04], [4, .04]]), cum([[9, .88], [4, .07], [3, .05]])],
  [BattedBall.Popup]: [0, 1, 2].map(() => cum([[2, .12], [3, .16], [4, .18], [5, .22], [6, .27], [1, .05]])),
};
const MIRROR = [0, 1, 2, 5, 6, 3, 4, 9, 8, 7];
/** Outfielder behind an infield zone when a ground ball gets through (RHB frame). */
const THROUGH = [0, 8, 8, 9, 9, 7, 7, 7, 8, 9];
const ERROR_BASE: Record<number, number> = {
  [BattedBall.Ground]: -2.85, [BattedBall.Line]: -4.80, [BattedBall.Fly]: -4.40, [BattedBall.Popup]: -4.80,
};

function resolveBattedBall(
  q: number, loc: Loc, con: number, pow: number, mov: number, spd: number,
  side: 'L' | 'R', defense: Defense | undefined,
  P: AtBatParams, rng: Rng, n: number, t: Tactic | undefined,
): AtBatResult {
  const s = P.s;

  // Launch type: softmax over ground (reference), line, fly, popup.
  const eLD = Math.exp(P.typeLD + s.typeLDContact * con + P.typeQualityLD * q + (t?.typeLD ?? 0));
  const eFB = Math.exp(P.typeFB + s.typeFBPower * pow + s.typeFBMovement * mov + P.typeQualityFB * q + (t?.typeFB ?? 0));
  const ePU = Math.exp(P.typePU + s.typePUContact * con + (loc === Loc.Chase ? P.typePUChase : 0) - 0.3 * q + (t?.typePU ?? 0));
  let u = rng.next() * (1 + eLD + eFB + ePU);
  let bb: BattedBall;
  if (u < 1) bb = BattedBall.Ground;
  else if ((u -= 1) < eLD) bb = BattedBall.Line;
  else if ((u -= eLD) < eFB) bb = BattedBall.Fly;
  else bb = BattedBall.Popup;

  // Spray: who gets to it. Power hitters pull more.
  const pullP = 0.40 + 0.04 * pow, oppoP = 0.25 - 0.02 * pow;
  const d = rng.next();
  const dir = d < pullP ? 0 : d < pullP + oppoP ? 2 : 1;
  const table = SPRAY[bb][dir];
  const w = rng.next();
  let posR = table[table.length - 1][0];
  for (const [p, c] of table) if (w < c) { posR = p; break; }
  const mirror = (p: number) => (side === 'L' ? MIRROR[p] : p);
  let fielder = mirror(posR);

  const f = defense?.fielders[fielder];
  const range = f ? z(f.instincts) : 0, hands = f ? z(f.glove) : 0, arm = f ? z(f.cannon) : 0;
  const done = (outcome: Outcome, fld = fielder) => ({ outcome, pitches: n, battedBall: bb, quality: q, fielder: fld });

  // Home run: only fly balls and line drives, driven hard by contact quality.
  if (bb === BattedBall.Fly || bb === BattedBall.Line) {
    const hrL = (bb === BattedBall.Fly ? P.hrFB : P.hrLD) + P.hrSlope * q;
    if (rng.next() < sigmoid(hrL)) return done(Outcome.HomeRun);
  }

  // Hit or out. Range turns hits into outs; a shallow fly to an infielder is nearly always caught.
  let hitL: number;
  if (bb === BattedBall.Ground) hitL = P.hitGB + P.hitSlopeGB * q + s.hitSpeedGB * spd - 0.22 * range - 0.08 * hands;
  else if (bb === BattedBall.Line) hitL = P.hitLD + P.hitSlopeLD * q - 0.12 * range;
  else if (bb === BattedBall.Fly) hitL = P.hitFB + P.hitSlopeFB * q - 0.25 * range - (fielder <= 6 ? 1.5 : 0);
  else hitL = P.hitPU;
  if (t) hitL += bb === BattedBall.Ground ? (t.hitGB ?? 0) : bb === BattedBall.Popup ? 0 : (t.hitAir ?? 0);

  if (rng.next() >= sigmoid(hitL)) {
    if (defense && rng.next() < sigmoid(ERROR_BASE[bb] - 0.40 * hands)) return done(Outcome.ReachedOnError);
    return done(
      bb === BattedBall.Ground ? Outcome.GroundOut
        : bb === BattedBall.Line ? Outcome.LineOut
        : bb === BattedBall.Fly ? Outcome.FlyOut
        : Outcome.PopOut,
    );
  }
  if (bb === BattedBall.Popup) return done(Outcome.Single);

  // Ground-ball hits: an infield hit, or through to the outfielder behind that zone.
  if (bb === BattedBall.Ground) {
    if (posR <= 6 && rng.next() < sigmoid(-1.27 + 0.5 * spd - 0.3 * arm)) return done(Outcome.Single);
    fielder = mirror(THROUGH[posR]);
  } else if (fielder <= 6) {
    return done(Outcome.Single); // blooper over an infielder
  }
  const of = defense?.fielders[fielder];
  const ofRange = of ? z(of.instincts) : 0, ofArm = of ? z(of.cannon) : 0;
  const xbhL = (bb === BattedBall.Ground ? P.xbhGB : bb === BattedBall.Line ? P.xbhLD : P.xbhFB) +
    P.xbhSlope * q + s.xbhSpeed * spd - 0.15 * ofRange - 0.10 * ofArm + (t?.xbh ?? 0);
  if (rng.next() >= sigmoid(xbhL)) return done(Outcome.Single, fielder);
  return done(rng.next() < sigmoid(P.triple + s.tripleSpeed * spd) ? Outcome.Triple : Outcome.Double, fielder);
}
