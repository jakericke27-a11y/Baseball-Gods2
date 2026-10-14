/** Draft night: the founding draft that opens a league, and the four-year draft every fourth winter. */
import { playerValue } from '../../engine/development';
import { done, onClock, projection, totalPicks, type DraftState } from '../../engine/draft';
import { REGIONS } from '../../engine/regions';
import type { League, Player } from '../../engine/types';
import type { App } from '../app';
import { teamName } from '../teams';
import { banner, btn, esc, link, r5, win } from './common';

export interface DraftView { league: League; draft: DraftState; userTeam: number }

export function draftView(app: App, v: DraftView): string {
  const { league: L, draft: d, userTeam } = v;
  const founding = d.kind === 'founding';
  const pool = founding ? L.freeAgents : L.amateurs;
  const on = new Set(d.pool);
  const yours = !done(d) && onClock(d) === userTeam;
  const n = d.order.length, i = d.picks.length, round = Math.floor(i / n) + 1;
  const filter = app.draftFilter;
  const board = pool.filter((p) => on.has(p.id) && (filter === 'all' || (filter === 'arms') === (p.position === 'P')))
    .map((p) => ({ p, pr: projection(p, L.seed) }))
    .sort((a, b) => (founding ? b.pr.now - a.pr.now || b.pr.mid - a.pr.mid : b.pr.mid - a.pr.mid || b.pr.now - a.pr.now) || a.p.id - b.p.id)
    .slice(0, 60);
  const ratings = (p: Player) => {
    const R = p.ratings;
    return p.position === 'P' ? `VEL ${r5(R.velocity)} · CTL ${r5(R.control)} · MOV ${r5(R.movement)} · STA ${r5(R.stamina)}`
      : `POW ${r5(R.power)} · CON ${r5(R.contact)} · EYE ${r5(R.discipline)} · SPD ${r5(R.speed)} · GLV ${r5(R.glove)}`;
  };
  const rows = board.map(({ p, pr }) => `<tr><th scope="row">${link(p.name, 'player', { id: p.id })}<span class="muted small d-sub">${esc(REGIONS.find((r) => r.id === p.regionId)?.name ?? '')}</span></th>
<td>${p.position === 'P' ? p.pitcherRole : p.position}</td><td>${p.age}</td><td>${pr.now}</td><td class="ceil">${pr.lo}–${pr.hi}</td><td class="small muted">${ratings(p)}</td>
<td class="acts">${yours ? btn('PICK', 'draft-pick', { kind: 'primary', data: { id: p.id } }) : ''}</td></tr>`).join('');
  const filters = (['all', 'bats', 'arms'] as const).map((f) => `<button type="button" class="tab${filter === f ? ' on' : ''}" data-act="draft-filter" data-f="${f}" aria-pressed="${filter === f}">${f.toUpperCase()}</button>`).join('');
  const boardWin = win({ id: 'w-board', title: 'The Board', label: founding ? 'BEST AVAILABLE NOW' : 'BEST CEILINGS AVAILABLE', cls: 'w-board',
    body: `<div class="tabs">${filters}</div><div class="hscroll"><table class="stat roster draft-board" aria-label="Draft board"><tr><th scope="col">NAME</th><th scope="col">POS</th><th scope="col">AGE</th><th scope="col">NOW</th><th scope="col">CEILING</th><th scope="col">RATINGS</th><th scope="col"></th></tr>${rows}</table></div>
<p class="note small muted">NOW is how good he is today; CEILING is everyone's read of what he could become, a range that narrows as he gets older. Scouts (later) will sharpen it.</p>` });

  const clock = done(d) ? '<p class="note">The draft is complete.</p>'
    : `<p class="clock${yours ? ' yours' : ''}">${yours ? 'YOU ARE ON THE CLOCK' : `${esc(teamName(onClock(d)))} on the clock`}</p><p class="note small">Round ${round} of ${d.rounds} · pick ${i + 1} of ${totalPicks(d)}</p>`;
  const lottery = !founding && d.lottery.length ? `<h3 class="pc-h">THE LOTTERY</h3><ol class="lead-list past-list">${[...d.lottery].sort((a, b) => a[1] - b[1]).map(([id, at], k) => `<li class="${id === userTeam ? 'mine' : ''}"><span class="rank">${at}</span><span class="nm">${esc(teamName(id))}</span><span class="val">${k < 6 ? 'won a top-6 pick' : ''}</span></li>`).join('')}</ol>` : '';
  const recent = [...d.picks].slice(-10).reverse().map((x) => `<li class="${x.teamId === userTeam ? 'mine' : ''}"><span class="rank">${x.overall}</span><span class="nm">${esc(teamName(x.teamId))}: ${link(x.name, 'player', { id: x.playerId })} <span class="muted">${x.pos}, ${x.age}</span><span class="d-why">${esc(x.reason)}</span></span></li>`).join('');
  const mine = d.picks.filter((x) => x.teamId === userTeam);
  let needs = '';
  if (founding) {
    const t = L.teams.find((x) => x.id === userTeam)!;
    const ps = t.playerIds.map((id) => L.players.find((p) => p.id === id)!);
    const bats = ps.filter((p) => p.position !== 'P'), arms = ps.filter((p) => p.position === 'P');
    const pos = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((k) => `${k} ${bats.filter((b) => b.position === k).length}/${k === 'C' ? 3 : 2}`).join(' · ');
    const avg = ps.length ? Math.round(ps.reduce((a, p) => a + playerValue(p), 0) / ps.length) : 0;
    needs = `<h3 class="pc-h">YOUR 40 SO FAR</h3><p class="note small">${bats.length}/22 position players · ${arms.length}/18 pitchers (${arms.filter((p) => p.pitcherRole === 'SP').length}/6 starters)</p><p class="note small muted">${pos}</p>${ps.length ? `<p class="note small">Average now: ${avg}</p>` : ''}`;
  }
  const side = win({ id: 'w-clock', title: founding ? 'Founding Draft' : `Year ${d.year} Draft`, label: founding ? 'BUILD YOUR 40' : 'TEN ROUNDS · RIGHTS FOR FOUR YEARS', cls: 'w-clock',
    body: `${clock}<div class="row-actions">${done(d) ? btn('CONTINUE', 'draft-finish', { kind: 'primary', icon: 'ball' }) : btn(founding ? 'AUTO THE REST' : 'AUTO THE REST OF MY PICKS', 'draft-auto', { title: 'The AI picks for you from here, then the draft finishes' })}</div>
${needs}${lottery}<h3 class="pc-h">LATEST PICKS</h3><ol class="lead-list draft-recent">${recent || '<li><span class="nm muted">No picks yet</span></li>'}</ol>
${mine.length ? `<h3 class="pc-h">YOUR PICKS</h3><ol class="lead-list draft-recent">${mine.map((x) => `<li class="mine"><span class="rank">${x.overall}</span><span class="nm">${link(x.name, 'player', { id: x.playerId })} <span class="muted">${x.pos}, ${x.age} · ceiling ${x.lo}–${x.hi}</span></span></li>`).join('')}</ol>` : ''}` });
  return `<div class="frame screen-page screen-draft">${banner(founding ? 'THE FOUNDING DRAFT' : `THE YEAR ${d.year} DRAFT`, founding ? `${esc(teamName(userTeam)).toUpperCase()} · 40 ROUNDS · SNAKE ORDER` : `${esc(teamName(userTeam)).toUpperCase()} · 10 ROUNDS · LOTTERY FOR PICKS 1–6`)}
<main class="main page" id="main" data-scroll="draft"><div class="draft-layout">${boardWin}${side}</div></main></div>`;
}
