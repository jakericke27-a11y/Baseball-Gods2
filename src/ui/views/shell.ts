/** Title screen, team picker, the modal windows (settings, player card, password) and the sim progress overlay. */
import { seasonLine } from '../leaders';
import { REGIONS } from '../../engine/regions';
import { buildTeamPlans } from '../../engine/season/teams';
import type { League } from '../../engine/types';
import type { App } from '../app';
import { LOOP_CUES, STINGERS } from '../audio';
import { icon } from '../sprites';
import { avg, era, era2, ip, obp, rate3, slg, whip } from '../stats';
import { DIVISIONS, LEAGUES, teamColors, teamFull, teamName } from '../teams';
import { careerBatting, careerPitching, ratingsIn, total } from '../../engine/history';
import { banner, btn, esc, r5, thead, trow, ttable } from './common';

export function titleView(app: App): string {
  const s = app.continueInfo();
  const menu = app.titleStage === 'press'
    ? '<p class="press" aria-live="polite">PRESS ANY KEY</p>'
    : `<section class="win menu" aria-label="Main menu"><span class="studs" aria-hidden="true"></span><ul class="menu-list">
${s ? `<li><button type="button" class="menu-item" data-act="continue" data-key="continue" data-autofocus><span class="mi-main">CONTINUE</span><span class="mi-sub">Year ${s.year} · ${esc(teamName(s.team))} · day ${s.day + 1}</span></button></li>` : ''}
<li><button type="button" class="menu-item" data-act="new-league" data-key="new-league"${s ? '' : ' data-autofocus'}><span class="mi-main">NEW LEAGUE</span><span class="mi-sub">Thirty fresh teams. Pick one.</span></button></li>
<li><button type="button" class="menu-item" data-act="load-file-pick" data-key="load-file-pick"><span class="mi-main">LOAD FROM FILE</span><span class="mi-sub">${s ? 'A saved league file. It replaces the league in this browser.' : 'A league you saved to a file'}</span></button></li>
<li><button type="button" class="menu-item" data-act="password-open" data-key="password-open"><span class="mi-main">ENTER PASSWORD</span><span class="mi-sub">Pick up a year from another device</span></button></li>
</ul><input type="file" accept=".zip,application/zip" data-act="load-file" hidden aria-hidden="true" tabindex="-1">${app.fileMsg ? `<p class="warn menu-msg" role="alert">${esc(app.fileMsg)}</p>` : ''}</section>`;
  return `<div class="frame screen-title"><div class="title-block"><h1 class="title-logo">Baseball Gods</h1>
<p class="title-sub">A BASEBALL SIM. THE RULES ANSWER TO HIGHER POWERS.</p>${menu}</div></div>`;
}

const gradeCache = new Map<number, Map<number, { off: number; rot: number; pen: number }>>();
function grades(seed: number, league: League) {
  let m = gradeCache.get(seed);
  if (m) return m;
  m = new Map();
  for (const [id, plan] of buildTeamPlans(league)) {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const off = mean(plan.lineup.map((s) => (s.player.ratings.power + s.player.ratings.contact + s.player.ratings.discipline) / 3));
    const arm = (p: { ratings: { velocity: number; control: number; movement: number } }) => (p.ratings.velocity + p.ratings.control + p.ratings.movement) / 3;
    m.set(id, { off: r5(off), rot: r5(mean(plan.rotation.map(arm))), pen: r5(mean(plan.bullpen.map((a) => arm(a.player)))) });
  }
  gradeCache.set(seed, m);
  return m;
}

