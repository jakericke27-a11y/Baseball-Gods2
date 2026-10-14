/**
 * The prospect board, shared by draft night and the scouting hub: sortable columns, filters, and your draft board
 * (the ★ wishlist). Everyone sees the same blurry projections until scouting arrives (4.5).
 */
import { playerValue } from '../../engine/development';
import { projection } from '../../engine/draft';
import { ratingsIn } from '../../engine/history';
import type { League, Player } from '../../engine/types';
import type { App } from '../app';
import { teamName } from '../teams';
import { btn, esc, link, r5, teamChip, win } from './common';

export interface BoardState {
  sort: string; desc: boolean;
  side: 'all' | 'bats' | 'arms';
  pos: string;
  ageMin: number; ageMax: number;
  minNow: number; minCeil: number;
  /** Only your board's players. */
  starred: boolean;
}
export const newBoardState = (): BoardState => ({ sort: 'ceil', desc: true, side: 'all', pos: 'all', ageMin: 0, ageMax: 99, minNow: 0, minCeil: 0, starred: false });

const HIT = [['POW', 'power'], ['CON', 'contact'], ['EYE', 'discipline'], ['SPD', 'speed'], ['GLV', 'glove']] as const;
const ARM = [['VEL', 'velocity'], ['CTL', 'control'], ['MOV', 'movement'], ['STA', 'stamina']] as const;
const POSITIONS = ['all', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'UT', 'SP', 'RP'];
const posOf = (p: Player) => (p.position === 'P' ? (p.pitcherRole === 'SP' ? 'SP' : 'RP') : p.position);

/** Change in a player's value over the last n years (from history's yearly snapshots), or null. */
function trend(L: League, p: Player, year: number, n: number): number | null {
  const then = ratingsIn(L, p.id, year - n);
  if (!then) return null;
  return Math.round(playerValue(p) - playerValue({ ...p, ratings: { ...p.ratings, ...then.ratings } as Player['ratings'] }));
}

export interface BoardOpts {
  app: App; league: League; players: Player[];
  /** 'draft': a PICK button when you're on the clock. 'hub': value trends over 1, 2 and 4 years. */
  mode: 'draft' | 'hub';
  yours?: boolean;
  /** The year the latest snapshot belongs to (for trends). */
  year?: number;
  title: string; label: string;
  /** Rows shown at most. */
  limit?: number;
}

