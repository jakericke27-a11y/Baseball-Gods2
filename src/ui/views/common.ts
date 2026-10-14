/** Shared markup: windows, buttons, streak rows, the banner and the footer. Views return HTML strings. */
import { icon, type IconName } from '../sprites';

export const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Data = Record<string, string | number>;
const dataAttrs = (d?: Data) => (d ? Object.entries(d).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') : '');

export interface WinOpts {
  id: string; title: string; label?: string; body: string;
  /** Screen this window expands into (shows the expand control). */
  open?: string; openData?: Data;
  cls?: string; scroll?: boolean; style?: string;
}

/** A framed window: silver frame, inner rule in your team color, studs on the corners. */
export function win(o: WinOpts): string {
  const openBtn = o.open
    ? `<button type="button" class="win-open" data-act="go" data-to="${o.open}"${dataAttrs(o.openData)} data-key="open:${o.id}" title="Open ${esc(o.title)}" aria-label="Open ${esc(o.title)}">${icon('expand', 3)}</button>`
    : '';
  return `<section class="win ${o.cls ?? ''}" aria-labelledby="${o.id}-t"${o.style ? ` style="${o.style}"` : ''}>
<span class="studs" aria-hidden="true"></span>
<header class="win-head"><h2 class="win-title" id="${o.id}-t">${esc(o.title)}</h2>${o.label ? `<span class="win-label">${o.label}</span>` : ''}${openBtn}</header>
<div class="win-body${o.scroll ? ' scroll' : ''}"${o.scroll ? ` data-scroll="${o.id}"` : ''}>${o.body}</div>
</section>`;
}

export interface BtnOpts { icon?: IconName; kind?: 'primary' | 'secondary' | 'ghost'; data?: Data; disabled?: boolean; title?: string; key?: string; cls?: string }

export function btn(label: string, act: string, o: BtnOpts = {}): string {
  return `<button type="button" class="btn btn-${o.kind ?? 'secondary'} ${o.cls ?? ''}" data-act="${act}"${dataAttrs(o.data)} data-key="${esc(o.key ?? act + (o.data ? ':' + Object.values(o.data).join(':') : ''))}"${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${o.icon ? icon(o.icon) : ''}<span>${label}</span></button>`;
}

/** Icon-only button; the label shows on hover and focus, and is read by screen readers. */
export function iconBtn(name: IconName, label: string, act: string, o: { on?: boolean; data?: Data } = {}): string {
  return `<button type="button" class="icon-btn${o.on ? ' on' : ''}" data-act="${act}"${dataAttrs(o.data)} data-key="${act}:${esc(label)}" data-tip="${esc(label)}" aria-label="${esc(label)}"${o.on ? ' aria-current="page"' : ''}>${icon(name)}</button>`;
}

/** A clickable name that opens something (a player card, a team's roster). */
export const link = (text: string, act: string, data: Data, cls = '') =>
  `<button type="button" class="link ${cls}" data-act="${act}"${dataAttrs(data)} data-key="${act}:${Object.values(data).join(':')}">${esc(text)}</button>`;

/** A table row that can carry flames (hot) or icicles (cold), and an outline for your team. */
export function trow(cells: string[], heat = 0, mine = false): string {
  const cls = ['trow', heat > 0 ? `hot hot-${heat}` : '', heat < 0 ? `cold cold-${-heat}` : '', mine ? 'mine' : ''].filter(Boolean).join(' ');
  // team rows carry their team and heat, so the app can play the flip when a streak ends (App.streakFlips)
  const team = /data-act="team" data-id="(\d+)"/.exec(cells[0])?.[1];
  return `<div class="${cls}" role="row"${team ? ` data-team="${team}" data-heat="${heat}"` : ''}>${cells.map((c, i) => `<div role="${i === 0 ? 'rowheader' : 'cell'}">${c}</div>`).join('')}</div>`;
}
export const thead = (cells: string[]) => `<div class="thead" role="row">${cells.map((c) => `<div role="columnheader">${c}</div>`).join('')}</div>`;
export const ttable = (cols: string, label: string, inner: string) => `<div class="ttable" role="table" aria-label="${esc(label)}" style="--cols: ${cols}">${inner}</div>`;

/** The parchment scroll across the top. */
export function banner(top: string, sub: string, compact = false): string {
  return `<header class="banner${compact ? ' compact' : ''}"><div class="roll" aria-hidden="true"></div>
<div class="banner-mid"><div class="logo">Baseball Gods</div><div class="banner-info"><div class="banner-top">${top}</div><div class="banner-sub">${sub}</div></div></div>
<div class="roll" aria-hidden="true"></div></header>`;
}

const NAV: Array<[IconName, string, string]> = [
  ['temple', 'Home', 'home'], ['pennant', 'Standings', 'standings'], ['ball', 'Games', 'games'], ['crown', 'Leaders', 'leaders'], ['flag', 'Races', 'races'],
  ['jersey', 'Roster', 'roster'], ['scroll', 'Game log', 'gamelog'],
];

export function footer(current: string, actions: string): string {
  const nav = NAV.map(([ic, label, to]) => iconBtn(ic, label, 'go', { on: current === to, data: { to } })).join('')
    + iconBtn('cog', 'Settings', 'settings');
  return `<footer class="footer"><nav class="nav" aria-label="Screens">${nav}</nav><div class="actions">${actions}</div></footer>`;
}

/** Ratings show to the nearest 5; the exact values stay hidden. */
export const r5 = (x: number) => Math.round(x / 5) * 5;
