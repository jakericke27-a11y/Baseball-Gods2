/**
 * Turns a finished game's event log into frames you can step through: a batter stepping in, each
 * pitch, the play, steals, wild pitches and pitching changes. The game is already decided; watching
 * it is a faithful replay, pitch for pitch.
 */
import { playTone } from './stats';
import { Loc, PitchResult, pitchLocOf, pitchResultOf } from '../engine/atbat/codes';
import {
  applyMoves, countBefore, decodeEvents, eventText, halfLabel, outsOnPlay, type PaEvent, type PitchDetail, type WildPitchEvent,
} from '../engine/game/text';
import { Play, type GameCall, type GameResult } from '../engine/game/types';

export type FrameKind = 'start' | 'up' | 'pitch' | 'result' | 'event' | 'final';
export type Tone = 'plain' | 'good' | 'bad' | 'big';

export interface Frame {
  kind: FrameKind;
  inning: number; half: 0 | 1; outs: number; bases: number;
  score: [number, number]; line: [number[], number[]]; hits: [number, number]; errors: [number, number];
  batter: number; pitcher: number; pitcherPitches: number;
  ab: number[]; count: [number, number];
  call: string; tone: Tone;
  /** How many log lines are visible at this frame. */
  log: number;
  /** The batter's line in this game before this trip ("1-for-3"). */
  today: string;
  stinger?: 'homer' | 'walkoff';
}

export interface LogLine {
  key: number; inning: number; half: 0 | 1; text: string; runs: number; score: [number, number]; kind: 'pa' | 'steal' | 'wp' | 'change';
  /** CSS tone for the play (stats.ts playTone). */ tone?: string;
  /** Plate appearances: the pitch bytes, batter and pitcher, for looking back at the at-bat. */
  ab?: { pitches: number[]; batter: number; pitcher: number };
}

export interface Replay { result: GameResult; frames: Frame[]; log: LogLine[] }

export const PITCH_WORD = ['Ball', 'Called strike', 'Swinging strike', 'Foul', 'In play', 'Hit by pitch'];
export const LOC_WORD = ['Middle', 'Corner', 'Off the plate'];

const isHit = (p: Play) => p >= Play.Single && p <= Play.HomeRun;
const isAtBat = (p: Play) => p !== Play.Walk && p !== Play.HitByPitch && p !== Play.SacFly;

/**
 * `live`: the game is still being played; the frames end with the next batter stepping in (the decision point the
 * game is waiting at) instead of the final.
 */
