/**
 * MANAGE (step 2.7): your team on an aerial field, with the dugout and the bullpen beside it. Drag a card from the
 * dugout onto a fielder, the batter or a runner (or a reliever onto the mound), or drag someone off to the open slot,
 * then compare the two Baseball Cards and CONFIRM or WAIT, NVM. Clicking works too: the player coming out, then the
 * one going in. The calls for this plate appearance and the defense's depth sit on the right.
 */
import type { App } from '../app';
import { POS_ABBR } from '../../engine/game/text';
import type { BatCall, GameCall, PitchCall } from '../../engine/game/types';
import type { Player } from '../../engine/types';
import type { Game } from '../state';
import { avg, era, era2, rate3 } from '../stats';
import { teamPair } from '../teams';
import { btn, esc, r5 } from './common';
import { baseballCard } from './card';

/** Where a player is being swapped: a lineup slot, the mound, or a base. */
export type ManageTarget = { kind: 'slot'; slot: number } | { kind: 'pitcher' } | { kind: 'base'; base: number };
export interface ManageState { open: boolean; out: number; in: number; target: ManageTarget | null; msg: string }
export const newManage = (): ManageState => ({ open: false, out: 0, in: 0, target: null, msg: '' });

/** Field spots (percent of the field box) by scoring position; 0 (DH) sits off the field. */
const SPOT: Record<number, [number, number]> = {
  1: [50, 42], 2: [50, 72], 3: [78, 38], 4: [64, 17], 5: [22, 38], 6: [36, 17], 7: [13, 3], 8: [50, 0], 9: [87, 3],
};
/** Runners stand on the bases: first, second, third. */
const BASE_SPOT: Array<[number, number]> = [[75, 40], [50, 0], [25, 40]];

export const BAT_CALLS: Array<[BatCall, string, string]> = [
  ['power', 'TIE THE GAME NOW!', 'Home run or nothing: big swings, more strikeouts'],
  ['move', 'MOVE THE RUNNER!', 'Bunt or put it on the ground: no double play, runners move up'],
  ['walk', 'DRAW THE WALK!', 'Sit on pitches: more walks, more called strikes'],
  ['hitrun', 'HIT AND RUN!', 'The runner goes: protect him, take an extra base'],
];
export const PITCH_CALLS: Array<[PitchCall, string]> = [
  ['k', 'STRIKEOUT'], ['gb', 'GROUNDER'], ['fb', 'FLY BALL'], ['corners', 'DOT THE CORNERS'], ['ibb', 'WALK HIM'],
];

/** Every pitcher's version of a call has its own name, from his best tool (pitch types arrive with Statcast, 3.2). */
export function pitchCallName(p: Player, call: PitchCall): string {
  if (call === 'ibb') return 'Four Wide';
  const R = p.ratings;
  const tool = R.velocity >= R.movement && R.velocity >= R.control ? 'vel' : R.movement >= R.control ? 'mov' : 'ctl';
  const names: Record<string, Record<Exclude<PitchCall, 'ibb'>, string>> = {
    vel: { k: 'Climb the Ladder', gb: 'Heavy Heat Down', fb: 'Ride the Heater', corners: 'Paint with Gas' },
    mov: { k: 'Bury the Breaker', gb: 'Sink and Spin', fb: 'Float the Hook', corners: 'Bend the Black' },
    ctl: { k: 'Back-Door Freeze', gb: 'Down and Away', fb: 'Elevate on the Edge', corners: 'Paint the Black' },
  };
  return names[tool][call];
}

/** A small card for the field, the dugout and the bullpen. */
function mini(g: Game, p: Player, from: string, o: { pos?: string; sel?: boolean; gone?: boolean; drop?: string } = {}): string {
  const teamId = g.teamOf.get(p.id) ?? 0, [t1, t2] = teamId ? teamPair(teamId) : ['#8E98B0', '#5B6B7A'];
  const isP = p.position === 'P';
  const b = g.season.batting.get(p.id), q = g.season.pitching.get(p.id);
  const stat = isP ? (q?.outs ? `${era2(era(q))} ERA` : '— ERA') : (b?.AB ? `${rate3(avg(b))} AVG` : '— AVG');
  const last = p.name.split(' ').slice(-1)[0];
  const can = !o.gone;
  return `<button type="button" class="mcard${o.sel ? ' sel' : ''}${o.gone ? ' gone' : ''}" style="--t1:${t1};--t2:${t2}" data-act="mg-pick" data-pid="${p.id}" data-from="${from}"${o.drop ? ` data-drop="${o.drop}"` : ''}${can ? ' draggable="true"' : ' disabled'} data-key="mg:${from}:${p.id}" title="${esc(p.name)}${o.gone ? ' (out of the game)' : ''}">
<span class="mc-pos">${o.pos ?? (isP ? p.pitcherRole ?? 'P' : p.position)}</span><span class="mc-name">${esc(last)}</span><span class="mc-stat">${stat}</span>${isP ? `<span class="mc-rt">STA ${r5(p.ratings.stamina)}</span>` : `<span class="mc-rt">${r5(p.ratings.contact)}/${r5(p.ratings.power)}</span>`}</button>`;
}

