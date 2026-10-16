/** Derived numbers for the screens: rates, leaderboards, races, streak heat. */
import { newBatLine, newPitchLine, type BatLine, type PitchLine } from '../engine/game/types';
import { divisionStandings, type DivisionTable, type StandingRow } from '../engine/season/season';
import type { Game } from './state';

/** How a play reads in a game log: hit, home run, on base (walk, hit by pitch, error), out, or strikeout. */
export function playTone(play: number | undefined): string {
  if (play === undefined) return '';
  if (play <= 1) return 't-k';
  if (play === 7) return 't-hr';
  if (play >= 4 && play <= 6) return 't-hit';
  if (play === 2 || play === 3 || play === 12) return 't-on';
  return 't-out';
}
export const LOG_KEY = '<p class="log-key" aria-hidden="true"><span class="t-hit">HIT</span><span class="t-hr">HOME RUN</span><span class="t-on">ON BASE</span><span class="t-out">OUT</span><span class="t-k">STRIKEOUT</span></p>';

export const avg = (l: BatLine) => (l.AB ? l.H / l.AB : 0);
export const obp = (l: BatLine) => { const d = l.AB + l.BB + l.HBP + l.SF; return d ? (l.H + l.BB + l.HBP) / d : 0; };
export const slg = (l: BatLine) => (l.AB ? (l.H + l.D + 2 * l.T + 3 * l.HR) / l.AB : 0);
export const era = (p: PitchLine) => (p.outs ? (27 * p.ER) / p.outs : p.ER ? Infinity : 0);
export const whip = (p: PitchLine) => (p.outs ? (3 * (p.BB + p.H)) / p.outs : 0);
export const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;
/** ".287" style. */
export const rate3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '—');
export const era2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
export const pct = (r: StandingRow) => (r.W + r.L ? r.W / (r.W + r.L) : 0);
export const gamesBehind = (a: StandingRow, leader: StandingRow) => ((leader.W - a.W) + (a.L - leader.L)) / 2;
export const gbText = (gb: number) => (gb === 0 ? '—' : gb.toFixed(1));
export const last10 = (r: StandingRow) => { const w = r.last10.reduce((a, b) => a + b, 0); return `${w}-${r.last10.length - w}`; };
export const streakText = (r: StandingRow) => (r.streak === 0 ? '—' : r.streak > 0 ? `W${r.streak}` : `L${-r.streak}`);

// Standout numbers in color: green for good, red for bad (HTML, for table cells).
const tone = (text: string, t: number) => (t > 0 ? `<span class="pos">${text}</span>` : t < 0 ? `<span class="neg">${text}</span>` : text);
/** W and L cells, colored when the record is .550+ or .450 and under (after 10 games). */
export const recordTone = (r: StandingRow, text: string) => tone(text, r.W + r.L < 10 ? 0 : pct(r) >= 0.55 ? 1 : pct(r) <= 0.45 ? -1 : 0);
/** Run differential, colored past ±0.4 runs a game. */
export const diffTone = (r: StandingRow) => { const d = r.RS - r.RA, g = Math.max(1, r.W + r.L); return tone(d > 0 ? `+${d}` : String(d), Math.abs(d) / g < 0.4 ? 0 : Math.sign(d)); };
/** Streaks of three or more, colored. */
export const streakTone = (r: StandingRow) => tone(streakText(r), Math.abs(r.streak) >= 3 ? Math.sign(r.streak) : 0);
/** Last ten, colored at 7-3 and 3-7. */
export const last10Tone = (r: StandingRow) => { const w = r.last10.reduce((a, b) => a + b, 0); return tone(last10(r), r.last10.length < 10 ? 0 : w >= 7 ? 1 : w <= 3 ? -1 : 0); };

/**
 * Streak heat: +1..+3 hot (flames), -1..-3 cold (ice), 0 neither. Two signals: the streak (3, 5, 7 wins; 4, 5, 7
 * losses) and the last ten (7, 8, 9 wins; 3, 2, 1), once ten games exist. When they agree the stronger one counts;
 * when they pull against each other they cancel, so W2 on a 2-8 run is a cool -1, not -2, and W3 on 3-7 is nothing.
 */
export function heat(r: StandingRow): number {
  const full = r.last10.length === 10;
  const w = r.last10.reduce((a, b) => a + b, 0);
  const s = r.streak, a = Math.abs(s);
  const streak = s > 0 ? (a >= 7 ? 3 : a >= 5 ? 2 : a >= 3 ? 1 : 0.5) : s < 0 ? -(a >= 7 ? 3 : a >= 5 ? 2 : a >= 4 ? 1 : 0.5) : 0;
  const form = !full ? 0 : w >= 9 ? 3 : w >= 8 ? 2 : w >= 7 ? 1 : w <= 1 ? -3 : w <= 2 ? -2 : w <= 3 ? -1 : 0;
  const v = Math.sign(streak) === Math.sign(form) || !form || !streak ? (Math.abs(streak) >= Math.abs(form) ? streak : form) : streak + form;
  return Math.trunc(v);
}

export interface LeagueRace {
  league: number;
  divisions: DivisionTable[];
  /** Every non-leader, best first, with games ahead (+) or behind the second wild card. */
  wildCard: Array<{ row: StandingRow; gb: number }>;
}

export function races(g: Game): LeagueRace[] {
  const all = divisionStandings(g.season);
  return [0, 1].map((league) => {
    const divisions = all.filter((t) => t.league === league);
    const chasers = divisions.flatMap((d) => d.rows.slice(1)).sort((a, b) => pct(b) - pct(a) || (b.RS - b.RA) - (a.RS - a.RA));
    const line = chasers[1], next = chasers[2];
    const wildCard = chasers.map((row, i) => ({ row, gb: i < 2 ? (next ? -gamesBehind(next, row) : 0) : gamesBehind(row, line) }));
    return { league, divisions, wildCard };
  });
}