export function buildReplay(
  r: GameResult, name: (id: number) => string, teamLabel: (id: number) => string, detail: PitchDetail, userTeam = 0, live?: GameCall,
): Replay {
  const events = decodeEvents(r.log!);
  const frames: Frame[] = [];
  const log: LogLine[] = [];
  const st = {
    inning: 1, half: 0 as 0 | 1, key: -1, outs: 0, bases: 0,
    score: [0, 0] as [number, number], line: [[], []] as [number[], number[]], hits: [0, 0] as [number, number], errors: [0, 0] as [number, number],
  };
  // pitcherOf[half] = who is pitching to the team batting in that half.
  const pitcherOf: [number, number] = [r.pitchersUsed[1][0], r.pitchersUsed[0][0]];
  const pitches = new Map<number, number>();
  const today = new Map<number, { ab: number; h: number; bb: number; pa: number }>();
  const userBats = (half: number) => (userTeam ? r.teamIds[half] === userTeam : null);
  const firstPa = events.find((e): e is PaEvent => e.type === 'pa');
  let batter = firstPa?.batter ?? live?.batter ?? 0;

  const todayText = (id: number) => {
    const t = today.get(id);
    if (!t || t.pa === 0) return 'First trip to the plate';
    return `${t.h}-for-${t.ab} today` + (t.bb ? `, ${t.bb} BB` : '');
  };
  const snap = (kind: FrameKind, call: string, tone: Tone, extra: Partial<Frame> = {}) => {
    const p = pitcherOf[st.half];
    frames.push({
      kind, inning: st.inning, half: st.half, outs: st.outs, bases: st.bases,
      score: [st.score[0], st.score[1]], line: [st.line[0].slice(), st.line[1].slice()], hits: [st.hits[0], st.hits[1]], errors: [st.errors[0], st.errors[1]],
      batter, pitcher: p, pitcherPitches: pitches.get(p) ?? 0, ab: [], count: [0, 0], call, tone, log: log.length,
      today: todayText(batter), ...extra,
    });
  };
  const addLog = (kind: LogLine['kind'], text: string, runs: number, tone = '', ab?: LogLine['ab']) =>
    log.push({ key: st.key, inning: st.inning, half: st.half, text, runs, score: [st.score[0], st.score[1]], kind, tone, ...(ab ? { ab } : {}) });
  const score = (runs: number) => {
    st.score[st.half] += runs;
    st.line[st.half][st.inning - 1] += runs;
  };
  const toneFor = (goodForBatting: boolean): Tone => {
    const u = userBats(st.half);
    if (u === null) return 'plain';
    return goodForBatting === u ? 'good' : 'bad';
  };
  const applyWp = (wp: WildPitchEvent) => {
    st.bases = applyMoves(st.bases, wp.moves);
    const runs = wp.moves.filter((m) => m.to === 4).length;
    score(runs);
    addLog('wp', eventText(wp, name, detail), runs);
    snap('event', eventText(wp, name, 'final'), toneFor(true));
  };

  snap('start', 'Play ball!', 'plain', { line: [[0], []] });
  let pendingWp: WildPitchEvent | null = null;
  let newHalf = false;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const key = ev.inning * 2 + ev.half;
    if (key !== st.key) {
      st.key = key; st.inning = ev.inning; st.half = ev.half; st.outs = 0; st.bases = 0;
      while (st.line[ev.half].length < ev.inning) st.line[ev.half].push(0);
      newHalf = true;
    }
    if (ev.type === 'change') {
      pitcherOf[ev.half] = ev.incoming;
      addLog('change', eventText(ev, name, detail), 0);
      snap('event', eventText(ev, name, 'final'), 'plain');
      continue;
    }
    if (ev.type === 'sub') {
      addLog('change', eventText(ev, name, detail), 0);
      snap('event', eventText(ev, name, 'final'), 'plain');
      continue;
    }
    if (ev.type === 'steal') {
      st.bases &= ~(1 << (ev.base - 2));
      if (ev.safe) st.bases |= 1 << (ev.base - 1); else st.outs++;
      addLog('steal', eventText(ev, name, detail), 0, ev.safe ? 't-on' : 't-out');
      snap('event', eventText(ev, name, 'final'), toneFor(ev.safe));
      continue;
    }
    if (ev.type === 'wp') {
      const next = events[i + 1];
      if (next && next.type === 'pa' && next.inning === ev.inning && next.half === ev.half) { pendingWp = ev; continue; }
      applyWp(ev);
      continue;
    }

    // ---- A plate appearance.
    const pa = ev;
    batter = pa.batter;
    pitcherOf[pa.half] = pa.pitcher;
    st.outs = pa.outsBefore;
    st.bases = pendingWp ? pendingWp.moves.reduce((b, m) => b | (1 << (m.from - 1)), 0) : pa.basesBefore;
    snap('up', (newHalf ? `${halfLabel(st.inning, st.half)}. ` : '') + `Now batting: ${name(pa.batter)}`, 'plain');
    newHalf = false;

    let wpAfter = -1;
    if (pendingWp) {
      for (let j = 0; j < pa.pitches.length - 1; j++) if (pitchLocOf(pa.pitches[j]) === Loc.Chase) { wpAfter = j; break; }
      if (wpAfter < 0) { applyWp(pendingWp); pendingWp = null; }
    }
    const n = pa.pitches.length;
    for (let j = 0; j < n; j++) {
      const byte = pa.pitches[j];
      pitches.set(pa.pitcher, (pitches.get(pa.pitcher) ?? 0) + 1);
      const ab = Array.from(pa.pitches.subarray(0, j + 1));
      if (j < n - 1) {
        const res = pitchResultOf(byte);
        const tone: Tone = res === PitchResult.Ball ? toneFor(true) : res === PitchResult.Foul ? 'plain' : toneFor(false);
        snap('pitch', PITCH_WORD[res], tone, { ab, count: countBefore(pa.pitches, j + 1) });
        if (j === wpAfter && pendingWp) { applyWp(pendingWp); pendingWp = null; }
        continue;
      }
      // The final pitch: the play happens.
      const t = today.get(pa.batter) ?? { ab: 0, h: 0, bb: 0, pa: 0 };
      const countAtPitch = countBefore(pa.pitches, n - 1);
      st.outs += outsOnPlay(pa);
      st.bases = applyMoves(st.bases, pa.moves);
      score(pa.runs);
      if (isHit(pa.play)) st.hits[pa.half]++;
      if (pa.play === Play.ReachedOnError) st.errors[1 - pa.half]++;
      const text = eventText(pa, name, 'final');
      addLog('pa', eventText(pa, name, detail), pa.runs, playTone(pa.play), { pitches: [...pa.pitches], batter: pa.batter, pitcher: pa.pitcher });
      const lastEvent = i === events.length - 1;
      const walkoff = lastEvent && pa.half === 1 && st.score[1] > st.score[0];
      const tone: Tone = pa.play === Play.HomeRun || walkoff ? 'big' : toneFor(isHit(pa.play) || pa.runs > 0 || pa.play === Play.Walk || pa.play === Play.HitByPitch);
      snap('result', text + (st.outs >= 3 && !lastEvent ? ' Side retired.' : ''), tone, {
        ab, count: countAtPitch, stinger: walkoff ? 'walkoff' : pa.play === Play.HomeRun ? 'homer' : undefined,
      });
      t.pa++;
      if (isAtBat(pa.play)) t.ab++;
      if (isHit(pa.play)) t.h++;
      if (pa.play === Play.Walk || pa.play === Play.HitByPitch) t.bb++;
      today.set(pa.batter, t);
    }
  }

  if (live) {
    const key = live.inning * 2 + live.half;
    if (key !== st.key) {
      st.key = key; st.inning = live.inning; st.half = live.half; st.outs = 0; st.bases = 0;
      while (st.line[live.half].length < live.inning) st.line[live.half].push(0);
      newHalf = true;
    }
    batter = live.batter;
    pitcherOf[live.half] = live.pitchers[1 - live.half].id;
    st.outs = live.outs;
    st.bases = (live.bases[0] ? 1 : 0) | (live.bases[1] ? 2 : 0) | (live.bases[2] ? 4 : 0);
    snap('up', (newHalf ? `${halfLabel(st.inning, st.half)}. ` : '') + `Now batting: ${name(batter)}`, 'plain');
    return { result: r, frames, log };
  }
  const extra = r.innings > 9 ? ` in ${r.innings}` : '';
  snap('final', `Final${extra}: ${teamLabel(r.teamIds[0])} ${st.score[0]}, ${teamLabel(r.teamIds[1])} ${st.score[1]}`, 'big');
  return { result: r, frames, log };
}

/** Navigation targets. */
export function nextAtBat(rp: Replay, at: number): number {
  for (let j = at + 1; j < rp.frames.length; j++) if (rp.frames[j].kind === 'result' || rp.frames[j].kind === 'final') return j;
  return rp.frames.length - 1;
}
export function nextInning(rp: Replay, at: number): number {
  const key = (f: Frame) => f.inning * 2 + f.half;
  const endOfHalf = (from: number) => {
    let j = from;
    while (j + 1 < rp.frames.length && rp.frames[j + 1].kind !== 'final' && key(rp.frames[j + 1]) === key(rp.frames[from])) j++;
    return j;
  };
  const end = endOfHalf(at);
  if (end !== at) return end;
  if (at + 1 >= rp.frames.length) return at;
  return rp.frames[at + 1].kind === 'final' ? at + 1 : endOfHalf(at + 1);
}

export const isInPlay = (byte: number) => pitchResultOf(byte) === PitchResult.InPlay;
