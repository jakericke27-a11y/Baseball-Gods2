/** Races: the playoff race with odds and magic numbers, leader races, chases, hot and cold, and streaks. */
import type { TeamRace } from '../../engine/season/races';
import type { App } from '../app';
import type { Game } from '../state';
import { heat, last10, pct, recordTone, streakText } from '../stats';
import {
  activeStreaks, crownWatch, FORM_WINDOWS, hotCold, inningsText, leaderRaces, milestoneChases, oddsText, pctText,
  playoffPicture, recordChases, recordText, type Form,
} from '../races';
import { DIVISIONS, LEAGUES, teamName } from '../teams';
import { btn, esc, link, thead, trow, ttable, win } from './common';
import { page } from './screens';

const who = (g: Game, id: number) => `${link(g.name(id), 'player', { id })} <span class="muted">${esc(teamName(g.teamOf.get(id) ?? 0))}</span>`;
const mineCls = (g: Game, id: number) => (g.teamOf.get(id) === g.userTeam ? ' class="mine"' : '');

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
  const cols = 'minmax(0, 1fr) 32px 32px 38px 44px 46px 46px';
  const head = thead(['TEAM', 'W', 'L', 'LEFT', 'M/E', 'DIV', 'IN']);
  const line = '<div class="playoff-line" role="presentation">PLAYOFF LINE</div>';
  const outRow = out.length ? `<p class="note muted small race-out">Out: ${out.map((t) => link(teamName(t.teamId), 'team', { id: t.teamId })).join(', ')}</p>` : '';
  const body = ttable(cols, `${LEAGUES[league]} playoff race`, head + [...leaders, ...wild].map(me).join('') + line + alive.map(me).join('')).replace('class="ttable"', 'class="ttable race-t"') + outRow;
  return win({ id: `w-race-${league}`, title: LEAGUES[league], label: 'PLAYOFF RACE', body });
}

function leaderRacesWin(g: Game): string {
  const items = leaderRaces(g).map((r) => {
    if (!r.top.length) return `<li><div class="rl-h"><span class="k">${esc(r.label.toUpperCase())}</span><span class="muted small">No qualifiers yet</span></div></li>`;
    const close = r.top.length > 1 && r.closeness <= 1;
    const facts = [r.gap && `${r.closeness === 0 ? 'tied' : `by ${r.gap}`}`, r.pace !== null && `pace ${r.pace}`, r.record && `record ${recordText(g, r.record)}`].filter(Boolean).join(' · ');
    const lines = r.top.slice(0, 2).map((t, i) => `<div class="rl-p"${mineCls(g, t.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, t.id)}</span><span class="val">${t.shown}</span></div>`).join('');
    return `<li class="${close ? 'close' : ''}"><div class="rl-h"><span class="k">${esc(r.label.toUpperCase())}</span>${close ? '<span class="tag">CLOSE</span>' : ''}</div>${lines}<div class="rl-f muted small">${esc(facts)}</div></li>`;
  }).join('');
  return win({ id: 'w-lraces', title: 'Leader Races', label: 'TOP TWO', body: `<ul class="race-list">${items}</ul>`, cls: 'w-lraces' });
}

function crownWin(g: Game): string {
  const w = crownWatch(g);
  if (!w.length) return ''; // shows up when someone is in range
  const name = (k: string) => ({ AVG: 'average', HR: 'homers', RBI: 'RBI', W: 'wins', SO: 'strikeouts', ERA: 'ERA' })[k] ?? k;
  const body = w.length ? `<ul class="chase-list">${w.map((x) => `<li${mineCls(g, x.playerId)}>${who(g, x.playerId)}<span class="small">${x.leads.length === 3 ? 'Leads all three' : `Leads ${x.leads.map(name).join(' and ')}; ${x.chasing.map((c) => `${c.behind} back in ${name(c.cat)}`).join(', ')}`}</span></li>`).join('')}</ul>`
    : '<p class="note muted small">Nobody leads two of the three with the third in reach.</p>';
  return win({ id: 'w-crown', title: 'Triple Crown', label: 'WATCH', body });
}

function chasesWin(g: Game): string {
  const ms = milestoneChases(g).slice(0, 8), rc = recordChases(g);
  if (!ms.length && !rc.length) return ''; // shows up when someone is chasing
  const list = (cs: typeof ms) => `<ul class="chase-list">${cs.map((c) => `<li${mineCls(g, c.playerId)}>${who(g, c.playerId)}<span class="small">${esc(c.text)}</span></li>`).join('')}</ul>`;
  const body = `${rc.length ? `<h3 class="sub-h">RECORD PACE</h3>${list(rc)}` : ''}${ms.length ? `<h3 class="sub-h">CAREER MILESTONES</h3>${list(ms)}` : ''}`;
  return win({ id: 'w-chases', title: 'Chases', label: 'RECORDS AND MILESTONES', body });
}

