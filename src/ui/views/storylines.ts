/**
 * Storylines (step 2.9): the Gazette, one old newspaper with a section for each story of the season. THE RACE (the
 * playoff race with odds), LEADERS (top ten per category, this season or all time), LEADER RACES (the top two, the
 * Triple Crown watch and chases), STREAKS, HOT & COLD, BIG GAMES (the season's highest-Drama games) and YOUR GAMES
 * (your game log, play by play). Filters: the whole league or one league, hitting or pitching. Records live in the
 * record books (Records).
 */
import type { App } from '../app';
import { gameDrama } from '../../engine/game/drama';
import { BAT, careerMin, PIT, board, type Cat, type Scope } from '../leaders';
import { activeStreaks, crownWatch, FORM_WINDOWS, hotCold, inningsText, leaderRaces, milestoneChases, recordChases, type Form } from '../races';
import type { Game } from '../state';
import { heat, last10Tone, streakTone } from '../stats';
import { LEAGUES, teamName } from '../teams';
import { dateLabel, shortDate } from '../calendar';
import { esc, link, teamChip, thead, trow, ttable, win } from './common';
import { playoffRaceWin } from './races';
import { gameLogBody, page } from './screens';

export type Section = 'race' | 'leaders' | 'lraces' | 'streaks' | 'form' | 'big' | 'yours';
export interface LeadState { view: Section; scope: 'all' | '0' | '1'; side: 'bat' | 'pit'; when: 'season' | 'alltime' }
export const SECTIONS: Array<[Section, string]> = [['race', 'THE RACE'], ['leaders', 'LEADERS'], ['lraces', 'LEADER RACES'], ['streaks', 'STREAKS'], ['form', 'HOT & COLD'], ['big', 'BIG GAMES'], ['yours', 'YOUR GAMES']];

const who = (g: Game, id: number) => {
  const t = g.teamOf.get(id);
  return `${t ? `<span title="${esc(teamName(t))}">${teamChip(t)}</span>` : ''}${link(g.name(id), 'player', { id })}${t ? '' : ' <span class="muted small">retired</span>'}`;
};
const mineCls = (g: Game, id: number) => (g.teamOf.get(id) === g.userTeam ? ' class="mine"' : '');

const tabs = (k: keyof LeadState, cur: string, opts: Array<[string, string]>, label: string) =>
  `<div class="tabs" role="group" aria-label="${label}">${opts.map(([v, text]) => `<button type="button" class="tab${cur === v ? ' on' : ''}" data-act="lead" data-k="${k}" data-v="${v}" data-key="lead:${k}:${v}" aria-pressed="${cur === v}">${text}</button>`).join('')}</div>`;

function leadersCards(g: Game, s: LeadState, scope: Scope): string {
  const cats = s.side === 'bat' ? BAT : PIT;
  const card = (c: Cat) => {
    const rows = board(g, c, s.when, scope, 10);
    if (!rows.length) return '';
    const body = `<ol class="lead-list" data-flow>${rows.map((l, i) => `<li${mineCls(g, l.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, l.id)}</span><span class="val">${l.shown}</span></li>`).join('')}</ol>`;
    return win({ id: `w-l-${c.key}`, title: c.key, label: c.label.toUpperCase(), body });
  };
  const cards = cats.map(card).join('');
  const note = s.when === 'alltime'
    ? `<p class="note muted small">All time counts completed seasons; this year joins once it ends. Rate leaders need ${s.side === 'bat' ? `${careerMin(g.league.history.length).PA} plate appearances` : `${careerMin(g.league.history.length).outs / 3} innings`}.</p>`
    : '';
  return cards ? `${note}<div class="cards flow fill">${cards}</div>` : `<p class="note">${s.when === 'alltime' ? 'No completed seasons yet. All-time leaders start after Year 1.' : 'No leaders yet. Play a few games.'}</p>`;
}

