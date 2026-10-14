/** Watching a game: line score, matchup, this at-bat, count and bases, and the game log by half-inning. */
import { pitchLocOf, pitchResultOf } from '../../engine/atbat/codes';
import { halfLabel, ordinal, POS_ABBR } from '../../engine/game/text';
import { formatStart } from '../../engine/season/schedule';
import type { App } from '../app';
import { LOC_WORD, PITCH_WORD, type Frame } from '../replay';
import { icon } from '../sprites';
import { era, era2, rate3 } from '../stats';
import { findSeries, seriesShort } from '../post';
import { teamName } from '../teams';
import { banner, btn, esc, iconBtn, link, r5, win, tname } from './common';

function lineScore(app: App, f: Frame): string {
  const r = app.watch!.replay.result;
  const final = f.kind === 'final';
  const innings = Math.max(9, f.line[0].length, f.line[1].length, f.inning);
  const head = `<tr><th scope="col" class="ls-team">INNING</th>${Array.from({ length: innings }, (_, i) => `<th scope="col">${i + 1}</th>`).join('')}<th scope="col" class="ls-gap"></th><th scope="col">R</th><th scope="col">H</th><th scope="col">E</th></tr>`;
  const row = (side: 0 | 1) => {
    const cells = Array.from({ length: innings }, (_, i) => {
      const cur = !final && f.half === side && f.inning === i + 1;
      let v = i < f.line[side].length ? String(f.line[side][i]) : '';
      if (final && side === 1 && i === f.line[1].length && i < r.innings && f.score[1] > f.score[0]) v = 'x';
      return `<td${cur ? ' class="cur"' : ''}>${v}</td>`;
    }).join('');
    const id = r.teamIds[side];
    return `<tr${id === app.game!.userTeam ? ' class="mine"' : ''}><th scope="row" class="ls-team">${tname(id)}</th>${cells}<td class="ls-gap"></td><td class="rhe">${f.score[side]}</td><td class="rhe">${f.hits[side]}</td><td class="rhe">${f.errors[side]}</td></tr>`;
  };
  return `<section class="win linescore-win" aria-label="Line score"><span class="studs" aria-hidden="true"></span><div class="ls-scroll"><table class="linescore">${head}${row(0)}${row(1)}</table></div></section>`;
}

function chips(c: Record<string, number>): string {
  return `<div class="chips">${Object.entries(c).map(([k, v]) => `<div class="chip"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;
}

function matchup(app: App, f: Frame): string {
  const g = app.game!, r = app.watch!.replay.result;
  const b = g.players.get(f.batter)!, p = g.players.get(f.pitcher)!;
  const post = r.kind === 'post';
  const sb = (post ? g.season.postBatting : g.season.batting).get(b.id), gb = r.batting.get(b.id);
  const ab = (sb?.AB ?? 0) - (gb?.AB ?? 0), h = (sb?.H ?? 0) - (gb?.H ?? 0), hr = (sb?.HR ?? 0) - (gb?.HR ?? 0);
  const sp = (post ? g.season.postPitching : g.season.pitching).get(p.id), gp = r.pitching.get(p.id);
  const before = sp ? { ...sp, ER: sp.ER - (gp?.ER ?? 0), outs: sp.outs - (gp?.outs ?? 0) } : null;
  const slot = r.lineups[f.half].find((s) => s.player.id === b.id);
  const pos = slot ? POS_ABBR[slot.pos] : b.position;
  const R = b.ratings, Q = p.ratings;
  const body = `<div class="person"><div class="k">AT BAT</div><div class="person-name">${link(b.name, 'player', { id: b.id })}</div>
<div class="person-sub">${pos} · BATS ${b.bats} · ${ab ? rate3(h / ab) : '.000'} · ${hr} HR</div><div class="person-sub">${esc(f.today)}</div>
${chips({ POW: r5(R.power), CON: r5(R.contact), EYE: r5(R.discipline), SPD: r5(R.speed) })}</div>
<div class="divider" aria-hidden="true"></div>
<div class="person"><div class="k">ON THE MOUND</div><div class="person-name">${link(p.name, 'player', { id: p.id })}</div>
<div class="person-sub">${p.throws === 'R' ? 'RHP' : 'LHP'} · ${f.pitcherPitches} PITCHES · ${before && before.outs ? era2(era(before)) : '—'} ERA</div>
${chips({ VEL: r5(Q.velocity), CTL: r5(Q.control), MOV: r5(Q.movement), STA: r5(Q.stamina) })}</div>`;
  return win({ id: 'w-matchup', title: 'Matchup', label: 'RATINGS TO THE NEAREST 5', body, cls: 'w-matchup', scroll: true });
}

