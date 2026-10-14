/**
 * Leaders: one screen, five views. LEADERS (top ten per category, this season or all time), RACES (the top two,
 * the Triple Crown watch and chases), STREAKS, HOT & COLD and RECORDS. Filters: the whole league or one league,
 * hitting or pitching.
 */
import type { App } from '../app';
import { BAT, careerMin, PIT, board, careerRecords, seasonRecords, type Cat, type RecordRow, type Scope } from '../leaders';
import { activeStreaks, crownWatch, FORM_WINDOWS, hotCold, inningsText, leaderRaces, milestoneChases, recordChases, type Form } from '../races';
import type { Game } from '../state';
import { heat, last10Tone, streakTone } from '../stats';
import { LEAGUES, teamName } from '../teams';
import { esc, link, teamChip, thead, trow, ttable, win } from './common';
import { page } from './screens';

export type LeadView = 'leaders' | 'races' | 'streaks' | 'form' | 'records';
export interface LeadState { view: LeadView; scope: 'all' | '0' | '1'; side: 'bat' | 'pit'; when: 'season' | 'alltime' }

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
    const body = `<ol class="lead-list">${rows.map((l, i) => `<li${mineCls(g, l.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, l.id)}</span><span class="val">${l.shown}</span></li>`).join('')}</ol>`;
    return win({ id: `w-l-${c.key}`, title: c.key, label: c.label.toUpperCase(), body });
  };
  const cards = cats.map(card).join('');
  const note = s.when === 'alltime'
    ? `<p class="note muted small">All time counts completed seasons; this year joins once it ends. Rate leaders need ${s.side === 'bat' ? `${careerMin(g.league.history.length).PA} plate appearances` : `${careerMin(g.league.history.length).outs / 3} innings`}.</p>`
    : '';
  return cards ? `${note}<div class="cards">${cards}</div>` : `<p class="note">${s.when === 'alltime' ? 'No completed seasons yet. All-time leaders start after Year 1.' : 'No leaders yet. Play a few games.'}</p>`;
}

function racesView(g: Game, s: LeadState, scope: Scope): string {
  const pitching = s.side === 'pit';
  const items = leaderRaces(g, scope).filter((r) => r.pitching === pitching && r.top.length).map((r) => {
    const close = r.top.length > 1 && r.closeness <= 1;
    const facts = [r.gap && `${r.closeness === 0 ? 'tied' : `by ${r.gap}`}`, r.pace !== null && `pace ${r.pace}`].filter(Boolean).join(' · ');
    const lines = r.top.slice(0, 2).map((t, i) => `<div class="rl-p"${mineCls(g, t.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, t.id)}</span><span class="val">${t.shown}</span></div>`).join('');
    return `<li class="${close ? 'close' : ''}"><div class="rl-h"><span class="k">${esc(r.label.toUpperCase())}</span>${close ? '<span class="tag">CLOSE</span>' : ''}</div>${lines}<div class="rl-f muted small">${esc(facts)}</div></li>`;
  }).join('');
  const out = [items ? win({ id: 'w-lraces', title: 'Leader Races', label: 'TOP TWO', body: `<ul class="race-list">${items}</ul>` }) : ''];
  const name = (k: string) => ({ AVG: 'average', HR: 'homers', RBI: 'RBI', W: 'wins', SO: 'strikeouts', ERA: 'ERA' })[k] ?? k;
  const crown = crownWatch(g).filter((x) => x.pitching === pitching);
  if (crown.length) out.push(win({ id: 'w-crown', title: 'Triple Crown', label: 'WATCH', body: `<ul class="chase-list">${crown.map((x) => `<li${mineCls(g, x.playerId)}>${who(g, x.playerId)}<span class="small">${x.leads.length === 3 ? 'Leads all three' : `Leads ${x.leads.map(name).join(' and ')}; ${x.chasing.map((c) => `${c.behind} back in ${name(c.cat)}`).join(', ')}`}</span></li>`).join('')}</ul>` }));
  const pitchKeys = new Set(['W', 'SO', 'SV', 'ERA']);
  const rc = recordChases(g).filter((c) => pitchKeys.has(c.key) === pitching);
  const ms = milestoneChases(g).filter((c) => pitchKeys.has(c.key) === pitching).slice(0, 8);
  const list = (cs: typeof ms) => `<ul class="chase-list">${cs.map((c) => `<li${mineCls(g, c.playerId)}>${who(g, c.playerId)}<span class="small">${esc(c.text)}</span></li>`).join('')}</ul>`;
  if (rc.length || ms.length) out.push(win({ id: 'w-chases', title: 'Chases', label: 'RECORDS AND MILESTONES', body: `${rc.length ? `<h3 class="sub-h">RECORD PACE</h3>${list(rc)}` : ''}${ms.length ? `<h3 class="sub-h">CAREER MILESTONES</h3>${list(ms)}` : ''}` }));
  const body = out.filter(Boolean).join('');
  return body ? `<div class="cards">${body}</div>` : '<p class="note">No races yet. Leaders need a few games to qualify.</p>';
}