function racesView(g: Game, s: LeadState, scope: Scope): string {
  const pitching = s.side === 'pit';
  const items = leaderRaces(g, scope).filter((r) => r.pitching === pitching && r.top.length).map((r) => {
    const close = r.top.length > 1 && r.closeness <= 1;
    const facts = [r.gap && `${r.closeness === 0 ? 'tied' : `by ${r.gap}`}`, r.pace !== null && `pace ${r.pace}`].filter(Boolean).join(' · ');
    const lines = r.top.slice(0, 2).map((t, i) => `<div class="rl-p"${mineCls(g, t.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, t.id)}</span><span class="val">${t.shown}</span></div>`).join('');
    return `<li class="${close ? 'close' : ''}"><div class="rl-h"><span class="k">${esc(r.label.toUpperCase())}</span>${close ? '<span class="tag">CLOSE</span>' : ''}</div>${lines}<div class="rl-f muted small">${esc(facts)}</div></li>`;
  }).join('');
  const out = [items ? win({ id: 'w-lraces', title: 'Leader Races', label: 'TOP TWO', cls: 'long', body: `<ul class="race-list" data-flow>${items}</ul>` }) : ''];
  const name = (k: string) => ({ AVG: 'average', HR: 'homers', RBI: 'RBI', W: 'wins', SO: 'strikeouts', ERA: 'ERA' })[k] ?? k;
  const crown = crownWatch(g).filter((x) => x.pitching === pitching);
  if (crown.length) out.push(win({ id: 'w-crown', title: 'Triple Crown', label: 'WATCH', body: `<ul class="chase-list" data-flow>${crown.map((x) => `<li${mineCls(g, x.playerId)}>${who(g, x.playerId)}<span class="small">${x.leads.length === 3 ? 'Leads all three' : `Leads ${x.leads.map(name).join(' and ')}; ${x.chasing.map((c) => `${c.behind} back in ${name(c.cat)}`).join(', ')}`}</span></li>`).join('')}</ul>` }));
  const pitchKeys = new Set(['W', 'SO', 'SV', 'ERA']);
  const rc = recordChases(g).filter((c) => pitchKeys.has(c.key) === pitching);
  const ms = milestoneChases(g).filter((c) => pitchKeys.has(c.key) === pitching).slice(0, 8);
  const list = (cs: typeof ms) => `<ul class="chase-list" data-flow>${cs.map((c) => `<li${mineCls(g, c.playerId)}>${who(g, c.playerId)}<span class="small">${esc(c.text)}</span></li>`).join('')}</ul>`;
  if (rc.length || ms.length) out.push(win({ id: 'w-chases', title: 'Chases', label: 'RECORDS AND MILESTONES', cls: 'long', body: `${rc.length ? `<h3 class="sub-h">RECORD PACE</h3>${list(rc)}` : ''}${ms.length ? `<h3 class="sub-h">CAREER MILESTONES</h3>${list(ms)}` : ''}` }));
  const body = out.filter(Boolean).join('');
  return body ? `<div class="cards flow fill">${body}</div>` : '<p class="note">No races yet. Leaders need a few games to qualify.</p>';
}

