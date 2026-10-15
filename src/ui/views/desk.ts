/**
 * The desk (step 2.8): decision cards waiting for you, missions in progress, and what you decided lately.
 * In the clubhouse it's the office desk; on the dashboard it's a screen of its own.
 */
import type { App } from '../app';
import { blockHtml } from '../art';
import { choiceLabel, daysLeft, defOf, viewCtx, type CardInst } from '../cards';
import { shortDate } from '../calendar';
import { btn, esc, win } from './common';
import { page } from './screens';

function cardHtml(app: App, inst: CardInst): string {
  const g = app.game!, def = defOf(inst.def);
  if (!def) return '';
  const c = viewCtx(g), left = daysLeft(g, inst);
  const due = left <= 0 ? 'ANSWER TODAY' : left === 1 ? '1 DAY TO ANSWER' : `${left} DAYS TO ANSWER`;
  const choices = def.choices.map((ch, i) => `<button type="button" class="dc-choice" data-act="dc-answer" data-uid="${inst.uid}" data-i="${i}" data-key="dc:${inst.uid}:${i}"><b>${esc(choiceLabel(ch, c, inst.bind))}</b><span>${esc(ch.hint)}</span></button>`).join('');
  return `<article class="dcard dk-${def.kind}" aria-labelledby="dc-${inst.uid}">
<div class="dc-art">${blockHtml(`dcard_${def.id.replace(/-/g, '_')}`, 2)}</div>
<header class="dc-head"><h3 id="dc-${inst.uid}">${esc(inst.title)}</h3><span class="dc-due${left <= 1 ? ' soon' : ''}">${due}</span></header>
<p class="dc-text">${esc(inst.text)}</p>
<div class="dc-choices">${choices}</div>
<div class="dc-foot">${btn('LET THE BENCH COACH DECIDE', 'dc-answer', { kind: 'ghost', data: { uid: inst.uid, i: 'roll' }, title: 'He picks for you (roll it)' })}${def.expireText ? `<span class="small muted">If you don't answer: ${esc(def.expireText.toLowerCase())}.</span>` : ''}</div></article>`;
}

export function deskView(app: App): string {
  const g = app.game!, book = g.cards;
  const cards = book.desk.map((c) => cardHtml(app, c)).join('');
  const deskWin = win({ id: 'w-desk', title: 'On Your Desk', label: book.desk.length ? `${book.desk.length} CARD${book.desk.length === 1 ? '' : 'S'}` : 'ALL CLEAR', scroll: true, cls: 'w-desk',
    body: cards ? `<div class="dc-row">${cards}</div>` : '<p class="note muted">Your desk is clear. Cards come in as the season goes: one a week, more after big games.</p>' });
  const missions = book.missions.map((m) => {
    const pct = Math.max(0, Math.min(100, Math.round((100 * m.progress) / Math.max(1, m.target))));
    const left = Math.max(0, m.until - (g.year * 1000 + g.day));
    return `<li class="ms ${m.status}"><div class="ms-h"><b>${esc(m.title)}</b><span class="small ${m.status === 'done' ? 'pos' : m.status === 'failed' ? 'neg' : 'muted'}">${m.status === 'active' ? `${left} DAYS LEFT` : m.status.toUpperCase()}</span></div>
<p class="small">${esc(m.goal)}</p><div class="ms-bar"><i style="width:${pct}%"></i></div><p class="small muted">${m.progress} of ${m.target}</p></li>`;
  }).join('');
  const missionsWin = win({ id: 'w-missions', title: 'Missions', label: `${book.missions.filter((m) => m.status === 'active').length} ACTIVE`, scroll: true,
    body: missions ? `<ul class="ms-list">${missions}</ul>` : '<p class="note muted small">None yet. Some cards start one.</p>' });
  const log = [...book.log].reverse().slice(0, 14).map((l) => `<li><span class="muted small">${shortDate(l.day)}${l.year !== g.year ? ` Y${l.year}` : ''}</span> <b>${esc(l.title)}</b>: ${esc(l.choice)}${l.how === 'rolled' ? ' <i class="muted">(bench coach)</i>' : ''}<br><span class="small muted">${esc(l.result)}</span></li>`).join('');
  const logWin = win({ id: 'w-decided', title: 'Lately', label: 'DECISIONS AND WHAT CAME OF THEM', scroll: true,
    body: log ? `<ul class="dl-list">${log}</ul>` : '<p class="note muted small">Nothing decided yet.</p>' });
  return page(app, 'desk', `<div class="fill desk-layout">${deskWin}<div class="desk-side">${missionsWin}${logWin}</div></div>`, true);
}

/** The pop-up when cards land: go to the desk now, or later (the sim picks up where it stopped). */
export function landedModal(app: App, titles: string[]): string {
  const n = titles.length;
  return `<div class="modal-veil"><section class="win modal landed" role="dialog" aria-modal="true" aria-labelledby="landed-t"><span class="studs" aria-hidden="true"></span>
<header class="win-head"><h2 class="win-title" id="landed-t">${n === 1 ? 'A card is on your desk' : `${n} cards are on your desk`}</h2></header>
<div class="win-body"><ul class="landed-list">${titles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
<div class="row-actions">${btn('GO TO DESK', 'landed-go', { kind: 'primary', data: {}, title: 'Open your desk' })}${btn(app.resumeSim ? 'LATER · KEEP SIMMING' : 'LATER', 'landed-later', { title: 'It waits on your desk' })}</div></div></section></div>`;
}