/** Where a team stands in the playoff picture, in words. */
export function raceText(g: Game, teamId: number): string {
  const t = g.league.teams.find((x) => x.id === teamId)!;
  const race = races(g)[t.conference];
  const div = race.divisions.find((d) => d.division === t.division)!;
  const me = g.season.standings.get(teamId)!;
  if (me.W + me.L === 0) return 'Opening Day. Everyone is tied.';
  if (div.rows[0].teamId === teamId) {
    const lead = gamesBehind(div.rows[1], me);
    return lead === 0 ? 'Tied for the division lead' : `Leads the division by ${lead.toFixed(1)}`;
  }
  const i = race.wildCard.findIndex((w) => w.row.teamId === teamId);
  if (i < 2) { const by = -race.wildCard[i].gb; return by === 0 ? 'Tied for a wild card spot' : `Holds a wild card by ${by.toFixed(1)}`; }
  const gb = race.wildCard[i].gb;
  return gb === 0 ? 'Tied with the last wild card' : `${gb.toFixed(1)} games out of a playoff spot`;
}

/** Games played by a player's team (for qualifying). */
const teamGames = (g: Game, playerId: number) => { const r = g.season.standings.get(g.teamOf.get(playerId) ?? 0); return r ? r.W + r.L : 0; };

export interface Leader { id: number; value: number; shown: string }
export interface LeaderCat { key: string; label: string; pitching: boolean }

export const BAT_CATS: LeaderCat[] = [
  { key: 'AVG', label: 'Batting average', pitching: false }, { key: 'HR', label: 'Home runs', pitching: false },
  { key: 'RBI', label: 'Runs batted in', pitching: false }, { key: 'OPS', label: 'On-base plus slugging', pitching: false },
  { key: 'SB', label: 'Stolen bases', pitching: false }, { key: 'H', label: 'Hits', pitching: false },
];
export const PIT_CATS: LeaderCat[] = [
  { key: 'ERA', label: 'Earned run average', pitching: true }, { key: 'W', label: 'Wins', pitching: true },
  { key: 'SO', label: 'Strikeouts', pitching: true }, { key: 'SV', label: 'Saves', pitching: true },
  { key: 'WHIP', label: 'Walks + hits per inning', pitching: true }, { key: 'IP', label: 'Innings pitched', pitching: true },
];

export function leaders(g: Game, key: string, n = 5): Leader[] {
  const out: Leader[] = [];
  const pitching = PIT_CATS.some((c) => c.key === key);
  if (!pitching) {
    for (const [id, l] of g.season.batting) {
      const q = l.PA >= 3.1 * teamGames(g, id);
      let v: number | null = null, shown = '';
      switch (key) {
        case 'AVG': if (q && l.AB) { v = avg(l); shown = rate3(v); } break;
        case 'OPS': if (q && l.AB) { v = obp(l) + slg(l); shown = rate3(v); } break;
        case 'HR': v = l.HR; shown = String(v); break;
        case 'RBI': v = l.RBI; shown = String(v); break;
        case 'SB': v = l.SB; shown = String(v); break;
        case 'H': v = l.H; shown = String(v); break;
      }
      if (v !== null && (v > 0 || key === 'AVG' || key === 'OPS')) out.push({ id, value: v, shown });
    }
  } else {
    for (const [id, p] of g.season.pitching) {
      const q = p.outs >= 3 * teamGames(g, id);
      let v: number | null = null, shown = '';
      switch (key) {
        case 'ERA': if (q) { v = -era(p); shown = era2(era(p)); } break;
        case 'WHIP': if (q) { v = -whip(p); shown = whip(p).toFixed(2); } break;
        case 'W': v = p.W; shown = String(v); break;
        case 'SO': v = p.K; shown = String(v); break;
        case 'SV': v = p.SV; shown = String(v); break;
        case 'IP': v = p.outs; shown = ip(p.outs); break;
      }
      if (v !== null && (v > 0 || key === 'ERA' || key === 'WHIP')) out.push({ id, value: v, shown });
    }
  }
  return out.sort((a, b) => b.value - a.value || a.id - b.id).slice(0, n);
}

export interface TeamTotals { G: number; bat: BatLine; pit: PitchLine }
const totalsCache = new WeakMap<object, { n: number; m: Map<number, TeamTotals> }>();
/** Every team's season totals, regular season, from the games themselves (so a traded player counts for each team he played for). */
export function teamTotals(g: Game): Map<number, TeamTotals> {
  const s = g.season, hit = totalsCache.get(s);
  if (hit && hit.n === s.results.length) return hit.m;
  const m = new Map<number, TeamTotals>(g.league.teams.map((t) => [t.id, { G: 0, bat: newBatLine(), pit: newPitchLine() }]));
  const add = <T extends object>(into: T, l: T) => { for (const k in l) (into as Record<string, number>)[k] += (l as Record<string, number>)[k]; };
  for (const r of s.results) {
    if (r.kind === 'post') continue;
    for (const side of [0, 1] as const) {
      const t = m.get(r.teamIds[side]);
      if (!t) continue;
      t.G++;
      const ids = new Set([...r.lineups[side].map((x) => x.player.id), ...(r.subs ?? []).filter((x) => x.side === side).map((x) => x.incoming)]);
      for (const id of ids) { const l = r.batting.get(id); if (l) add(t.bat, l); }
      for (const id of r.pitchersUsed[side]) { const l = r.pitching.get(id); if (l) add(t.pit, l); }
    }
  }
  totalsCache.set(s, { n: s.results.length, m });
  return m;
}
