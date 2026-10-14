/**
 * Parameters for the pitch-by-pitch at-bat model.
 *
 * Two kinds of numbers live here:
 *  - BASES (log-odds): where the league average sits. The calibrator tunes a handful of
 *    these automatically so league output hits the targets. These are the future
 *    "sim sliders" and the levers the Gods' decree pulls.
 *  - SENSITIVITIES: how hard each rating pushes, in log-odds per 10 rating points (1 SD).
 *    These decide star separation and are set by judgment, then checked on leaderboards.
 */
import { logit } from '../math';

/** Indexed [balls][strikes]. */
export type CountTable = number[][];

export interface AtBatParams {
  // ---- pitch location ----
  zone: number;           // P(pitch in strike zone), neutral count, 50 control
  heart: number;          // P(middle of the zone | in zone) — the "mistake" pitch
  zoneCount: CountTable;  // pitchers attack when behind, expand when ahead
  // ---- swing decision ----
  swingHeart: number;
  swingEdge: number;
  swingChase: number;
  swingZoneCount: CountTable;   // count shifts for in-zone swings
  swingChaseCount: CountTable;  // count shifts for chase swings
  // ---- contact ----
  contactHeart: number;
  contactEdge: number;
  contactChase: number;
  contactTwoStrike: number;     // protect mode: shorter swing, more contact
  // ---- foul vs fair ----
  foul: number;
  foulEdge: number;
  foulChase: number;
  foulTwoStrike: number;
  // ---- hit by pitch (per out-of-zone pitch taken) ----
  hbp: number;
  // ---- batted ball: quality (continuous, sd 1) ----
  qualityHeart: number;
  qualityEdge: number;
  qualityChase: number;
  qualityCount: CountTable;     // hitter's counts produce harder contact
  qualityTwoStrike: number;
  // ---- batted ball: launch type logits relative to ground ball ----
  typeLD: number;
  typeFB: number;
  typePU: number;
  typePUChase: number;          // chasing produces pop-ups and topped balls
  typeQualityLD: number;        // harder contact → more line drives
  typeQualityFB: number;
  // ---- outcomes ----
  hrFB: number; hrLD: number; hrSlope: number;
  hitGB: number; hitLD: number; hitFB: number; hitPU: number;
  hitSlopeGB: number; hitSlopeLD: number; hitSlopeFB: number;
  xbhGB: number; xbhLD: number; xbhFB: number; xbhSlope: number;
  triple: number;
  // ---- rating sensitivities (log-odds per 1 SD = 10 rating points) ----
  s: {
    zoneControl: number;      // command: throws strikes
    heartControl: number;     // command: avoids the middle (negative = fewer mistakes)
    chaseDiscipline: number;  // eye: lays off balls (negative)
    chaseMovement: number;    // deception: induces chases
    edgeDiscipline: number;   // eye: recognizes borderline strikes
    contactContact: number;   // bat-to-ball skill
    contactStuff: number;     // velocity+movement: misses bats (negative)
    foulContact: number;      // spoiling tough pitches
    hbpControl: number;
    qualityPower: number;
    qualityContact: number;
    qualityMovement: number;  // negative
    qualityVelocity: number;  // negative
    typeFBPower: number;      // power hitters lift the ball
    typeFBMovement: number;   // sinkers/breakers keep it on the ground (negative)
    typeLDContact: number;
    typePUContact: number;    // negative
    hitSpeedGB: number;       // infield hits
    xbhSpeed: number;
    tripleSpeed: number;
    platoon: number;          // applied to contact and quality, + with the platoon edge
  };
}

const L = logit;
const table = (rows: number[][]): CountTable => rows;

export const DEFAULT_PARAMS: AtBatParams = {
  zone: L(0.50),
  heart: L(0.48),
  //           s=0    s=1    s=2
  zoneCount: table([
    [ 0.10,  0.00, -0.70],  // b=0
    [ 0.15,  0.05, -0.45],  // b=1
    [ 0.30,  0.25, -0.15],  // b=2
    [ 0.80,  0.55,  0.25],  // b=3
  ]),
  swingHeart: L(0.74),
  swingEdge: L(0.60),
  swingChase: L(0.28),
  swingZoneCount: table([
    [-0.55,  0.00,  1.20],
    [-0.05,  0.10,  1.25],
    [ 0.05,  0.20,  1.30],
    [-2.30,  0.25,  1.45],  // 3-0: take; 3-2: protect the plate
  ]),
  swingChaseCount: table([
    [-0.55,  0.05,  0.75],
    [-0.20,  0.05,  0.75],
    [-0.35,  0.00,  0.80],
    [-2.50, -0.30,  0.90],
  ]),
  contactHeart: L(0.90),
  contactEdge: L(0.82),
  contactChase: L(0.57),
  contactTwoStrike: 0.20,
  foul: L(0.42),
  foulEdge: 0.25,
  foulChase: 0.45,
  foulTwoStrike: 0.20,
  hbp: L(0.008),
  qualityHeart: 0.35,
  qualityEdge: -0.05,
  qualityChase: -0.55,
  qualityCount: table([
    [ 0.00, -0.05, -0.15],
    [ 0.10,  0.00, -0.10],
    [ 0.20,  0.10, -0.05],
    [ 0.30,  0.20,  0.00],
  ]),
  qualityTwoStrike: -0.15,
  typeLD: Math.log(0.21 / 0.43),
  typeFB: Math.log(0.32 / 0.43),
  typePU: Math.log(0.045 / 0.43),
  typePUChase: 0.70,
  typeQualityLD: 0.20,
  typeQualityFB: 0.15,
  hrFB: L(0.12), hrLD: L(0.015), hrSlope: 1.35,
  hitGB: L(0.24), hitLD: L(0.68), hitFB: L(0.13), hitPU: L(0.02),
  hitSlopeGB: 0.45, hitSlopeLD: 0.45, hitSlopeFB: 0.55,
  xbhGB: L(0.06), xbhLD: L(0.27), xbhFB: L(0.55), xbhSlope: 0.40,
  triple: L(0.08),
  s: {
    zoneControl: 0.14,
    heartControl: -0.30,
    chaseDiscipline: -0.36,
    chaseMovement: 0.12,
    edgeDiscipline: 0.08,
    contactContact: 0.62,
    contactStuff: -0.45,
    foulContact: 0.10,
    hbpControl: -0.25,
    qualityPower: 0.18,
    qualityContact: 0.04,
    qualityMovement: -0.13,
    qualityVelocity: -0.06,
    typeFBPower: 0.10,
    typeFBMovement: -0.12,
    typeLDContact: 0.06,
    typePUContact: -0.10,
    hitSpeedGB: 0.14,
    xbhSpeed: 0.10,
    tripleSpeed: 0.45,
    platoon: 0.07,
  },
};

/** Deep copy so the calibrator can tweak without mutating the defaults. */
export function cloneParams(p: AtBatParams): AtBatParams {
  return JSON.parse(JSON.stringify(p)) as AtBatParams;
}