export function pickerView(app: App): string {
  const p = app.picker!;
  const gr = grades(p.seed, p.league);
  const divs: string[] = [];
  for (const lg of [0, 1]) for (const dv of [0, 1, 2]) {
    const teams = p.league.teams.filter((t) => t.conference === lg && t.division === dv);
    const items = teams.map((t) => {
      const g = gr.get(t.id)!;
      const on = t.id === p.team;
      return `<li><button type="button" class="pick${on ? ' picked' : ''}" data-act="pick-team" data-id="${t.id}" data-key="pick:${t.id}" aria-pressed="${on}">
<span class="pick-jersey" style="color:${teamColors(t.id).line}">${icon('jersey')}</span><span class="pick-name">${esc(teamFull(t.id))}</span>
<span class="pick-grades"><span>OFF <b>${g.off}</b></span><span>ROT <b>${g.rot}</b></span><span>PEN <b>${g.pen}</b></span></span></button></li>`;
    }).join('');
    divs.push(`<section class="win" aria-labelledby="pd-${lg}-${dv}"><span class="studs" aria-hidden="true"></span><header class="win-head"><h2 class="win-title" id="pd-${lg}-${dv}">${DIVISIONS[dv]}</h2><span class="win-label">${LEAGUES[lg].toUpperCase()}</span></header><div class="win-body"><ul class="pick-list">${items}</ul></div></section>`);
  }
  return `<div class="frame screen-picker">${banner('CHOOSE YOUR TEAM', 'GRADES IF THE AI DRAFTS EVERY ROSTER · 20–80 SCALE · 50 IS AVERAGE')}
<main class="main page" id="main" data-scroll="picker"><div class="picker-grid">${divs.join('')}</div></main>
<footer class="footer"><nav class="nav" aria-label="Back">${btn('BACK', 'to-title', { kind: 'ghost', icon: 'left' })}</nav>
<div class="actions">${btn('NEW TEAMS', 'reroll', { title: 'Roll a different league' })}${btn('AUTO DRAFT', 'auto-draft', { title: 'The AI drafts every roster, yours too: the grades shown are that league' })}${btn(`DRAFT ${esc(teamName(p.team)).toUpperCase()}`, 'start-year', { kind: 'primary', icon: 'ball', title: 'The founding draft: build your 40 yourself, auto the rest whenever you like' })}</div></footer></div>`;
}

// ------------------------------------------------------------------ modals

function modal(id: string, title: string, body: string, wide = false): string {
  return `<div class="modal-veil"><section class="win modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}"><span class="studs" aria-hidden="true"></span>
<header class="win-head"><h2 class="win-title" id="${id}">${title}</h2><button type="button" class="win-open" data-act="close" data-key="close" aria-label="Close" title="Close (Esc)">${icon('close', 3)}</button></header>
<div class="win-body scroll" data-scroll="${id}">${body}</div></section></div>`;
}

function ratingBar(label: string, v: number): string {
  const n = Math.round(((Math.max(20, Math.min(80, v)) - 20) / 60) * 12);
  const tone = v >= 65 ? 'hi' : v >= 50 ? 'mid' : 'lo';
  const edge = v <= 30 ? ' v-lo' : v >= 70 ? ' v-hi' : '';
  return `<div class="rbar"><span class="k">${label}</span><span class="segs ${tone}" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span><span class="v${edge}">${v}</span></div>`;
}