function streaksView(g: Game, s: LeadState): string {
  const st = activeStreaks(g);
  const list = (id: string, title: string, rows: Array<[number, number]>, shown: (v: number) => string, best: [number, number]) => {
    if (!rows.length && !best[0]) return '';
    const body = `${rows.length ? `<ol class="lead-list" data-flow>${rows.map(([pid, v], i) => `<li${mineCls(g, pid)}><span class="rank">${i + 1}</span><span class="nm">${who(g, pid)}</span><span class="val">${shown(v)}</span></li>`).join('')}</ol>` : ''}${best[0] ? `<p class="note muted small">Year's best: ${esc(g.name(best[1]))}, ${shown(best[0])}</p>` : ''}`;
    return win({ id, title, label: 'ACTIVE', body, cls: 'long' });
  };
  const games = (v: number) => `${v} G`, inn = (v: number) => `${inningsText(v)} IP`;
  const players = s.side === 'bat'
    ? list('w-st-hit', 'Hitting Streaks', st.hit, games, st.best.hit) + list('w-st-ob', 'On-Base Streaks', st.onBase, games, st.best.onBase)
    : list('w-st-zero', 'Scoreless Streaks', st.scoreless, inn, st.best.scoreless);
  const teams = g.league.teams.map((t) => g.season.standings.get(t.id)!).filter((r) => heat(r) !== 0).sort((a, b) => b.streak - a.streak);
  const teamWin = (id: string, title: string, rows: typeof teams) => rows.length ? win({ id, title, label: 'TEAMS', cls: 'long', body: ttable('minmax(0, 1fr) 52px 52px', title, thead(['TEAM', 'STK', 'L10']) + rows.map((r) => trow([link(teamName(r.teamId), 'team', { id: r.teamId }), streakTone(r), last10Tone(r)], heat(r), r.teamId === g.userTeam)).join('')).replace('class="ttable"', 'class="ttable" data-flow') }) : '';
  const fire = teamWin('w-hot', "Who's Hot", teams.filter((r) => heat(r) > 0)) + teamWin('w-cold', "Who's Cold", teams.filter((r) => heat(r) < 0).reverse());
  const all = players + fire;
  return all ? `<div class="cards flow fill">${all}</div>` : '<p class="note">No streaks worth watching yet.</p>';
}

function formView(app: App, s: LeadState): string {
  const g = app.game!, days = app.formDays, f = hotCold(g, days);
  const win2 = (id: string, title: string, rows: Form[], stat: string) => win({
    id, title, label: `LAST ${days} DAYS`, scroll: true,
    body: rows.length ? `<ol class="lead-list form-list">${rows.map((r, i) => `<li${mineCls(g, r.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, r.id)}<span class="muted small"> ${esc(r.line)} · season ${r.season}</span></span><span class="val">${r.shown}</span></li>`).join('')}</ol>` : `<p class="note muted small">Not enough ${stat} yet.</p>`,
  });
  const days$ = `<div class="tabs small-tabs" role="group" aria-label="Window">${FORM_WINDOWS.map((d) => `<button type="button" class="tab${d === days ? ' on' : ''}" data-act="form-days" data-days="${d}" data-key="form-days:${d}" aria-pressed="${d === days}">LAST ${d}</button>`).join('')}</div>`;
  const body = s.side === 'bat' ? win2('w-hot-b', 'Hot Bats · OPS', f.hotBats, 'at-bats') + win2('w-cold-b', 'Cold Bats · OPS', f.coldBats, 'at-bats')
    : win2('w-hot-p', 'Hot Arms · ERA', f.hotArms, 'innings') + win2('w-cold-p', 'Cold Arms · ERA', f.coldArms, 'innings');
  return `${days$}<div class="two-col fill">${body}</div>`;
}

