/**
 * Human-readable output, derived on demand from the event log.
 * `decodeEvents` turns the bytes into structured events (used by the game screen's replay and the
 * game log); `eventText` writes one line for an event; `playByPlay` and `boxScore` are terminal reports.
 */
import { Loc, PitchResult, pitchLocOf, pitchResultOf } from '../atbat/codes';
import { Ev, Play, type GameResult } from './types';

const TO_SPOT = ['', 'the pitcher', 'the catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
const ROLE = ['', 'pitcher', 'catcher', 'first baseman', 'second baseman', 'third baseman', 'shortstop',
  'left fielder', 'center fielder', 'right fielder'];
/** Position abbreviations by scoring number (0 = DH). */
export const POS_ABBR = ['DH', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const BASE = ['', 'first', 'second', 'third', 'home'];
export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/**
 * A runner's trip on a play. `to`: 1–3 = reached that base, 4 = scored,
 * 5/6/7 = thrown out at second/third/home, 0 = batter out (from 0) or doubled off (from 1–3).
 */
export interface Move { runner: number; from: number; to: number }

export interface PaEvent {
  type: 'pa'; inning: number; half: 0 | 1;
  outsBefore: number; basesBefore: number; // bases: bit 1 = first, 2 = second, 4 = third
  batter: number; pitcher: number; play: Play; fielder: number; bbType: number; quality: number;
  runs: number; rbi: number; pitches: Uint8Array; moves: Move[];
}
export interface StealEvent { type: 'steal'; inning: number; half: 0 | 1; runner: number; base: 2 | 3; safe: boolean }
export interface WildPitchEvent { type: 'wp'; inning: number; half: 0 | 1; moves: Move[] }
export interface ChangeEvent { type: 'change'; inning: number; half: 0 | 1; side: 0 | 1; incoming: number; outgoing: number }
export type GameEvent = PaEvent | StealEvent | WildPitchEvent | ChangeEvent;

/** Outs a play made: the strikeout itself plus every move that ends in an out. */
export function outsOnPlay(ev: PaEvent): number {
  const k = ev.play === Play.StrikeoutSwinging || ev.play === Play.StrikeoutLooking ? 1 : 0;
  return k + ev.moves.filter((m) => m.to === 0 || m.to >= 5).length;
}

/** Apply runner moves to a bases bitmask. */
export function applyMoves(bases: number, moves: Move[]): number {
  let b = bases;
  for (const m of moves) {
    if (m.from >= 1) b &= ~(1 << (m.from - 1));
    if (m.to >= 1 && m.to <= 3) b |= 1 << (m.to - 1);
  }
  return b;
}

export function decodeEvents(log: Uint8Array): GameEvent[] {
  const out: GameEvent[] = [];
  const view = new DataView(log.buffer, log.byteOffset, log.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const readMoves = (at: number, k: number): Move[] => {
    const moves: Move[] = [];
    for (let m = 0; m < k; m++) {
      const ft = log[at + 3 * m + 2];
      moves.push({ runner: u16(at + 3 * m), from: ft & 3, to: ft >> 2 });
    }
    return moves;
  };
  let i = 0;
  while (i < log.length) {
    const ev = log[i++];
    const ih = log[i++];
    const inning = ih & 0x7f, half = (ih >> 7) as 0 | 1;
    if (ev === Ev.PitchingChange) {
      const side = log[i++] as 0 | 1;
      out.push({ type: 'change', inning, half, side, incoming: u16(i), outgoing: u16(i + 2) });
      i += 4;
    } else if (ev === Ev.WildPitch) {
      const k = log[i++];
      out.push({ type: 'wp', inning, half, moves: readMoves(i, k) });
      i += 3 * k;
    } else if (ev === Ev.Steal) {
      const runner = u16(i); i += 2;
      const b = log[i++];
      out.push({ type: 'steal', inning, half, runner, base: (b & 3) as 2 | 3, safe: (b >> 2) === 1 });
    } else {
      const ob = log[i++];
      const batter = u16(i), pitcher = u16(i + 2); i += 4;
      const play = log[i++] as Play;
      const fb = log[i++];
      const qByte = view.getInt8(i++);
      const rr = log[i++];
      const n = log[i++];
      const pitches = log.slice(i, i + n); i += n;
      const k = log[i++];
      const moves = readMoves(i, k); i += 3 * k;
      out.push({
        type: 'pa', inning, half, outsBefore: ob & 3, basesBefore: (ob >> 2) & 7, batter, pitcher, play,
        fielder: fb & 15, bbType: fb >> 4, quality: qByte === -128 ? NaN : qByte / 20,
        runs: rr & 7, rbi: rr >> 3, pitches, moves,
      });
    }
  }
  return out;
}

function describe(play: Play, f: number, bbType: number, b: string): string {
  switch (play) {
    case Play.StrikeoutSwinging: return `${b} strikes out swinging`;
    case Play.StrikeoutLooking: return `${b} strikes out looking`;
    case Play.Walk: return `${b} walks`;
    case Play.HitByPitch: return `${b} is hit by a pitch`;
    case Play.Single:
      if (f >= 7) return `${b} singles to ${TO_SPOT[f]}`;
      if (bbType === 1) return `${b} beats out an infield single to ${TO_SPOT[f]}`;
      if (bbType === 2) return `${b} lines a single to ${['', 'center', 'center', 'right', 'right', 'left', 'left'][f]}`;
      return `${b} bloops a single over ${TO_SPOT[f]}`;
    case Play.Double: return `${b} doubles to ${TO_SPOT[f]}`;
    case Play.Triple: return `${b} triples to ${TO_SPOT[f]}`;
    case Play.HomeRun: return `${b} homers to ${TO_SPOT[f]}`;
    case Play.GroundOut: return `${b} grounds out to ${TO_SPOT[f]}`;
    case Play.FlyOut: return `${b} flies out to ${TO_SPOT[f]}`;
    case Play.LineOut: return `${b} lines out to ${TO_SPOT[f]}`;
    case Play.PopOut: return `${b} pops out to ${TO_SPOT[f]}`;
    case Play.ReachedOnError: return `${b} reaches on an error by the ${ROLE[f]}`;
    case Play.DoublePlay: return bbType === 2 ? `${b} lines into a double play (${POS_ABBR[f]})` : `${b} grounds into a double play (${POS_ABBR[f]})`;
    case Play.FieldersChoice: return `${b} reaches on a fielder's choice (${POS_ABBR[f]})`;
    case Play.SacFly: return `${b} hits a sacrifice fly to ${TO_SPOT[f]}`;
    case Play.TriplePlay: return bbType === 2 ? `${b} lines into a TRIPLE PLAY (${POS_ABBR[f]})` : `${b} grounds into a TRIPLE PLAY (${POS_ABBR[f]})`;
    default: return `${b} ?`;
  }
}

/** Balls and strikes before pitch `upTo` (exclusive). */
export function countBefore(pitches: ArrayLike<number>, upTo: number): [number, number] {
  let b = 0, s = 0;
  for (let i = 0; i < upTo; i++) {
    const r = pitchResultOf(pitches[i]);
    if (r === PitchResult.Ball) b++;
    else if (r === PitchResult.CalledStrike || r === PitchResult.SwingingStrike || (r === PitchResult.Foul && s < 2)) s++;
  }
  return [b, s];
}

function countTrail(pitches: Uint8Array): string {
  return Array.from(pitches, (byte) => {
    const r = pitchResultOf(byte), loc = pitchLocOf(byte);
    const word = r === PitchResult.Ball ? 'B' : r === PitchResult.CalledStrike ? 'K' : r === PitchResult.SwingingStrike ? 'S'
      : r === PitchResult.Foul ? 'F' : r === PitchResult.InPlay ? 'X' : 'H';
    return word + (loc === Loc.Heart && r === PitchResult.InPlay ? '!' : '');
  }).join('');
}

/**
 * How much pitch detail each play-by-play line carries:
 *  'final' (default): homers get the count ("on a 2-2 pitch"); strikeouts and walks note long at-bats;
 *  'full': every 7+ pitch at-bat lists its whole sequence; 'none': plays only.
 */
export type PitchDetail = 'full' | 'final' | 'none';

function finalPitchNote(play: Play, pitches: Uint8Array): string {
  const n = pitches.length;
  if (play === Play.HomeRun) {
    if (n === 1) return ' on the first pitch';
    const [b, s] = countBefore(pitches, n - 1);
    return ` on a ${b}-${s} pitch`;
  }
  if (play === Play.Walk && n === 4) return ' on four pitches';
  if ((play === Play.StrikeoutSwinging || play === Play.StrikeoutLooking || play === Play.Walk) && n >= 6) return ` (${n} pitches)`;
  return n >= 8 ? ` (${n} pitches)` : '';
}

/** One line of play-by-play for an event (no indentation, no score). */
export function eventText(ev: GameEvent, name: (id: number) => string, detail: PitchDetail = 'final'): string {
  if (ev.type === 'change') return `Pitching change: ${name(ev.incoming)} replaces ${name(ev.outgoing)}.`;
  if (ev.type === 'steal') return `${name(ev.runner)} ${ev.safe ? 'steals' : 'is caught stealing'} ${BASE[ev.base]}.`;
  if (ev.type === 'wp') {
    return `Wild pitch! ${ev.moves.map((m) => (m.to === 4 ? `${name(m.runner)} scores` : `${name(m.runner)} to ${BASE[m.to]}`)).join(', ')}.`;
  }
  const notes: string[] = [];
  for (const m of ev.moves) {
    if (m.from === 0) continue; // the batter's own trip is in the play description
    if (m.to === 4) notes.push(`${name(m.runner)} scores`);
    else if (m.to >= 5) notes.push(`${name(m.runner)} out at ${BASE[m.to - 3]}`);
    else if (m.to === 0) notes.push(`${name(m.runner)} doubled off ${BASE[m.from]}`);
    else notes.push(`${name(m.runner)} to ${BASE[m.to]}`);
  }
  const what = describe(ev.play, ev.fielder, ev.bbType, name(ev.batter)) + (detail === 'final' ? finalPitchNote(ev.play, ev.pitches) : '');
  let line = what + (notes.length ? `. ${notes.join(', ')}` : '') + '.';
  if (detail === 'full' && ev.pitches.length >= 7) line += `  [${ev.pitches.length} pitches: ${countTrail(ev.pitches)}]`;
  return line;
}

export const halfLabel = (inning: number, half: number) => `${half ? 'Bottom' : 'Top'} of the ${ordinal(inning)}`;

/** Decode a game log into play-by-play lines (terminal report). */
export function playByPlay(log: Uint8Array, name: (id: number) => string, teamNames: [string, string], detail: PitchDetail = 'final'): string[] {
  const out: string[] = [];
  const score = [0, 0];
  let lastHalf = -1;
  for (const ev of decodeEvents(log)) {
    const key = ev.inning * 2 + ev.half;
    if (key !== lastHalf) {
      out.push(`\n${halfLabel(ev.inning, ev.half)} — ${teamNames[ev.half]} batting`);
      lastHalf = key;
    }
    let line = (ev.type === 'change' ? '  ⇄ ' : '  ') + eventText(ev, name, detail);
    const runs = ev.type === 'pa' ? ev.runs : ev.type === 'wp' ? ev.moves.filter((m) => m.to === 4).length : 0;
    if (runs) { score[ev.half] += runs; line += `  ${teamNames[0]} ${score[0]}, ${teamNames[1]} ${score[1]}`; }
    out.push(line);
  }
  return out;
}

/** Newspaper-style box score. */
export function boxScore(g: GameResult, name: (id: number) => string, teamName: (id: number) => string): string {
  const [aName, hName] = [teamName(g.teamIds[0]), teamName(g.teamIds[1])];
  const L: string[] = [];
  const w = Math.max(aName.length, hName.length) + 2;
  const innings = Math.max(g.lineScore[0].length, 9);
  const cell = (v: number | string) => String(v).padStart(3);
  L.push(`FINAL${g.innings > 9 ? ` (${g.innings})` : ''}: ${aName} ${g.score[0]}, ${hName} ${g.score[1]}`);
  L.push(''.padEnd(w) + Array.from({ length: innings }, (_, k) => cell(k + 1)).join('') + '    R  H  E');
  for (const side of [0, 1]) {
    const ls = g.lineScore[side];
    const row = Array.from({ length: innings }, (_, k) => (k < ls.length ? cell(ls[k]) : cell(side === 1 && k === ls.length ? 'x' : '')));
    L.push((side ? hName : aName).padEnd(w) + row.join('') + ' ' + cell(g.score[side]) + cell(g.hits[side]) + cell(g.errors[side]));
  }
  for (const side of [0, 1]) {
    L.push('', `${(side ? hName : aName).padEnd(24)}  AB  R  H RBI BB  K`);
    const extras: Record<string, string[]> = { '2B': [], '3B': [], HR: [], SB: [] };
    for (const slot of g.lineups[side]) {
      const b = g.batting.get(slot.player.id)!;
      L.push(`  ${(name(slot.player.id) + ' ' + POS_ABBR[slot.pos]).padEnd(22)} ${[b.AB, b.R, b.H, b.RBI, b.BB, b.K].map((v) => String(v).padStart(3)).join('')}`);
      if (b.D) extras['2B'].push(name(slot.player.id) + (b.D > 1 ? ` ${b.D}` : ''));
      if (b.T) extras['3B'].push(name(slot.player.id) + (b.T > 1 ? ` ${b.T}` : ''));
      if (b.HR) extras.HR.push(name(slot.player.id) + (b.HR > 1 ? ` ${b.HR}` : ''));
      if (b.SB) extras.SB.push(name(slot.player.id) + (b.SB > 1 ? ` ${b.SB}` : ''));
    }
    for (const [k, v] of Object.entries(extras)) if (v.length) L.push(`  ${k}: ${v.join(', ')}`);
  }
  for (const side of [0, 1]) {
    L.push('', `${((side ? hName : aName) + ' pitching').padEnd(24)}   IP  H  R ER BB  K HR   P`);
    for (const id of g.pitchersUsed[side]) {
      const p = g.pitching.get(id)!;
      const dec = g.decisions.win === id ? ' (W)' : g.decisions.loss === id ? ' (L)' : g.decisions.save === id ? ' (S)' : '';
      const ip = `${Math.floor(p.outs / 3)}.${p.outs % 3}`;
      L.push(`  ${(name(id) + dec).padEnd(22)} ${ip.padStart(4)}${[p.H, p.R, p.ER, p.BB, p.K, p.HR].map((v) => String(v).padStart(3)).join('')}${String(p.P).padStart(4)}`);
    }
  }
  return L.join('\n');
}
