/** Derived numbers for the screens: rates, leaderboards, races, streak heat. */
import type { BatLine, PitchLine } from '../engine/game/types';
import { divisionStandings, type DivisionTable, type StandingRow } from '../engine/season/season';
import type { Game } from './state';

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

/** Streak heat: +1..+3 hot (flames), -1..-3 cold (ice), 0 neither. Last-10 counts only once 10 games exist. */
export function heat(r: StandingRow): number {
  const full = r.last10.length === 10;
  const w = r.last10.reduce((a, b) => a + b, 0);
  if (r.streak >= 7 || (full && w >= 9)) return 3;
  if (r.streak >= 5 || (full && w >= 8)) return 2;
  if (r.streak >= 3 || (full && w >= 7)) return 1;
  if (r.streak <= -7 || (full && w <= 1)) return -3;
  if (r.streak <= -5 || (full && w <= 2)) return -2;
  if (r.streak <= -4 || (full && w <= 3)) return -1;
  return 0;
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
