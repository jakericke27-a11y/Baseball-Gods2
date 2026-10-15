/** Full screens behind the footer icons: standings, games and box scores, leaders, roster, game log, news. */
import { decodeEvents, eventText, halfLabel, POS_ABBR } from '../../engine/game/text';
import type { GameResult } from '../../engine/game/types';
import { peekStarter, recoveredFatigue } from '../../engine/season/season';
import { formatStart } from '../../engine/season/schedule';
import { playerValue } from '../../engine/development';
import { activeOf, canOption, movesLeft, optionsLeft, RULES, waiverPlayer } from '../../engine/roster';
import { projection } from '../../engine/draft';
import type { App } from '../app';
import { dateLabel, shortDate } from '../calendar';
import type { Game } from '../state';
import { BAT_CATS, LOG_KEY, PIT_CATS, diffTone, last10Tone, playTone, recordTone, streakTone, avg, era, era2, gbText, heat, ip, last10, leaders, obp, pct, races, rate3, slg, streakText, whip } from '../stats';
import { bracketHtml, findSeries, FINAL_NAME, seriesShort } from '../post';
import { DIVISIONS, LEAGUE_NAMES, LEAGUES, teamFull, teamName } from '../teams';
import { bannerFor, simActions } from './home';
import { btn, dramaStrip, dramaTag, esc, footer, link, r5, thead, trow, ttable, win, tname } from './common';

/** A full screen. `fixed`: on a laptop or bigger it fits the window, and long lists scroll inside their windows. */
export const page = (app: App, current: string, inner: string, fixed = false) =>
  `<div class="frame screen-page">${bannerFor(app.game!)}<main class="main page${fixed ? ' page-fixed' : ''}" id="main" data-scroll="page-${current}">${inner}</main>${footer(current, simActions(app.game!))}</div>`;

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
        return trow([link(teamName(r.teamId), 'team', { id: r.teamId }), recordTone(r, String(r.W)), recordTone(r, String(r.L)), recordTone(r, rate3(pct(r))), gbText(r.gb), last10Tone(r), streakTone(r),
          `<span class="x">${r.RS}</span>`, `<span class="x">${r.RA}</span>`, `<span class="x">${diffTone(r)}</span>`,
          `<span class="x">${r.homeW}-${r.homeL}</span>`, `<span class="x">${r.awayW}-${r.awayL}</span>`], heat(r), r.teamId === g.userTeam);
      }).join('');
      return win({ id: `w-st-${race.league}-${d.division}`, title: DIVISIONS[d.division], label: LEAGUES[race.league].toUpperCase(), body: `<div class="hscroll">${ttable(cols, `${LEAGUES[race.league]} ${DIVISIONS[d.division]}`, head + rows).replace('class="ttable"', 'class="ttable full"')}</div>` });
    }).join('');
    let wc = '';
    race.wildCard.forEach((w, i) => {
      const gb = i < 2 ? (w.gb === 0 ? '—' : `+${(-w.gb).toFixed(1)}`) : gbText(w.gb);
      wc += trow([link(teamName(w.row.teamId), 'team', { id: w.row.teamId }), recordTone(w.row, String(w.row.W)), recordTone(w.row, String(w.row.L)), recordTone(w.row, rate3(pct(w.row))), gb, last10Tone(w.row), streakTone(w.row)], heat(w.row), w.row.teamId === g.userTeam);
      if (i === 1) wc += '<div class="playoff-line" role="presentation">PLAYOFF LINE</div>';
    });
    const seeds = race.divisions.map((d) => d.rows[0]).sort((a, b) => pct(b) - pct(a));
    const picture = [...seeds.map((r, i) => `<li><span class="seed">${i + 1}</span>${link(teamName(r.teamId), 'team', { id: r.teamId })} <span class="muted">${r.W}-${r.L} · ${DIVISIONS[race.divisions.find((d) => d.rows[0] === r)!.division]}</span></li>`),
      ...race.wildCard.slice(0, 2).map((w, i) => `<li><span class="seed">${i + 4}</span>${link(teamName(w.row.teamId), 'team', { id: w.row.teamId })} <span class="muted">${w.row.W}-${w.row.L} · Wild card</span></li>`)].join('');
    return `<div class="league-col"><h2 class="page-h">${LEAGUE_NAMES[race.league]}</h2>
${g.season.post?.seeds.length ? '' : win({ id: `w-pic-${race.league}`, title: 'Playoff Picture', label: 'IF IT ENDED TODAY', body: `<ol class="seeds">${picture}</ol>` })}
${divs}${win({ id: `w-wc-${race.league}`, title: 'Wild Card', label: LEAGUES[race.league].toUpperCase(), body: ttable(cols2, 'Wild card race', thead(['TEAM', 'W', 'L', 'PCT', 'GB', 'L10', 'STK']) + wc) })}</div>`;
  }).join('');
  const P = g.season.post;
  const bracket = P?.seeds.length ? win({ id: 'w-bracket', title: 'Postseason', label: P.champion ? `${FINAL_NAME.toUpperCase()} CHAMPIONS: ${teamName(P.champion).toUpperCase()}` : 'THE BRACKET', body: bracketHtml(g, esc, link), cls: 'w-bracket wide' }) : '';
  return page(app, 'standings', `${bracket}<div class="two-col">${cols3}</div>${pastSeasons(g)}`);
}

