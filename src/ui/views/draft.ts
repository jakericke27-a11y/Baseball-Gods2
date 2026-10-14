/**
 * Draft night: the founding draft that opens a league, and the four-year draft every fourth winter. The AI's picks
 * tick by live (pause, speed, or skip to your pick); the board sorts and filters; your draft board is pinned beside it.
 */
import { playerValue } from '../../engine/development';
import { done, onClock, totalPicks, type DraftState } from '../../engine/draft';
import type { League } from '../../engine/types';
import type { App } from '../app';
import { teamName } from '../teams';
import { boardWin, wishWin } from './board';
import { banner, btn, esc, link, tname, win } from './common';

export interface DraftView { league: League; draft: DraftState; userTeam: number }

/** Milliseconds between AI picks at each speed. */
export const DRAFT_SPEEDS = { slow: 1600, normal: 700, fast: 180 } as const;

export function draftView(app: App, v: DraftView): string {
  const { league: L, draft: d, userTeam } = v;
  const founding = d.kind === 'founding';
  const pool = founding ? L.freeAgents : L.amateurs;
  const on = new Set(d.pool);
  const yours = !done(d) && onClock(d) === userTeam;
  const n = d.order.length, i = d.picks.length, round = Math.floor(i / n) + 1;
  const live = app.draftLive;

  const board = boardWin({ app, league: L, players: pool.filter((p) => on.has(p.id)), mode: 'draft', yours, title: 'The Board', label: founding ? 'EVERYONE STILL AVAILABLE' : 'AMATEURS 18–22 STILL AVAILABLE' });

  // the clock and its controls
  const myNext = (() => { for (let k = i; k < totalPicks(d); k++) { const r = Math.floor(k / n), j = k % n; const t = d.snake && r % 2 === 1 ? d.order[n - 1 - j] : d.order[j]; if (t === userTeam) return k - i; } return -1; })();
  const clock = done(d) ? '<p class="note">The draft is complete.</p>'
    : `<p class="clock${yours ? ' yours' : ''}">${yours ? 'YOU ARE ON THE CLOCK' : `${tname(onClock(d))} on the clock`}</p><p class="note small">Round ${round} of ${d.rounds} · pick ${i + 1} of ${totalPicks(d)}${!yours && myNext > 0 ? ` · your pick in ${myNext}` : ''}</p>`;
  const speeds = (['slow', 'normal', 'fast'] as const).map((sp) => `<button type="button" class="tab${live.speed === sp ? ' on' : ''}" data-act="draft-speed" data-speed="${sp}" data-key="draft-speed:${sp}" aria-pressed="${live.speed === sp}">${sp.toUpperCase()}</button>`).join('');
  const controls = done(d) ? `<div class="row-actions">${btn('CONTINUE', 'draft-finish', { kind: 'primary', icon: 'ball' })}</div>`
    : `<div class="row-actions">${yours ? '' : btn(live.paused ? 'RESUME' : 'PAUSE', 'draft-pause', { kind: live.paused ? 'primary' : 'secondary', icon: live.paused ? 'play' : 'pause' })}${!yours && myNext > 0 ? btn('SKIP TO MY PICK', 'draft-skip', { title: 'The AI picks until you are on the clock' }) : ''}${btn(founding ? 'AUTO THE REST' : 'AUTO MY PICKS', 'draft-auto', { title: 'The AI picks for you from here (your draft board first), then the draft finishes' })}</div>
<div class="tabs small-tabs" role="group" aria-label="Pick speed">${speeds}</div>`;

  // your 40 so far (founding)
  let needs = '';
  if (founding) {
    const t = L.teams.find((x) => x.id === userTeam)!;
    const ps = t.playerIds.map((id) => L.players.find((p) => p.id === id)!);
    const bats = ps.filter((p) => p.position !== 'P'), arms = ps.filter((p) => p.position === 'P');
    const pos = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((k) => `${k} ${bats.filter((b) => b.position === k).length}/${k === 'C' ? 3 : 2}`).join(' · ');
    const avg = ps.length ? Math.round(ps.reduce((a, p) => a + playerValue(p), 0) / ps.length) : 0;
    needs = `<h3 class="pc-h">YOUR 40 SO FAR</h3><p class="note small">${bats.length}/22 position players · ${arms.length}/18 pitchers (${arms.filter((p) => p.pitcherRole === 'SP').length}/6 starters)</p><p class="note small muted">${pos}</p>${ps.length ? `<p class="note small">Average now: ${avg}</p>` : ''}`;
  }
  const lottery = !founding && d.lottery.length ? `<h3 class="pc-h">THE LOTTERY</h3><ol class="lead-list past-list">${[...d.lottery].sort((a, b) => a[1] - b[1]).map(([id, at], k) => `<li class="${id === userTeam ? 'mine' : ''}"><span class="rank">${at}</span><span class="nm">${tname(id)}</span><span class="val">${k < 6 ? 'won a top-6 pick' : ''}</span></li>`).join('')}</ol>` : '';
  const recent = [...d.picks].slice(-12).reverse().map((x, k) => `<li class="${x.teamId === userTeam ? 'mine' : ''}${k === 0 && live.fresh === x.overall ? ' fresh' : ''}"><span class="rank">${x.overall}</span><span class="nm">${tname(x.teamId)}: ${link(x.name, 'player', { id: x.playerId })} <span class="muted">${x.pos}, ${x.age}</span><span class="d-why">${esc(x.reason)}</span></span></li>`).join('');
  const mine = d.picks.filter((x) => x.teamId === userTeam);
  const side = win({ id: 'w-clock', title: founding ? 'Founding Draft' : `Year ${d.year} Draft`, label: founding ? 'BUILD YOUR 40' : 'TEN ROUNDS · RIGHTS FOR FOUR YEARS', cls: 'w-clock',
    body: `${clock}${controls}${needs}${lottery}<h3 class="pc-h">LATEST PICKS</h3><ol class="lead-list draft-recent">${recent || '<li><span class="nm muted">No picks yet</span></li>'}</ol>
${mine.length ? `<h3 class="pc-h">YOUR PICKS</h3><ol class="lead-list draft-recent">${mine.map((x) => `<li class="mine"><span class="rank">${x.overall}</span><span class="nm">${link(x.name, 'player', { id: x.playerId })} <span class="muted">${x.pos}, ${x.age} · ceiling ${x.lo}–${x.hi}</span></span></li>`).join('')}</ol>` : ''}` });
  const taken = new Map(d.picks.map((x) => [x.playerId, x.teamId]));
  const wish = wishWin(app, L, taken, { title: 'Your Board' });

  return `<div class="frame screen-page screen-draft">${banner(founding ? 'THE FOUNDING DRAFT' : `THE YEAR ${d.year} DRAFT`, founding ? `${esc(teamName(userTeam)).toUpperCase()} · 40 ROUNDS · SNAKE ORDER` : `${esc(teamName(userTeam)).toUpperCase()} · 10 ROUNDS · LOTTERY FOR PICKS 1–6`)}
<main class="main page" id="main" data-scroll="draft"><div class="draft-layout">${board}<div class="draft-side">${side}${wish}</div></div></main></div>`;
}
