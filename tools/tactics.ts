/**
 * What each manager call and alignment does. Two reads:
 *   1. At the plate: an average hitter against an average pitcher, 60,000 plate appearances per call.
 *   2. In games: a full season where one team makes that call in the situations it's meant for, every game, against
 *      the same season with no calls. Runs scored per game (batting calls) or allowed (pitching calls, alignments).
 *   npm run tactics [seasons]
 */
import { MAX_PITCHES, simulateAtBat, type Tactic } from '../src/engine/atbat/atbat';
import { BASELINE_ENVIRONMENT, applyEnvironment } from '../src/engine/atbat/environment';
import { BattedBall, Outcome, isAtBat, isHit, isStrikeout } from '../src/engine/atbat/codes';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { BAT_TACTIC, PITCH_TACTIC, tacticFor, NORMAL_ALIGN } from '../src/engine/game/tactics';
import type { GameCall, GameMove } from '../src/engine/game/types';
import { generateLeague } from '../src/engine/generate';
import { createRng } from '../src/engine/rng';
import { createSeason, isOver, liveStep, simDay, startLiveDay } from '../src/engine/season/season';
import type { Player, Ratings } from '../src/engine/types';

const P = applyEnvironment(DEFAULT_PARAMS, BASELINE_ENVIRONMENT);
const avg: Ratings = { power: 50, contact: 50, discipline: 50, speed: 50, velocity: 50, control: 50, movement: 50, stamina: 50, instincts: 50, glove: 50, cannon: 50, clutchRisp: 50, clutchPressure: 50 };
const mk = (hand: 'L' | 'R', pitcher: boolean): Player => ({ id: 1, name: 'x', age: 27, regionId: 1, bats: hand, throws: hand, position: pitcher ? 'P' : 'DH', ratings: avg });

function plate(t: Tactic | undefined, n = 60_000) {
  const rng = createRng(11), scratch = new Uint8Array(MAX_PITCHES + 4);
  let PA = 0, AB = 0, H = 0, HR = 0, BB = 0, K = 0, TB = 0, GB = 0, BIP = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateAtBat(mk(i % 2 ? 'L' : 'R', false), mk(i % 4 < 2 ? 'L' : 'R', true), { fatigue: 0, ...(t ? { tactic: t } : {}) }, P, rng, scratch);
    const o = r.outcome;
    PA++; if (isAtBat(o)) AB++; if (isHit(o)) H++; if (isStrikeout(o)) K++; if (o === Outcome.Walk) BB++; if (o === Outcome.HomeRun) HR++;
    TB += o === Outcome.Single ? 1 : o === Outcome.Double ? 2 : o === Outcome.Triple ? 3 : o === Outcome.HomeRun ? 4 : 0;
    if (r.battedBall !== BattedBall.None) { BIP++; if (r.battedBall === BattedBall.Ground) GB++; }
  }
  return { K: K / PA, BB: BB / PA, AVG: H / AB, SLG: TB / AB, HR600: 600 * HR / PA, GB: GB / BIP };
}

type Policy = { name: string; side: 'bat' | 'field'; move: (c: GameCall, side: number) => GameMove | null };
const on1 = (c: GameCall) => !!c.bases[0], risp = (c: GameCall) => !!(c.bases[1] || c.bases[2]);
const POLICIES: Policy[] = [
  { name: 'Tie the Game Now! (always)', side: 'bat', move: (c, s) => ({ kind: 'call', side: s, bat: 'power' }) },
  { name: 'Move the Runner! (runner on, <2 outs)', side: 'bat', move: (c, s) => ((on1(c) || c.bases[1]) && c.outs < 2 ? { kind: 'call', side: s, bat: 'move' } : null) },
  { name: 'Draw the Walk! (always)', side: 'bat', move: (c, s) => ({ kind: 'call', side: s, bat: 'walk' }) },
  { name: 'Hit and Run! (on first, <2 outs)', side: 'bat', move: (c, s) => (on1(c) && !c.bases[1] && c.outs < 2 ? { kind: 'call', side: s, bat: 'hitrun' } : null) },
  { name: 'Strikeout (always)', side: 'field', move: (c, s) => ({ kind: 'call', side: s, pitch: 'k' }) },
  { name: 'Grounder (on first, <2 outs)', side: 'field', move: (c, s) => (on1(c) && c.outs < 2 ? { kind: 'call', side: s, pitch: 'gb' } : null) },
  { name: 'Fly ball (always)', side: 'field', move: (c, s) => ({ kind: 'call', side: s, pitch: 'fb' }) },
  { name: 'Dot the Corners (always)', side: 'field', move: (c, s) => ({ kind: 'call', side: s, pitch: 'corners' }) },
  { name: 'Intentional walk (RISP, first open)', side: 'field', move: (c, s) => (risp(c) && !c.bases[0] ? { kind: 'call', side: s, pitch: 'ibb' } : null) },
  { name: 'Infield in (runner on third, <2 outs)', side: 'field', move: (c, s) => ({ kind: 'align', side: s, infield: c.bases[2] && c.outs < 2 ? 'in' : 'normal' }) },
  { name: 'Double-play depth (on first, <2 outs)', side: 'field', move: (c, s) => ({ kind: 'align', side: s, infield: on1(c) && c.outs < 2 ? 'dp' : 'normal' }) },
  { name: 'Guard the lines (always)', side: 'field', move: (c, s) => ({ kind: 'align', side: s, infield: 'lines' }) },
  { name: 'Outfield deep (always)', side: 'field', move: (c, s) => ({ kind: 'align', side: s, outfield: 'deep' }) },
  { name: 'Outfield shallow (always)', side: 'field', move: (c, s) => ({ kind: 'align', side: s, outfield: 'shallow' }) },
];

