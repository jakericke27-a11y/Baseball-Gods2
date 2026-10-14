/**
 * League environment: a few league-wide dials, each an additive log-odds shift.
 * The calibrator sets these so a neutral year hits the targets; sim sliders and
 * (later) the Gods' decree move them. Ratings are untouched by these dials.
 */
import baseline from '../../../calibration/baseline.json';
import { cloneParams, type AtBatParams } from './params';

export interface LeagueEnvironment {
  zone: number;    // strike-throwing → walks
  contact: number; // bat-to-ball → swinging strikes
  protect: number; // two-strike contact → strikeouts
  foul: number;    // spoiled pitches → pitches per PA
  hr: number;      // fly balls leaving the park
  hit: number;     // balls in play finding holes → batting average
  xbh: number;     // hits going for extra bases → doubles
  triple: number;  // extra-base hits stretching to three
  hbp: number;     // hit batsmen
  /** Star power: scales every rating's effect. 1 = default, <1 compresses the league, >1 lets stars dominate. */
  spread: number;
}

export const NEUTRAL_ENVIRONMENT: LeagueEnvironment = {
  zone: 0, contact: 0, protect: 0, foul: 0, hr: 0, hit: 0, xbh: 0, triple: 0, hbp: 0, spread: 1,
};

/** The calibrated 2019-like league every new league is born with (calibration/baseline.json). */
export const BASELINE_ENVIRONMENT: LeagueEnvironment = { ...NEUTRAL_ENVIRONMENT, ...(baseline as Partial<LeagueEnvironment>) };

export type Dial = keyof LeagueEnvironment;
export const DIALS = Object.keys(NEUTRAL_ENVIRONMENT) as Dial[];

/** Add shifts to an environment. Log-odds dials add; spread (a multiplier) adds too, as a change in star power. */
export function shiftEnvironment(env: LeagueEnvironment, by: Partial<LeagueEnvironment>, scale = 1): LeagueEnvironment {
  const out = { ...env };
  for (const k of DIALS) if (by[k]) out[k] += scale * by[k]!;
  return out;
}

export function applyEnvironment(base: AtBatParams, env: LeagueEnvironment): AtBatParams {
  const p = cloneParams(base);
  p.zone += env.zone;
  p.contactHeart += env.contact;
  p.contactEdge += env.contact;
  p.contactChase += env.contact;
  p.contactTwoStrike += env.protect;
  p.foul += env.foul;
  p.hrFB += env.hr;
  p.hrLD += env.hr;
  p.hitGB += env.hit;
  p.hitLD += env.hit;
  p.hitFB += env.hit;
  p.xbhGB += env.xbh;
  p.xbhLD += env.xbh;
  p.xbhFB += env.xbh;
  p.triple += env.triple;
  p.hbp += env.hbp;
  const k = env.spread ?? 1;
  for (const key of Object.keys(p.s) as Array<keyof typeof p.s>) p.s[key] *= k;
  return p;
}