export function boardWin(o: BoardOpts): string {
  const { app, league: L } = o, s = app.board;
  const wish = new Set(L.wishlist);
  const rows = o.players
    .filter((p) => (s.side === 'all' || (s.side === 'arms') === (p.position === 'P')) && (s.pos === 'all' || posOf(p) === s.pos)
      && p.age >= s.ageMin && p.age <= s.ageMax && (!s.starred || wish.has(p.id)))
    .map((p) => ({ p, pr: projection(p, L.seed) }))
    .filter(({ pr }) => pr.now >= s.minNow && pr.mid >= s.minCeil);
  const key = (r: (typeof rows)[number]): number | string => {
    const R = r.p.ratings as unknown as Record<string, number>;
    switch (s.sort) {
      case 'name': return r.p.name;
      case 'pos': return posOf(r.p);
      case 'age': return r.p.age;
      case 'now': return r.pr.now;
      case 'ceil': return r.pr.mid;
      case 't1': case 't2': case 't4': return trend(L, r.p, o.year ?? 0, Number(s.sort[1])) ?? -99;
      default: { const col = [...HIT, ...ARM].find(([k]) => k === s.sort); return col ? R[col[1]] : 0; }
    }
  };
  rows.sort((a, b) => { const x = key(a), y = key(b); const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number); return (s.desc ? -c : c) || a.p.id - b.p.id; });
  const shown = rows.slice(0, o.limit ?? 150);
  const showHit = s.side !== 'arms', showArm = s.side !== 'bats';
  const hub = o.mode === 'hub';
  const head = (k: string, label: string, title = '') => `<th scope="col"><button type="button" class="sort${s.sort === k ? ' on' : ''}" data-act="board-sort" data-k="${k}" data-key="board-sort:${k}"${title ? ` title="${esc(title)}"` : ''}>${label}${s.sort === k ? (s.desc ? ' ▼' : ' ▲') : ''}</button></th>`;
  const cols = [head('name', 'NAME'), head('pos', 'POS'), head('age', 'AGE'), head('now', 'NOW', 'How good he is today'), head('ceil', 'CEILING', 'Everyone\'s read of what he could become'),
    ...(showHit ? HIT.map(([k, f]) => head(k, k, f)) : []), ...(showArm ? ARM.map(([k, f]) => head(k, k, f)) : []),
    ...(hub ? [head('t1', '1Y', 'Value change over 1 year'), head('t2', '2Y', 'Over 2 years'), head('t4', '4Y', 'Over 4 years')] : []), '<th scope="col"></th>'].join('');
  const rate = (p: Player, f: string, on: boolean) => `<td class="${on ? '' : 'muted'}">${on ? r5((p.ratings as unknown as Record<string, number>)[f]) : '·'}</td>`;
  const tr = (n: number | null) => (n === null ? '<td class="muted">·</td>' : `<td class="${n >= 3 ? 'pos' : n <= -3 ? 'neg' : ''}">${n > 0 ? `+${n}` : n}</td>`);
  const body = shown.map(({ p, pr }) => {
    const isP = p.position === 'P', starred = wish.has(p.id);
    return `<tr class="${starred ? 'wish' : ''}"><th scope="row"><button type="button" class="star${starred ? ' on' : ''}" data-act="wish" data-id="${p.id}" data-key="wish:${p.id}" aria-pressed="${starred}" title="${starred ? 'Take off your draft board' : 'Add to your draft board'}">${starred ? '★' : '☆'}</button>${link(p.name, 'player', { id: p.id })}</th>
<td>${posOf(p)}</td><td>${p.age}</td><td>${pr.now}</td><td class="ceil">${pr.lo}–${pr.hi}</td>${showHit ? HIT.map(([, f]) => rate(p, f, !isP)).join('') : ''}${showArm ? ARM.map(([, f]) => rate(p, f, isP)).join('') : ''}
${hub ? tr(trend(L, p, o.year ?? 0, 1)) + tr(trend(L, p, o.year ?? 0, 2)) + tr(trend(L, p, o.year ?? 0, 4)) : ''}<td class="acts">${o.mode === 'draft' && o.yours ? btn('PICK', 'draft-pick', { kind: 'primary', data: { id: p.id } }) : ''}</td></tr>`;
  }).join('');
  const sel = (f: keyof BoardState, label: string, opts: Array<[string | number, string]>) =>
    `<label class="bsel"><span class="k">${label}</span><select data-act="board-set" data-f="${f}">${opts.map(([v, t]) => `<option value="${v}"${String(s[f]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const ages = Array.from({ length: 25 }, (_, i) => 16 + i);
  const filters = `<div class="board-filters">
<div class="tabs">${(['all', 'bats', 'arms'] as const).map((f) => `<button type="button" class="tab${s.side === f ? ' on' : ''}" data-act="board-side" data-f="${f}" data-key="board-side:${f}" aria-pressed="${s.side === f}">${f.toUpperCase()}</button>`).join('')}<button type="button" class="tab${s.starred ? ' on' : ''}" data-act="board-starred" data-key="board-starred" aria-pressed="${s.starred}">★ ONLY</button></div>
${sel('pos', 'POS', POSITIONS.map((x) => [x, x === 'all' ? 'ANY' : x]))}${sel('ageMin', 'AGE ≥', [[0, 'ANY'], ...ages.map((a): [number, string] => [a, String(a)])])}${sel('ageMax', 'AGE ≤', [[99, 'ANY'], ...ages.map((a): [number, string] => [a, String(a)])])}
${sel('minNow', 'NOW ≥', [[0, 'ANY'], ...[30, 35, 40, 45, 50, 55, 60].map((v): [number, string] => [v, String(v)])])}${sel('minCeil', 'CEILING ≥', [[0, 'ANY'], ...[40, 45, 50, 55, 60, 65, 70].map((v): [number, string] => [v, String(v)])])}
${btn('RESET', 'board-reset', { kind: 'ghost', title: 'Clear the filters' })}</div>`;
  const table = shown.length ? `<div class="hscroll board-scroll"><table class="stat roster draft-board" aria-label="${esc(o.title)}"><tr>${cols}</tr>${body}</table></div>`
    : '<p class="note muted">Nobody matches these filters.</p>';
  const more = rows.length > shown.length ? `<p class="note small muted">Showing the first ${shown.length} of ${rows.length}. Filter or sort to see others.</p>` : '';
  return win({ id: `w-board-${o.mode}`, title: o.title, label: `${o.label} · ${rows.length} PLAYERS`, cls: 'w-board', body: filters + table + more });
}

/** Your draft board, in your order: who's still there, who's gone and where. */
export function wishWin(app: App, L: League, taken: Map<number, number>, opts: { title?: string; compact?: boolean } = {}): string {
  const byId = new Map([...L.amateurs, ...L.freeAgents, ...L.players, ...L.prospects.map((x) => x.player)].map((p) => [p.id, p]));
  const items = L.wishlist.map((id, i) => {
    const p = byId.get(id);
    if (!p) return '';
    const by = taken.get(id), pr = projection(p, L.seed);
    const moves = `<span class="wish-moves">${btn('▲', 'wish-move', { kind: 'ghost', data: { id, dir: -1 }, disabled: i === 0, title: 'Up' })}${btn('▼', 'wish-move', { kind: 'ghost', data: { id, dir: 1 }, disabled: i === L.wishlist.length - 1, title: 'Down' })}${btn('✕', 'wish', { kind: 'ghost', data: { id }, title: 'Take off your board' })}</span>`;
    return `<li class="${by ? 'gone' : ''}"><span class="rank">${i + 1}</span><span class="nm">${link(p.name, 'player', { id })} <span class="muted small">${posOf(p)}, ${p.age} · ${pr.now} now · ${pr.lo}–${pr.hi}</span>${by ? `<span class="small"> taken by ${teamChip(by)}${esc(teamName(by))}</span>` : ''}</span>${opts.compact ? '' : moves}</li>`;
  }).join('');
  return win({ id: 'w-wish', title: opts.title ?? 'Your Draft Board', label: `${L.wishlist.length} PLAYERS · AUTO PICKS FOR YOU TAKE THE TOP NAME LEFT`, cls: 'w-wish',
    body: items ? `<ol class="lead-list wish-list">${items}</ol>` : '<p class="note muted small">Empty. Star (☆) prospects on the board to add them here, then order them your way.</p>' });
}
