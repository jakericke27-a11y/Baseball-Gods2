/** Home: your team, your division, tonight's game, the wild card race, leaders and headlines over the field. */
import { RELIEVER_MAX_FATIGUE } from '../../engine/game/game';
import { recoveredFatigue, peekStarter } from '../../engine/season/season';
import { formatStart } from '../../engine/season/schedule';
import type { App } from '../app';
import { dateLabel, weekOf, weekdayShort } from '../calendar';
import type { Game } from '../state';
import { era, era2, gbText, heat, last10, leaders, raceText, races, streakText } from '../stats';
import { DIVISIONS, LEAGUES, teamName } from '../teams';
import { icon } from '../sprites';
import { banner, btn, esc, footer, link, thead, trow, ttable, win } from './common';

export function bannerFor(g: Game): string {
  const days = g.season.schedule.days, day = g.day;
  if (g.over) return banner('YEAR 1', 'REGULAR SEASON COMPLETE');
  const left = days - day;
  const brk = g.season.schedule.allStarBreak;
  const tail = day >= brk && day < brk + 3 ? 'ALL-STAR BREAK' : left > 14 ? `${Math.ceil(left / 7)} WEEKS TO PLAYOFFS` : `${left} DAYS TO PLAYOFFS`;
  const head = g.season.results.length === 0 ? `OPENING DAY · ${dateLabel(day)}` : `WEEK ${weekOf(day)} · ${dateLabel(day)}`;
  return banner('YEAR 1', `${head} · ${tail}`);
}

export function simActions(g: Game): string {
  if (g.over) return btn('NEW LEAGUE', 'restart-open', { kind: 'secondary' });
  const playing = !!g.gameOn(g.day, g.userTeam);
  return (playing ? btn('WATCH', 'watch', { kind: 'primary', icon: 'ball', title: 'Play today and watch your game pitch by pitch' }) : '')
    + btn('SIM DAY', 'sim-day', { kind: playing ? 'secondary' : 'primary', icon: 'hourglass' })
    + btn('WEEK', 'sim-week', { title: 'Sim 7 days' })
    + btn('MONTH', 'sim-month', { title: 'Sim 30 days' })
    + btn('TO END', 'sim-end', { icon: 'ff', title: 'Sim the rest of the regular season' });
}

function ticker(g: Game): string {
  const recent = g.headlines.filter((h) => h.day >= g.day - 3).slice(-14).reverse();
  let items = recent.map((h) => `<span class="tick${h.big ? ' big' : ''}${h.teamId === g.userTeam ? ' mine' : ''}">${esc(h.text)}</span>`);
  if (!items.length) {
    items = g.over ? ['<span class="tick">The regular season is over. The Gods are counting the votes.</span>']
      : g.season.results.length === 0 ? ['<span class="tick">Opening Day. Thirty teams, 162 games each, and one set of gods watching.</span>', '<span class="tick">Sim a day, or watch your team play pitch by pitch.</span>']
      : ['<span class="tick">A quiet day around the league.</span>'];
  }
  const run = items.join('');
  const key = `${g.headlines.length}:${g.day}:${g.userTeam}`;
  return `<div class="ticker" data-ticker="${key}"><button type="button" class="ticker-label" data-act="news" data-key="news" title="All headlines">HEADLINES</button>
<div class="ticker-track"><div class="ticker-run" style="--dur:${Math.max(30, items.length * 9)}s"><div class="ticker-set">${run}</div><div class="ticker-set" aria-hidden="true">${run}</div></div></div></div>`;
}

