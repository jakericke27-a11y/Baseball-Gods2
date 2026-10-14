/**
 * Small integer codes so the full pitch-by-pitch log stays compact.
 * One pitch = one byte: bits 0–2 result, bits 3–4 location, bits 5–7 reserved
 * (reserved for pitch type once the engine models fastballs/breakers/offspeed).
 */
export const enum PitchResult {
  Ball = 0,
  CalledStrike = 1,
  SwingingStrike = 2,
  Foul = 3,
  InPlay = 4,
  HitByPitch = 5,
}

export const enum Loc {
  Heart = 0,  // middle of the zone
  Edge = 1,   // in the zone, on the corners
  Chase = 2,  // out of the zone
}

export const enum Outcome {
  StrikeoutSwinging = 0,
  StrikeoutLooking = 1,
  Walk = 2,
  HitByPitch = 3,
  Single = 4,
  Double = 5,
  Triple = 6,
  HomeRun = 7,
  GroundOut = 8,
  FlyOut = 9,
  LineOut = 10,
  PopOut = 11,
  ReachedOnError = 12,
}

export const enum BattedBall {
  None = 0,
  Ground = 1,
  Line = 2,
  Fly = 3,
  Popup = 4,
}

export const encodePitch = (result: PitchResult, loc: Loc): number => result | (loc << 3);
export const pitchResultOf = (byte: number): PitchResult => (byte & 7) as PitchResult;
export const pitchLocOf = (byte: number): Loc => ((byte >> 3) & 3) as Loc;

export const isHit = (o: Outcome): boolean => o >= Outcome.Single && o <= Outcome.HomeRun;
export const isStrikeout = (o: Outcome): boolean => o === Outcome.StrikeoutSwinging || o === Outcome.StrikeoutLooking;
/** Counts as an official at-bat (walks and HBP don't; sac flies are handled in the game layer). */
export const isAtBat = (o: Outcome): boolean => o !== Outcome.Walk && o !== Outcome.HitByPitch;