const slotOf = (c: GameCall, side: number, id: number) => c.lineups[side].findIndex(([pid]) => pid === id);

export function manageView(app: App): string {
  const g = app.game!, d = g.live?.day, c = d?.call, m = app.manage;
  if (!d || !c) return '';
  const me = g.liveSide, setup = d.setups[me], batting = c.half === me;
  const P = (id: number) => g.players.get(id)!;
  const used = new Set(c.used[me]);
  const bench = (setup.bench ?? []).filter((p) => !used.has(p.id));
  const pen = setup.bullpen.filter((a) => !used.has(a.player.id));
  const pitcher = P(c.pitchers[me].id);
  const sel = (id: number) => id === m.out || id === m.in;

  // ---- the field: your defense, or your batter and runners
  let field = '';
  if (!batting) {
    for (const [id, pos] of c.lineups[me]) {
      if (pos < 2) continue;
      const [x, y] = SPOT[pos];
      field += `<div class="fspot" style="left:${x}%;top:${y}%">${mini(g, P(id), 'field', { pos: POS_ABBR[pos], sel: sel(id), drop: `slot:${slotOf(c, me, id)}` })}</div>`;
    }
    const [x, y] = SPOT[1];
    field += `<div class="fspot" style="left:${x}%;top:${y}%">${mini(g, pitcher, 'mound', { pos: 'P', sel: sel(pitcher.id), drop: 'pitcher' })}</div>`;
  } else {
    const [x, y] = SPOT[2];
    field += `<div class="fspot" style="left:${x}%;top:${y}%">${mini(g, P(c.batter), 'batter', { pos: 'AB', sel: sel(c.batter), drop: `slot:${c.slot}` })}</div>`;
    c.bases.forEach((id, b) => {
      if (!id) return;
      const [bx, by] = BASE_SPOT[b];
      field += `<div class="fspot" style="left:${bx}%;top:${by}%">${mini(g, P(id), 'runner', { pos: ['1B', '2B', '3B'][b], sel: sel(id), drop: `base:${b}` })}</div>`;
    });
  }
  const dh = c.lineups[me].find(([, pos]) => pos === 0);
  const dhTile = !batting && dh ? `<div class="mg-dh">${mini(g, P(dh[0]), 'field', { pos: 'DH', sel: sel(dh[0]), drop: `slot:${slotOf(c, me, dh[0])}` })}</div>` : '';
  const order = batting ? `<div class="mg-order"><span class="k">BATTING ORDER</span><ol>${c.lineups[me].map(([id, pos], i) => `<li class="${i === c.slot ? 'up' : ''}"><span>${i + 1}</span>${esc(P(id).name.split(' ').slice(-1)[0])} <i>${POS_ABBR[pos]}</i></li>`).join('')}</ol></div>` : '';

  const outSlot = (where: string, label: string) => `<div class="mcard open" data-drop="${where}" data-act="mg-open" data-key="mg-open:${where}" title="Drag a player here to take him out">${label}</div>`;
  const dugout = `<div class="mg-row"><span class="k">DUGOUT</span><div class="mg-cards">${bench.map((p) => mini(g, p, 'bench', { sel: sel(p.id) })).join('') || '<span class="note small muted">Bench empty</span>'}${outSlot('bench-out', 'OUT')}</div></div>`;
  const bullpen = `<div class="mg-row"><span class="k">BULLPEN</span><div class="mg-cards">${pen.map((a) => mini(g, a.player, 'pen', { pos: a.role, sel: sel(a.player.id) })).join('') || '<span class="note small muted">Bullpen empty</span>'}${outSlot('pen-out', 'OUT')}</div></div>`;

  // ---- the compare
  let compare: string;
  if (m.out || m.in) {
    const left = m.out ? baseballCard(app, m.out, 'mg-out') : '<div class="bcard empty">Drag out who\'s coming out</div>';
    const right = m.in ? baseballCard(app, m.in, 'mg-in') : '<div class="bcard empty">Now drag in who replaces him</div>';
    const what = !m.target ? '' : m.target.kind === 'pitcher' ? 'PITCHING CHANGE' : m.target.kind === 'base' ? `PINCH RUNNER AT ${['FIRST', 'SECOND', 'THIRD'][m.target.base]}` : batting && m.target.slot === c.slot ? 'PINCH HITTER' : 'DEFENSIVE SUB';
    compare = `<div class="mg-what">${what}</div><div class="bc-compare"><div class="bc-side"><div class="bc-tag out">OUT</div>${left}</div><div class="bc-side"><div class="bc-tag in">IN</div>${right}</div></div>
<div class="row-actions mg-confirm">${btn('CONFIRM', 'mg-confirm', { kind: 'primary', disabled: !(m.out && m.in && m.target), title: 'Lock it in: he enters now' })}${btn('WAIT, NVM', 'mg-cancel', { title: 'Put everyone back' })}</div>`;
  } else {
    compare = `<p class="note small muted mg-hint">${batting ? 'Drag a bench card onto the batter (pinch hit) or a runner (pinch run).' : 'Drag a bench card onto a fielder, or a reliever onto the mound. Or drag someone to an OUT slot first.'} The two Baseball Cards show here side by side.</p>`;
  }

  // ---- calls and depth
  const tabsRow = (act: string, opts: Array<[string, string, string?]>, cur: string, k: string) => `<div class="mg-calls" role="group">${opts.map(([v, t, title]) => `<button type="button" class="tab${cur === v ? ' on' : ''}" data-act="${act}" data-v="${v}" data-key="${k}:${v}"${title ? ` title="${esc(title)}"` : ''} aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
  let calls: string;
  if (batting) {
    const cur = c.calls.bat[me] ?? 'none';
    const opts = BAT_CALLS.filter(([k]) => (k !== 'move' || c.bases.some(Boolean)) && (k !== 'hitrun' || (!!c.bases[0] && !c.bases[1])));
    calls = `<h3 class="sub-h">THIS AT-BAT</h3>${tabsRow('mg-bat', [['none', 'SWING AWAY', 'No call'], ...opts.map(([k, t, ti]): [string, string, string] => [k, t, ti])], cur, 'mg-bat')}`;
  } else {
    const cur = c.calls.pitch[me] ?? 'none', al = c.align[me];
    const name = cur !== 'none' ? `<p class="mg-strat">${esc(pitcher.name.split(' ').slice(-1)[0]).toUpperCase()}: <b>${esc(pitchCallName(pitcher, cur as PitchCall))}</b></p>` : '';
    const opts = PITCH_CALLS.filter(([k]) => k !== 'ibb' || !c.bases[0] || !c.bases[1] || !c.bases[2]);
    calls = `<h3 class="sub-h">THIS AT-BAT</h3>${tabsRow('mg-pitch', [['none', 'PITCH TO HIM'], ...opts.map(([k, t]): [string, string] => [k, t])], cur, 'mg-pitch')}${name}
<h3 class="sub-h">INFIELD</h3>${tabsRow('mg-inf', [['normal', 'NORMAL'], ['in', 'IN'], ['dp', 'DOUBLE PLAY'], ['lines', 'GUARD LINES']], al.infield, 'mg-inf')}
<h3 class="sub-h">OUTFIELD</h3>${tabsRow('mg-of', [['normal', 'NORMAL'], ['deep', 'DEEP'], ['shallow', 'SHALLOW']], al.outfield, 'mg-of')}`;
  }
  const score = `${c.score[0]}-${c.score[1]}`;
  const head = `<header class="mg-head"><h2 class="win-title" id="mg-t">Manage · ${batting ? 'At Bat' : 'In the Field'}</h2><span class="win-label">${c.half ? 'BOT' : 'TOP'} ${c.inning} · ${c.outs} OUT · ${score}</span>${btn('DONE', 'mg-close', { kind: 'primary', title: 'Back to the game (Esc)' })}</header>`;
  return `<div class="modal-veil mg-veil"><section class="win mg" role="dialog" aria-modal="true" aria-labelledby="mg-t"><span class="studs" aria-hidden="true"></span>${head}
<div class="mg-body"><div class="mg-left"><div class="mg-field${batting ? ' batting' : ''}"><div class="mg-dirt"></div>${field}${dhTile}</div>${order}${dugout}${batting ? '' : bullpen}</div>
<div class="mg-right">${calls}<div class="mg-compare">${compare}</div>${m.msg ? `<p class="warn small">${esc(m.msg)}</p>` : ''}</div></div></section></div>`;
}