/** A season where `team` plays every game live under the policy (null: no calls). Its runs per game, for and against. */
function season(seed: number, team: number, pol: Policy | null): { rf: number; ra: number } {
  const s = createSeason(generateLeague(seed), P, { year: 1, seed, rosterRules: true, userTeam: team });
  let rf = 0, ra = 0, g = 0;
  while (!isOver(s)) {
    const day = startLiveDay(s, team);
    if (!day) { simDay(s); continue; }
    const me = day.setups[0].teamId === team ? 0 : 1;
    let res = null;
    while (day.call) {
      const c = day.call, batting = c.half === me;
      const m = pol && ((pol.side === 'bat') === batting) ? pol.move(c, me) : null;
      // a move makes the game wait again at the same spot; then play on
      res = liveStep(day, m ? [m] : []) ?? res;
      if (m && day.call) res = liveStep(day) ?? res;
    }
    if (res) { rf += res.score[me]; ra += res.score[1 - me]; g++; }
  }
  return { rf: rf / g, ra: ra / g };
}

const pct = (x: number) => (100 * x).toFixed(1).padStart(5);
const f3 = (x: number) => x.toFixed(3).replace(/^0/, '');
console.log('AT THE PLATE (average vs average)        K%    BB%   AVG  SLG   HR/600  GB%');
const line = (name: string, r: ReturnType<typeof plate>) => console.log(`${name.padEnd(38)} ${pct(r.K)} ${pct(r.BB)}  ${f3(r.AVG)} ${f3(r.SLG)} ${r.HR600.toFixed(1).padStart(6)} ${pct(r.GB)}`);
line('nothing called', plate(undefined));
for (const [k, t] of Object.entries(BAT_TACTIC)) line(`bat: ${k}`, plate(t));
for (const [k, t] of Object.entries(PITCH_TACTIC)) line(`pitch: ${k}`, plate(t));
for (const inf of ['in', 'dp', 'lines'] as const) line(`infield ${inf}`, plate(tacticFor(null, null, { ...NORMAL_ALIGN, infield: inf })));
for (const of of ['deep', 'shallow'] as const) line(`outfield ${of}`, plate(tacticFor(null, null, { ...NORMAL_ALIGN, outfield: of })));

const N = Number(process.argv[2] ?? 2);
const runs = (pol: Policy | null) => {
  let rf = 0, ra = 0;
  for (let i = 0; i < N; i++) for (const team of [3, 17]) { const r = season(301 + i * 13, team, pol); rf += r.rf; ra += r.ra; }
  return { rf: rf / (2 * N), ra: ra / (2 * N) };
};
console.log(`\nIN GAMES (${N} season(s) x 2 teams; runs per game, your side)`);
const base = runs(null);
console.log(`${'no calls'.padEnd(40)} scored ${base.rf.toFixed(2)}  allowed ${base.ra.toFixed(2)}`);
for (const pol of POLICIES) {
  const r = runs(pol);
  const d = pol.side === 'bat' ? r.rf - base.rf : r.ra - base.ra;
  console.log(`${pol.name.padEnd(40)} ${pol.side === 'bat' ? 'scored ' + r.rf.toFixed(2) : 'allowed ' + r.ra.toFixed(2)}  (${d >= 0 ? '+' : ''}${d.toFixed(2)})`);
}
