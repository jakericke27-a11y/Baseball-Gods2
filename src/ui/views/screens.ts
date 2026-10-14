/** Full screens behind the footer icons: standings, games and box scores, leaders, roster, game log, news. */
import { decodeEvents, eventText, halfLabel, POS_ABBR } from '../../engine/game/text';
import type { GameResult } from '../../engine/game/types';
import { peekStarter, recoveredFatigue } from '../../engine/season/season';
import { formatStart } from '../../engine/season/schedule';
import type { App } from '../app';
import { dateLabel, shortDate } from '../calendar';
import type { Game } from '../state';
import { BAT_CATS, PIT_CATS, avg, era, era2, gbText, heat, ip, last10, leaders, obp, pct, races, rate3, slg, streakText, whip } from '../stats';
import { bracketHtml, findSeries, FINAL_NAME, seriesShort } from '../post';
import { DIVISIONS, LEAGUES, teamName } from '../teams';
import { bannerFor, simActions } from './home';
import { btn, esc, footer, link, r5, thead, trow, ttable, win } from './common';

const page = (app: App, current: string, inner: string) =>
  `<div class="frame screen-page">${bannerFor(app.game!)}<main class="main page" id="main" data-scroll="page-${current}">${inner}</main>${footer(current, simActions(app.game!))}</div>`;

// ------------------------------------------------------------------ standings

export function standingsView(app: App): string {
  const g = app.game!;
  const cols = 'minmax(90px, 1fr) 32px 32px 46px 42px 40px 38px 40px 40px 44px 50px 50px';
  const cols2 = 'minmax(90px, 1fr) 32px 32px 46px 42px 40px 38px';
  const head = thead(['TEAM', 'W', 'L', 'PCT', 'GB', 'L10', 'STK', '<span class="x">RS</span>', '<span class="x">RA</span>', '<span class="x">DIFF</span>', '<span class="x">HOME</span>', '<span class="x">AWAY</span>']);
  const cols3 = races(g).map((race) => {
    const divs = race.divisions.map((d) => {
      const rows = d.rows.map((r) => {
        const diff = r.RS - r.RA;
        return trow([link(teamName(r.teamId), 'team', { id: r.teamId }), String(r.W), String(r.L), rate3(pct(r)), gbText(r.gb), last10(r), streakText(r),
          `<span class="x">${r.RS}</span>`, `<span class="x">${r.RA}</span>`, `<span class="x">${diff > 0 ? '+' + diff : diff}</span>`,
          `<span class="x">${r.homeW}-${r.homeL}</span>`, `<span class="x">${r.awayW}-${r.awayL}</span>`], heat(r), r.teamId === g.userTeam);
      }).join('');
      return win({ id: `w-st-${race.league}-${d.division}`, title: DIVISIONS[d.division], label: LEAGUES[race.league].toUpperCase(), body: `<div class="hscroll">${ttable(cols, `${LEAGUES[race.league]} ${DIVISIONS[d.division]}`, head + rows).replace('class="ttable"', 'class="ttable full"')}</div>` });
    }).join('');
    let wc = '';
    race.wildCard.forEach((w, i) => {
      const gb = i < 2 ? (w.gb === 0 ? '—' : `+${(-w.gb).toFixed(1)}`) : gbText(w.gb);
      wc += trow([link(teamName(w.row.teamId), 'team', { id: w.row.teamId }), String(w.row.W), String(w.row.L), rate3(pct(w.row)), gb, last10(w.row), streakText(w.row)], heat(w.row), w.row.teamId === g.userTeam);
      if (i === 1) wc += '<div class="playoff-line" role="presentation">PLAYOFF LINE</div>';
    });
    const seeds = race.divisions.map((d) => d.rows[0]).sort((a, b) => pct(b) - pct(a));
    const picture = [...seeds.map((r, i) => `<li><span class="seed">${i + 1}</span>${link(teamName(r.teamId), 'team', { id: r.teamId })} <span class="muted">${r.W}-${r.L} · ${DIVISIONS[race.divisions.find((d) => d.rows[0] === r)!.division]}</span></li>`),
      ...race.wildCard.slice(0, 2).map((w, i) => `<li><span class="seed">${i + 4}</span>${link(teamName(w.row.teamId), 'team', { id: w.row.teamId })} <span class="muted">${w.row.W}-${w.row.L} · Wild card</span></li>`)].join('');
    return `<div class="league-col"><h2 class="page-h">${LEAGUES[race.league]}</h2>
${g.season.post?.seeds.length ? '' : win({ id: `w-pic-${race.league}`, title: 'Playoff Picture', label: 'IF IT ENDED TODAY', body: `<ol class="seeds">${picture}</ol>` })}
${divs}${win({ id: `w-wc-${race.league}`, title: 'Wild Card', label: LEAGUES[race.league].toUpperCase(), body: ttable(cols2, 'Wild card race', thead(['TEAM', 'W', 'L', 'PCT', 'GB', 'L10', 'STK']) + wc) })}</div>`;
  }).join('');
  const P = g.season.post;
  const bracket = P?.seeds.length ? win({ id: 'w-bracket', title: 'Postseason', label: P.champion ? `${FINAL_NAME.toUpperCase()} CHAMPIONS: ${teamName(P.champion).toUpperCase()}` : 'THE BRACKET', body: bracketHtml(g, esc, link), cls: 'w-bracket wide' }) : '';
  return page(app, 'standings', `${bracket}<div class="two-col">${cols3}</div>`);
}