// ------------------------------------------------------------------ games and box scores

function boxScoreHtml(g: Game, r: GameResult, index: number): string {
  const innings = Math.max(9, r.lineScore[0].length);
  const ls = `<div class="hscroll"><table class="linescore small"><tr><th scope="col" class="ls-team"></th>${Array.from({ length: innings }, (_, i) => `<th scope="col">${i + 1}</th>`).join('')}<th class="ls-gap"></th><th scope="col">R</th><th scope="col">H</th><th scope="col">E</th></tr>
${[0, 1].map((side) => `<tr${r.teamIds[side] === g.userTeam ? ' class="mine"' : ''}><th scope="row" class="ls-team">${tname(r.teamIds[side])}</th>${Array.from({ length: innings }, (_, i) => `<td>${i < r.lineScore[side].length ? r.lineScore[side][i] : side === 1 && i === r.lineScore[1].length && i < r.innings ? 'x' : ''}</td>`).join('')}<td class="ls-gap"></td><td class="rhe">${r.score[side]}</td><td class="rhe">${r.hits[side]}</td><td class="rhe">${r.errors[side]}</td></tr>`).join('')}</table></div>`;
  const bat = (side: 0 | 1) => {
    const notes: Record<string, string[]> = { '2B': [], '3B': [], HR: [], SB: [] };
    // starters in order, each followed by whoever came in for his spot (pinch hitters, runners, defensive subs)
    const order: Array<{ id: number; pos: string; sub: string }> = [];
    r.lineups[side].forEach((s, slot) => {
      order.push({ id: s.player.id, pos: POS_ABBR[s.pos], sub: '' });
      for (const x of (r.subs ?? []).filter((y) => y.side === side && y.slot === slot)) order.push({ id: x.incoming, pos: x.why === 'hitter' ? 'PH' : x.why === 'runner' ? 'PR' : POS_ABBR[s.pos], sub: ` · ${x.inning}${['th', 'st', 'nd', 'rd'][x.inning % 10 > 3 || [11, 12, 13].includes(x.inning % 100) ? 0 : x.inning % 10]}` });
    });
    const rows = order.map((s) => {
      const b = r.batting.get(s.id)!;
      const nm = g.name(s.id);
      if (b.D) notes['2B'].push(nm + (b.D > 1 ? ` ${b.D}` : ''));
      if (b.T) notes['3B'].push(nm + (b.T > 1 ? ` ${b.T}` : ''));
      if (b.HR) notes.HR.push(nm + (b.HR > 1 ? ` ${b.HR}` : ''));
      if (b.SB) notes.SB.push(nm + (b.SB > 1 ? ` ${b.SB}` : ''));
      return `<tr${s.sub ? ' class="box-sub"' : ''}><th scope="row">${link(nm, 'player', { id: s.id })} <span class="muted">${s.pos}${s.sub}</span></th><td>${b.AB}</td><td>${b.R}</td><td>${b.H}</td><td>${b.RBI}</td><td>${b.BB}</td><td>${b.K}</td></tr>`;
    }).join('');
    const note = Object.entries(notes).filter(([, v]) => v.length).map(([k, v]) => `<p class="box-note"><b>${k}:</b> ${esc(v.join(', '))}</p>`).join('');
    return `<div class="box-side"><div class="hscroll"><table class="stat"><caption>${tname(r.teamIds[side])}</caption><tr><th scope="col">BATTING</th><th scope="col">AB</th><th scope="col">R</th><th scope="col">H</th><th scope="col">RBI</th><th scope="col">BB</th><th scope="col">K</th></tr>${rows}</table></div>${note}</div>`;
  };
  const pit = (side: 0 | 1) => {
    const rows = r.pitchersUsed[side].map((id) => {
      const p = r.pitching.get(id)!;
      const dec = r.decisions.win === id ? ' (W)' : r.decisions.loss === id ? ' (L)' : r.decisions.save === id ? ' (S)' : '';
      return `<tr><th scope="row">${link(g.name(id), 'player', { id })}<span class="dec">${dec}</span></th><td>${ip(p.outs)}</td><td>${p.H}</td><td>${p.R}</td><td>${p.ER}</td><td>${p.BB}</td><td>${p.K}</td><td>${p.HR}</td><td>${p.P}</td></tr>`;
    }).join('');
    return `<div class="hscroll"><table class="stat"><caption>${tname(r.teamIds[side])} pitching</caption><tr><th scope="col">PITCHING</th><th scope="col">IP</th><th scope="col">H</th><th scope="col">R</th><th scope="col">ER</th><th scope="col">BB</th><th scope="col">K</th><th scope="col">HR</th><th scope="col">P</th></tr>${rows}</table></div>`;
  };
  const acts = `<div class="row-actions">${btn('GAME LOG', 'go', { icon: 'scroll', data: { to: 'gamelog', index } })}${btn('REPLAY', 'replay', { icon: 'play', data: { index }, title: 'Watch this game pitch by pitch' })}</div>`;
  return `${ls}${dramaStrip(r, g.name)}${acts}<div class="box-grid">${bat(0)}${bat(1)}</div><div class="box-grid">${pit(0)}${pit(1)}</div>`;
}