/** The season's highest-Drama games: the last 30 days and the whole year. Click one for its box score. */
function bigGames(app: App): string {
  const g = app.game!;
  const all = g.season.results.map((r, i) => ({ r, i })).filter((x) => x.r.log).map(({ r, i }) => { const d = gameDrama(r.log!, r.innings); return { r, i, d: d.score, s: d.swing }; });
  if (!all.length) return '<p class="note">No games yet. The big ones show up here as the season is played.</p>';
  const list = (rows: typeof all) => `<ol class="lead-list big-list" data-flow>${rows.map((x, n) => {
    const [a, h] = x.r.teamIds, mine = x.r.teamIds.includes(g.userTeam);
    const tag = x.r.innings > 9 ? ` <span class="muted small">(${x.r.innings})</span>` : '';
    const when = `${shortDate(x.r.day)}${x.r.kind === 'post' ? ', postseason' : x.r.kind === 'tiebreak' ? ', Game 163' : ''}${x.r.innings > 9 ? `, ${x.r.innings} innings` : ''}`;
    return `<li${mine ? ' class="mine"' : ''}><span class="rank">${n + 1}</span><span class="nm"><button type="button" class="link" data-act="go" data-to="games" data-index="${x.i}" data-key="big:${x.i}" title="${esc(when)}: open the box score">${esc(teamName(a))} ${x.r.score[0]}, ${esc(teamName(h))} ${x.r.score[1]}</button>${tag}</span><span class="val drama-n ${x.d >= 78 ? 'd-hot' : x.d >= 55 ? 'd-warm' : 'd-cool'}">${x.d}</span></li>`;
  }).join('')}</ol>`;
  const byD = (p: typeof all) => [...p].sort((x, y) => y.d - x.d || y.s - x.s || y.r.day - x.r.day).slice(0, 12);
  const recent = byD(all.filter((x) => x.r.day > g.day - 30));
  const mine = byD(all.filter((x) => x.r.teamIds.includes(g.userTeam)));
  return `<div class="cards flow fill">${win({ id: 'w-big-30', title: 'Last 30 Days', label: 'BY DRAMA', body: list(recent), cls: 'long' })}${win({ id: 'w-big-y', title: `Year ${g.year}`, label: 'THE BIGGEST SO FAR', body: list(byD(all)), cls: 'long' })}${win({ id: 'w-big-me', title: teamName(g.userTeam), label: 'YOUR BIGGEST', body: mine.length ? list(mine) : '<p class="note muted small">No games yet.</p>', cls: 'long' })}</div>
<p class="note muted small">Drama: how hard a game's win probability swung, 0 to 100. A typical game is about 40.</p>`;
}

export function storylinesView(app: App): string {
  const g = app.game!, s = app.lead;
  const scope: Scope = s.scope === 'all' ? 'all' : (Number(s.scope) as 0 | 1);
  const sec = SECTIONS.some(([k]) => k === s.view) ? s.view : 'race';
  const nav = `<nav class="paper-nav" aria-label="Sections">${SECTIONS.map(([k, t]) => `<button type="button" class="paper-sec${sec === k ? ' on' : ''}" data-act="lead" data-k="view" data-v="${k}" data-key="lead:view:${k}" aria-pressed="${sec === k}">${t}</button>`).join('<span class="paper-dot" aria-hidden="true">·</span>')}</nav>`;
  const filters = sec === 'leaders' || sec === 'lraces' || sec === 'streaks' || sec === 'form'
    ? `<div class="lead-filters">${sec === 'leaders' || sec === 'lraces' ? tabs('scope', s.scope, [['all', 'ALL'], ['0', LEAGUES[0].toUpperCase()], ['1', LEAGUES[1].toUpperCase()]], 'League') : ''}${tabs('side', s.side, [['bat', 'HITTING'], ['pit', 'PITCHING']], 'Side')}${sec === 'leaders' ? tabs('when', s.when, [['season', `YEAR ${g.year}`], ['alltime', 'ALL TIME']], 'When') : ''}</div>` : '';
  const body = sec === 'race' ? `<div class="two-col fill race-cols">${[0, 1].map((lg) => playoffRaceWin(g, lg)).join('')}</div><p class="note muted small race-key">M magic number: wins plus rival losses to clinch. E elimination number. DIV and IN: odds from simming the rest of the season. z clinched the division, x clinched a spot, e eliminated.</p>`
    : sec === 'leaders' ? leadersCards(g, s, scope) : sec === 'lraces' ? racesView(g, s, scope) : sec === 'streaks' ? streaksView(g, s) : sec === 'form' ? formView(app, s)
    : sec === 'big' ? bigGames(app) : gameLogBody(app);
  const mast = `<header class="paper-mast"><span class="paper-ear">${esc(dateLabel(g.day))}<br>YEAR ${g.year} · ${esc(teamName(g.userTeam).toUpperCase())} EDITION</span><h1 class="paper-name">The Gazette</h1><span class="paper-ear">ALL THE NEWS THE GODS<br>SEE FIT TO PRINT</span></header>`;
  return page(app, 'storylines', `<div class="paper fill"><div class="paper-in">${mast}${nav}${filters ? `<div class="lead-head">${filters}</div>` : ''}<div class="paper-body fill sec-${sec}">${body}</div></div></div>`, true);
}