function playerCard(app: App, id: number): string {
  const g = app.game;
  const L = g?.league ?? app.founding?.league;
  // anyone: rostered, a free agent, an amateur or prospect on the draft board, or retired
  const p = L && (g?.players.get(id) ?? [...L.players, ...L.freeAgents, ...L.amateurs, ...L.prospects.map((x) => x.player), ...L.retired].find((x) => x.id === id));
  if (!p || !L) return '';
  const R = p.ratings;
  const region = REGIONS.find((r) => r.id === p.regionId);
  const teamId = g?.teamOf.get(id) ?? L.teams.find((t) => t.playerIds.includes(id))?.id ?? 0;
  const prospectOf = L.prospects.find((x) => x.player.id === id);
  const isP = p.position === 'P';
  const hit = `<div class="rgroup"><h3>HITTING</h3>${ratingBar('POWER', r5(R.power))}${ratingBar('CONTACT', r5(R.contact))}${ratingBar('EYE', r5(R.discipline))}${ratingBar('SPEED', r5(R.speed))}</div>`;
  const field = `<div class="rgroup"><h3>FIELDING</h3>${ratingBar('RANGE', r5(R.instincts))}${ratingBar('GLOVE', r5(R.glove))}${ratingBar('ARM', r5(R.cannon))}</div>`;
  const arm = `<div class="rgroup"><h3>PITCHING</h3>${ratingBar('VELOCITY', r5(R.velocity))}${ratingBar('CONTROL', r5(R.control))}${ratingBar('MOVEMENT', r5(R.movement))}${ratingBar('STAMINA', r5(R.stamina))}</div>`;
  const clutch = `<div class="rgroup"><h3>CLUTCH</h3>${ratingBar('RISP', r5(R.clutchRisp))}${ratingBar('PRESSURE', r5(R.clutchPressure))}</div>`;
  const b = g?.season.batting.get(id), q = g?.season.pitching.get(id);
  const line = isP
    ? (q ? `${q.W}-${q.L} · ${era2(era(q))} ERA · ${ip(q.outs)} IP · ${q.K} SO · ${q.BB} BB · ${q.SV} SV · ${whip(q).toFixed(2)} WHIP · ${q.G} G, ${q.GS} GS` : 'Has not pitched this year.')
    : (b ? `${rate3(avg(b))}/${rate3(obp(b))}/${rate3(slg(b))} · ${b.HR} HR · ${b.RBI} RBI · ${b.R} R · ${b.SB} SB · ${b.BB} BB · ${b.K} K · ${b.PA} PA` : 'Has not batted this year.');
  const role = isP ? (p.pitcherRole === 'SP' ? 'Starting pitcher' : p.pitcherRole === 'CL' ? 'Closer' : 'Relief pitcher') : (POS_NAME[p.position] ?? p.position);
  const where = teamId ? teamName(teamId) : prospectOf ? `${teamName(prospectOf.teamId)} prospect` : 'retiredAfter' in p ? 'Retired' : p.age <= 22 && L.amateurs.includes(p) ? 'Amateur' : 'Free agent';
  const body = `<div class="pc-who"><p>Born in ${esc(region?.name ?? 'parts unknown')}${region ? ` <span class="muted">(${esc(region.environment.replace(/_/g, ' '))})</span>` : ''}</p>
<p>${esc(role)}</p><p>Bats ${p.bats} · Throws ${p.throws}</p><p class="pc-main">Age ${p.age} · ${esc(where)}</p></div>
<div class="rgrid">${isP ? arm + field + clutch : hit + field + clutch}</div>
${g ? `<h3 class="pc-h">YEAR ${g.year}</h3>${(isP ? q : b) ? `<p class="pc-line st-line">${seasonLine(g, id, isP)}</p><p class="pc-line muted small">Green: the league's top tenth among qualified players. Red: the bottom tenth.</p>` : `<p class="pc-line">${line}</p>`}${postLine(g, id, isP)}${careerHtml(g, id, isP)}` : ''}`;
  return modal('pc-t', esc(p.name), body);
}

const POS_NAME: Record<string, string> = { C: 'Catcher', '1B': 'First base', '2B': 'Second base', '3B': 'Third base', SS: 'Shortstop', LF: 'Left field', CF: 'Center field', RF: 'Right field', DH: 'Designated hitter', UT: 'Utility' };

/** Year-by-year lines from history, this year's so far, and career totals. */
function careerHtml(g: NonNullable<App['game']>, id: number, isP: boolean): string {
  if (!g.league.history.length) return '';
  const ageIn = (year: number) => ratingsIn(g.league, id, year)?.age;
  const now = g.players.get(id)!;
  if (isP) {
    const past = careerPitching(g.league, id);
    const cur = g.season.pitching.get(id);
    const all = [...past, ...(cur ? [{ year: g.year, teamId: g.teamOf.get(id) ?? 0, line: cur }] : [])];
    if (!all.length) return '';
    const cells = (q: NonNullable<typeof cur>) => [`${q.W}-${q.L}`, era2(era(q)), String(q.G), String(q.GS), ip(q.outs), String(q.K), String(q.BB), whip(q).toFixed(2), String(q.SV)];
    const rows = all.map((y) => trow([String(y.year), String(y.teamId).padStart(2, '0'), String(y.year === g.year ? now.age : ageIn(y.year) ?? ''), ...cells(y.line)])).join('');
    const tot = total(all.map((y) => y.line))!;
    const body = thead(['YR', 'TM', 'AGE', 'W-L', 'ERA', 'G', 'GS', 'IP', 'SO', 'BB', 'WHIP', 'SV']) + rows + trow(['CAREER', '', '', ...cells(tot)], 0, true);
    return careerBox(ttable('62px 34px 34px 56px 50px 34px 34px 60px 40px 40px 50px 34px', 'Career pitching', body).replace('class="ttable"', 'class="ttable full"'));
  }
  const past = careerBatting(g.league, id);
  const cur = g.season.batting.get(id);
  const all = [...past, ...(cur ? [{ year: g.year, teamId: g.teamOf.get(id) ?? 0, line: cur }] : [])];
  if (!all.length) return '';
  const cells = (b: NonNullable<typeof cur>) => [String(b.PA), rate3(avg(b)), rate3(obp(b)), rate3(slg(b)), String(b.H), String(b.D), String(b.HR), String(b.RBI), String(b.SB), String(b.BB), String(b.K)];
  const rows = all.map((y) => trow([String(y.year), String(y.teamId).padStart(2, '0'), String(y.year === g.year ? now.age : ageIn(y.year) ?? ''), ...cells(y.line)])).join('');
  const tot = total(all.map((y) => y.line))!;
  const body = thead(['YR', 'TM', 'AGE', 'PA', 'AVG', 'OBP', 'SLG', 'H', '2B', 'HR', 'RBI', 'SB', 'BB', 'K']) + rows + trow(['CAREER', '', '', ...cells(tot)], 0, true);
  return careerBox(ttable('62px 34px 34px 46px 50px 50px 50px 40px 34px 34px 40px 34px 40px 40px', 'Career batting', body).replace('class="ttable"', 'class="ttable full"'));
}
/** Career lines, folded away until you open them. */
const careerBox = (table: string) => `<details class="pc-career"><summary class="pc-h">CAREER</summary><div class="hscroll">${table}</div></details>`;