/** Every finished year: the champion, the final they beat, and how your team did. */
function pastSeasons(g: Game): string {
  const H = g.league.history;
  if (!H.length) return '';
  const finish = (y: (typeof H)[number], id: number) => {
    const t = y.teams.find((x) => x.teamId === id)!;
    const out = [...y.series].reverse().find((s) => s.high === id || s.low === id);
    const how = y.champion === id ? 'Won it all' : out ? `Lost ${out.round === 'WS' ? 'the final' : out.round === 'LCS' ? 'the CS' : out.round === 'DS' ? 'the DS' : 'the wild card'}` : ['1st', '2nd', '3rd', '4th', '5th'][t.place - 1] + ' in division';
    return { rec: `${t.W}-${t.L}`, how };
  };
  const rows = [...H].reverse().map((y) => {
    const ws = y.series.find((s) => s.round === 'WS');
    const loser = ws ? (ws.winner === ws.high ? ws.low : ws.high) : 0;
    const mine = finish(y, g.userTeam);
    const champ = y.champion ? `${link(teamName(y.champion), 'team', { id: y.champion })}${loser ? ` <span class="muted">over ${esc(teamName(loser))}${ws ? ` ${Math.max(...ws.wins)}-${Math.min(...ws.wins)}` : ''}</span>` : ''}` : '—';
    const decree = y.decree ? `<span class="decree-sub">${esc(y.decree)}</span>` : '';
    return `<li class="${y.champion === g.userTeam ? 'mine' : ''}"><span class="rank">${y.year}</span><span class="nm">${champ}${decree}</span><span class="val">You: ${mine.rec}, ${esc(mine.how.toLowerCase())}</span></li>`;
  }).join('');
  return win({ id: 'w-past', title: 'Past Seasons', label: `${H.length} ${H.length === 1 ? 'YEAR' : 'YEARS'} · ${FINAL_NAME.toUpperCase()} CHAMPIONS`, body: `<ol class="lead-list past-list">${rows}</ol>`, cls: 'w-past wide' });
}

/** "AL DS G3 · " for postseason games, "GAME 163 · " for tiebreakers. */
function gameTag(g: Game, r: GameResult): string {
  const sr = findSeries(g, r.series);
  return sr ? `${esc(seriesShort(sr))} G${r.game} · ` : r.kind === 'tiebreak' ? 'GAME 163 · ' : '';
}

/** Every day with games: the ones played, then the rest of the schedule. */
export function gameDays(g: Game): number[] {
  const days = new Set(g.byDay.keys());
  for (let d = g.day; d < g.season.schedule.days; d++) if (g.season.schedule.byDay[d]?.length) days.add(d);
  return [...days].sort((a, b) => a - b);
}