function yourTeam(g: Game): string {
  const me = g.season.standings.get(g.userTeam)!;
  const t = g.league.teams.find((x) => x.id === g.userTeam)!;
  const race = races(g)[t.conference];
  const div = race.divisions.find((d) => d.division === t.division)!;
  const place = div.rows.findIndex((r) => r.teamId === g.userTeam) + 1;
  const placeTxt = ['1st', '2nd', '3rd', '4th', '5th'][place - 1];
  const diff = me.RS - me.RA;
  const lastIdx = [...g.season.results.keys()].reverse().find((i) => g.season.results[i].teamIds.includes(g.userTeam));
  let lastLine = '';
  if (lastIdx !== undefined) {
    const r = g.season.results[lastIdx];
    const side = r.teamIds[0] === g.userTeam ? 0 : 1;
    const won = r.score[side] > r.score[1 - side];
    const opp = r.teamIds[1 - side];
    lastLine = `<div class="yt-last">Last game: ${link(`${won ? 'W' : 'L'} ${r.score[side]}-${r.score[1 - side]} ${side ? 'vs' : 'at'} ${teamName(opp)}${r.innings > 9 ? ` (${r.innings})` : ''}`, 'go', { to: 'games', index: lastIdx }, won ? 'good' : 'bad')}</div>`;
  }
  const kv = (k: string, v: string) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const body = `<div class="yt-record"><span class="big-num">${me.W}-${me.L}</span><span class="yt-place">${placeTxt} in ${LEAGUES[t.conference]} ${DIVISIONS[t.division]}</span></div>
<div class="kv-row">${kv('RUN DIFF', diff > 0 ? `+${diff}` : String(diff))}${kv('STREAK', streakText(me))}${kv('LAST 10', last10(me))}</div>
<div class="yt-race">${esc(raceText(g, g.userTeam))}</div>${lastLine}`;
  return win({ id: 'w-yours', title: 'Your Team', label: teamName(g.userTeam).toUpperCase(), body, open: 'roster', openData: { team: g.userTeam }, cls: 'w-yours' });
}

function divisionWindow(g: Game): string {
  const t = g.league.teams.find((x) => x.id === g.userTeam)!;
  const div = races(g)[t.conference].divisions.find((d) => d.division === t.division)!;
  const cols = 'minmax(0, 1fr) 32px 32px 44px 40px 36px';
  const rows = div.rows.map((r) => trow([link(teamName(r.teamId), 'team', { id: r.teamId }), String(r.W), String(r.L), gbText(r.gb), last10(r), streakText(r)], heat(r), r.teamId === g.userTeam)).join('');
  return win({
    id: 'w-div', title: 'Standings', label: `${LEAGUES[t.conference]} ${DIVISIONS[t.division]}`.toUpperCase(), open: 'standings',
    body: ttable(cols, 'Division standings', thead(['TEAM', 'W', 'L', 'GB', 'L10', 'STK']) + rows), scroll: true, cls: 'w-div',
  });
}

function pitcherLine(g: Game, id: number): string {
  const p = g.season.pitching.get(id);
  const rec = p ? `${p.W}-${p.L}, ${era2(era(p))}` : '0-0, —';
  return `${link(g.name(id), 'player', { id })} <span class="muted">${rec}</span>`;
}

