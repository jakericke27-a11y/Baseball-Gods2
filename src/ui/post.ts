/** Postseason words and windows: series names, where a series stands, the bracket, headlines. */
import type { GameResult } from '../engine/game/types';
import { ROUND_GAMES, seriesFor, type Series } from '../engine/season/postseason';
import type { Game, Headline } from './state';
import { LEAGUES, teamName } from './teams';

/** The championship's working name (on the names-to-pick list). */
export const FINAL_NAME = 'Galaxy Series';
const ROUND_NAME = { WC: 'Wild Card Game', DS: 'Division Series', LCS: 'Championship Series' } as const;
const ROUND_SHORT = { WC: 'WC', DS: 'DS', LCS: 'CS' } as const;

export const seriesName = (sr: Series) => (sr.round === 'WS' ? FINAL_NAME : `${LEAGUES[sr.league]} ${ROUND_NAME[sr.round]}`);
export const seriesShort = (sr: Series) => (sr.round === 'WS' ? FINAL_NAME.toUpperCase() : `${LEAGUES[sr.league].toUpperCase()} ${ROUND_SHORT[sr.round]}`);

/** "Team 05 lead 2-1", "Series tied 1-1", "Team 05 win 4-2". */
export function seriesStatus(sr: Series): string {
  const [h, l] = sr.wins;
  if (sr.round === 'WC') return sr.winner ? `${teamName(sr.winner)} win` : `${teamName(sr.low)} at ${teamName(sr.high)}`;
  const hi = Math.max(h, l), lo = Math.min(h, l), lead = h > l ? sr.high : sr.low;
  if (sr.winner) return `${teamName(sr.winner)} win ${hi}-${lo}`;
  if (h === l) return h === 0 ? 'Not started' : `Tied ${h}-${l}`;
  return `${teamName(lead)} lead ${hi}-${lo}`;
}

export const findSeries = (g: Game, id: string | undefined) => g.season.post?.series.find((x) => x.id === id);

/** Headlines for a day's Game 163s and postseason games (after the day is simmed). */
export function postHeadlines(g: Game, day: number, results: GameResult[]): Headline[] {
  const out: Headline[] = [];
  const add = (text: string, teamId: number, big = false) => out.push({ day, text, teamId, big });
  const winnerOf = (r: GameResult) => (r.score[1] > r.score[0] ? r.teamIds[1] : r.teamIds[0]);
  for (const r of results) {
    const w = winnerOf(r), l = r.teamIds[0] === w ? r.teamIds[1] : r.teamIds[0];
    if (r.kind === 'tiebreak') { add(`${teamName(w)} beat ${teamName(l)} in Game 163`, w, true); continue; }
    if (r.kind !== 'post') continue;
    const sr = findSeries(g, r.series);
    if (!sr) continue;
    const [h, lo] = sr.wins, hi = Math.max(h, lo), low = Math.min(h, lo);
    if (sr.winner && sr.round === 'WS') add(`${teamName(w).toUpperCase()} WIN THE ${FINAL_NAME.toUpperCase()}, ${hi}-${low} over ${teamName(l)}`, w, true);
    else if (sr.winner && sr.round === 'WC') add(`${teamName(w)} win the ${seriesName(sr)} over ${teamName(l)}`, w, true);
    else if (sr.winner) add(`${teamName(w)} win the ${seriesName(sr)} ${hi}-${low} over ${teamName(l)}`, w, true);
    else if (h === lo) add(`${teamName(w)} even the ${seriesName(sr)} at ${h}`, w);
    else if (w === (h > lo ? sr.high : sr.low)) add(`${teamName(w)} take a ${hi}-${low} lead in the ${seriesName(sr)}`, w);
    else add(`${teamName(w)} pull within ${hi}-${low} in the ${seriesName(sr)}`, w);
  }
  // the field, the day it's set
  const P = g.season.post;
  if (P && P.phase !== 'tiebreak' && P.seeds.length && !g.headlines.some((x) => x.text.startsWith('The field is set'))) {
    add(`The field is set: ${P.seeds.map((s, lg) => `${LEAGUES[lg]} ${s.map(teamName).join(', ')}`).join('; ')}`, P.seeds[0][0], true);
  }
  return out;
}

/** Where your season stands in October, in words. */
export function postText(g: Game, teamId: number): string {
  const P = g.season.post;
  if (!P || P.phase === 'tiebreak') return '';
  const sr = seriesFor(g.season, teamId);
  if (!sr) return 'Missed the postseason';
  if (P.champion === teamId) return `${FINAL_NAME} champions`;
  if (sr.winner && sr.winner !== teamId) return `Out: lost the ${seriesName(sr)}`;
  return `${seriesName(sr)}: ${seriesStatus(sr)}`;
}

/** The bracket as rows of series, by round. */
export function bracketHtml(g: Game, esc: (s: string) => string, link: (text: string, act: string, data: Record<string, string | number>) => string): string {
  const P = g.season.post;
  if (!P || !P.seeds.length) return '';
  const seed = (id: number) => { const lg = P.seeds.findIndex((s) => s.includes(id)); return P.seeds[lg].indexOf(id) + 1; };
  const team = (sr: Series, id: number, wins: number) => {
    const out = sr.winner && sr.winner !== id, mine = id === g.userTeam;
    return `<span class="br-team${out ? ' out' : ''}${sr.winner === id ? ' won' : ''}${mine ? ' mine' : ''}"><span class="seed">${seed(id)}</span>${link(teamName(id), 'team', { id })}<span class="br-w">${sr.round === 'WC' ? (sr.winner === id ? 'W' : '') : wins}</span></span>`;
  };
  const card = (sr: Series) => `<li class="br-series"><span class="br-name">${esc(seriesShort(sr))} · ${ROUND_GAMES[sr.round] === 1 ? 'ONE GAME' : `BEST OF ${ROUND_GAMES[sr.round]}`}</span>${team(sr, sr.high, sr.wins[0])}${team(sr, sr.low, sr.wins[1])}</li>`;
  const rounds = (['WC', 'DS', 'LCS', 'WS'] as const).map((rd) => {
    const list = P.series.filter((x) => x.round === rd);
    const name = rd === 'WS' ? FINAL_NAME : ROUND_NAME[rd] + (rd === 'WC' ? 's' : '');
    return `<div class="br-round"><h3>${esc(name.toUpperCase())}</h3>${list.length ? `<ol class="br-list">${list.map(card).join('')}</ol>` : '<p class="note muted small">Waiting</p>'}</div>`;
  }).join('');
  const champ = P.champion ? `<p class="br-champ">${esc(teamName(P.champion))} win the ${FINAL_NAME}.</p>` : '';
  return `${champ}<div class="bracket">${rounds}</div>`;
}
