/**
 * Season splits for the back of a Baseball Card, read from the season's pitch logs: platoon, home and road,
 * base and out situations, late and close, and month by month. Regular season only.
 * Batters get their own line; pitchers get what hitters did against them.
 */
import { decodeEvents } from '../engine/game/text';
import { Play } from '../engine/game/types';
import { dateOf } from './calendar';
import type { Game } from './state';

export type SplitGroup = 'platoon' | 'venue' | 'situation' | 'outs' | 'month';
export interface SplitLine {
  key: string; label: string; group: SplitGroup | 'all';
  PA: number; AB: number; H: number; D: number; T: number; HR: number; BB: number; HBP: number; K: number; SF: number;
}
const blank = (key: string, label: string, group: SplitLine['group']): SplitLine =>
  ({ key, label, group, PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, BB: 0, HBP: 0, K: 0, SF: 0 });

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function add(l: SplitLine, play: Play): void {
  l.PA++;
  if (play === Play.Walk) { l.BB++; return; }
  if (play === Play.HitByPitch) { l.HBP++; return; }
  if (play === Play.SacFly) { l.SF++; return; }
  l.AB++;
  if (play === Play.StrikeoutSwinging || play === Play.StrikeoutLooking) l.K++;
  if (play >= Play.Single && play <= Play.HomeRun) {
    l.H++;
    if (play === Play.Double) l.D++; else if (play === Play.Triple) l.T++; else if (play === Play.HomeRun) l.HR++;
  }
}

const cache = new Map<string, SplitLine[]>();

/** Every split for one player this season, in display order. Cached until the season moves on. */
export function splitsFor(g: Game, id: number): SplitLine[] {
  const key = `${g.year}:${g.season.results.length}:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pitcher = g.players.get(id)?.position === 'P';
  const lines = new Map<string, SplitLine>();
  const line = (k: string, label: string, group: SplitLine['group']) => { let l = lines.get(k); if (!l) lines.set(k, (l = blank(k, label, group))); return l; };
  // fixed order first, so the table reads the same every time
  line('all', 'Season', 'all');
  for (const [k, l] of pitcher ? [['vsL', 'vs LHB'], ['vsR', 'vs RHB']] : [['vsL', 'vs LHP'], ['vsR', 'vs RHP']]) line(k, l, 'platoon');
  line('home', 'Home', 'venue'); line('away', 'Road', 'venue');
  line('empty', 'Bases empty', 'situation'); line('on', 'Runners on', 'situation'); line('risp', 'RISP', 'situation'); line('loaded', 'Bases loaded', 'situation'); line('late', 'Late & close', 'situation');
  line('o0', 'No outs', 'outs'); line('o1', 'One out', 'outs'); line('o2', 'Two outs', 'outs');

  for (const r of g.season.results) {
    if (r.kind === 'post' || !r.log) continue;
    if (!(pitcher ? r.pitching.has(id) : r.batting.has(id))) continue;
    const month = dateOf(r.day).month;
    const score = [0, 0];
    for (const ev of decodeEvents(r.log)) {
      if (ev.type === 'wp') { /* runs on wild pitches */ for (const m of ev.moves) if (m.to === 4) score[ev.half]++; continue; }
      if (ev.type !== 'pa') continue;
      const mine = pitcher ? ev.pitcher === id : ev.batter === id;
      if (mine) {
        const other = g.players.get(pitcher ? ev.batter : ev.pitcher);
        const sideHand = pitcher
          ? (other?.bats === 'S' ? (g.players.get(id)!.throws === 'R' ? 'L' : 'R') : other?.bats)
          : other?.throws;
        const homeSide = pitcher ? 1 - ev.half : ev.half; // the player's team: home bats in the bottom half
        const late = ev.inning >= 7 && Math.abs(score[0] - score[1]) <= 1;
        const keys = ['all', sideHand === 'L' ? 'vsL' : 'vsR', homeSide === 1 ? 'home' : 'away',
          ev.basesBefore === 0 ? 'empty' : 'on', ...(ev.basesBefore & 6 ? ['risp'] : []), ...(ev.basesBefore === 7 ? ['loaded'] : []),
          ...(late ? ['late'] : []), `o${ev.outsBefore}`];
        for (const k of keys) add(lines.get(k)!, ev.play);
        add(line(`m${month}`, MONTHS[month], 'month'), ev.play);
      }
      score[ev.half] += ev.runs;
    }
  }
  const out = [...lines.values()].filter((l) => l.key === 'all' || l.PA > 0 || l.group !== 'month');
  // months in calendar order after the fixed rows
  out.sort((a, b) => (a.group === 'month' && b.group === 'month' ? Number(a.key.slice(1)) - Number(b.key.slice(1)) : 0));
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

export const splitAvg = (l: SplitLine) => (l.AB ? l.H / l.AB : 0);
export const splitObp = (l: SplitLine) => { const d = l.AB + l.BB + l.HBP + l.SF; return d ? (l.H + l.BB + l.HBP) / d : 0; };
export const splitSlg = (l: SplitLine) => (l.AB ? (l.H + l.D + 2 * l.T + 3 * l.HR) / l.AB : 0);
