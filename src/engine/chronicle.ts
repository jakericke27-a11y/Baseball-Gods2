/**
 * The chronicle: what the record books keep from each season beyond the stat lines (step 2.9).
 *
 * - Great games: every team's ten highest-Drama games (the union, so the league's best are in it too), as compact rows.
 * - League splits: every regular-season plate appearance in the league, split by platoon, venue, base and out
 *   situation, inning and month. Hitters' view (what pitchers allowed is the same total).
 *
 * Both are read straight from the season's game logs, so the current season can be shown live the same way.
 */
import { gameDrama } from './game/drama';
import { decodeEvents } from './game/text';
import { Play, type GameResult } from './game/types';
import { dateOfDay } from './season/schedule';
import type { Player } from './types';

/** [day, awayId, homeId, awayRuns, homeRuns, innings, drama, kind (0 regular, 1 Game 163, 2 postseason), total swing x100 (breaks ties at the 100 cap)] */
export type GameRow = number[];
export const GAME_KEEP = 10;

export const gameRow = (r: GameResult, d: { score: number; swing: number }): GameRow =>
  [r.day, r.teamIds[0], r.teamIds[1], r.score[0], r.score[1], r.innings, d.score, r.kind === 'post' ? 2 : r.kind === 'tiebreak' ? 1 : 0, Math.round(100 * d.swing)];

/** Each team's `keep` highest-Drama games (ties: the later game), merged into one list, highest first. */
export function greatGames(results: GameResult[], keep = GAME_KEEP): GameRow[] {
  const byTeam = new Map<number, GameRow[]>();
  for (const r of results) {
    if (!r.log) continue;
    const row = gameRow(r, gameDrama(r.log, r.innings));
    for (const t of r.teamIds) {
      const list = byTeam.get(t) ?? [];
      list.push(row);
      byTeam.set(t, list);
    }
  }
  const out = new Set<GameRow>();
  for (const list of byTeam.values()) for (const row of sortGames(list).slice(0, keep)) out.add(row);
  return sortGames([...out]);
}
export const sortGames = (rows: GameRow[]) => rows.sort(byDrama);
/** Highest Drama first; past the cap, the bigger total swing; then the later game. */
export const byDrama = (a: GameRow, b: GameRow) => b[6] - a[6] || (b[8] ?? 0) - (a[8] ?? 0) || b[0] - a[0] || a[2] - b[2];

/** [PA, AB, H, 2B, 3B, HR, BB, HBP, K, SF] */
export type SplitRow = number[];
export const SPLIT_FIELDS = ['PA', 'AB', 'H', 'D', 'T', 'HR', 'BB', 'HBP', 'K', 'SF'] as const;
export interface SplitDef { key: string; label: string; group: 'platoon' | 'venue' | 'bases' | 'outs' | 'inning' | 'month' }
export const SPLIT_DEFS: SplitDef[] = [
  { key: 'all', label: 'All plate appearances', group: 'platoon' },
  { key: 'vsL', label: 'vs left-handed pitchers', group: 'platoon' }, { key: 'vsR', label: 'vs right-handed pitchers', group: 'platoon' },
  { key: 'same', label: 'Same hand (L-L, R-R)', group: 'platoon' }, { key: 'opp', label: 'Opposite hands', group: 'platoon' },
  { key: 'home', label: 'Home teams', group: 'venue' }, { key: 'away', label: 'Road teams', group: 'venue' },
  { key: 'empty', label: 'Bases empty', group: 'bases' }, { key: 'on', label: 'Runners on', group: 'bases' }, { key: 'risp', label: 'Scoring position', group: 'bases' },
  { key: 'loaded', label: 'Bases loaded', group: 'bases' }, { key: 'late', label: 'Late and close', group: 'bases' },
  { key: 'o0', label: 'No outs', group: 'outs' }, { key: 'o1', label: 'One out', group: 'outs' }, { key: 'o2', label: 'Two outs', group: 'outs' },
  { key: 'i1', label: 'Innings 1–3', group: 'inning' }, { key: 'i4', label: 'Innings 4–6', group: 'inning' }, { key: 'i7', label: 'Innings 7–9', group: 'inning' }, { key: 'i10', label: 'Extra innings', group: 'inning' },
  ...['MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT'].map((m, i) => ({ key: `m${i + 2}`, label: m, group: 'month' as const })),
];

function add(row: SplitRow, play: Play): void {
  row[0]++;
  if (play === Play.Walk) { row[6]++; return; }
  if (play === Play.HitByPitch) { row[7]++; return; }
  if (play === Play.SacFly) { row[9]++; return; }
  row[1]++;
  if (play === Play.StrikeoutSwinging || play === Play.StrikeoutLooking) row[8]++;
  if (play >= Play.Single && play <= Play.HomeRun) {
    row[2]++;
    if (play === Play.Double) row[3]++; else if (play === Play.Triple) row[4]++; else if (play === Play.HomeRun) row[5]++;
  }
}

/** League-wide splits over the regular season's games. Keys with no plate appearances are left out. */
export function leagueSplits(results: GameResult[], players: Map<number, Player>): Record<string, SplitRow> {
  const out: Record<string, SplitRow> = {};
  const row = (k: string) => (out[k] ??= new Array(SPLIT_FIELDS.length).fill(0));
  for (const r of results) {
    if (r.kind === 'post' || !r.log) continue;
    const month = `m${dateOfDay(r.day).month}`;
    const score = [0, 0];
    for (const ev of decodeEvents(r.log)) {
      if (ev.type === 'wp') { for (const m of ev.moves) if (m.to === 4) score[ev.half]++; continue; }
      if (ev.type !== 'pa') continue;
      const p = players.get(ev.pitcher), b = players.get(ev.batter);
      const ph = p?.throws ?? 'R';
      const bh = b?.bats === 'S' ? (ph === 'R' ? 'L' : 'R') : (b?.bats ?? 'R');
      const late = ev.inning >= 7 && Math.abs(score[0] - score[1]) <= 1;
      const keys = ['all', ph === 'L' ? 'vsL' : 'vsR', bh === ph ? 'same' : 'opp', ev.half === 1 ? 'home' : 'away',
        ev.basesBefore === 0 ? 'empty' : 'on', ...(ev.basesBefore & 6 ? ['risp'] : []), ...(ev.basesBefore === 7 ? ['loaded'] : []), ...(late ? ['late'] : []),
        `o${ev.outsBefore}`, ev.inning <= 3 ? 'i1' : ev.inning <= 6 ? 'i4' : ev.inning <= 9 ? 'i7' : 'i10', month];
      for (const k of keys) add(row(k), ev.play);
      score[ev.half] += ev.runs;
    }
  }
  return out;
}

/** Add one set of splits into another (career and decade totals). */
export function addSplits(into: Record<string, SplitRow>, from: Record<string, SplitRow>): void {
  for (const [k, r] of Object.entries(from)) {
    const cur = (into[k] ??= new Array(SPLIT_FIELDS.length).fill(0));
    r.forEach((v, i) => (cur[i] += v));
  }
}
