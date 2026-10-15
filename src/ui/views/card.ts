/**
 * The Baseball Card (step 2.7): a pixel trading card for any player. Front: portrait, the name centered in the lower
 * third, this year's line (slash line for hitters; W-L, ERA and strikeouts for pitchers), league ranks and ratings.
 * FLIP shows the back: this season's splits, filterable by group and sortable by any column.
 * The card itself is an art slot (card_front / card_back, 100x140 at 1x, shown at 2x): a solid canvas in the team's
 * colors until art arrives. The portrait is drawn from the player's id until portraits exist.
 */
import type { App } from '../app';
import { artSlot, artUrl } from '../art';
import { board, catOf } from '../leaders';
import { splitAvg, splitObp, splitSlg, splitsFor, type SplitLine } from '../splits';
import type { Game } from '../state';
import { avg, era, era2, obp, rate3, slg } from '../stats';
import { teamName, teamPair } from '../teams';
import { esc, link, r5 } from './common';

artSlot({ id: 'card_front', w: 100, h: 140, label: 'Baseball card front', group: 'cards', kind: 'card' });
artSlot({ id: 'card_back', w: 100, h: 140, label: 'Baseball card back', group: 'cards', kind: 'card' });

export interface SplitView { group: 'all' | SplitLine['group']; sort: string; desc: boolean }
export const newSplitView = (): SplitView => ({ group: 'all', sort: '', desc: true });

// ---- the portrait: a 16x16 bust, colors from the player's id, cap in his team's colors
const SKIN = ['#F2C9A0', '#E0AC7E', '#C68A5A', '#9C6640', '#6E4528', '#4A2E1A'];
const HAIR = ['#2A1D14', '#4A3020', '#7A5230', '#B07A3E', '#D9B26A', '#1A1A1A', '#8C8C8C'];
const BUST = [
  '................',
  '.....cccccc.....',
  '....cccccccc....',
  '....cccccccc....',
  '...bbbbbbbbbb...',
  '....hsssssh.....',
  '....ssesses.....',
  '....ssssssss....',
  '.....ssmsss.....',
  '.....ssssss.....',
  '......ssss......',
  '...jjjjjjjjjj...',
  '..jjjjjnjjjjjj..',
  '..jjjjjnjjjjjj..',
  '..jjjjjjjjjjjj..',
  '..jjjjjjjjjjjj..',
];
function portrait(id: number, teamId: number): string {
  const h = Math.imul(id ^ 0x9e3779b9, 2654435761) >>> 0;
  const [t1, t2] = teamId ? teamPair(teamId) : ['#8E98B0', '#5B6B7A'];
  const col: Record<string, string> = { c: t1, b: t2, s: SKIN[h % SKIN.length], h: HAIR[(h >>> 8) % HAIR.length], e: '#11131C', m: '#7A3B32', j: t1, n: t2 };
  const rects: string[] = [];
  BUST.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${col[row[x]]}"/>`); });
  return `<svg class="bc-face" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`;
}