// ------------------------------------------------------------------ games and box scores

function boxScoreHtml(g: Game, r: GameResult, index: number): string {
  const innings = Math.max(9, r.lineScore[0].length);
  const ls = `<div class="hscroll"><table class="linescore small"><tr><th scope="col" class="ls-team"></th>${Array.from({ length: innings }, (_, i) => `<th scope="col">${i + 1}</th>`).join('')}<th class="ls-gap"></th><th scope="col">R</th><th scope="col">H</th><th scope="col">E</th></tr>
${[0, 1].map((side) => `<tr${r.teamIds[side] === g.userTeam ? ' class="mine"' : ''}><th scope="row" class="ls-team">${esc(teamName(r.teamIds[side]))}</th>${Array.from({ length: innings }, (_, i) => `<td>${i < r.lineScore[side].length ? r.lineScore[side][i] : side === 1 && i === r.lineScore[1].length && i < r.innings ? 'x' : ''}</td>`).join('')}<td class="ls-gap"></td><td class="rhe">${r.score[side]}</td><td class="rhe">${r.hits[side]}</td><td class="rhe">${r.errors[side]}</td></tr>`).join('')}</table></div>`;
  const bat = (side: 0 | 1) => {
    const notes: Record<string, string[]> = { '2B': [], '3B': [], HR: [], SB: [] };
    const rows = r.lineups[side].map((s) => {
      const b = r.batting.get(s.player.id)!;
      const nm = s.player.name;
      if (b.D) notes['2B'].push(nm + (b.D > 1 ? ` ${b.D}` : ''));
      if (b.T) notes['3B'].push(nm + (b.T > 1 ? ` ${b.T}` : ''));
      if (b.HR) notes.HR.push(nm + (b.HR > 1 ? ` ${b.HR}` : ''));
      if (b.SB) notes.SB.push(nm + (b.SB > 1 ? ` ${b.SB}` : ''));
      return `<tr><th scope="row">${link(nm, 'player', { id: s.player.id })} <span class="muted">${POS_ABBR[s.pos]}</span></th><td>${b.AB}</td><td>${b.R}</td><td>${b.H}</td><td>${b.RBI}</td><td>${b.BB}</td><td>${b.K}</td></tr>`;
    }).join('');
    const note = Object.entries(notes).filter(([, v]) => v.length).map(([k, v]) => `<p class="box-note"><b>${k}:</b> ${esc(v.join(', '))}</p>`).join('');
    return `<div class="box-side"><div class="hscroll"><table class="stat"><caption>${esc(teamName(r.teamIds[side]))}</caption><tr><th scope="col">BATTING</th><th scope="col">AB</th><th scope="col">R</th><th scope="col">H</th><th scope="col">RBI</th><th scope="col">BB</th><th scope="col">K</th></tr>${rows}</table></div>${note}</div>`;
  };
  const pit = (side: 0 | 1) => {
    const rows = r.pitchersUsed[side].map((id) => {
      const p = r.pitching.get(id)!;
      const dec = r.decisions.win === id ? ' (W)' : r.decisions.loss === id ? ' (L)' : r.decisions.save === id ? ' (S)' : '';
      return `<tr><th scope="row">${link(g.name(id), 'player', { id })}<span class="dec">${dec}</span></th><td>${ip(p.outs)}</td><td>${p.H}</td><td>${p.R}</td><td>${p.ER}</td><td>${p.BB}</td><td>${p.K}</td><td>${p.HR}</td><td>${p.P}</td></tr>`;
    }).join('');
    return `<div class="hscroll"><table class="stat"><caption>${esc(teamName(r.teamIds[side]))} pitching</caption><tr><th scope="col">PITCHING</th><th scope="col">IP</th><th scope="col">H</th><th scope="col">R</th><th scope="col">ER</th><th scope="col">BB</th><th scope="col">K</th><th scope="col">HR</th><th scope="col">P</th></tr>${rows}</table></div>`;
  };
  const acts = `<div class="row-actions">${btn('GAME LOG', 'go', { icon: 'scroll', data: { to: 'gamelog', index } })}${btn('REPLAY', 'replay', { icon: 'play', data: { index }, title: 'Watch this game pitch by pitch' })}</div>`;
  return `${ls}${acts}<div class="box-grid">${bat(0)}${bat(1)}</div><div class="box-grid">${pit(0)}${pit(1)}</div>`;
}