function streaksView(g: Game, s: LeadState): string {
  const st = activeStreaks(g);
  const list = (id: string, title: string, rows: Array<[number, number]>, shown: (v: number) => string, best: [number, number]) => {
    if (!rows.length && !best[0]) return '';
    const body = `${rows.length ? `<ol class="lead-list">${rows.map(([pid, v], i) => `<li${mineCls(g, pid)}><span class="rank">${i + 1}</span><span class="nm">${who(g, pid)}</span><span class="val">${shown(v)}</span></li>`).join('')}</ol>` : ''}${best[0] ? `<p class="note muted small">Year's best: ${esc(g.name(best[1]))}, ${shown(best[0])}</p>` : ''}`;
    return win({ id, title, label: 'ACTIVE', body });
  };
  const games = (v: number) => `${v} G`, inn = (v: number) => `${inningsText(v)} IP`;
  const players = s.side === 'bat'
    ? list('w-st-hit', 'Hitting Streaks', st.hit, games, st.best.hit) + list('w-st-ob', 'On-Base Streaks', st.onBase, games, st.best.onBase)
    : list('w-st-zero', 'Scoreless Streaks', st.scoreless, inn, st.best.scoreless);
  const teams = g.league.teams.map((t) => g.season.standings.get(t.id)!).filter((r) => heat(r) !== 0).sort((a, b) => b.streak - a.streak);
  const fire = teams.length ? win({ id: 'w-fire', title: 'Fire and Ice', label: 'TEAMS', body: ttable('minmax(0, 1fr) 52px 52px', 'Team streaks', thead(['TEAM', 'STK', 'L10']) + teams.map((r) => trow([link(teamName(r.teamId), 'team', { id: r.teamId }), streakTone(r), last10Tone(r)], heat(r), r.teamId === g.userTeam)).join('')) }) : '';
  const all = players + fire;
  return all ? `<div class="cards">${all}</div>` : '<p class="note">No streaks worth watching yet.</p>';
}

function formView(app: App, s: LeadState): string {
  const g = app.game!, days = app.formDays, f = hotCold(g, days);
  const win2 = (id: string, title: string, rows: Form[], stat: string) => win({
    id, title, label: `LAST ${days} DAYS`,
    body: rows.length ? `<ol class="lead-list form-list">${rows.map((r, i) => `<li${mineCls(g, r.id)}><span class="rank">${i + 1}</span><span class="nm">${who(g, r.id)}<span class="muted small"> ${esc(r.line)} · season ${r.season}</span></span><span class="val">${r.shown}</span></li>`).join('')}</ol>` : `<p class="note muted small">Not enough ${stat} yet.</p>`,
  });
  const days$ = `<div class="tabs small-tabs" role="group" aria-label="Window">${FORM_WINDOWS.map((d) => `<button type="button" class="tab${d === days ? ' on' : ''}" data-act="form-days" data-days="${d}" data-key="form-days:${d}" aria-pressed="${d === days}">LAST ${d}</button>`).join('')}</div>`;
  const body = s.side === 'bat' ? win2('w-hot-b', 'Hot Bats · OPS', f.hotBats, 'at-bats') + win2('w-cold-b', 'Cold Bats · OPS', f.coldBats, 'at-bats')
    : win2('w-hot-p', 'Hot Arms · ERA', f.hotArms, 'innings') + win2('w-cold-p', 'Cold Arms · ERA', f.coldArms, 'innings');
  return `${days$}<div class="cards">${body}</div>`;
}