/** League rank among qualified players this season ("3rd"), or '' outside the top 50. */
function rank(g: Game, key: string, id: number): string {
  const rows = board(g, catOf(key), 'season', 'all', 50);
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return '';
  const n = i + 1;
  return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function front(g: Game, id: number): string {
  const p = g.players.get(id)!;
  const isP = p.position === 'P', R = p.ratings;
  const stat = (k: string, v: string, key?: string) => { const r = key ? rank(g, key, id) : ''; return `<span class="bc-stat"><b>${v}</b><i>${k}${r ? ` · ${r}` : ''}</i></span>`; };
  let line: string;
  if (isP) {
    const q = g.season.pitching.get(id);
    line = q && q.outs ? `${stat('W-L', `${q.W}-${q.L}`, 'W')}${stat('ERA', era2(era(q)), 'ERA')}${stat('SO', String(q.K), 'SO')}`
      : '<span class="bc-none">No innings yet</span>';
  } else {
    const b = g.season.batting.get(id);
    line = b && b.PA ? `<span class="bc-slash">${rate3(avg(b))}/${rate3(obp(b))}/${rate3(slg(b))}/${rate3(obp(b) + slg(b))}</span>`
      + `<span class="bc-ranks muted">${[['AVG', 'AVG'], ['HR', 'HR'], ['OPS', 'OPS']].map(([k, key]) => { const r = rank(g, key, id); return r ? `${k} ${r}` : ''; }).filter(Boolean).join(' · ') || `${b.HR} HR · ${b.RBI} RBI`}</span>`
      : '<span class="bc-none">No at-bats yet</span>';
  }
  const ratings: Array<[string, number]> = isP
    ? [['VEL', R.velocity], ['CTL', R.control], ['MOV', R.movement], ['STA', R.stamina]]
    : [['POW', R.power], ['CON', R.contact], ['EYE', R.discipline], ['SPD', R.speed], ['GLV', R.glove], ['ARM', R.cannon]];
  const rt = ratings.map(([k, v]) => { const n = r5(v); return `<span class="bc-rt${n >= 70 ? ' hi' : n <= 30 ? ' lo' : ''}"><i>${k}</i><b>${n}</b></span>`; }).join('');
  return `<div class="bc-pos">${esc(isP ? p.pitcherRole ?? 'P' : p.position)}<span>${isP ? `${p.throws}HP` : `BATS ${p.bats}`}</span></div>
<div class="bc-pic">${portrait(id, g.teamOf.get(id) ?? 0)}</div>
<div class="bc-lower"><div class="bc-name">${link(p.name, 'player', { id })}</div><div class="bc-line${isP ? ' bc-pline' : ''}">${line}</div><div class="bc-rts">${rt}</div></div>`;
}

function back(app: App, g: Game, id: number, ctx: string): string {
  const p = g.players.get(id)!, isP = p.position === 'P', v = app.splitView;
  const all = splitsFor(g, id);
  const groups: Array<[SplitView['group'], string]> = [['all', 'ALL'], ['platoon', 'L/R'], ['venue', 'H/R'], ['situation', 'SIT'], ['outs', 'OUTS'], ['month', 'MONTH']];
  const cols: Array<[string, string, (l: SplitLine) => number, (n: number) => string]> = [
    ['PA', isP ? 'BF' : 'PA', (l) => l.PA, String], ['AVG', 'AVG', splitAvg, rate3], ['OBP', 'OBP', splitObp, rate3], ['SLG', 'SLG', splitSlg, rate3],
    ['HR', 'HR', (l) => l.HR, String], ['BB', 'BB', (l) => l.BB, String], ['K', isP ? 'SO' : 'K', (l) => l.K, String],
  ];
  let rows = all.filter((l) => v.group === 'all' || l.group === v.group || l.key === 'all');
  const c = cols.find((x) => x[0] === v.sort);
  if (c) rows = [...rows].sort((a, b) => (a.key === 'all' ? -1 : b.key === 'all' ? 1 : (v.desc ? -1 : 1) * (c[2](a) - c[2](b))));
  const head = `<tr><th scope="col" class="l">SPLIT</th>${cols.map(([k, h]) => `<th scope="col"><button type="button" class="sort${v.sort === k ? ' on' : ''}" data-act="split-sort" data-k="${k}" data-key="split-sort:${ctx}:${k}">${h}${v.sort === k ? (v.desc ? '▾' : '▴') : ''}</button></th>`).join('')}</tr>`;
  const body = rows.map((l) => `<tr${l.key === 'all' ? ' class="tot"' : ''}><th scope="row">${esc(l.label)}</th>${cols.map(([, , f, fmt]) => `<td>${l.PA ? fmt(f(l)) : '—'}</td>`).join('')}</tr>`).join('');
  const tabs = groups.map(([k, t]) => `<button type="button" class="bc-tab${v.group === k ? ' on' : ''}" data-act="split-group" data-g="${k}" data-key="split-group:${ctx}:${k}" aria-pressed="${v.group === k}">${t}</button>`).join('');
  return `<div class="bc-back-head">${esc(p.name)}<span>${isP ? 'HITTERS AGAINST HIM' : 'SPLITS'} · YEAR ${g.year}</span></div>
<div class="bc-tabs" role="group" aria-label="Split groups">${tabs}</div>
<div class="bc-table"><table class="bc-splits">${head}${body}</table></div>`;
}

/**
 * A Baseball Card. `ctx` names where it sits (so two cards on one screen flip on their own); `extra` adds classes;
 * `drag` makes it draggable, carrying the player id.
 */
export function baseballCard(app: App, id: number, ctx: string, o: { extra?: string; drag?: boolean; flip?: boolean } = {}): string {
  const g = app.game!, p = g.players.get(id);
  if (!p) return '';
  const flipped = app.cardBack.has(`${ctx}:${id}`);
  const teamId = g.teamOf.get(id) ?? 0;
  const [t1, t2] = teamId ? teamPair(teamId) : ['#8E98B0', '#5B6B7A'];
  const art = artUrl(flipped ? 'card_back' : 'card_front');
  const style = `--t1:${t1};--t2:${t2}${art ? `;--art:url('${art}')` : ''}`;
  const flip = o.flip === false ? '' : `<button type="button" class="bc-flip" data-act="card-flip" data-id="${id}" data-ctx="${ctx}" data-key="card-flip:${ctx}:${id}" title="${flipped ? 'Front' : 'Flip for splits'}">${flipped ? 'FRONT' : 'FLIP'}</button>`;
  return `<article class="bcard${flipped ? ' back' : ''}${art ? ' has-art' : ''}${o.extra ? ` ${o.extra}` : ''}" style="${style}" data-pid="${id}"${o.drag ? ' draggable="true"' : ''} aria-label="${esc(p.name)}, ${esc(teamName(teamId))}">
${flipped ? back(app, g, id, ctx) : front(g, id)}${flip}</article>`;
}

/** Two cards side by side with what changes. */
export function compareCards(app: App, a: number, b: number, ctx: string, labels: [string, string] = ['OUT', 'IN']): string {
  return `<div class="bc-compare"><div class="bc-side"><div class="bc-tag out">${labels[0]}</div>${baseballCard(app, a, `${ctx}-a`)}</div>
<div class="bc-side"><div class="bc-tag in">${labels[1]}</div>${baseballCard(app, b, `${ctx}-b`)}</div></div>`;
}