/** "AL DS G3 · " for postseason games, "GAME 163 · " for tiebreakers. */
function gameTag(g: Game, r: GameResult): string {
  const sr = findSeries(g, r.series);
  return sr ? `${esc(seriesShort(sr))} G${r.game} · ` : r.kind === 'tiebreak' ? 'GAME 163 · ' : '';
}

export function gamesView(app: App): string {
  const g = app.game!;
  const days = [...g.byDay.keys()].sort((a, b) => a - b);
  if (!days.length) {
    const today = g.season.schedule.byDay[g.nextGameDay()] ?? [];
    const rows = today.map((s) => `<li class="sched${s.home === g.userTeam || s.away === g.userTeam ? ' mine' : ''}"><span>${esc(teamName(s.away))} at ${esc(teamName(s.home))}</span><span class="muted">${formatStart(s.start)}</span><span class="muted small">${esc(g.name(peekStarter(g.season, s.away).id))} vs ${esc(g.name(peekStarter(g.season, s.home).id))}</span></li>`).join('');
    return page(app, 'games', `<div class="games-layout">${win({ id: 'w-sched', title: 'Today', label: dateLabel(g.day), body: `<ul class="sched-list">${rows}</ul>`, scroll: true })}${win({ id: 'w-box', title: 'Box Score', body: '<p class="note">No games have been played yet. Sim a day, or watch your team from the home screen.</p>' })}</div>`);
  }
  if (!days.includes(app.gamesDay)) app.gamesDay = days[days.length - 1];
  const day = app.gamesDay;
  const idx = g.byDay.get(day)!;
  if (!idx.includes(app.gamesPick)) app.gamesPick = idx.find((i) => g.season.results[i].teamIds.includes(g.userTeam)) ?? idx[0];
  const di = days.indexOf(day);
  const cards = idx.map((i) => {
    const r = g.season.results[i];
    const wNm = r.decisions.win ? g.name(r.decisions.win) : '', lNm = r.decisions.loss ? g.name(r.decisions.loss) : '';
    const side = (s: 0 | 1) => `<span class="sc-team${r.score[s] > r.score[1 - s] ? ' won' : ''}">${esc(teamName(r.teamIds[s]))}</span><span class="sc-runs${r.score[s] > r.score[1 - s] ? ' won' : ''}">${r.score[s]}</span>`;
    const mine = r.teamIds.includes(g.userTeam);
    return `<li><button type="button" class="score-card${i === app.gamesPick ? ' picked' : ''}${mine ? ' mine' : ''}" data-act="games-pick" data-index="${i}" data-key="games-pick:${i}" aria-pressed="${i === app.gamesPick}">
<span class="sc-row">${side(0)}</span><span class="sc-row">${side(1)}</span><span class="sc-meta">${gameTag(g, r)}F${r.innings > 9 ? `/${r.innings}` : ''} · W ${esc(wNm)} · L ${esc(lNm)}</span></button></li>`;
  }).join('');
  const nav = `<div class="day-nav">${btn('', 'games-day', { icon: 'left', data: { step: -1 }, disabled: di <= 0, title: 'Previous day', cls: 'btn-icon' })}<span class="day-label">${dateLabel(day)}</span>${btn('', 'games-day', { icon: 'right', data: { step: 1 }, disabled: di >= days.length - 1, title: 'Next day', cls: 'btn-icon' })}</div>`;
  const r = g.season.results[app.gamesPick];
  const box = win({ id: 'w-box', title: 'Box Score', label: `${esc(teamName(r.teamIds[0])).toUpperCase()} AT ${esc(teamName(r.teamIds[1])).toUpperCase()} · ${shortDate(r.day)}`, body: boxScoreHtml(g, r, app.gamesPick), scroll: true, cls: 'w-boxscore' });
  return page(app, 'games', `<div class="games-layout">${win({ id: 'w-scores', title: 'Scoreboard', label: `${idx.length} GAMES`, body: `${nav}<ul class="score-list">${cards}</ul>`, scroll: true, cls: 'w-scores' })}${box}</div>`);
}

