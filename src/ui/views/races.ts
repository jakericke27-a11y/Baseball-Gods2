/** Races: the playoff race with odds, magic numbers and proven clinches. (Leader races, streaks and chases live on Leaders.) */
import type { TeamRace } from '../../engine/season/races';
import type { App } from '../app';
import type { Game } from '../state';
import { heat, pct, recordTone } from '../stats';
import { oddsText, pctText, playoffPicture } from '../races';
import { DIVISIONS, LEAGUE_NAMES, LEAGUES, teamName } from '../teams';
import { btn, esc, link, thead, trow, ttable, win } from './common';
import { page } from './screens';


/** The race key: z clinched the division, x clinched a spot, e eliminated. */
const mark = (t: TeamRace) => (t.clinched === 'division' ? 'z' : t.clinched === 'berth' ? 'x' : t.eliminated ? 'e' : '');

function playoffRaceWin(g: Game, league: number): string {
  const all = playoffPicture(g).filter((t) => t.league === league);
  const row = (t: TeamRace) => g.season.standings.get(t.teamId)!;
  const byPct = (a: TeamRace, b: TeamRace) => pct(row(b)) - pct(row(a)) || (row(b).RS - row(b).RA) - (row(a).RS - row(a).RA);
  const leaders = all.filter((t) => t.spot === 'division').sort(byPct);
  const wild = all.filter((t) => t.spot === 'wildcard').sort(byPct);
  const rest = all.filter((t) => !t.spot).sort(byPct);
  const alive = rest.filter((t) => !t.eliminated), out = rest.filter((t) => t.eliminated);
  const odds = (p: number, alive: boolean, sure: boolean) => (Number.isNaN(p) ? '—' : pctText(p, alive, sure));
  const me = (t: TeamRace) => {
    const r = row(t), m = mark(t);
    const num = t.clinched === 'division' || (t.clinched && t.spot !== 'division') ? '—' : t.magic !== null ? `M${t.magic}` : t.elim !== null && !t.eliminated ? `E${t.elim}` : '—';
    const name = `${m ? `<span class="race-mark m-${m}" title="${esc(m === 'z' ? 'Clinched the division' : m === 'x' ? 'Clinched a playoff spot' : 'Eliminated')}">${m}</span>` : ''}${link(teamName(t.teamId), 'team', { id: t.teamId })}`;
    const sub = t.spot === 'division' ? `<span class="muted x"> ${DIVISIONS[t.division]}</span>` : '';
    return trow([name + sub, recordTone(r, String(r.W)), recordTone(r, String(r.L)), String(t.left), num, odds(t.odds.division, !t.divisionOut, t.clinched === 'division' || g.day >= g.season.regularDays), odds(t.odds.berth, !t.eliminated, !!t.clinched || g.day >= g.season.regularDays)], heat(r), t.teamId === g.userTeam);
  };
  const cols = 'minmax(0, 1fr) 36px 36px 48px 52px 58px 58px';
  const head = thead(['TEAM', 'W', 'L', 'LEFT', 'M/E', 'DIV', 'IN']);
  const line = '<div class="playoff-line" role="presentation">PLAYOFF LINE</div>';
  const outRow = out.length ? `<p class="note muted small race-out">Out: ${out.map((t) => link(teamName(t.teamId), 'team', { id: t.teamId })).join(', ')}</p>` : '';
  const body = ttable(cols, `${LEAGUES[league]} playoff race`, head + [...leaders, ...wild].map(me).join('') + line + alive.map(me).join('')).replace('class="ttable"', 'class="ttable race-t"') + outRow;
  return win({ id: `w-race-${league}`, title: LEAGUE_NAMES[league], label: 'PLAYOFF RACE', body });
}

export function racesView(app: App): string {
  const g = app.game!;
  const mine = playoffPicture(g).find((t) => t.teamId === g.userTeam)!;
  const lead = `<p class="note race-lead win">${esc(teamName(g.userTeam))}: ${esc([oddsText(mine), mine.magic !== null && !mine.clinched ? `magic number ${mine.magic}` : '', mine.elim !== null && !mine.eliminated ? `${mine.elim} from elimination` : ''].filter(Boolean).join(' · ') || 'the race is on')}</p>`;
  const key = '<p class="note muted small race-key win">M magic number: wins plus rival losses to clinch. E elimination number. DIV and IN: odds from simming the rest of the season. z clinched the division, x clinched a spot, e eliminated.</p>';
  const post = g.season.post?.seeds.length ? `<div class="row-actions">${btn('THE BRACKET', 'go', { data: { to: 'standings' } })}</div>` : '';
  return page(app, 'races', `${post}${lead}<div class="two-col fill race-cols">${[0, 1].map((lg) => playoffRaceWin(g, lg)).join('')}</div>${key}`, true);
}