function formWin(app: App): string {
  const g = app.game!, days = app.formDays, f = hotCold(g, days);
  const tabs = `<div class="tabs small-tabs" role="group" aria-label="Window">${FORM_WINDOWS.map((d) => `<button type="button" class="tab${d === days ? ' on' : ''}" data-act="form-days" data-days="${d}" data-key="form-days:${d}" aria-pressed="${d === days}">LAST ${d}</button>`).join('')}</div>`;
  const list = (title: string, rows: Form[], stat: string) => `<h3 class="sub-h">${title}</h3>${rows.length ? `<ol class="lead-list form-list">${rows.map((r, i) => `<li${mineCls(g, r.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, r.id)}<span class="muted small"> ${esc(r.line)} · season ${r.season}</span></span><span class="val">${r.shown}</span></li>`).join('')}</ol>` : `<p class="note muted small">Not enough ${stat} yet.</p>`}`;
  const body = tabs + `<div class="form-grid"><div>${list('HOT BATS · OPS', f.hotBats, 'at-bats')}${list('COLD BATS · OPS', f.coldBats, 'at-bats')}</div><div>${list('HOT ARMS · ERA', f.hotArms, 'innings')}${list('COLD ARMS · ERA', f.coldArms, 'innings')}</div></div>`;
  return win({ id: 'w-form', title: 'Hot & Cold', label: `LAST ${days} DAYS`, body, cls: 'w-form wide' });
}

function streaksWin(g: Game): string {
  const s = activeStreaks(g);
  const list = (title: string, rows: Array<[number, number]>, shown: (v: number) => string, empty: string) =>
    (rows.length ? `<h3 class="sub-h">${title}</h3><ol class="lead-list">${rows.map(([id, v], i) => `<li${mineCls(g, id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, id)}</span><span class="val">${shown(v)}</span></li>`).join('')}</ol>` : (void empty, ''));
  const best = (k: 'hit' | 'onBase' | 'scoreless', shown: (v: number) => string) => (s.best[k][0] ? `<p class="note muted small">Year's best: ${esc(g.name(s.best[k][1]))}, ${shown(s.best[k][0])}</p>` : '');
  const games = (v: number) => `${v} G`, inn = (v: number) => `${inningsText(v)} IP`;
  const teams = g.league.teams.map((t) => g.season.standings.get(t.id)!).filter((r) => heat(r) !== 0).sort((a, b) => b.streak - a.streak);
  const teamRows = teams.length ? ttable('minmax(0, 1fr) 44px 44px', 'Team streaks', thead(['TEAM', 'STK', 'L10']) + teams.map((r) => trow([link(teamName(r.teamId), 'team', { id: r.teamId }), streakText(r), last10(r)], heat(r), r.teamId === g.userTeam)).join(''))
    : '';
  const body = `${list('HITTING', s.hit, games, 'No hitting streaks of 5+ games.')}${best('hit', games)}
${list('ON BASE', s.onBase, games, 'No on-base streaks of 10+ games.')}${best('onBase', games)}
${list('SCORELESS', s.scoreless, inn, 'No scoreless streaks of 10+ innings.')}${best('scoreless', inn)}
${teamRows ? `<h3 class="sub-h">FIRE AND ICE</h3>${teamRows}` : ''}`;
  return win({ id: 'w-streaks', title: 'Streaks', label: 'ACTIVE', body });
}

export function racesView(app: App): string {
  const g = app.game!;
  const mine = playoffPicture(g).find((t) => t.teamId === g.userTeam)!;
  const lead = `<p class="note race-lead win">${esc(teamName(g.userTeam))}: ${esc([oddsText(mine), mine.magic !== null && !mine.clinched ? `magic number ${mine.magic}` : '', mine.elim !== null && !mine.eliminated ? `${mine.elim} from elimination` : ''].filter(Boolean).join(' · ') || 'the race is on')}</p>`;
  const key = '<p class="note muted small race-key win">M magic number: wins plus rival losses to clinch. E elimination number. DIV and IN: odds from simming the rest of the season. z clinched the division, x clinched a spot, e eliminated.</p>';
  const post = g.season.post?.seeds.length ? `<div class="row-actions">${btn('THE BRACKET', 'go', { data: { to: 'standings' } })}</div>` : '';
  return page(app, 'races', `${post}${lead}<div class="two-col">${[0, 1].map((lg) => `<div class="league-col">${playoffRaceWin(g, lg)}</div>`).join('')}</div>${key}
<div class="cards race-cards">${leaderRacesWin(g)}${crownWin(g)}${chasesWin(g)}${streaksWin(g)}</div>${formWin(app)}`);
}