function postLine(g: NonNullable<App['game']>, id: number, isP: boolean): string {
  const b = g.season.postBatting.get(id), q = g.season.postPitching.get(id);
  const line = isP ? (q ? `${q.W}-${q.L} · ${era2(era(q))} ERA · ${ip(q.outs)} IP · ${q.K} SO · ${q.SV} SV · ${q.G} G, ${q.GS} GS` : '')
    : (b ? `${rate3(avg(b))}/${rate3(obp(b))}/${rate3(slg(b))} · ${b.HR} HR · ${b.RBI} RBI · ${b.PA} PA` : '');
  return line ? `<h3 class="pc-h">POSTSEASON</h3><p class="pc-line">${line}</p>` : '';
}

function settingsModal(app: App): string {
  const s = app.settings;
  const cueOpts = [...LOOP_CUES, ...STINGERS].map((c) => `<option value="${c}">${c}${(STINGERS as readonly string[]).includes(c) ? ' (one-shot)' : ''}</option>`).join('');
  const pw = app.password();
  const restart = app.restartArmed
    ? `<p class="warn">Start over in a new league? This year ends here. Write down your password first if you want to come back to it.</p><div class="row-actions">${btn('START OVER', 'restart-confirm', { kind: 'primary' })}${btn('KEEP PLAYING', 'close')}</div>`
    : `<div class="row-actions">${btn('NEW LEAGUE', 'restart-arm')}</div>`;
  const body = `<div class="set-group"><h3>DISPLAY</h3>
<label class="toggle"><input type="checkbox" id="set-readable" data-act="set-readable"${s.readable ? ' checked' : ''}><span>Readable text (swap the pixel fonts for a plain one)</span></label>
<label class="field"><span class="k">PLAY-BY-PLAY DETAIL</span><select id="set-detail" data-act="set-detail"><option value="final"${s.detail === 'final' ? ' selected' : ''}>Summary: counts on homers, long at-bats noted</option><option value="full"${s.detail === 'full' ? ' selected' : ''}>Full: every pitch of long at-bats</option><option value="none"${s.detail === 'none' ? ' selected' : ''}>Plays only</option></select></label></div>
<div class="set-group"><h3>LIVE GAMES</h3>
<label class="field"><span class="k">YOUR MOVES WHEN YOU WATCH</span><select id="set-manager" data-act="set-manager"><option value="ask"${s.manager === 'ask' ? ' selected' : ''}>Ask me first: the bench coach asks before he makes a move, and the game stops at big moments</option><option value="me"${s.manager === 'me' ? ' selected' : ''}>All mine: nothing moves unless I do; the game waits when a decision is due</option><option value="ai"${s.manager === 'ai' ? ' selected' : ''}>Bench coach: he decides and play flows on; I can still step in</option></select></label></div>
<div class="set-group"><h3>MUSIC</h3>
<label class="toggle"><input type="checkbox" id="set-music" data-act="set-music"${s.music ? ' checked' : ''}><span>Music on</span></label>
<label class="field"><span class="k">VOLUME</span><input type="range" id="set-volume" min="0" max="100" value="${Math.round(s.volume * 100)}" data-act="set-volume"></label>
<p class="note small">Tracks you make go in the game's <b>music</b> folder, listed in <b>manifest.json</b>. To hear one now, pick its cue and choose the file. It plays for this session.</p>
<form class="music-test" data-form="music">
<label class="field"><span class="k">CUE</span><select name="cue" id="music-cue">${cueOpts}</select></label>
<label class="field short"><span class="k">LOOP START (S)</span><input name="loopStart" id="music-ls" type="number" min="0" step="0.01" placeholder="0"></label>
<label class="field short"><span class="k">LOOP END (S)</span><input name="loopEnd" id="music-le" type="number" min="0" step="0.01" placeholder="end"></label>
<label class="field file"><span class="k">TRACK (OGG, MP3, WAV)</span><input type="file" id="music-file" accept="audio/*,.ogg,.mp3,.wav" data-act="music-file"></label>
</form><div class="row-actions">${btn('STOP MUSIC', 'music-stop')}</div>${app.musicMsg ? `<p class="note" role="status">${esc(app.musicMsg)}</p>` : ''}</div>
${app.game ? `<div class="set-group"><h3>SAVES</h3><p class="note small">${saveNote(app)} A save file holds the whole league: back it up, or load it on another device from the title screen.</p>
<div class="row-actions">${btn('SAVE TO FILE', 'export-file')}</div></div>` : ''}
${pw ? `<div class="set-group"><h3>YOUR PASSWORD</h3><p class="note small">This browser saves automatically. The password brings this year back on any device: enter it from the title screen.</p>
<div class="pw-row"><input class="pw" readonly value="${pw}" data-password-field aria-label="Password" id="pw-field">${btn('COPY', 'copy-password')}</div></div>` : ''}
<div class="set-group"><h3>LEAGUE</h3>${restart}</div>`;
  return modal('set-t', 'Settings', body, true);
}

