/**
 * One full game, pitch by pitch.
 *
 * The at-bat engine decides what happens at the plate (and which fielder gets the ball);
 * this layer owns everything around it: base/out state, baserunning, steals, pitching
 * changes, decisions, box score, clutch moments, and the event log.
 */
import { simulateAtBat, MAX_PITCHES, type Defense } from '../atbat/atbat';
import { Loc, Outcome, pitchLocOf, pitchResultOf } from '../atbat/codes';
import type { AtBatParams } from '../atbat/params';
import { ByteLog } from '../log';
import { logit, sigmoid, z } from '../math';
import type { Rng } from '../rng';
import type { Player } from '../types';
import {
  Ev, Moment, Play, newBatLine, newPitchLine,
  type BatLine, type BullpenArm, type BullpenRole, type GameMoment, type GameResult, type PitchLine, type TeamGameSetup,
} from './types';

interface Runner { id: number; pid: number; earned: boolean; spd: number }
interface PitcherState {
  p: Player; pitches: number; outs: number; budget: number; starter: boolean; role: BullpenRole | 'SP';
  /** Outs this pitcher is expected to cover (relievers: set by role and stamina). */
  planned: number;
  oppRunsAtEntry: number;
}

/** League tendencies for the running game (tuned to 2019: ~0.64 attempts/team-game, ~73% success). */
const RUN = {
  stealAttempt: logit(0.045), stealSuccess: logit(0.66), wildPitch: logit(0.016),
  sendFromSecondOnSingle: logit(0.62), firstToThirdOnSingle: logit(0.27), scoreFromFirstOnDouble: logit(0.42),
  safeAtHome: logit(0.93), safeAtThird: logit(0.95),
  doublePlay: logit(0.42), fieldersChoice: 0.35, scoreOnGroundout: logit(0.45),
  tagFromThird: logit(0.88), tagFromSecond: logit(0.25), doubledOffOnLiner: 0.03,
  triplePlay: logit(0.005), linerTriplePlay: 0.006,
};
/** Relievers can enter at or below this fatigue (season loop: +25 per appearance + 80 × pitches/budget, −25/day). */
export const RELIEVER_MAX_FATIGUE = 20;
/** Pitch budget = base + stamina, shrunk by pre-game fatigue. Deeper than modern MLB on purpose. */
const BUDGET_BASE = 60;

/** How many outs a reliever is expected to cover: 30 stamina ≈ 1 inning, 45 ≈ 2, 60 ≈ 3. */
function plannedOuts(role: BullpenRole | 'SP', stamina: number, blowout: boolean): number {
  if (role === 'SP') return 99;
  const byStamina = Math.max(3, Math.min(9, 3 * Math.round((stamina - 15) / 15)));
  if (role === 'LR') return blowout ? 9 : Math.max(6, byStamina);
  if (role === 'CL') return Math.min(6, byStamina);
  if (role === 'SU') return stamina >= 35 ? Math.max(6, byStamina) : byStamina; // 7th and 8th
  return blowout ? Math.max(6, byStamina) : byStamina; // middle relief soaks up lopsided games
}
const CLUTCH_PER_SD = 0.10;