function thisAtBat(f: Frame): string {
  const rows = f.ab.map((byte, i) => {
    const last = i === f.ab.length - 1 && f.kind === 'result';
    return `<li class="pitch-row${last ? ' last' : ''}"><span class="n">${i + 1}</span><span class="what">${PITCH_WORD[pitchResultOf(byte)]}</span><span class="where">${LOC_WORD[pitchLocOf(byte)].toUpperCase()}</span></li>`;
  }).join('');
  const empty = f.kind === 'up' || f.kind === 'start' ? '<li class="pitch-row muted">Stepping in…</li>' : '';
  return win({ id: 'w-ab', title: 'This At-Bat', label: `COUNT ${f.count[0]}-${f.count[1]}`, body: `<ol class="pitch-list">${rows || empty}</ol>`, scroll: true, cls: 'w-ab' });
}

function countBox(f: Frame): string {
  const lights = (k: string, n: number, total: number, cls: string) =>
    `<div class="lights" aria-label="${k === 'B' ? 'Balls' : k === 'S' ? 'Strikes' : 'Outs'}: ${n}"><span class="k">${k}</span>${Array.from({ length: total }, (_, i) => `<span class="lamp${i < n ? ` on ${cls}` : ''}"></span>`).join('')}</div>`;
  const base = (on: boolean, cls: string) => `<span class="base ${cls}${on ? ' on' : ''}"></span>`;
  const outs = Math.min(2, f.outs);
  const names = ['first', 'second', 'third'].filter((_, i) => f.bases & (1 << i));
  return `<section class="win count-win" aria-label="Count, outs and runners"><span class="studs" aria-hidden="true"></span>
<div class="count-lights">${lights('B', Math.min(3, f.count[0]), 3, 'ball')}${lights('S', Math.min(2, f.count[1]), 2, 'strike')}${lights('O', f.outs >= 3 ? 2 : outs, 2, 'out')}</div>
<div class="diamond" role="img" aria-label="${names.length ? `Runners on ${names.join(', ')}` : 'Bases empty'}">${base(!!(f.bases & 2), 'b2')}${base(!!(f.bases & 4), 'b3')}${base(!!(f.bases & 1), 'b1')}<span class="plate"></span></div></section>`;
}