export function gamesView(app: App): string {
  const g = app.game!;
  const days = gameDays(g);
  const lastPlayed = [...g.byDay.keys()].sort((a, b) => a - b).at(-1);
  if (!days.includes(app.gamesDay)) app.gamesDay = lastPlayed ?? days[0] ?? 0;
  const day = app.gamesDay, di = days.indexOf(day);
  const nav = `<div class="day-nav">${btn('', 'games-day', { icon: 'left', data: { step: -1 }, disabled: di <= 0, title: 'Previous day', cls: 'btn-icon' })}<span class="day-label">${dateLabel(day)}${g.byDay.has(day) ? '' : ' <span class="muted small">AHEAD</span>'}</span>${btn('', 'games-day', { icon: 'right', data: { step: 1 }, disabled: di >= days.length - 1, title: 'Next day', cls: 'btn-icon' })}</div>`;
  const idx = g.byDay.get(day);
  if (!idx) {
    // a day still to come: the schedule (probable starters for today only; later days set theirs that morning)
    const games = g.season.schedule.byDay[day] ?? [];
    const today = day === g.day;
    const rows = games.map((s) => `<li class="sched${s.home === g.userTeam || s.away === g.userTeam ? ' mine' : ''}"><span>${tname(s.away)} at ${tname(s.home)}</span><span class="muted">${formatStart(s.start)}${s.kind === 'post' ? ` · ${esc(seriesShort(findSeries(g, s.series)!))} G${s.game}` : s.kind === 'tiebreak' ? ' · GAME 163' : ''}</span>${today ? `<span class="muted small">${esc(g.name(peekStarter(g.season, s.away).id))} vs ${esc(g.name(peekStarter(g.season, s.home).id))}</span>` : ''}</li>`).join('');
    const mine = games.find((s) => s.home === g.userTeam || s.away === g.userTeam);
    const side = win({ id: 'w-box', title: today ? 'Today' : 'Coming Up', label: dateLabel(day), body: `<p class="note">${mine ? `${esc(teamName(g.userTeam))} ${mine.home === g.userTeam ? 'host' : 'visit'} ${esc(teamName(mine.home === g.userTeam ? mine.away : mine.home))} at ${formatStart(mine.start)}.` : `${esc(teamName(g.userTeam))} are off.`}</p><p class="note muted small">${today ? 'Box scores appear once the day is played.' : 'Probable starters are set the morning of the game.'}</p>`, cls: 'w-boxscore' });
    return page(app, 'games', `<div class="games-layout fill">${win({ id: 'w-scores', title: 'Schedule', label: `${games.length} GAMES`, body: `${nav}<ul class="sched-list">${rows}</ul>`, scroll: true, cls: 'w-scores' })}${side}</div>`, true);
  }
  if (!idx.includes(app.gamesPick)) app.gamesPick = idx.find((i) => g.season.results[i].teamIds.includes(g.userTeam)) ?? idx[0];
  const cards = idx.map((i) => {
    const r = g.season.results[i];
    const wNm = r.decisions.win ? g.name(r.decisions.win) : '', lNm = r.decisions.loss ? g.name(r.decisions.loss) : '';
    const side = (s: 0 | 1) => `<span class="sc-team${r.score[s] > r.score[1 - s] ? ' won' : ''}">${tname(r.teamIds[s])}</span><span class="sc-runs${r.score[s] > r.score[1 - s] ? ' won' : ''}">${r.score[s]}</span>`;
    const mine = r.teamIds.includes(g.userTeam);
    return `<li><button type="button" class="score-card${i === app.gamesPick ? ' picked' : ''}${mine ? ' mine' : ''}" data-act="games-pick" data-index="${i}" data-key="games-pick:${i}" aria-pressed="${i === app.gamesPick}">
<span class="sc-row">${side(0)}</span><span class="sc-row">${side(1)}</span><span class="sc-meta">${gameTag(g, r)}F${r.innings > 9 ? `/${r.innings}` : ''} · W ${esc(wNm)} · L ${esc(lNm)}</span>${dramaTag(r)}</button></li>`;
  }).join('');
  const r = g.season.results[app.gamesPick];
  const box = win({ id: 'w-box', title: 'Box Score', label: `${esc(teamName(r.teamIds[0])).toUpperCase()} AT ${esc(teamName(r.teamIds[1])).toUpperCase()} · ${shortDate(r.day)}`, body: boxScoreHtml(g, r, app.gamesPick), scroll: true, cls: 'w-boxscore' });
  return page(app, 'games', `<div class="games-layout fill">${win({ id: 'w-scores', title: 'Scoreboard', label: `${idx.length} GAMES`, body: `${nav}<ul class="score-list">${cards}</ul>`, scroll: true, cls: 'w-scores' })}${box}</div>`, true);
}

// ------------------------------------------------------------------ leaders

// ------------------------------------------------------------------ roster

