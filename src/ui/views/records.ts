/**
 * Records (step 2.9): three books on a desk. Pick one and it opens across the screen: two pages at a time, one stat
 * or view per page, tabs down the edge to jump between sections, and pages that turn. Book 1 is a team's (yours
 * by default; any team from its picker), Book 2 the league's. Book 3 is still blank.
 */
import { artSlot, artUrl } from '../art';
import { buildBook, type Book, type BookId, type BookPage } from '../books';
import type { App } from '../app';
import { teamName, teamPair } from '../teams';
import { esc } from './common';
import { page } from './screens';

artSlot({ id: 'book_team', w: 96, h: 128, label: 'Team record book cover', group: 'records', kind: 'book' });
artSlot({ id: 'book_league', w: 96, h: 128, label: 'League record book cover', group: 'records', kind: 'book' });
artSlot({ id: 'book_three', w: 96, h: 128, label: 'Book three cover (not written yet)', group: 'records', kind: 'book' });
artSlot({ id: 'book_spread', w: 320, h: 200, label: 'Open book, two blank pages', group: 'records', kind: 'background' });
artSlot({ id: 'desk_top', w: 320, h: 180, label: 'Desk top (wood)', group: 'records', kind: 'background' });

export interface BookState {
  open: BookId | null;
  /** Team for Book 1 (0: yours). */
  team: number;
  /** The left-hand page showing. */
  at: Record<BookId, number>;
  /** The spread being turned away from, for one render (the page-turn). */
  from: number | null;
  /** Rows per page: 20 when the page has room for them at a readable height, otherwise 10 (App.fitBook measures). */
  per: 10 | 20;
}
export const newBookState = (): BookState => ({ open: null, team: 0, at: { team: 0, league: 0 }, from: null, per: 20 });
/** The smallest row that still reads well, in px. */
export const BOOK_ROW_MIN = 22;

export function currentBook(app: App): Book | null {
  const g = app.game, s = app.book;
  if (!g || !s.open) return null;
  return buildBook(g, s.open, s.team || g.userTeam, s.per);
}

function pageHtml(b: Book, p: BookPage | undefined, i: number, per: number, extra = ''): string {
  if (!p) return '<div class="bk-page bk-none"></div>';
  const side = i % 2 ? 'right' : 'left';
  const num = `<span class="bk-num">${i + 1}</span>`;
  if (p.blank) return `<div class="bk-page bk-${side} bk-blank" aria-hidden="true"><span class="bk-orn">✦</span>${num}</div>`;
  const head = `<header class="bk-head"><h3 class="bk-h">${esc(p.title)}</h3>${p.sub ? `<span class="bk-sub">${esc(p.sub)}</span>` : ''}</header>`;
  let body = '';
  if (p.html !== undefined) body = p.html.replace('<!--picker-->', extra);
  else if (p.rows && p.rows.length) {
    const cols = (p.cols ?? []).map(([, w]) => w).join(' ');
    const labels = p.cols?.some(([l]) => l) ? `<div class="bk-row bk-th" role="row">${p.cols!.map(([l]) => `<span role="columnheader">${esc(l)}</span>`).join('')}</div>` : '';
    const textLast = /fr\)?$/.test(p.cols?.at(-1)?.[1] ?? '') && (p.cols?.length ?? 0) > 1 && !/^(VALUE|[A-Z0-9%/]{1,5})$/.test(p.cols!.at(-1)![0]);
    body = `<div class="bk-table${textLast ? ' text-last' : ''}${p.cls ? ` ${p.cls}` : ''}" role="table" aria-label="${esc(p.title)}" style="--cols:${cols};--per:${p.per ?? per}">${labels}${p.rows.map((r) => `<div class="bk-row${r.mine ? ' mine' : ''}" role="row">${r.cells.map((c, k) => `<span role="${k ? 'cell' : 'rowheader'}">${c}</span>`).join('')}</div>`).join('')}</div>`;
  } else body = `<p class="bk-empty">${esc(p.empty ?? 'Nothing here yet.')}</p>`;
  return `<div class="bk-page bk-${side}">${head}<div class="bk-body">${body}</div>${p.note ? `<p class="bk-note">${esc(p.note)}</p>` : ''}${num}<span class="bk-tabname" aria-hidden="true">${esc(p.tab === 'CONTENTS' ? b.title.toUpperCase() : p.tab)}</span></div>`;
}