/** Live games: your moves, and the bench coach's questions. */
function managerPanel(app: App): string {
  const g = app.game!, w = app.watch!, d = g.live?.day, c = d?.call;
  if (!w.live || !d || !c) return '';
  const me = g.liveSide, setup = d.setups[me], fielding = c.half !== me;
  const mode = app.settings.manager;
  const modeSel = `<label class="mgr-mode"><span class="sr-only">Your moves</span><select data-act="set-manager" title="Who makes your team's moves">${([['ask', 'ASK ME FIRST'], ['me', 'ALL MINE'], ['ai', 'BENCH COACH']] as const).map(([v, t]) => `<option value="${v}"${mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  if (!app.liveEdge()) {
    return win({ id: 'w-mgr', title: 'Manager', label: modeSel, cls: 'w-mgr', body: `<p class="note small">You're watching the game so far. Catch up to make moves.</p><div class="row-actions">${btn('CATCH UP', 'live-catch', { kind: 'primary', icon: 'ff' })}</div>` });
  }
  const used = new Set(c.used[me]);
  const bench = (setup.bench ?? []).filter((p) => !used.has(p.id));
  const pen = setup.bullpen.filter((a) => !used.has(a.player.id));
  const opt = (id: number, text: string) => `<option value="${id}">${esc(text)}</option>`;
  const penSel = `<select id="live-pitch-sel" aria-label="Reliever">${pen.map((a) => opt(a.player.id, `${a.role} ${a.player.name} · STA ${r5(a.player.ratings.stamina)}`)).join('')}</select>`;
  const benchSel = (id: string) => `<select id="${id}" aria-label="Bench player">${bench.map((p) => opt(p.id, `${p.position} ${p.name} · CON ${r5(p.ratings.contact)} POW ${r5(p.ratings.power)} SPD ${r5(p.ratings.speed)}`)).join('')}</select>`;
  const mine = c.pitchers[me];
  let ask = '';
  if (app.liveBlocked()) {
    const want = c.aiPitch[me];
    ask = `<div class="mgr-ask" role="alert"><p>${mode === 'ask' ? `Bench coach: ${esc(g.name(mine.id))} has thrown ${mine.pitches} pitches. Bring in ${esc(g.name(want))}?` : `${esc(g.name(mine.id))} has thrown ${mine.pitches} pitches. Your call: bring someone in below, or leave him in.`}</p>
<div class="row-actions">${mode === 'ask' ? btn(`YES, ${esc(g.name(want)).toUpperCase()}`, 'live-ok', { kind: 'primary' }) : ''}${btn('LEAVE HIM IN', 'live-keep')}</div></div>`;
  } else if (w.alert) {
    ask = `<div class="mgr-ask alert" role="status"><p>${esc(w.alert)}</p><div class="row-actions">${btn('PLAY ON', 'live-go', { kind: 'primary', icon: 'play' })}</div></div>`;
  }
  const moves: string[] = [];
  if (fielding) {
    moves.push(`<div class="mgr-row"><span class="k">PITCHING · ${esc(g.name(mine.id))}, ${mine.pitches} PITCHES</span>${pen.length ? `<div class="mgr-ctl">${penSel}${btn('BRING IN', 'live-pitch')}</div>` : '<p class="note small muted">Nobody left in the bullpen.</p>'}</div>`);
    if (bench.length) moves.push(`<div class="mgr-row"><span class="k">DEFENSIVE SUB</span><div class="mgr-ctl"><select id="live-def-slot" aria-label="Replace">${c.lineups[me].map(([id, pos], i) => pos >= 2 ? `<option value="${i}">${POS_ABBR[pos]} ${esc(g.name(id))}</option>` : '').join('')}</select>${benchSel('live-def-sel')}${btn('SWAP IN', 'live-def')}</div></div>`);
  } else {
    if (bench.length) moves.push(`<div class="mgr-row"><span class="k">PINCH HIT FOR ${esc(g.name(c.batter)).toUpperCase()}</span><div class="mgr-ctl">${benchSel('live-ph-sel')}${btn('PINCH HIT', 'live-ph')}</div></div>`);
    const on = c.bases.map((id, b) => (id ? `<option value="${b}">${['1ST', '2ND', '3RD'][b]} ${esc(g.name(id))}</option>` : '')).join('');
    if (bench.length && on) moves.push(`<div class="mgr-row"><span class="k">PINCH RUN</span><div class="mgr-ctl"><select id="live-pr-base" aria-label="Runner">${on}</select>${benchSel('live-pr-sel')}${btn('PINCH RUN', 'live-pr')}</div></div>`);
    if (!bench.length) moves.push('<p class="note small muted">Nobody left on the bench.</p>');
  }
  return win({ id: 'w-mgr', title: fielding ? 'Manager · In the Field' : 'Manager · At Bat', label: modeSel, cls: 'w-mgr', body: `${ask}${moves.join('')}`, scroll: true });
}

function callBox(f: Frame): string {
  return `<div class="call tone-${f.tone}" role="status" aria-live="polite">${esc(f.call)}</div>`;
}

function gameLog(app: App, f: Frame): string {
  const rp = app.watch!.replay, g = app.game!;
  const lines = rp.log.slice(0, f.log);
  let html = '', key = -1;
  for (const l of lines) {
    if (l.key !== key) {
      key = l.key;
      html += `<div class="log-half">${halfLabel(l.inning, l.half).toUpperCase()} — ${esc(teamName(rp.result.teamIds[l.half])).toUpperCase()}</div>`;
    }
    html += `<p class="log-line ${l.tone ?? ''}${l.runs ? ' scored' : ''}${l.kind === 'change' ? ' change' : ''}">${esc(l.text)}${l.runs ? ` <span class="log-score">${l.score[0]}-${l.score[1]}</span>` : ''}</p>`;
  }
  if (f.kind === 'up' || f.kind === 'pitch') {
    const fk = f.inning * 2 + f.half;
    if (fk !== key) html += `<div class="log-half">${halfLabel(f.inning, f.half).toUpperCase()} — ${esc(teamName(rp.result.teamIds[f.half])).toUpperCase()}</div>`;
    html += `<p class="log-line now">Now batting: ${esc(g.name(f.batter))}</p>`;
  }
  if (!html) html = '<p class="log-line muted">The game log fills in as the game goes.</p>';
  return `<section class="win w-log" aria-labelledby="w-log-t"><span class="studs" aria-hidden="true"></span>
<header class="win-head"><h2 class="win-title" id="w-log-t">Game Log</h2><span class="win-label">BY HALF-INNING</span></header>
<div class="win-body scroll" data-scroll="watch-log" data-stick="bottom">${html}</div></section>`;
}

export function watchView(app: App): string {
  const w = app.watch!;
  const f = w.replay.frames[w.at], r = w.replay.result;
  const final = f.kind === 'final';
  const [away, home] = r.teamIds;
  const sr = findSeries(app.game!, r.series);
  const tail = sr ? `${seriesShort(sr)} GAME ${r.game}` : r.kind === 'tiebreak' ? 'GAME 163' : `YEAR ${app.game!.year}`;
  const sub = final ? `FINAL${r.innings > 9 ? ` IN ${r.innings}` : ''} · FIRST PITCH ${formatStart(r.start)} · ${tail}`
    : `${f.half ? 'BOTTOM' : 'TOP'} ${ordinal(f.inning).toUpperCase()} · FIRST PITCH ${formatStart(r.start)} · ${tail}`;
  const controls = final
    ? btn('BOX SCORE', 'w-box', { icon: 'box' }) + btn('HOME', 'go', { kind: 'primary', icon: 'temple', data: { to: 'home' } })
    : btn('NEXT PITCH', 'w-pitch', { kind: 'primary', icon: 'ball', title: 'Space bar' })
      + btn('NEXT AT-BAT', 'w-ab', { icon: 'bat', title: 'A key' })
      + btn('NEXT INNING', 'w-inning', { icon: 'hourglass' })
      + btn('TO END', 'w-end', { icon: 'ff' });
  const auto = final ? '' : `<button type="button" class="btn btn-ghost${w.auto ? ' on' : ''}" data-act="w-auto" data-key="w-auto" aria-pressed="${w.auto}">${icon(w.auto ? 'pause' : 'play')}<span>AUTO</span></button>`;
  return `<div class="frame screen-watch">${banner(`${esc(teamName(away)).toUpperCase()} AT ${esc(teamName(home)).toUpperCase()}`, sub)}
<main class="main watch-main" id="main">${lineScore(app, f)}
<div class="gv"><div class="gv-left">${matchup(app, f)}${thisAtBat(f)}</div>
<div class="gv-center">${callBox(f)}${countBox(f)}${managerPanel(app)}</div>
<div class="gv-right">${gameLog(app, f)}</div></div></main>
<footer class="footer"><nav class="nav" aria-label="Screens">${iconBtn('temple', final ? 'Home' : w.live ? 'Leave game (the bench coach finishes it)' : 'Leave game (it plays out)', 'go', { data: { to: 'home' } })}${auto}</nav><div class="actions">${controls}</div></footer></div>`;
}