function fatigueBar(f: number): string {
  const n = Math.round(Math.min(100, f) / 10);
  return `<span class="fbar" role="img" aria-label="Fatigue ${Math.round(f)} of 100">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? (n >= 7 ? 'hot' : n >= 4 ? 'warm' : 'on') : ''}"></i>`).join('')}</span>`;
}

export function rosterView(app: App): string {
  const g = app.game!;
  const teamId = app.rosterTeam || g.userTeam;
  const mine = teamId === g.userTeam;
  const plan = g.season.plans.get(teamId)!;
  const team = g.league.teams.find((t) => t.id === teamId)!;
  const active = new Set(activeOf(team));
  const players = team.playerIds.map((id) => g.players.get(id)!);
  const auto = team.auto ?? { lineup: true, staff: true, roster: true };
  const tab = mine ? app.rosterTab : 'lineup';
  const sel = `<label class="team-select"><span class="k">TEAM</span><select data-act="roster-team" id="roster-team">${g.league.teams.map((t) => `<option value="${t.id}"${t.id === teamId ? ' selected' : ''}>${esc(teamName(t.id))}${t.id === g.userTeam ? ' (you)' : ''}</option>`).join('')}</select></label>`;
  const tabs = [['lineup', 'TEAM'], ...(mine ? [['moves', '26 & RESERVES']] : [])]
    .map(([k, label]) => `<button type="button" class="tab${tab === k ? ' on' : ''}" data-act="roster-tab" data-tab="${k}" data-key="roster-tab:${k}" aria-pressed="${tab === k}">${label}</button>`).join('')
    + (tab !== 'moves' ? `<span class="tab-gap"></span><button type="button" class="tab${app.cmp.on ? ' on' : ''}" data-act="cmp-toggle" data-key="cmp-toggle" aria-pressed="${app.cmp.on}" title="Pick two players to see their Baseball Cards side by side">${app.cmp.on ? (app.cmp.a ? 'PICK ONE MORE' : 'PICK TWO') : 'COMPARE'}</button><span class="tab-gap"></span>${(['ratings', 'stats'] as const).map((k) => `<button type="button" class="tab${app.rosterCols === k ? ' on' : ''}" data-act="roster-cols" data-c="${k}" data-key="roster-cols:${k}" aria-pressed="${app.rosterCols === k}">${k.toUpperCase()}</button>`).join('')}` : '');
  const autoBtn = (part: 'lineup' | 'staff' | 'roster') => mine
    ? `<button type="button" class="btn btn-ghost auto-btn${auto[part] ? ' on' : ''}" data-act="roster-auto" data-part="${part}" data-key="roster-auto:${part}" aria-pressed="${auto[part]}" title="${auto[part] ? 'The AI runs this. Change anything to take over.' : 'You run this. Turn AUTO on to hand it back to the AI.'}"><span>AUTO ${auto[part] ? 'ON' : 'OFF'}</span></button>` : '';
  const tbl = (head: string, rows: string, label: string) => `<div class="hscroll"><table class="stat roster" aria-label="${label}">${head}${rows}</table></div>`;
  const name = (p: (typeof players)[0]) => app.cmp.on && tab !== 'moves'
    ? `<th scope="row"><button type="button" class="link cmp-name${app.cmp.a === p.id ? ' picked' : ''}" data-act="cmp-pick" data-id="${p.id}" data-key="cmp:${p.id}" title="Compare">${esc(p.name)}</button></th>`
    : `<th scope="row">${link(p.name, 'player', { id: p.id })}</th>`;
  const updown = (act: string, i: number, n: number, on: boolean) => mine
    ? `<td class="ud">${on ? `${btn('', act, { icon: 'left', data: { i, dir: -1 }, disabled: i === 0, title: 'Move up', cls: 'btn-icon btn-ghost up' })}${btn('', act, { icon: 'right', data: { i, dir: 1 }, disabled: i === n - 1, title: 'Move down', cls: 'btn-icon btn-ghost down' })}` : ''}</td>` : '';
  let body = '';
  if (tab !== 'moves') {
    // One view: lineup and bench on the left, rotation and bullpen on the right. RATINGS or STATS; every column sorts.
    type P = (typeof players)[0];
    type Col = { k: string; h: string; v: (p: P) => number | string; cell?: (p: P) => string };
    const B = (p: P) => g.season.batting.get(p.id), A = (p: P) => g.season.pitching.get(p.id);
    const num = (x: number | undefined, f = (n: number) => String(n)) => (x === undefined || !Number.isFinite(x) ? '—' : f(x));
    const ratings = app.rosterCols === 'ratings';
    const batCols: Col[] = ratings
      ? [{ k: 'b', h: 'B', v: (p) => p.bats }, { k: 'age', h: 'AGE', v: (p) => p.age }, ...([['power', 'POW'], ['contact', 'CON'], ['discipline', 'EYE'], ['speed', 'SPD'], ['instincts', 'RNG'], ['glove', 'GLV'], ['cannon', 'ARM']] as const)
        .map(([r, h]): Col => ({ k: r, h, v: (p) => r5(p.ratings[r]) }))]
      : [{ k: 'pa', h: 'PA', v: (p) => B(p)?.PA ?? 0 }, { k: 'avg', h: 'AVG', v: (p) => (B(p)?.AB ? avg(B(p)!) : -1), cell: (p) => (B(p)?.AB ? rate3(avg(B(p)!)) : '—') },
        { k: 'obp', h: 'OBP', v: (p) => (B(p)?.PA ? obp(B(p)!) : -1), cell: (p) => (B(p)?.PA ? rate3(obp(B(p)!)) : '—') }, { k: 'slg', h: 'SLG', v: (p) => (B(p)?.AB ? slg(B(p)!) : -1), cell: (p) => (B(p)?.AB ? rate3(slg(B(p)!)) : '—') },
        { k: 'hr', h: 'HR', v: (p) => B(p)?.HR ?? 0 }, { k: 'rbi', h: 'RBI', v: (p) => B(p)?.RBI ?? 0 }, { k: 'sb', h: 'SB', v: (p) => B(p)?.SB ?? 0 }];
    const armCols: Col[] = ratings
      ? [{ k: 't', h: 'T', v: (p) => p.throws }, { k: 'age', h: 'AGE', v: (p) => p.age }, ...([['velocity', 'VEL'], ['control', 'CTL'], ['movement', 'MOV'], ['stamina', 'STA']] as const)
        .map(([r, h]): Col => ({ k: r, h, v: (p) => r5(p.ratings[r]) })), { k: 'fat', h: 'TIRED', v: (p) => recoveredFatigue(g.season, p.id), cell: (p) => fatigueBar(recoveredFatigue(g.season, p.id)) }]
      : [{ k: 'wl', h: 'W-L', v: (p) => (A(p)?.W ?? 0) - (A(p)?.L ?? 0), cell: (p) => `${A(p)?.W ?? 0}-${A(p)?.L ?? 0}` }, { k: 'era', h: 'ERA', v: (p) => (A(p)?.outs ? -era(A(p)!) : -99), cell: (p) => (A(p)?.outs ? era2(era(A(p)!)) : '—') },
        { k: 'ip', h: 'IP', v: (p) => A(p)?.outs ?? 0, cell: (p) => ip(A(p)?.outs ?? 0) }, { k: 'so', h: 'SO', v: (p) => A(p)?.K ?? 0 },
        { k: 'whip', h: 'WHIP', v: (p) => (A(p)?.outs ? -whip(A(p)!) : -99), cell: (p) => (A(p)?.outs ? whip(A(p)!).toFixed(2) : '—') }, { k: 'gs', h: 'GS', v: (p) => A(p)?.GS ?? 0 }, { k: 'sv', h: 'SV', v: (p) => A(p)?.SV ?? 0 }];
    void num;
    const sort = app.rosterSort;
    const sorted = <T,>(rows: T[], pick: (r: T) => P, cols: Col[]): T[] => {
      const c = cols.find((x) => x.k === sort.k) ?? (sort.k === 'name' ? { k: 'name', h: '', v: (p: P) => p.name } : null);
      if (!c) return rows;
      return [...rows].sort((x, y) => { const a = c.v(pick(x)), b = c.v(pick(y)); const d = typeof a === 'string' ? a.localeCompare(String(b)) : a - (b as number); return sort.desc ? -d : d; });
    };
    const ordered = (cols: Col[]) => !cols.some((c) => c.k === sort.k) && sort.k !== 'name';
    const sh = (k: string, h: string, left = false) => `<th scope="col"${left ? ' class="l"' : ''}><button type="button" class="sort${sort.k === k ? ' on' : ''}" data-act="roster-sort" data-k="${k}" data-key="roster-sort:${k}">${h}${sort.k === k ? (sort.desc ? ' ▾' : ' ▴') : ''}</button></th>`;
    const cells = (p: P, cols: Col[]) => cols.map((c) => `<td>${c.cell ? c.cell(p) : c.v(p)}</td>`).join('');
    const sect = (label: string, n: number) => `<tr class="sect"><th colspan="${n}" scope="colgroup">${label}</th></tr>`;
    // lineup and bench
    const bench = players.filter((p) => p.position !== 'P' && active.has(p.id) && !plan.lineup.some((l) => l.player.id === p.id));
    const byOrder = ordered(batCols);
    // one select per spot: his position today, or a bench bat to swap in
    const posSel = (i: number, pos: number) => `<select data-act="lineup-pos" data-i="${i}" aria-label="Position, or swap in a bench bat">${[2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<option value="${n}"${n === pos ? ' selected' : ''}>${POS_ABBR[n]}</option>`).join('')}${bench.length ? `<optgroup label="SWAP IN">${bench.map((p) => `<option value="sub:${p.id}">${esc(p.name)} (${p.position})</option>`).join('')}</optgroup>` : ''}</select>`;
    const lineup = sorted(plan.lineup.map((l, i) => ({ l, i })), (x) => x.l.player, batCols);
    const bCount = 3 + (mine ? 1 : 0) + batCols.length;
    // POS: where he plays today; out of position shows in amber, with his own position on hover
    const playsCell = (i: number, pos: number, p: P) => {
      const off = POS_ABBR[pos] !== p.position && !(pos === 0 && p.position === 'DH');
      return `<td${off ? ` class="offpos" title="Plays ${POS_ABBR[pos]}; his position is ${p.position}"` : ''}>${mine ? posSel(i, pos) : POS_ABBR[pos]}</td>`;
    };
    const bHead = `<tr>${sh('order', '#')}${mine ? '<th scope="col"></th>' : ''}${sh('name', 'NAME', true)}<th scope="col">POS</th>${batCols.map((c) => sh(c.k, c.h)).join('')}</tr>`;
    const lRows = lineup.map(({ l, i }) => `<tr><td>${i + 1}</td>${updown('lineup-move', i, plan.lineup.length, byOrder)}${name(l.player)}${playsCell(i, l.pos, l.player)}${cells(l.player, batCols)}</tr>`).join('');
    const bRows = sorted(bench, (p) => p, batCols).map((p) => `<tr><td></td>${mine ? '<td></td>' : ''}${name(p)}<td>${p.position}</td>${cells(p, batCols)}</tr>`).join('');
    // rotation and bullpen
    const byRot = ordered(armCols);
    const rotSel = (i: number) => `<select data-act="rot-swap" data-i="${i}" aria-label="Starter ${i + 1}, or swap in a reliever"><option value="">SP${i + 1}</option><optgroup label="SWAP IN">${plan.bullpen.map((a) => `<option value="${a.player.id}">${esc(a.player.name)} (${a.role})</option>`).join('')}</optgroup></select>`;
    const roleSel = (i: number, role: string) => `<select data-act="pen-role" data-i="${i}" aria-label="Role">${['CL', 'SU', 'MR', 'LR'].map((r) => `<option value="${r}"${r === role ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
    const aCount = 2 + (mine ? 1 : 0) + armCols.length;
    const aHead = `<tr>${sh('order', 'ROLE')}${mine ? '<th scope="col"></th>' : ''}${sh('name', 'NAME', true)}${armCols.map((c) => sh(c.k, c.h)).join('')}</tr>`;
    const rot = sorted(plan.rotation.map((p, i) => ({ p, i })), (x) => x.p, armCols).map(({ p, i }) => `<tr><td>${mine ? rotSel(i) : `SP${i + 1}`}</td>${updown('rot-move', i, plan.rotation.length, byRot)}${name(p)}${cells(p, armCols)}</tr>`).join('');
    const pen = sorted(plan.bullpen.map((a, i) => ({ a, i })), (x) => x.a.player, armCols).map(({ a, i }) => `<tr><td>${mine ? roleSel(i, a.role) : a.role}</td>${mine ? '<td></td>' : ''}${name(a.player)}${cells(a.player, armCols)}</tr>`).join('');
    const sorted$ = (on: boolean) => (on ? '' : '<span class="sorted-note" title="Click # to put the order back and reorder">SORTED · # TO REORDER</span>');
    body = win({ id: 'w-lineup', title: 'Lineup & Bench', label: `${sorted$(byOrder)}${autoBtn('lineup')}`, scroll: true, cls: 'w-lineup', body: tbl(bHead, sect('LINEUP', bCount) + lRows + sect('BENCH', bCount) + bRows, 'Lineup and bench') })
      + win({ id: 'w-rot', title: 'Rotation & Bullpen', label: `${sorted$(byRot)}${autoBtn('staff')}`, scroll: true, cls: 'w-rotpen', body: tbl(aHead, sect('ROTATION', aCount) + rot + sect('BULLPEN', aCount) + pen, 'Rotation and bullpen') });
  } else {
    const left = movesLeft(team, g.day);
    const opt = (p: (typeof players)[0]) => (p.optionedThisYear ? `<span class="muted">option used · ${Math.max(0, optionsLeft(p) - 1)} after</span>` : optionsLeft(p) > 0 ? `${optionsLeft(p)} left` : '<span class="warn">OUT · waivers</span>');
    const relBtn = (p: (typeof players)[0]) => app.releaseArmed === p.id
      ? btn('CONFIRM', 'release', { kind: 'primary', data: { id: p.id }, title: 'He goes on waivers for 3 days; unclaimed, he becomes a free agent' })
      : btn('RELEASE', 'release-arm', { data: { id: p.id } });
    const onWaivers = new Set(g.league.waivers.map((w) => w.playerId));
    const line = (p: (typeof players)[0], extra: string) => `<tr>${name(p)}<td>${p.position === 'P' ? p.pitcherRole : p.position}</td><td>${p.age}</td><td>${Math.round(playerValue(p))}</td><td>${opt(p)}</td><td class="acts">${extra}</td></tr>`;
    const head = (k: string) => `<tr><th scope="col">${k}</th><th scope="col">POS</th><th scope="col">AGE</th><th scope="col">OVR</th><th scope="col">OPTIONS</th><th scope="col"></th></tr>`;
    const group = (pitchers: boolean, inActive: boolean) => players.filter((p) => (p.position === 'P') === pitchers && active.has(p.id) === inActive).sort((a, b) => playerValue(b) - playerValue(a));
    const callSel = (p: (typeof players)[0]) => onWaivers.has(p.id) ? '<span class="muted">on waivers</span>'
      : `<select data-act="call-up" data-id="${p.id}" aria-label="Call up for"${left <= 0 ? ' disabled' : ''}><option value="">CALL UP FOR…</option>${group(p.position === 'P', true).map((q) => `<option value="${q.id}">${esc(q.name)} (${q.position === 'P' ? q.pitcherRole : q.position}${canOption(q) ? '' : ', to waivers'})</option>`).join('')}</select>`;
    const act = [...group(false, true), ...group(true, true)].map((p) => line(p, relBtn(p))).join('');
    const res = [...group(false, false), ...group(true, false)].map((p) => line(p, callSel(p) + relBtn(p))).join('');
    const waivers = g.league.waivers.map((w) => {
      const p = waiverPlayer(g.league, w);
      if (!p) return '';
      const claimed = w.claims.includes(g.userTeam), ours = w.fromTeam === g.userTeam;
      return `<tr><th scope="row">${esc(p.name)}</th><td>${p.position}</td><td>${p.age}</td><td>${Math.round(playerValue(p))}</td><td>${tname(w.fromTeam)} · clears ${shortDate(w.until)}</td><td class="acts">${ours ? '<span class="muted">yours</span>' : btn(claimed ? 'CLAIMED' : 'CLAIM', 'claim', { kind: claimed ? 'primary' : 'secondary', data: { id: p.id } })}</td></tr>`;
    }).join('');
    const room = team.playerIds.length < 40;
    const mineP = g.league.prospects.filter((x) => x.teamId === teamId).sort((a, b) => projection(b.player, g.league.seed).mid - projection(a.player, g.league.seed).mid);
    const prospectsWin = win({ id: 'w-prospects', title: 'Prospects', label: `${mineP.length} · OFF THE 40 · RIGHTS TO THE YEAR ${mineP[0]?.until ?? ''} DRAFT`.replace(/ · RIGHTS TO THE YEAR  DRAFT$/, ''),
      body: mineP.length ? tbl(head('PROSPECT').replace('OPTIONS', 'CEILING'), mineP.map((x) => { const pr = projection(x.player, g.league.seed); return `<tr>${`<th scope="row">${esc(x.player.name)}</th>`}<td>${x.player.position === 'P' ? x.player.pitcherRole : x.player.position}</td><td>${x.player.age}</td><td>${pr.now}</td><td>${pr.lo}–${pr.hi}</td><td class="acts">${btn('ADD TO 40', 'promote', { data: { id: x.player.id }, disabled: !room, title: room ? 'He joins your reserves' : 'Your 40 is full: release someone first' })}</td></tr>`; }).join(''), 'Prospects')
        : '<p class="note muted">No prospects. Picks from the four-year draft wait here until you add them to the 40 or their rights run out.</p>' });
    const fas = [...g.league.freeAgents].sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 15)
      .map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${p.position === 'P' ? (p.pitcherRole ?? 'P') : p.position}</td><td>${p.age}</td><td>${Math.round(playerValue(p))}</td><td>${optionsLeft(p)} left</td><td class="acts">${btn('SIGN', 'sign', { data: { id: p.id }, disabled: !room, title: room ? 'He joins your reserves' : 'Your 40-man roster is full: release someone first' })}</td></tr>`).join('');
    body = `<div class="row-actions">${autoBtn('roster')}<span class="note small">${left} of ${RULES.movesPerMonth} moves left this month · ${team.playerIds.length} of 40 · a call-up sends someone of the same kind down; out of options means waivers first.</span></div>
${win({ id: 'w-active', title: 'Active 26', label: '13 POSITION PLAYERS · 13 PITCHERS', body: tbl(head('ACTIVE'), act, 'Active roster') })}
<div class="roster-side">${win({ id: 'w-res', title: 'Reserves', label: `${team.playerIds.length - active.size} ON THE 40, NOT ACTIVE`, body: res ? tbl(head('RESERVE'), res, 'Reserves') : '<p class="note muted">Nobody on the reserves.</p>' })}
${prospectsWin}
${win({ id: 'w-waive', title: 'Waiver Wire', label: `${g.league.waivers.length} PLAYERS · WORST RECORD CLAIMS FIRST`, body: waivers ? tbl(head('PLAYER').replace('OPTIONS', 'FROM'), waivers, 'Waivers') : '<p class="note muted">Nobody on waivers.</p>' })}
${win({ id: 'w-fa', title: 'Free Agents', label: room ? 'SIGN TO THE RESERVES' : 'YOUR 40 IS FULL', body: tbl(head('FREE AGENT'), fas, 'Free agents') })}</div>`;
  }
  const rs = g.season.standings.get(teamId)!;
  return page(app, 'roster', `<div class="roster-head"><div><h2 class="page-h">${esc(teamFull(teamId))}</h2><p class="page-sub">${rs.W}-${rs.L} · ${LEAGUES[team.conference]} ${DIVISIONS[team.division]} · ${team.strategy.rotationSize}-man rotation</p></div><div class="tabs" role="group" aria-label="Roster views">${tabs}</div>${sel}</div>
<div class="fill roster-fill">${body}</div>`, true);
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
    return `<li><button type="button" class="glist${i === app.logPick ? ' picked' : ''}" data-act="log-pick" data-index="${i}" data-key="log-pick:${i}" aria-pressed="${i === app.logPick}"><span class="d">${shortDate(x.day)}</span><span class="o">${side ? 'vs' : 'at'} ${esc(teamName(x.teamIds[1 - side]))}</span><span class="res ${won ? 'good' : 'bad'}">${won ? 'W' : 'L'} ${x.score[side]}-${x.score[1 - side]}${x.innings > 9 ? ` (${x.innings})` : ''}</span>${dramaTag(x)}</button></li>`;
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
    const tone = ev.type === 'pa' ? playTone(ev.play) : ev.type === 'steal' ? (ev.safe ? 't-on' : 't-out') : '';
    h.lines.push(`<p class="log-line ${tone}${runs ? ' scored' : ''}${ev.type === 'change' || ev.type === 'sub' ? ' change' : ''}">${esc(eventText(ev, g.name, app.settings.detail))}</p>`);
  }
  const pbp = halves.map((h) => `<details class="half" open><summary>${halfLabel(h.inning, h.half).toUpperCase()} — ${esc(teamName(r.teamIds[h.half])).toUpperCase()} <span class="half-runs">${h.runs} R</span></summary>${h.lines.join('')}</details>`).join('');
  const detail = `<label class="detail-pick"><span class="k">PITCH DETAIL</span><select data-act="set-detail" id="detail-pick"><option value="final"${app.settings.detail === 'final' ? ' selected' : ''}>Summary</option><option value="full"${app.settings.detail === 'full' ? ' selected' : ''}>Full sequences</option><option value="none"${app.settings.detail === 'none' ? ' selected' : ''}>Plays only</option></select></label>`;
  const acts = `<div class="row-actions">${detail}${btn('BOX SCORE', 'go', { icon: 'box', data: { to: 'games', index: app.logPick } })}${btn('REPLAY', 'replay', { icon: 'play', data: { index: app.logPick } })}</div>`;
  const title = `${esc(teamName(r.teamIds[0])).toUpperCase()} ${r.score[0]}, ${esc(teamName(r.teamIds[1])).toUpperCase()} ${r.score[1]}${r.innings > 9 ? ` (${r.innings})` : ''} · ${shortDate(r.day)}`;
  return page(app, 'gamelog', `<div class="games-layout">${win({ id: 'w-glist', title: 'Your Games', label: `${mine.length} PLAYED`, body: `<ul class="glist-list">${list}</ul>`, scroll: true, cls: 'w-scores' })}
${win({ id: 'w-pbp', title: 'Game Log', label: title, body: acts + LOG_KEY + pbp, scroll: true, cls: 'w-boxscore' })}</div>`);
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
