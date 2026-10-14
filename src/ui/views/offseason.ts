/** The offseason report: who retired, who signed, who rose and fell over the winter, and the way into the new year. */
import type { OffseasonMove } from '../../engine/offseason';
import type { App } from '../app';
import { teamName } from '../teams';
import { banner, btn, esc, footer, link, win } from './common';

const row = (m: OffseasonMove, extra = '') =>
  `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · ${esc(teamName(m.teamId))}</span></span><span class="val">${extra || m.value}</span></li>`;
const deadRow = (m: OffseasonMove) =>
  `<li><span class="nm">${esc(m.name)} <span class="muted">${m.age} · ${m.teamId ? esc(teamName(m.teamId)) : 'free agent'}</span></span><span class="val">${m.value}</span></li>`;
const list = (items: string[], empty: string) => (items.length ? `<ol class="lead-list off-list">${items.join('')}</ol>` : `<p class="note muted">${empty}</p>`);

export function offseasonView(app: App): string {
  const g = app.game!, r = g.offseason;
  const next = g.year;
  if (!r) return '';
  const mine = (m: OffseasonMove) => m.teamId === g.userTeam;
  const yours = [
    ...r.retirements.filter(mine).map((m) => `<li><span class="nm">${esc(m.name)} <span class="muted">${m.age}</span></span><span class="val">RETIRED</span></li>`),
    ...r.releases.filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age}</span></span><span class="val">RELEASED</span></li>`),
    ...r.signings.filter(mine).map((m) => `<li><span class="nm">${link(m.name, 'player', { id: m.id })} <span class="muted">${m.age} · ${m.from === 'amateur' ? 'undrafted amateur' : 'free agent'}</span></span><span class="val">SIGNED</span></li>`),
  ];
  const top = <T extends OffseasonMove>(xs: T[], n = 10) => [...xs].sort((a, b) => b.value - a.value || a.id - b.id).slice(0, n);
  const note = 'Ratings are a one-number read of how good each player is now (20–80). Values shown to the nearest point.';
  const body = `<div class="cards off-cards">
${win({ id: 'w-off-you', title: 'Your Winter', label: teamName(g.userTeam).toUpperCase(), body: list(yours, 'Nobody came or went. Same roster, a year older.') })}
${win({ id: 'w-off-ret', title: 'Retirements', label: `${r.retirements.length} PLAYERS`, body: list(top(r.retirements).map(deadRow), 'Nobody retired.') })}
${win({ id: 'w-off-sign', title: 'Signings', label: `${r.signings.length} PLAYERS`, body: list(top(r.signings).map((m) => row(m, `${m.value}`)), 'No signings.') })}
${win({ id: 'w-off-up', title: 'Risers', label: 'BIGGEST GAINS', body: list(r.risers.map((m) => row(m, `+${m.change}`)), '—') })}
${win({ id: 'w-off-down', title: 'Fallers', label: 'BIGGEST DROPS', body: list(r.fallers.map((m) => row(m, String(m.change))), '—') })}
${win({ id: 'w-off-class', title: 'New Class', label: 'AMATEURS', body: `<p class="note">${r.newClass} sixteen-year-olds joined the amateur pool. They grow up in view, and undrafted ones can be signed at 23.</p>` })}
</div><p class="note muted small">${note}</p>`;
  return `<div class="frame screen-page">${banner(`YEAR ${next}`, `THE OFFSEASON · AFTER YEAR ${r.year}`)}<main class="main page" id="main" data-scroll="page-offseason">${body}</main>
${footer('offseason', btn(`START YEAR ${next}`, 'go', { kind: 'primary', icon: 'ball', data: { to: 'home' } }))}</div>`;
}