function openBook(app: App, b: Book): string {
  const g = app.game!, s = app.book, per = s.per;
  const at = Math.max(0, Math.min(b.pages.length - 2, s.at[b.id] - (s.at[b.id] % 2)));
  s.at[b.id] = at;
  const from = s.from;
  s.from = null;
  const teams = [...g.league.teams].sort((a, c) => teamName(a.id).localeCompare(teamName(c.id)));
  const picker = b.id === 'team'
    ? `<label class="bk-pick"><span>WHOSE BOOK</span><select data-act="book-team" data-key="book-team">${teams.map((t) => `<option value="${t.id}"${t.id === (s.team || g.userTeam) ? ' selected' : ''}>${esc(teamName(t.id))}${t.id === g.userTeam ? ' (yours)' : ''}</option>`).join('')}</select></label>` : '';
  const cur = (k: number) => pageHtml(b, b.pages[k], k, per, k === 0 ? picker : '');
  // the turning leaf: forward, the old right page turns over onto the new left; back, the old left turns onto the new right
  let leaf = '';
  if (from !== null && from !== at && b.pages[from]) {
    const fwd = at > from;
    leaf = fwd
      ? `<div class="bk-under bk-under-l" aria-hidden="true" inert>${cur(from)}</div><div class="bk-leaf fwd" aria-hidden="true" inert><div class="bk-face front">${cur(from + 1)}</div><div class="bk-face back">${cur(at)}</div></div>`
      : `<div class="bk-under bk-under-r" aria-hidden="true" inert>${cur(from + 1)}</div><div class="bk-leaf back" aria-hidden="true" inert><div class="bk-face front">${cur(from)}</div><div class="bk-face back">${cur(at + 1)}</div></div>`;
  }
  const tabAt = (k: number) => b.tabs.filter((t) => t.page <= k).at(-1)?.tab;
  const here = new Set([tabAt(at), tabAt(at + 1)]);
  // ribbons for sections already passed sit over the left page; the ones still ahead over the right, as in a real book
  const ribbon = (t: Book['tabs'][number], i: number) => `<button type="button" class="bk-ribbon r${i % 6}${here.has(t.tab) ? ' on' : ''}" data-act="book-tab" data-page="${t.page}" data-key="book-ribbon:${t.page}"${here.has(t.tab) ? ' aria-current="true"' : ''}>${t.tab === 'CONTENTS' ? '≡' : esc(t.tab)}</button>`;
  const tabs = b.tabs.map((t, i) => ({ t, i }));
  const ribbons = `<div class="bk-rib bk-rib-l">${tabs.filter((x) => x.t.page <= at + 1).map((x) => ribbon(x.t, x.i)).join('')}</div><div class="bk-rib bk-rib-r">${tabs.filter((x) => x.t.page > at + 1).map((x) => ribbon(x.t, x.i)).join('')}</div>`;
  const last = b.pages.length - 2;
  const bar = `<div class="bk-bar"><button type="button" class="btn btn-ghost bk-desk" data-act="book-close" data-key="book-close" title="Close the book (Esc)"><span>◂ DESK</span></button>
<nav class="bk-ribbons" aria-label="${esc(b.title)} sections">${ribbons}</nav>
<button type="button" class="btn btn-secondary bk-arrow" data-act="book-flip" data-dir="-1" data-key="book-flip:-1"${at <= 0 ? ' disabled' : ''} aria-label="Previous pages" title="Previous pages (←)"><span>◂</span></button><button type="button" class="btn btn-secondary bk-arrow" data-act="book-flip" data-dir="1" data-key="book-flip:1"${at >= last ? ' disabled' : ''} aria-label="Next pages" title="Next pages (→)"><span>▸</span></button></div>`;
  const art = artUrl('book_spread');
  const corner = (dir: number, dis: boolean) => (dis ? '' : `<button type="button" class="bk-corner ${dir > 0 ? 'next' : 'prev'}" data-act="book-flip" data-dir="${dir}" data-key="book-corner:${dir}" aria-label="${dir > 0 ? 'Turn the page' : 'Turn back'}" title="${dir > 0 ? 'Turn the page' : 'Turn back'}"></button>`);
  const [c1] = b.id === 'team' ? teamPair(s.team || g.userTeam) : ['#4A2418'];
  return `<div class="records fill">${bar}<div class="book${art ? ' has-art' : ''}" style="--cover:${c1}${art ? `;--spread:url(${art})` : ''}" aria-label="${esc(b.title)}, pages ${at + 1} and ${at + 2} of ${b.pages.length}">
<div class="bk-spread">${cur(at)}${cur(at + 1)}${leaf}${corner(-1, at <= 0)}${corner(1, at >= last)}</div></div></div>`;
}

function desk(app: App): string {
  const g = app.game!;
  const [t1, t2] = teamPair(g.userTeam);
  const cover = (id: string, cls: string, k: string, title: string, sub: string, style: string, act: string) => {
    const art = artUrl(id);
    const inner = `<span class="bc-spine" aria-hidden="true"></span><span class="bc-plate"><span class="bc-k">${esc(k)}</span><span class="bc-t">${esc(title)}</span><span class="bc-s">${esc(sub)}</span></span>`;
    return act
      ? `<button type="button" class="bcover ${cls}${art ? ' has-art' : ''}" style="${style}${art ? `;--art:url(${art})` : ''}" data-act="book-open" data-book="${act}" data-key="book-open:${act}">${inner}</button>`
      : `<div class="bcover ${cls}${art ? ' has-art' : ''}" style="${style}" title="Not written yet" aria-label="Book three: not written yet">${inner}<span class="bc-clasp" aria-hidden="true"></span></div>`;
  };
  return `<div class="records fill"><div class="desk-top"><div class="desk-books">
${cover('book_team', 'bc-team', 'BOOK ONE', teamName(g.userTeam), 'TEAM RECORDS', `--c1:${t1};--c2:${t2}`, 'team')}
${cover('book_league', 'bc-league', 'BOOK TWO', 'The League', 'LEAGUE RECORDS', '--c1:#4A2418;--c2:#C9A24A', 'league')}
${cover('book_three', 'bc-three', 'BOOK THREE', '', 'NOT WRITTEN YET', '--c1:#2B2A33;--c2:#77706A', '')}
</div><p class="desk-hint">Pick a book. Inside, ◂ ▸ or the arrow keys turn the pages, the ribbons jump to a section, Esc closes it.</p></div></div>`;
}

export function recordsView(app: App): string {
  const b = currentBook(app);
  return page(app, 'records', b ? openBook(app, b) : desk(app), true);
}