// ------------------------------------------------------------------ leaders

export function leadersView(app: App): string {
  const g = app.game!;
  const cat = (key: string, label: string) => {
    const rows = leaders(g, key, 10);
    const body = rows.length ? `<ol class="lead-list">${rows.map((l, i) => `<li class="${g.teamOf.get(l.id) === g.userTeam ? 'mine' : ''}"><span class="rank">${i + 1}</span><span class="nm">${link(g.name(l.id), 'player', { id: l.id })} <span class="muted">${esc(teamName(g.teamOf.get(l.id) ?? 0))}</span></span><span class="val">${l.shown}</span></li>`).join('')}</ol>`
      : '<p class="note muted">No qualifiers yet.</p>';
    return win({ id: `w-l-${key}`, title: key, label: label.toUpperCase(), body });
  };
  return page(app, 'leaders', `<h2 class="page-h">Batting</h2><div class="cards">${BAT_CATS.map((c) => cat(c.key, c.label)).join('')}</div>
<h2 class="page-h">Pitching</h2><div class="cards">${PIT_CATS.map((c) => cat(c.key, c.label)).join('')}</div>`);
}

// ------------------------------------------------------------------ roster

function fatigueBar(f: number): string {
  const n = Math.round(Math.min(100, f) / 10);
  return `<span class="fbar" role="img" aria-label="Fatigue ${Math.round(f)} of 100">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? (n >= 7 ? 'hot' : n >= 4 ? 'warm' : 'on') : ''}"></i>`).join('')}</span>`;
}

export function rosterView(app: App): string {
  const g = app.game!;
  const teamId = app.rosterTeam || g.userTeam;
  const plan = g.season.plans.get(teamId)!;
  const team = g.league.teams.find((t) => t.id === teamId)!;
  const players = team.playerIds.map((id) => g.players.get(id)!);
  const sel = `<label class="team-select"><span class="k">TEAM</span><select data-act="roster-team" id="roster-team">${g.league.teams.map((t) => `<option value="${t.id}"${t.id === teamId ? ' selected' : ''}>${esc(teamName(t.id))}${t.id === g.userTeam ? ' (you)' : ''}</option>`).join('')}</select></label>`;
  const batRow = (p: (typeof players)[0], order: string, pos: string) => {
    const l = g.season.batting.get(p.id), R = p.ratings;
    return `<tr><td>${order}</td><th scope="row">${link(p.name, 'player', { id: p.id })}</th><td>${pos}</td><td>${p.bats}</td><td>${p.age}</td><td>${r5(R.power)}</td><td>${r5(R.contact)}</td><td>${r5(R.discipline)}</td><td>${r5(R.speed)}</td><td>${r5(R.instincts)}</td><td>${r5(R.glove)}</td><td>${r5(R.cannon)}</td>
<td>${l ? rate3(avg(l)) : '—'}</td><td>${l ? rate3(obp(l)) : '—'}</td><td>${l ? rate3(slg(l)) : '—'}</td><td>${l?.HR ?? 0}</td><td>${l?.RBI ?? 0}</td><td>${l?.SB ?? 0}</td></tr>`;
  };
  const batHead = '<tr><th scope="col">#</th><th scope="col">NAME</th><th scope="col">POS</th><th scope="col">B</th><th scope="col">AGE</th><th scope="col">POW</th><th scope="col">CON</th><th scope="col">EYE</th><th scope="col">SPD</th><th scope="col">RNG</th><th scope="col">GLV</th><th scope="col">ARM</th><th scope="col">AVG</th><th scope="col">OBP</th><th scope="col">SLG</th><th scope="col">HR</th><th scope="col">RBI</th><th scope="col">SB</th></tr>';
  const lineup = plan.lineup.map((s, i) => batRow(s.player, String(i + 1), POS_ABBR[s.pos])).join('');
  const inLineup = new Set(plan.lineup.map((s) => s.player.id));
  const bench = players.filter((p) => p.position !== 'P' && !inLineup.has(p.id)).map((p) => batRow(p, '', p.position)).join('');
  const armRow = (p: (typeof players)[0], lead: string, isStarter: boolean) => {
    const l = g.season.pitching.get(p.id), R = p.ratings;
    const f = recoveredFatigue(g.season, p.id);
    return `<tr><td>${lead}</td><th scope="row">${link(p.name, 'player', { id: p.id })}</th><td>${p.throws}</td><td>${p.age}</td><td>${r5(R.velocity)}</td><td>${r5(R.control)}</td><td>${r5(R.movement)}</td><td>${r5(R.stamina)}</td><td>${fatigueBar(f)}</td>