function recordsView(g: Game, s: LeadState): string {
  const table = (rows: RecordRow[], career: boolean) => {
    const cols = '56px 76px minmax(0, 1.2fr) minmax(0, 2fr)';
    const head = thead(['STAT', 'RECORD', 'HELD BY', career ? 'CLOSEST ACTIVE' : 'THIS YEAR']);
    const body = rows.map((r) => {
      const holder = r.best ? `${link(g.name(r.best.id), 'player', { id: r.best.id })}${r.best.year ? ` <span class="muted small">Y${r.best.year}</span>` : ''}` : '<span class="muted">—</span>';
      const chase = r.chase ? `${link(g.name(r.chase.id), 'player', { id: r.chase.id })} <span class="${r.chase.closeness >= 1 ? 'pos' : 'small'}">${r.chase.closeness >= 1 && !r.chase.pace ? 'past it: ' : ''}${r.cat.fmt(r.chase.value)}${r.chase.pace ? `, pace ${r.chase.pace}` : ''}</span>` : '<span class="muted">—</span>';
      return trow([`<span title="${esc(r.cat.label)}">${esc(r.cat.key)}</span>`, r.best ? r.cat.fmt(r.best.value) : '—', holder, chase], 0, !!r.chase && g.teamOf.get(r.chase.id) === g.userTeam);
    }).join('');
    return `<div class="hscroll">${ttable(cols, career ? 'Career records' : 'Single-season records', head + body).replace('class="ttable"', 'class="ttable full rec-t"')}</div>`;
  };
  if (!g.league.history.length) return '<p class="note">Records start once Year 1 is in the books: the first season sets every mark.</p>';
  const ss = seasonRecords(g, s.side), cr = careerRecords(g, s.side);
  return `<div class="two-col">${win({ id: 'w-rec-s', title: 'Single Season', label: 'LEAGUE RECORDS · CLOSE CHASES SHOWN', body: table(ss, false) })}
${win({ id: 'w-rec-c', title: 'Career', label: 'LEAGUE RECORDS · ACTIVE PLAYERS WITHIN 75%', body: table(cr, true) })}</div>
<p class="note muted small">THIS YEAR lists a leader on pace for 90% of a counting record, or within 3% of a rate record (after 30 games). Records count completed seasons.</p>`;
}

export function leadersView(app: App): string {
  const g = app.game!, s = app.lead;
  const scope: Scope = s.scope === 'all' ? 'all' : (Number(s.scope) as 0 | 1);
  const views: Array<[LeadView, string]> = [['leaders', 'LEADERS'], ['races', 'RACES'], ['streaks', 'STREAKS'], ['form', 'HOT & COLD'], ['records', 'RECORDS']];
  const filters = [
    tabs('view', s.view, views, 'View'),
    `<div class="lead-filters">${s.view === 'leaders' || s.view === 'races' ? tabs('scope', s.scope, [['all', 'ALL'], ['0', LEAGUES[0].toUpperCase()], ['1', LEAGUES[1].toUpperCase()]], 'League') : ''}${tabs('side', s.side, [['bat', 'HITTING'], ['pit', 'PITCHING']], 'Side')}${s.view === 'leaders' ? tabs('when', s.when, [['season', `YEAR ${g.year}`], ['alltime', 'ALL TIME']], 'When') : ''}</div>`,
  ].join('');
  const body = s.view === 'leaders' ? leadersCards(g, s, scope) : s.view === 'races' ? racesView(g, s, scope) : s.view === 'streaks' ? streaksView(g, s) : s.view === 'form' ? formView(app, s) : recordsView(g, s);
  return page(app, 'leaders', `<div class="lead-head">${filters}</div>${body}`);
}