function tonight(g: Game): string {
  if (g.over) {
    const me = g.season.standings.get(g.userTeam)!;
    return win({ id: 'w-tonight', title: 'Tonight', label: 'SEASON OVER', cls: 'w-tonight', body: `<p class="note">The regular season is over. ${teamName(g.userTeam)} finished ${me.W}-${me.L}.</p><p class="note muted">The postseason and Year 2 come in a later build.</p>` });
  }
  const today = g.gameOn(g.day, g.userTeam);
  if (!today) {
    const next = g.nextGameFor(g.userTeam);
    const anyone = g.season.schedule.byDay[g.day].length > 0;
    const nextTxt = next ? `Next: ${weekdayShort(next.day)} ${next.home === g.userTeam ? 'vs' : 'at'} ${teamName(next.home === g.userTeam ? next.away : next.home)}, ${formatStart(next.start)}` : '';
    return win({ id: 'w-tonight', title: 'Tonight', label: anyone ? 'OFF DAY' : 'NO GAMES TODAY', cls: 'w-tonight', body: `<p class="note">${anyone ? `${teamName(g.userTeam)} are off today.` : 'No games anywhere today.'}</p><p class="note muted">${nextTxt}</p>` });
  }
  const home = today.home === g.userTeam;
  const opp = home ? today.away : today.home;
  const mine = peekStarter(g.season, g.userTeam), theirs = peekStarter(g.season, opp);
  const plan = g.season.plans.get(g.userTeam)!;
  const pen = plan.bullpen.filter((a) => a.role !== 'MR').slice(0, 3).map((a) => {
    const ready = recoveredFatigue(g.season, a.player.id) <= RELIEVER_MAX_FATIGUE;
    return `<div class="pen-row"><span class="role">${a.role}</span><span class="pen-name">${link(a.player.name, 'player', { id: a.player.id })}</span><span class="ready ${ready ? 'ok' : 'tired'}">${ready ? 'READY' : 'TIRED'}</span></div>`;
  }).join('');
  const body = `<div class="probables"><div class="prob"><span class="who">YOU</span>${pitcherLine(g, mine.id)}</div><div class="prob"><span class="who">THEM</span>${pitcherLine(g, theirs.id)}</div></div>
<div class="pen">${pen}</div>`;
  return win({ id: 'w-tonight', title: 'Tonight', label: `${formatStart(today.start)} · ${home ? 'VS' : 'AT'} ${teamName(opp).toUpperCase()}`, body, cls: 'w-tonight' });
}

function wildCard(g: Game): string {
  const t = g.league.teams.find((x) => x.id === g.userTeam)!;
  const race = races(g)[t.conference];
  const cols = 'minmax(0, 1fr) 36px 36px 50px';
  let rows = '';
  race.wildCard.forEach((w, i) => {
    const gb = i < 2 ? (w.gb === 0 ? '—' : `+${(-w.gb).toFixed(1)}`) : gbText(w.gb);
    rows += trow([link(teamName(w.row.teamId), 'team', { id: w.row.teamId }), String(w.row.W), String(w.row.L), gb], heat(w.row), w.row.teamId === g.userTeam);
    if (i === 1) rows += '<div class="playoff-line" role="presentation">PLAYOFF LINE</div>';
  });
  return win({
    id: 'w-wild', title: 'Wild Card', label: `${race.wildCard.length} TEAMS · ${LEAGUES[t.conference].toUpperCase()}`, open: 'standings',
    body: ttable(cols, 'Wild card race', thead(['TEAM', 'W', 'L', 'GB']) + rows), scroll: true, cls: 'w-wild',
  });
}

function leadersStrip(g: Game): string {
  const cells = [['HR', 'HR'], ['AVG', 'AVG'], ['SO', 'SO'], ['SV', 'SV']].map(([key, label]) => {
    const top = leaders(g, key, 1)[0];
    return `<div class="lead-cell"><div class="k">${label}</div><div class="lead-line">${top ? `<span class="lead-name">${link(g.name(top.id), 'player', { id: top.id })}</span><span class="lead-val">${top.shown}</span>` : '<span class="muted">—</span>'}</div></div>`;
  }).join('');
  return `<section class="win leaders-strip" aria-labelledby="w-lead-t"><span class="studs" aria-hidden="true"></span><h2 class="win-title" id="w-lead-t">Leaders</h2><div class="lead-grid">${cells}</div>
<button type="button" class="win-open" data-act="go" data-to="leaders" data-key="open:leaders" title="Open leaders" aria-label="Open leaders">${icon('expand', 3)}</button></section>`;
}

export function homeView(app: App): string {
  const g = app.game!;
  return `<div class="frame screen-home">${bannerFor(g)}${ticker(g)}
<main class="main home-main" id="main"><div class="dash">
<div class="dash-col dash-left">${yourTeam(g)}${divisionWindow(g)}</div>
<div class="dash-center">${leadersStrip(g)}</div>
<div class="dash-col dash-right">${tonight(g)}${wildCard(g)}</div>
</div></main>
${footer('home', simActions(g))}</div>`;
}