<td>${l ? `${l.W}-${l.L}` : '0-0'}</td><td>${l ? era2(era(l)) : '—'}</td><td>${l ? ip(l.outs) : '0.0'}</td><td>${l?.K ?? 0}</td><td>${isStarter ? (l?.GS ?? 0) : (l?.SV ?? 0)}</td><td>${l ? whip(l).toFixed(2) : '—'}</td></tr>`;
  };
  const armHead = (last: string) => `<tr><th scope="col"></th><th scope="col">NAME</th><th scope="col">T</th><th scope="col">AGE</th><th scope="col">VEL</th><th scope="col">CTL</th><th scope="col">MOV</th><th scope="col">STA</th><th scope="col">FATIGUE</th><th scope="col">W-L</th><th scope="col">ERA</th><th scope="col">IP</th><th scope="col">SO</th><th scope="col">${last}</th><th scope="col">WHIP</th></tr>`;
  const rot = plan.rotation.map((p, i) => armRow(p, String(i + 1), true)).join('');
  const pen = plan.bullpen.map((a) => armRow(a.player, a.role, false)).join('');
  const inStaff = new Set([...plan.rotation, ...plan.bullpen.map((a) => a.player)].map((p) => p.id));
  const extra = players.filter((p) => p.position === 'P' && !inStaff.has(p.id)).map((p) => armRow(p, '—', false)).join('');
  const rs = g.season.standings.get(teamId)!;
  const tbl = (head: string, rows: string, label: string) => `<div class="hscroll"><table class="stat roster" aria-label="${label}">${head}${rows}</table></div>`;
  return page(app, 'roster', `<div class="roster-head"><div><h2 class="page-h">${esc(teamName(teamId))}</h2><p class="page-sub">${rs.W}-${rs.L} · ${LEAGUES[team.conference]} ${DIVISIONS[team.division]} · ${team.strategy.rotationSize}-man rotation</p></div>${sel}</div>
