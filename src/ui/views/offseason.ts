/** The offseason report: who retired, who signed, who rose and fell over the winter, and the way into the new year. */
import type { OffseasonMove } from '../../engine/offseason';
import type { App } from '../app';
import { teamName } from '../teams';
import { decreeFor } from '../../engine/decree';
import { decreeScroll, lingering } from '../decree';
import { banner, btn, esc, footer, link, win, tname } from './common';

const row = (m: OffseasonMove, extra = '') =>
  `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · ${tname(m.teamId)}</span></span><span class="val">${extra || m.value}</span></li>`;
const deadRow = (m: OffseasonMove) =>
  `<li><span class="nm">${esc(m.name)} <span class="muted">${m.age} · ${m.teamId ? esc(teamName(m.teamId)) : 'free agent'}</span></span><span class="val">${m.value}</span></li>`;
const list = (items: string[], empty: string) => (items.length ? `<ol class="lead-list off-list">${items.join('')}</ol>` : `<p class="note muted">${empty}</p>`);

export function offseasonView(app: App): string {
  const g = app.game!, r = g.offseason;
  const next = g.year;
  if (!r) return '';
  const mine = (m: OffseasonMove) => m.teamId === g.userTeam;
  const yours = [
    ...(r.kept ?? []).filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · prospect, rights about to run out</span></span><span class="val">KEPT</span></li>`),
    ...r.promotions.filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · prospect</span></span><span class="val">PROMOTED</span></li>`),
    ...r.retirements.filter(mine).map((m) => `<li><span class="nm">${esc(m.name)} <span class="muted">${m.age}</span></span><span class="val">RETIRED</span></li>`),
    ...r.releases.filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age}</span></span><span class="val">RELEASED</span></li>`),
    ...r.signings.filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · ${m.from === 'amateur' ? 'undrafted amateur' : 'free agent'}</span></span><span class="val">SIGNED</span></li>`),
  ];
  const top = <T extends OffseasonMove>(xs: T[], n = 10) => [...xs].sort((a, b) => b.value - a.value || a.id - b.id).slice(0, n);
  const scope = app.offScope;
  const tabs = `<div class="tabs" role="group" aria-label="Show">${(['team', 'league'] as const).map((k) => `<button type="button" class="tab${scope === k ? ' on' : ''}" data-act="off-scope" data-scope="${k}" data-key="off-scope:${k}" aria-pressed="${scope === k}">${k === 'team' ? esc(teamName(g.userTeam).toUpperCase()) : 'THE LEAGUE'}</button>`).join('')}</div>`;
  const myPicks = r.draft?.filter((x) => x.teamId === g.userTeam) ?? [];
  const myRise = [...r.risers, ...r.fallers].filter(mine);
  const teamView = `<div class="cards off-cards">
${win({ id: 'w-off-you', title: 'Your Winter', label: teamName(g.userTeam).toUpperCase(), body: list(yours, 'Nobody came or went. Same roster, a year older.') })}
${myPicks.length ? win({ id: 'w-off-mypicks', title: `Year ${r.year} Draft`, label: 'YOUR PICKS', body: list(myPicks.map((x) => `<li class="mine"><span class="nm">${x.overall}. ${link(x.name, 'player', { id: x.playerId })} <span class="muted">${x.pos}, ${x.age} · ceiling ${x.lo}–${x.hi}</span></span><span class="val">R${x.round}</span></li>`), '—') }) : ''}
${myRise.length ? win({ id: 'w-off-myrise', title: 'Big Changes', label: 'AMONG THE LEAGUE\'S TOP 10', body: list(myRise.map((m) => row(m, m.change > 0 ? `+${m.change}` : String(m.change))), '—') }) : ''}
</div>`;
  const leagueView = `<div class="cards off-cards">
${win({ id: 'w-off-ret', title: 'Retirements', label: `${r.retirements.length} PLAYERS`, body: list(top(r.retirements).map(deadRow), 'Nobody retired.') })}
${win({ id: 'w-off-sign', title: 'Signings', label: `${r.signings.length} PLAYERS`, body: list(top(r.signings).map((m) => row(m, `${m.value}`)), 'No signings.') })}
${win({ id: 'w-off-up', title: 'Risers', label: 'BIGGEST GAINS', body: list(r.risers.map((m) => row(m, `+${m.change}`)), '—') })}
${win({ id: 'w-off-down', title: 'Fallers', label: 'BIGGEST DROPS', body: list(r.fallers.map((m) => row(m, String(m.change))), '—') })}
${r.draft?.length ? win({ id: 'w-off-draft', title: `Year ${r.year} Draft`, label: 'THE TOP 10', body: list(r.draft.slice(0, 10).map((x) => `<li class="${x.teamId === g.userTeam ? 'mine' : ''}"><span class="nm">${x.overall}. ${link(x.name, 'player', { id: x.playerId })} <span class="muted">${tname(x.teamId)} · ${esc(x.reason)}</span></span><span class="val">${x.lo}–${x.hi}</span></li>`), '—') }) : ''}
${r.promotions?.length ? win({ id: 'w-off-prom', title: 'Promoted', label: `${r.promotions.length} PROSPECTS JOIN A 40`, body: list(top(r.promotions).map((m) => row(m)), '—') }) : ''}
${win({ id: 'w-off-class', title: 'New Class', label: 'AMATEURS', body: `<p class="note">${r.newClass} sixteen-year-olds joined the amateur pool. Every fourth winter the draft takes those aged 18–22; anyone undrafted at 23 can be signed by anyone.</p><div class="row-actions">${btn('SCOUTING HUB', 'go', { icon: 'scope', data: { to: 'scouting' } })}</div>` })}
</div>`;
  const d = r.decree ?? decreeFor(g.league, next);
  const scroll = d ? decreeScroll(d, next, lingering(g.league, next)) : '';
  const body = `${scroll}${tabs}${scope === 'team' ? teamView : leagueView}<p class="note muted small">Values are a one-number read of how good each player is now (20–80).</p>`;
  return `<div class="frame screen-page">${banner(`YEAR ${next}`, `THE OFFSEASON · AFTER YEAR ${r.year}`)}<main class="main page" id="main" data-scroll="page-offseason">${body}</main>
${footer('offseason', btn(`START YEAR ${next}`, 'go', { kind: 'primary', icon: 'ball', data: { to: 'home' } }))}</div>`;
}
