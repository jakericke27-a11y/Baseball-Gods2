/**
 * The scouting hub (step 2.4): the amateur classes growing up, a preview of the next draft, your draft board, and
 * the prospects whose rights you hold. Everyone sees the same blurry projections until scouts arrive (4.5).
 */
import { DRAFT, cycleOrder, lotteryOdds, nextDraftYear, projection } from '../../engine/draft';
import type { App } from '../app';
import type { Game } from '../state';
import { teamName } from '../teams';
import { boardWin, wishWin } from './board';
import { esc, link, tname, win } from './common';
import { page } from './screens';

const ODDS = lotteryOdds();

/** The draft after season `draftYear` takes amateurs who'll be 18–22 then (everyone ages a year each winter). */
export function ageAtDraft(g: Game, age: number, draftYear: number): number {
  return age + (draftYear - g.year) + (g.winter ? 0 : 1);
}

function previewWin(g: Game, D: number, folded: Set<string>): string {
  const extra = g.year <= D && !g.over ? [...g.season.standings.values()].map((r) => ({ teamId: r.teamId, W: r.W, L: r.L, diff: r.RS - r.RA })) : [];
  const order = cycleOrder(g.league, D, extra);
  const me = order.findIndex((r) => r.teamId === g.userTeam);
  const eligible = g.league.amateurs.filter((p) => { const a = ageAtDraft(g, p.age, D); return a >= DRAFT.minAge && a <= DRAFT.maxAge; }).length;
  const winters = D - g.year;
  const when = winters <= 0 ? 'this winter' : winters === 1 ? 'after next season' : `in ${winters + 1} winters`;
  const rows = order.slice(0, DRAFT.lotteryTeams).map((r, i) => `<li class="${r.teamId === g.userTeam ? 'mine' : ''}"><span class="rank">${i + 1}</span><span class="nm">${tname(r.teamId)} <span class="muted small">${r.W}-${r.L}</span></span><span class="val small">${Math.round(100 * ODDS[i])}%</span></li>`).join('');
  const mine = me >= DRAFT.lotteryTeams
    ? `<p class="note small">${esc(teamName(g.userTeam))}: projected pick ${me + 1} (${order[me].W}-${order[me].L} over the cycle). Out of the lottery.</p>`
    : `<p class="note small">${esc(teamName(g.userTeam))}: in the lottery, ${Math.round(100 * ODDS[me])}% to land a top-6 pick.</p>`;
  return win({ id: 'w-preview', title: `Year ${D} Draft`, label: `${when.toUpperCase()} · ${eligible} ELIGIBLE`, fold: true, folded: folded.has('w-preview'),
    body: `${mine}<h3 class="pc-h">PROJECTED ORDER · THE LOTTERY TEN</h3><ol class="lead-list past-list">${rows}</ol>
<p class="note muted small">Order by the cycle's combined record so far, worst first; the ten worst draw for picks 1–6 (top-6 chances shown). Ten rounds, the same order every round.</p>` });
}

function prospectsWin(g: Game, folded: Set<string>): string {
  const mine = g.league.prospects.filter((x) => x.teamId === g.userTeam);
  const body = mine.length ? `<ol class="lead-list">${mine.map((x) => { const pr = projection(x.player, g.league.seed); return `<li><span class="rank">${x.overall}</span><span class="nm">${link(x.player.name, 'player', { id: x.player.id })} <span class="muted small">${x.player.position === 'P' ? x.player.pitcherRole : x.player.position}, ${x.player.age} · rights to Year ${x.until}</span></span><span class="val">${pr.now}<span class="muted small"> / ${pr.lo}–${pr.hi}</span></span></li>`; }).join('')}</ol>`
    : '<p class="note muted small">None. Picks from the four-year draft wait here until you add them to your 40 (Roster → 26 & Reserves).</p>';
  return win({ id: 'w-myprospects', title: 'Your Prospects', label: `${mine.length} · RIGHTS HELD`, body, cls: 'w-myprospects', fold: true, folded: folded.has('w-myprospects') });
}

export function scoutingView(app: App): string {
  const g = app.game!;
  const D = nextDraftYear(g.year);
  const cls = app.hubClass;
  const players = g.league.amateurs.filter((p) => { if (cls === 'all') return true; const a = ageAtDraft(g, p.age, D); return a >= DRAFT.minAge && a <= DRAFT.maxAge; });
  const tabs = `<div class="tabs board-class" role="group" aria-label="Class">${([['next', `YEAR ${D} CLASS`], ['all', 'ALL 16–22']] as const).map(([k, t]) => `<button type="button" class="tab${cls === k ? ' on' : ''}" data-act="hub-class" data-c="${k}" data-key="hub-class:${k}" aria-pressed="${cls === k}">${t}</button>`).join('')}</div>`;
  const taken = new Map<number, number>(g.league.prospects.map((x) => [x.player.id, x.teamId]));
  for (const t of g.league.teams) for (const id of t.playerIds) taken.set(id, t.id);
  const board = boardWin({ app, league: g.league, players, mode: 'hub', year: g.year, title: 'Amateurs', label: cls === 'next' ? `ELIGIBLE FOR THE YEAR ${D} DRAFT` : 'EVERY CLASS', lead: tabs });
  const f = app.folded;
  return page(app, 'scouting', `<div class="scout-layout fill"><div class="scout-main">${board}</div><div class="scout-side">${previewWin(g, D, f)}${wishWin(app, g.league, taken, { fold: true, folded: f.has('w-wish') })}${prospectsWin(g, f)}</div></div>`, true);
}