${win({ id: 'w-lineup', title: 'Lineup', label: 'BATTING ORDER', body: tbl(batHead, lineup, 'Lineup') })}
${win({ id: 'w-rot', title: 'Rotation', label: 'FATIGUE AS OF TODAY', body: tbl(armHead('GS'), rot, 'Rotation') })}
${win({ id: 'w-pen', title: 'Bullpen', label: 'CL CLOSER · SU SETUP · LR LONG · MR MIDDLE', body: tbl(armHead('SV'), pen, 'Bullpen') })}
${win({ id: 'w-bench', title: 'Bench & Reserves', label: 'NOT IN THE LINEUP OR STAFF', body: tbl(batHead, bench, 'Bench') + (extra ? tbl(armHead('SV'), extra, 'Reserve pitchers') : '') })}`);
}

// ------------------------------------------------------------------ game log

export function gameLogView(app: App): string {
  const g = app.game!;
  const mine = [...g.season.results.keys()].filter((i) => g.season.results[i].teamIds.includes(g.userTeam)).reverse();
  if (!g.season.results.length) {
    return page(app, 'gamelog', win({ id: 'w-log-empty', title: 'Game Log', body: '<p class="note">No games yet. The log fills in as the season is played.</p>' }));
  }
  if (app.logPick < 0 || !g.season.results[app.logPick]) app.logPick = mine[0] ?? g.season.results.length - 1;
  const r = g.season.results[app.logPick];
  const list = mine.map((i) => {
    const x = g.season.results[i];
    const side = x.teamIds[0] === g.userTeam ? 0 : 1;
    const won = x.score[side] > x.score[1 - side];
    return `<li><button type="button" class="glist${i === app.logPick ? ' picked' : ''}" data-act="log-pick" data-index="${i}" data-key="log-pick:${i}" aria-pressed="${i === app.logPick}"><span class="d">${shortDate(x.day)}</span><span class="o">${side ? 'vs' : 'at'} ${esc(teamName(x.teamIds[1 - side]))}</span><span class="res ${won ? 'good' : 'bad'}">${won ? 'W' : 'L'} ${x.score[side]}-${x.score[1 - side]}${x.innings > 9 ? ` (${x.innings})` : ''}</span></button></li>`;
  }).join('');
  // Play-by-play grouped by half-inning.
  const events = decodeEvents(r.log!);
  type Half = { key: number; inning: number; half: 0 | 1; lines: string[]; runs: number };
  const halves: Half[] = [];
  for (const ev of events) {
    const key = ev.inning * 2 + ev.half;
    let h = halves[halves.length - 1];
    if (!h || h.key !== key) { h = { key, inning: ev.inning, half: ev.half, lines: [], runs: 0 }; halves.push(h); }
    const runs = ev.type === 'pa' ? ev.runs : ev.type === 'wp' ? ev.moves.filter((m) => m.to === 4).length : 0;
    h.runs += runs;
    h.lines.push(`<p class="log-line${runs ? ' scored' : ''}${ev.type === 'change' ? ' change' : ''}">${esc(eventText(ev, g.name, app.settings.detail))}</p>`);
  }
  const pbp = halves.map((h) => `<details class="half" open><summary>${halfLabel(h.inning, h.half).toUpperCase()} — ${esc(teamName(r.teamIds[h.half])).toUpperCase()} <span class="half-runs">${h.runs} R</span></summary>${h.lines.join('')}</details>`).join('');
  const detail = `<label class="detail-pick"><span class="k">PITCH DETAIL</span><select data-act="set-detail" id="detail-pick"><option value="final"${app.settings.detail === 'final' ? ' selected' : ''}>Summary</option><option value="full"${app.settings.detail === 'full' ? ' selected' : ''}>Full sequences</option><option value="none"${app.settings.detail === 'none' ? ' selected' : ''}>Plays only</option></select></label>`;
  const acts = `<div class="row-actions">${detail}${btn('BOX SCORE', 'go', { icon: 'box', data: { to: 'games', index: app.logPick } })}${btn('REPLAY', 'replay', { icon: 'play', data: { index: app.logPick } })}</div>`;
  const title = `${esc(teamName(r.teamIds[0])).toUpperCase()} ${r.score[0]}, ${esc(teamName(r.teamIds[1])).toUpperCase()} ${r.score[1]}${r.innings > 9 ? ` (${r.innings})` : ''} · ${shortDate(r.day)}`;
  return page(app, 'gamelog', `<div class="games-layout">${win({ id: 'w-glist', title: 'Your Games', label: `${mine.length} PLAYED`, body: `<ul class="glist-list">${list}</ul>`, scroll: true, cls: 'w-scores' })}
${win({ id: 'w-pbp', title: 'Game Log', label: title, body: acts + pbp, scroll: true, cls: 'w-boxscore' })}</div>`);
}

// ------------------------------------------------------------------ news

export function newsView(app: App): string {
  const g = app.game!;
  const byDay = new Map<number, typeof g.headlines>();
  for (const h of g.headlines) { const a = byDay.get(h.day) ?? []; a.push(h); byDay.set(h.day, a); }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const body = days.length ? days.map((d) => `<h3 class="news-day">${dateLabel(d)}</h3><ul class="news-list">${byDay.get(d)!.map((h) => `<li class="${h.big ? 'big' : ''}${h.teamId === g.userTeam ? ' mine' : ''}">${esc(h.text)}</li>`).join('')}</ul>`).join('')
    : '<p class="note">No headlines yet. Big moments around the league show up here: walk-offs, slams, no-hitters, streaks and milestones.</p>';
  const winter = g.offseason ? `<div class="row-actions news-actions">${btn(`THE OFFSEASON BEFORE YEAR ${g.year}`, 'go', { data: { to: 'offseason' } })}</div>` : '';
  return page(app, 'news', winter + win({ id: 'w-news', title: 'Headlines', label: `${g.headlines.length} THIS YEAR`, body, cls: 'w-news' }));
}
