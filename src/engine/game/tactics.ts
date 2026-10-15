/**
 * Manager calls and defensive alignments, as bounded shifts in the at-bat's own log-odds units (design rule 2:
 * physics first, then layered effects with a source). A call lasts one plate appearance; an alignment stays until
 * changed. Nothing here rolls dice: with no calls and normal depth every shift is 0, so the game plays exactly as before.
 * `npm run tactics` measures what each one does.
 */
import type { Tactic } from '../atbat/atbat';
import type { Alignment, BatCall, PitchCall } from './types';

export const NORMAL_ALIGN: Alignment = { infield: 'normal', outfield: 'normal' };

/** Batting calls. */
export const BAT_TACTIC: Record<BatCall, Tactic> = {
  // Tie the Game Now!: swing for the fences. More homers, more whiffs, fewer singles.
  power: { swingZone: 0.3, swingChase: 0.35, contact: -0.7, quality: 0.26, typeFB: 0.4, typePU: 0.25 },
  // Move the Runner!: shorten up and put it on the ground or on a line. Few strikeouts, little power.
  move: { contact: 0.5, quality: -1.0, typeFB: -0.8, typePU: -0.3 },
  // Draw the Walk!: sit on pitches. More walks, more called strikeouts, fewer balls in play.
  walk: { swingZone: -0.95, swingChase: -0.7 },
  // Hit and Run!: the runner goes, the batter protects him. Contact up, power down, swing at more.
  hitrun: { swingZone: 0.5, swingChase: 0.6, contact: 0.15, quality: -0.15, typeFB: -0.3 },
};

/** Pitching calls (the intentional walk skips the at-bat entirely). */
export const PITCH_TACTIC: Record<Exclude<PitchCall, 'ibb'>, Tactic> = {
  // Go for the strikeout: expand the zone, bury the put-away pitch.
  k: { zone: -0.25, heart: -0.4, contact: -0.3, quality: 0.05 },
  // Induce a grounder: work down.
  gb: { typeFB: -0.5, typeLD: -0.25, typePU: -0.3, quality: -0.1 },
  // Induce a fly ball: work up.
  fb: { typeFB: 0.5, typePU: 0.4, typeLD: -0.1, quality: 0.05 },
  // Dot the Corners: nothing over the heart. Less contact, softer contact, more walks.
  corners: { heart: -0.9, zone: -0.4, contact: -0.05, quality: -0.1 },
};

/** Defensive depth, applied to the fielding side. */
const INFIELD: Record<Alignment['infield'], Tactic> = {
  normal: {}, in: { hitGB: 0.4 }, dp: { hitGB: 0.05 }, lines: { hitGB: 0.06, xbh: -0.35 },
};
const OUTFIELD: Record<Alignment['outfield'], Tactic> = {
  normal: {}, deep: { hitAir: 0.08, xbh: -0.45 }, shallow: { hitAir: -0.12, xbh: 0.6 },
};

/** Game-layer effects (runners): logit shifts on double plays and on holding the runner at third. */
export const RUN_TACTIC = {
  /** Infield in: the runner on third rarely scores on a ground out. */
  infieldInHold: -2.2,
  /** Double-play depth. */
  dpDepth: 0.6,
  /** Move the Runner! and Hit and Run!: no double play, and every runner moves up on a ground out. */
  noDoublePlay: -2.5,
  /** Hit and Run!: the runner from first takes third on a single. */
  hitRunFirstToThird: 0.9,
};

/** Sum the shifts for one plate appearance. Undefined when nothing was called, so the at-bat is untouched. */
export function tacticFor(bat: BatCall | null, pitch: PitchCall | null, align: Alignment): Tactic | undefined {
  const parts: Tactic[] = [];
  if (bat) parts.push(BAT_TACTIC[bat]);
  if (pitch && pitch !== 'ibb') parts.push(PITCH_TACTIC[pitch]);
  if (align.infield !== 'normal') parts.push(INFIELD[align.infield]);
  if (align.outfield !== 'normal') parts.push(OUTFIELD[align.outfield]);
  if (!parts.length) return undefined;
  const t: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) t[k] = (t[k] ?? 0) + (v as number);
  return t as Tactic;
}