export function simulateGame(
  away: TeamGameSetup, home: TeamGameSetup, P: AtBatParams, rng: Rng, opts: { log: boolean } = { log: false },
): GameResult {
  const teams = [away, home];
  const score: [number, number] = [0, 0];
  const lineScore: [number[], number[]] = [[], []];
  const hits: [number, number] = [0, 0], errors: [number, number] = [0, 0], lob: [number, number] = [0, 0];
  const outsRecorded: [number, number] = [0, 0];
  const order = [0, 0];
  const batting = new Map<number, BatLine>(), pitching = new Map<number, PitchLine>();
  const bl = (id: number) => { let l = batting.get(id); if (!l) batting.set(id, (l = newBatLine())); return l; };
  const pl = (id: number) => { let l = pitching.get(id); if (!l) pitching.set(id, (l = newPitchLine())); return l; };
  for (const t of teams) for (const s of t.lineup) bl(s.player.id);
  const log = opts.log ? new ByteLog(16_384) : null;
  const scratch = new Uint8Array(MAX_PITCHES + 4);
  const pitchResults = [0, 0, 0, 0, 0, 0];
  const moments: GameMoment[] = [];
  const used = [new Set<number>(), new Set<number>()];
  const pitchersUsed: [number[], number[]] = [[], []];
  const budgets = new Map<number, number>();
  const enteredLead = new Map<number, number>();
  const potW = [0, 0], potL = [0, 0];

  const defense: Defense[] = teams.map((t) => {
    const fielders: Defense['fielders'] = new Array(10);
    for (const s of t.lineup) if (s.pos >= 2) fielders[s.pos] = s.player.ratings;
    return { fielders };
  });

  const enter = (side: number, p: Player, starter: boolean, role: BullpenRole | 'SP'): PitcherState => {
    used[side].add(p.id); pitchersUsed[side].push(p.id);
    const line = pl(p.id); line.G = 1; if (starter) line.GS = 1;
    const budget = BUDGET_BASE + p.ratings.stamina * (1 - Math.min(100, teams[side].fatigue(p.id)) / 100);
    budgets.set(p.id, budget);
    enteredLead.set(p.id, score[side] - score[1 - side]);
    defense[side].fielders[1] = p.ratings;
    const blowout = Math.abs(score[side] - score[1 - side]) >= 5;
    return { p, pitches: 0, outs: 0, budget, starter, role, planned: plannedOuts(role, p.ratings.stamina, blowout), oppRunsAtEntry: score[1 - side] };
  };
  const cur: PitcherState[] = [enter(0, away.starter, true, 'SP'), enter(1, home.starter, true, 'SP')];

  let inning = 1, walkoff = false;

  const closerReady = (fld: number) => teams[fld].bullpen.some((a) =>
    a.role === 'CL' && !used[fld].has(a.player.id) && teams[fld].fatigue(a.player.id) <= RELIEVER_MAX_FATIGUE);

  /** Old-school bullpen: starter, then a finisher (or setup + closer); long man when the starter is knocked out early. */
  const chooseReliever = (fld: number, lead: number): BullpenArm | null => {
    const team = teams[fld];
    const fresh = team.bullpen.filter((a) => !used[fld].has(a.player.id));
    if (!fresh.length) return null;
    const rested = fresh.filter((a) => team.fatigue(a.player.id) <= RELIEVER_MAX_FATIGUE);
    const pool = rested.length ? rested : fresh;
    const pick = (role: BullpenRole) =>
      pool.filter((a) => a.role === role).sort((x, y) => team.fatigue(x.player.id) - team.fatigue(y.player.id))[0];
    const save = lead >= 1 && lead <= 3, close = lead >= -1 && lead <= 3;
    if (inning >= 9 && (save || (lead === 0 && (fld === 1 || inning >= 10)))) return pick('CL') ?? pick('SU') ?? pick('MR') ?? pick('LR') ?? pool[0];
    if (inning === 8 && close) {
      const cl = pick('CL');
      if (cl && save && cl.player.ratings.stamina >= 45) return cl; // six-out save
      return pick('SU') ?? pick('MR') ?? pick('LR') ?? pool[0];
    }
    if (inning >= 6 && close) return pick('SU') ?? pick('LR') ?? pick('MR') ?? pool[0];
    if (inning <= 5) return pick('LR') ?? pick('MR') ?? pick('SU') ?? pool[0];
    return pick('MR') ?? pick('LR') ?? pick('SU') ?? pool[0];
  };

  const maybeChangePitcher = (fld: number, atInningStart: boolean, runnersOn: number) => {
    const ps = cur[fld];
    const lead = score[fld] - score[1 - fld];
    const save = lead >= 1 && lead <= 3, close = lead >= -1 && lead <= 3;
    let pull: boolean;
    if (ps.starter) {
      const charged = pl(ps.p.id).R;
      pull = ps.pitches >= ps.budget || charged >= 6 || (inning <= 4 && charged >= 5) ||
        (ps.pitches >= 0.9 * ps.budget && runnersOn >= 2) ||
        (atInningStart && inning >= 9 && save && ps.pitches >= 0.8 * ps.budget) ||
        (atInningStart && inning === 8 && close && ps.pitches >= 0.85 * ps.budget);
    } else {
      const blowout = Math.abs(lead) >= 5; // nobody burns the bullpen in a lopsided game
      pull = ps.pitches >= ps.budget || (!blowout && score[1 - fld] - ps.oppRunsAtEntry >= 3) ||
        (atInningStart && ps.outs >= ps.planned) ||
        (atInningStart && inning >= 9 && ps.role !== 'CL' && (save || (lead === 0 && fld === 1)) && closerReady(fld));
    }
    if (!pull) return;
    const next = chooseReliever(fld, lead);
    if (!next) return; // bullpen empty: he stays in and wears it
    if (log) { log.u8(Ev.PitchingChange); log.u8(inning | (fld === 1 ? 0 : 0x80)); log.u8(fld); log.u16(next.player.id); log.u16(ps.p.id); }
    cur[fld] = enter(fld, next.player, false, next.role);
  };

  const clutchShift = (b: Player, p: Player, risp: boolean, lateClose: boolean): number => {
    const br = b.ratings, pr = p.ratings;
    if (risp && lateClose) {
      return 1.5 * CLUTCH_PER_SD * ((z(br.clutchRisp) + z(br.clutchPressure)) / 2 - (z(pr.clutchRisp) + z(pr.clutchPressure)) / 2);
    }
    if (risp) return CLUTCH_PER_SD * (z(br.clutchRisp) - z(pr.clutchRisp));
    if (lateClose) return 0.75 * CLUTCH_PER_SD * (z(br.clutchPressure) - z(pr.clutchPressure));
    return 0;
  };

  const halfInning = (bat: number) => {
    const fld = 1 - bat;
    const ih = inning | (bat << 7);
    let outs = 0;
    const bases: Array<Runner | null> = [null, null, null];
    lineScore[bat].push(0);
    const firstPitcher = cur[fld].p.id;
    let halfPitches = 0, halfKs = 0, onePitcher = true;
    let first = true;

    while (outs < 3 && !walkoff) {
      maybeChangePitcher(fld, first, (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0));
      first = false;
      if (cur[fld].p.id !== firstPitcher) onePitcher = false;
      const ps = cur[fld];
      const PL = pl(ps.p.id);

      // ---- Steal attempt before the pitch (2nd with 2nd open, or 3rd with 3rd open) ----
      const from = bases[0] && !bases[1] ? 0 : bases[1] && !bases[2] ? 1 : -1;
      if (from >= 0) {
        const rn = bases[from]!;
        const c = defense[fld].fielders[2];
        const cArm = c ? z(c.cannon) : 0;
        let aL = RUN.stealAttempt + 0.75 * rn.spd - 0.25 * cArm - 0.15 * z(ps.p.ratings.control);
        if (from === 1) aL -= 1.6;
        if (Math.abs(score[bat] - score[fld]) >= 5) aL -= 1.2;
        if (rng.next() < sigmoid(aL)) {
          const safe = rng.next() < sigmoid(RUN.stealSuccess + 0.55 * rn.spd - 0.45 * cArm - (from === 1 ? 0.2 : 0));
          bases[from] = null;
          if (safe) { bases[from + 1] = rn; bl(rn.id).SB++; }
          else { bl(rn.id).CS++; outs++; ps.outs++; PL.outs++; outsRecorded[fld]++; }
          if (log) { log.u8(Ev.Steal); log.u8(ih); log.u16(rn.id); log.u8((from + 2) | ((safe ? 1 : 0) << 2)); } // base attempted: 2nd/3rd
          if (outs >= 3) break;
        }
      }

      // ---- The plate appearance ----
      const slot = teams[bat].lineup[order[bat] % 9];
      const batter = slot.player;
      const diffBefore = score[bat] - score[fld];
      const risp = bases[1] !== null || bases[2] !== null;
      const lateClose = inning >= 7 && Math.abs(diffBefore) <= 1;
      const fatigue = Math.max(0, (ps.pitches / ps.budget - 0.65) / 0.35);
      const r = simulateAtBat(batter, ps.p, { fatigue, clutch: clutchShift(batter, ps.p, risp, lateClose), defense: defense[fld] }, P, rng, scratch);
      ps.pitches += r.pitches; halfPitches += r.pitches;
      let chase = 0;
      for (let i = 0; i < r.pitches; i++) { pitchResults[pitchResultOf(scratch[i])]++; if (pitchLocOf(scratch[i]) === Loc.Chase) chase++; }

      // ---- Wild pitch / passed ball during the at-bat: every runner moves up a base ----
      if ((bases[0] || bases[1] || bases[2]) && chase > 0) {
        const c = defense[fld].fielders[2];
        const pWP = sigmoid(RUN.wildPitch - 0.25 * z(ps.p.ratings.control) - 0.20 * (c ? z(c.glove) : 0));
        if (rng.next() < 1 - Math.pow(1 - pWP, chase)) {
          const ids: number[] = [];
          if (bases[2]) {
            const rn = bases[2]; ids.push(rn.id, 3, 4);
            score[bat]++; lineScore[bat][inning - 1]++; bl(rn.id).R++;
            const rp = pl(rn.pid); rp.R++; if (rn.earned) rp.ER++;
            if (score[bat] === score[fld] + 1) { potW[bat] = cur[bat].p.id; potL[fld] = rn.pid; }
            if (bat === 1 && inning >= 9 && score[1] > score[0]) walkoff = true;
          }
          if (bases[1]) ids.push(bases[1].id, 2, 3);
          if (bases[0]) ids.push(bases[0].id, 1, 2);
          bases[2] = bases[1]; bases[1] = bases[0]; bases[0] = null;
          if (log) {
            log.u8(Ev.WildPitch); log.u8(ih); log.u8(ids.length / 3);
            for (let k = 0; k < ids.length; k += 3) { log.u16(ids[k]); log.u8(ids[k + 1] | (ids[k + 2] << 2)); }
          }
          if (walkoff) { moments.push({ kind: Moment.WalkOff, playerId: ps.p.id, inning, value: 1 }); break; }
        }
      }

      const outsBefore = outs;
      const basesBefore = (bases[0] ? 1 : 0) | (bases[1] ? 2 : 0) | (bases[2] ? 4 : 0);
      const B = bl(batter.id);
      B.PA++; B.P += r.pitches; PL.BF++; PL.P += r.pitches;
      const br: Runner = { id: batter.id, pid: ps.p.id, earned: true, spd: z(batter.ratings.speed) };
      const moves: number[] = [];
      const mv = (rn: Runner, fromBase: number, to: number) => { moves.push(rn.id, fromBase, to); };
      let rbi = 0, runs = 0;
      const isHR = r.outcome === Outcome.HomeRun;
      const scoreRun = (rn: Runner, credit: boolean, earned = rn.earned): boolean => {
        if (walkoff && !isHR) return false; // game already over: later runners don't count
        score[bat]++; lineScore[bat][inning - 1]++; runs++;
        bl(rn.id).R++;
        const rp = pl(rn.pid); rp.R++; if (earned) rp.ER++;
        if (credit) rbi++;
        if (score[bat] === score[fld] + 1) { potW[bat] = cur[bat].p.id; potL[fld] = rn.pid; }
        if (bat === 1 && inning >= 9 && score[1] > score[0]) walkoff = true;
        return true;
      };
      const out = (k = 1) => { outs += k; ps.outs += k; PL.outs += k; outsRecorded[fld] += k; };

      const r1 = bases[0], r2 = bases[1], r3 = bases[2];
      const fpos = r.fielder;
      const fr = fpos ? defense[fld].fielders[fpos] : undefined;
      const fArm = fr ? z(fr.cannon) : 0, fGlove = fr ? z(fr.glove) : 0;
      let play: Play;

      switch (r.outcome) {
        case Outcome.StrikeoutSwinging:
        case Outcome.StrikeoutLooking:
          play = r.outcome === Outcome.StrikeoutSwinging ? Play.StrikeoutSwinging : Play.StrikeoutLooking;
          B.AB++; B.K++; PL.K++; out(); halfKs++;
          break;

        case Outcome.Walk:
        case Outcome.HitByPitch:
          play = r.outcome === Outcome.Walk ? Play.Walk : Play.HitByPitch;
          if (play === Play.Walk) { B.BB++; PL.BB++; } else { B.HBP++; PL.HBP++; }
          if (r1) {
            if (r2) {
              if (r3 && scoreRun(r3, true)) mv(r3, 3, 4);
              bases[2] = r2; mv(r2, 2, 3);
            }
            bases[1] = r1; mv(r1, 1, 2);
          }
          bases[0] = br; mv(br, 0, 1);
          break;

        case Outcome.ReachedOnError:
          play = Play.ReachedOnError; B.AB++; B.ROE++; errors[fld]++;
          br.earned = false;
          if (r3 && scoreRun(r3, false, false)) mv(r3, 3, 4);
          bases[2] = r2; if (r2) mv(r2, 2, 3);
          bases[1] = r1; if (r1) mv(r1, 1, 2);
          bases[0] = br; mv(br, 0, 1);
          break;

        case Outcome.Single: {
          play = Play.Single; B.AB++; B.H++; PL.H++; hits[bat]++;
          const outfield = fpos >= 7;
          bases[0] = bases[1] = bases[2] = null;
          if (r3 && scoreRun(r3, true)) mv(r3, 3, 4);
          if (r2) {
            const send = RUN.sendFromSecondOnSingle + 0.55 * r2.spd - 0.35 * fArm + (outsBefore === 2 ? 1.0 : 0) + (fpos === 7 ? -0.2 : 0);
            if (outfield && rng.next() < sigmoid(send)) {
              if (rng.next() < sigmoid(RUN.safeAtHome + 0.5 * r2.spd - 0.5 * fArm)) { if (scoreRun(r2, true)) mv(r2, 2, 4); }
              else { mv(r2, 2, 7); out(); }
            } else { bases[2] = r2; mv(r2, 2, 3); }
          }
          if (r1 && outs < 3) {
            const go = RUN.firstToThirdOnSingle + 0.55 * r1.spd - 0.4 * fArm + (outsBefore === 2 ? 0.5 : 0) +
              (fpos === 9 ? 0.5 : fpos === 8 ? 0.2 : -0.9);
            if (outfield && !bases[2] && rng.next() < sigmoid(go)) {
              if (rng.next() < sigmoid(RUN.safeAtThird + 0.5 * r1.spd - 0.5 * fArm)) { bases[2] = r1; mv(r1, 1, 3); }
              else { mv(r1, 1, 6); out(); }
            } else { bases[1] = r1; mv(r1, 1, 2); }
          }
          if (outs < 3) { bases[0] = br; mv(br, 0, 1); }
          break;
        }

        case Outcome.Double: {
          play = Play.Double; B.AB++; B.H++; B.D++; PL.H++; hits[bat]++;
          bases[0] = bases[1] = bases[2] = null;
          if (r3 && scoreRun(r3, true)) mv(r3, 3, 4);
          if (r2 && scoreRun(r2, true)) mv(r2, 2, 4);
          if (r1) {
            const send = RUN.scoreFromFirstOnDouble + 0.6 * r1.spd - 0.3 * fArm + (outsBefore === 2 ? 0.9 : 0) + 0.25 * r.quality;
            if (rng.next() < sigmoid(send)) {
              if (rng.next() < sigmoid(RUN.safeAtHome + 0.5 * r1.spd - 0.5 * fArm)) { if (scoreRun(r1, true)) mv(r1, 1, 4); }
              else { mv(r1, 1, 7); out(); }
            } else { bases[2] = r1; mv(r1, 1, 3); }
          }
          if (outs < 3) { bases[1] = br; mv(br, 0, 2); }
          break;
        }

        case Outcome.Triple:
          play = Play.Triple; B.AB++; B.H++; B.T++; PL.H++; hits[bat]++;
          if (r3 && scoreRun(r3, true)) mv(r3, 3, 4);
          if (r2 && scoreRun(r2, true)) mv(r2, 2, 4);
          if (r1 && scoreRun(r1, true)) mv(r1, 1, 4);
          bases[0] = bases[1] = null; bases[2] = br; mv(br, 0, 3);
          break;

        case Outcome.HomeRun:
          play = Play.HomeRun; B.AB++; B.H++; B.HR++; PL.H++; PL.HR++; hits[bat]++;
          if (r3 && scoreRun(r3, true)) mv(r3, 3, 4);
          if (r2 && scoreRun(r2, true)) mv(r2, 2, 4);
          if (r1 && scoreRun(r1, true)) mv(r1, 1, 4);
          scoreRun(br, true); mv(br, 0, 4);
          bases[0] = bases[1] = bases[2] = null;
          break;

        case Outcome.GroundOut:
          B.AB++; play = Play.GroundOut;
          if (outsBefore === 2) { out(); mv(br, 0, 0); break; }
          if (r1 && r2 && outsBefore === 0 && fpos >= 4 && fpos <= 6 &&
              rng.next() < sigmoid(RUN.triplePlay + 0.3 * fGlove + 0.3 * fArm - 0.4 * br.spd)) {
            play = Play.TriplePlay; B.GIDP++;
            bases[0] = bases[1] = null;
            mv(r2, 2, 6); mv(r1, 1, 5); mv(br, 0, 0); out(3);
            break;
          }
          if (r1) {
            const dp = RUN.doublePlay - 0.35 * br.spd + 0.25 * fGlove + 0.15 * fArm - 0.15 * r1.spd;
            if (rng.next() < sigmoid(dp)) {
              play = Play.DoublePlay; B.GIDP++;
              bases[0] = null; mv(r1, 1, 5); mv(br, 0, 0); out(2);
              if (outs < 3) {
                if (r3) { bases[2] = null; if (scoreRun(r3, false)) mv(r3, 3, 4); }
                if (r2) { bases[1] = null; bases[2] = r2; mv(r2, 2, 3); }
              }
            } else if (rng.next() < RUN.fieldersChoice) {
              play = Play.FieldersChoice;
              mv(r1, 1, 5); out();
              bases[0] = br; mv(br, 0, 1); bases[1] = null;
              if (outs < 3) {
                if (r3 && (r2 || rng.next() < 0.4)) { bases[2] = null; if (scoreRun(r3, true)) mv(r3, 3, 4); }
                if (r2) { bases[2] = r2; mv(r2, 2, 3); }
              }
            } else {
              out(); mv(br, 0, 0);
              if (outs < 3) {
                bases[0] = null;
                if (r3) { bases[2] = null; if (scoreRun(r3, true)) mv(r3, 3, 4); }
                if (r2) { bases[2] = r2; bases[1] = null; mv(r2, 2, 3); }
                bases[1] = r1; mv(r1, 1, 2);
              }
            }
          } else {
            out(); mv(br, 0, 0);
            if (outs < 3) {
              if (r3 && rng.next() < sigmoid(RUN.scoreOnGroundout + 0.4 * r3.spd)) {
                bases[2] = null; if (scoreRun(r3, true)) mv(r3, 3, 4);
              }
              if (r2 && !bases[2] && rng.next() < (fpos === 3 || fpos === 4 ? 0.6 : 0.22)) {
                bases[1] = null; bases[2] = r2; mv(r2, 2, 3);
              }
            }
          }
          break;

        case Outcome.FlyOut: {
          play = Play.FlyOut; out(); mv(br, 0, 0);
          let sac = false;
          if (fpos >= 7 && outs < 3) {
            if (r3 && rng.next() < sigmoid(RUN.tagFromThird + 0.5 * r3.spd - 0.35 * fArm + 0.5 * r.quality)) {
              bases[2] = null;
              if (rng.next() < sigmoid(RUN.safeAtHome + 0.5 * r3.spd - 0.5 * fArm)) { if (scoreRun(r3, true)) { mv(r3, 3, 4); sac = true; } }
              else { mv(r3, 3, 7); out(); }
            }
            const tag = RUN.tagFromSecond + 0.45 * (r2?.spd ?? 0) + 0.4 * r.quality + (fpos === 9 ? 0.5 : fpos === 8 ? 0.2 : -0.4);
            if (r2 && !bases[2] && outs < 3 && rng.next() < sigmoid(tag)) { bases[1] = null; bases[2] = r2; mv(r2, 2, 3); }
          }
          if (sac) { play = Play.SacFly; B.SF++; } else B.AB++;
          break;
        }

        case Outcome.LineOut:
          play = Play.LineOut; B.AB++; out(); mv(br, 0, 0);
          if (outsBefore === 0 && r1 && r2 && fpos <= 6 && rng.next() < RUN.linerTriplePlay) {
            bases[0] = bases[1] = null; mv(r2, 2, 0); mv(r1, 1, 0); out(2); play = Play.TriplePlay;
          } else if (outs < 3 && (r1 || r2 || r3) && rng.next() < RUN.doubledOffOnLiner) {
            const lead = r3 ? 2 : r2 ? 1 : 0;
            const rn = bases[lead]!;
            bases[lead] = null; mv(rn, lead + 1, 0); out(); play = Play.DoublePlay;
          }
          break;

        default:
          play = Play.PopOut; B.AB++; out(); mv(br, 0, 0);
      }
      B.RBI += rbi;

      if (log) {
        log.u8(Ev.PlateAppearance); log.u8(ih); log.u8(outsBefore | (basesBefore << 2));
        log.u16(batter.id); log.u16(ps.p.id);
        log.u8(play); log.u8(r.fielder | (r.battedBall << 4));
        log.i8(Number.isNaN(r.quality) ? -128 : r.quality * 20);
        log.u8(runs | (rbi << 3));
        log.u8(r.pitches); log.bytes(scratch, r.pitches);
        log.u8(moves.length / 3);
        for (let i = 0; i < moves.length; i += 3) { log.u16(moves[i]); log.u8(moves[i + 1] | (moves[i + 2] << 2)); }
      }

      // ---- Clutch / notable moments ----
      const tag = (kind: Moment, value = 0) => moments.push({ kind, playerId: batter.id, inning, value });
      if (play === Play.HomeRun && runs === 4) tag(Moment.GrandSlam);
      if (play === Play.TriplePlay) tag(Moment.TriplePlay);
      if (play === Play.HomeRun && inning >= 7 && diffBefore <= 0 && score[bat] > score[fld]) tag(Moment.GoAheadLateHomer);
      if (play >= Play.Single && play <= Play.Triple && risp && lateClose && rbi > 0) tag(Moment.ClutchHit, rbi);
      if (r.pitches >= 10) tag(Moment.LongAtBat, r.pitches);
      if (play === Play.HomeRun && B.HR === 3) tag(Moment.ThreeHomers);
      if (B.K === 4 && (play === Play.StrikeoutSwinging || play === Play.StrikeoutLooking)) tag(Moment.GoldenSombrero);
      if (play >= Play.Single && play <= Play.HomeRun && B.D > 0 && B.T > 0 && B.HR > 0 && B.H - B.D - B.T - B.HR > 0 &&
          !moments.some((m) => m.kind === Moment.Cycle && m.playerId === batter.id)) tag(Moment.Cycle);
      if (walkoff) tag(Moment.WalkOff, runs);

      order[bat]++;
    }
    if (onePitcher && halfKs === 3 && halfPitches === 9 && outs === 3) {
      moments.push({ kind: Moment.ImmaculateInning, playerId: firstPitcher, inning, value: 9 });
    }
    lob[bat] += (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
  };

  for (;;) {
    halfInning(0);
    if (inning >= 9 && score[1] > score[0]) break; // home team doesn't need its half
    halfInning(1);
    if (walkoff) break;
    if (inning >= 9 && score[0] !== score[1]) break;
    if (++inning > 40) break; // safety valve; never reached in practice
  }

  // ---- Decisions ----
  const winner = score[1] > score[0] ? 1 : 0, loser = 1 - winner;
  let win = potW[winner];
  const starter = pitchersUsed[winner][0];
  if (win === starter && pl(starter).outs < 15) {
    let best = 0, bestOuts = -1;
    for (const id of pitchersUsed[winner].slice(1)) { const o = pl(id).outs; if (o > bestOuts) { best = id; bestOuts = o; } }
    if (best) win = best;
  }
  const loss = potL[loser];
  const finisher = pitchersUsed[winner][pitchersUsed[winner].length - 1];
  let save = 0;
  if (finisher !== win) {
    const lead0 = enteredLead.get(finisher) ?? 0, o = pl(finisher).outs;
    if (lead0 > 0 && ((lead0 <= 3 && o >= 3) || o >= 9)) save = finisher;
  }
  if (win) pl(win).W = 1;
  if (loss) pl(loss).L = 1;
  if (save) pl(save).SV = 1;

  // ---- Pitching gems ----
  for (const side of [0, 1]) {
    const opp = 1 - side;
    if (outsRecorded[side] < 27) continue;
    const sp = pitchersUsed[side][0];
    const solo = pitchersUsed[side].length === 1;
    if (hits[opp] === 0) {
      let reached = errors[side];
      for (const s of teams[opp].lineup) { const l = bl(s.player.id); reached += l.BB + l.HBP; }
      moments.push({ kind: reached === 0 ? Moment.PerfectGame : Moment.NoHitter, playerId: solo ? sp : 0, inning, value: 0 });
    }
    if (solo && score[opp] === 0) moments.push({ kind: Moment.ShutoutCG, playerId: sp, inning, value: 0 });
  }

  return {
    day: -1, start: 0,
    teamIds: [away.teamId, home.teamId], score, innings: inning, lineScore, hits, errors, lob, outsRecorded,
    batting, pitching, lineups: [away.lineup, home.lineup], pitchersUsed,
    decisions: { win, loss, save }, budgets, pitchResults, moments, log: log ? log.toBytes() : null,
  };
}