function saveNote(app: App): string {
  switch (app.storage) {
    case 'persistent': return 'This browser saves your league automatically, and it has agreed to keep it.';
    case 'kept': return 'This browser saves your league automatically. Browsers can clear saved data for sites you haven\'t visited in a while (Safari after about a week), so keep a file too.';
    case 'none': return app.game?.year === 1 ? 'This browser won\'t store the full league here (a private window, or storage is off). It keeps a short replay save instead, and the year replays from it when you continue. Save a file to keep everything.' : 'This browser won\'t store the league here (a private window, or storage is off). Save a file, or this league is gone when the page closes.';
    default: return 'This browser saves your league automatically.';
  }
}

function passwordModal(app: App): string {
  const body = `<form class="pw-form" data-form="password"><label class="field"><span class="k">PASSWORD</span><input id="pw-input" class="pw" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="14" data-autofocus></label>
<div class="row-actions"><button type="submit" class="btn btn-primary" data-key="pw-go"><span>LOAD YEAR</span></button></div>
${app.passwordMsg ? `<p class="warn" role="alert">${esc(app.passwordMsg)}</p>` : '<p class="note small">Ten letters and numbers, from Settings on the device where you played.</p>'}</form>`;
  return modal('pwm-t', 'Enter Password', body);
}

function restartModal(app: App): string {
  void app;
  const body = `<p class="note">Start a new league? This year ends here. Your password in Settings brings it back later.</p><div class="row-actions">${btn('START OVER', 'restart-confirm', { kind: 'primary' })}${btn('NOT YET', 'close')}</div>`;
  return modal('rs-t', 'New League', body);
}

export function modalView(app: App): string {
  const m = app.modal;
  if (!m) return '';
  if (m.kind === 'player') return playerCard(app, m.id);
  if (m.kind === 'settings') return settingsModal(app);
  if (m.kind === 'password') return passwordModal(app);
  return restartModal(app);
}

export function busyView(app: App): string {
  const b = app.busy;
  if (!b) return '';
  const done = b.total ? b.done / b.total : 0;
  return `<div class="busy-veil"><section class="win busy" role="alertdialog" aria-labelledby="busy-t" aria-live="polite"><span class="studs" aria-hidden="true"></span>
<h2 class="win-title" id="busy-t">${esc(b.label)}</h2><div class="hourglass-anim" aria-hidden="true">${icon('hourglass', 6)}</div>
<div class="bar" data-busy-bar style="--done:${done}"><i></i></div><div class="busy-count" data-busy-count>${b.total > 1 ? `${b.done} / ${b.total}` : ''}</div>
<p class="busy-note" data-busy-note>${esc(b.note)}</p>${b.stoppable ? btn('STOP', 'stop-sim') : ''}</section></div>`;
}

export function toastView(app: App): string {
  return app.toast ? `<div class="toast" role="status">${esc(app.toast)}</div>` : '';
}
