/** The Gods' decree on screen: the scroll in the winter report, and a line for player cards and past seasons. */
import { DECREES, decreeFor, type Decree } from '../engine/decree';
import type { League } from '../engine/types';
import { esc } from './views/common';

/** The parchment scroll that unrolls in the winter report (and wherever the year's decree is shown big). */
export function decreeScroll(d: Decree, year: number, after?: string): string {
  return `<section class="decree" aria-label="The Gods' decree for Year ${year}">
<span class="roll" aria-hidden="true"></span><div class="decree-mid">
<p class="decree-k">THE GODS DECREE · YEAR ${year}</p>
<h2 class="decree-title">${esc(d.label.toUpperCase())}</h2>
<p class="decree-fx">${esc(cap(d.effect))}. For one year; a quarter of it stays in the game for good.</p>${after ? `<p class="decree-fx muted-ink">${esc(after)}</p>` : ''}
</div><span class="roll" aria-hidden="true"></span></section>`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What past decrees have left in the league's dials, in words ("home runs: blessed twice, cursed once"). */
export function lingering(L: League, year: number): string {
  const tally = new Map<string, { up: number; down: number }>();
  for (const m of L.modifiers) {
    const d = m as Decree;
    if (m.source !== 'decree' || m.until >= year) continue;
    const t = tally.get(d.kind) ?? { up: 0, down: 0 };
    if (d.blessed) t.up++; else t.down++;
    tally.set(d.kind, t);
  }
  const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
  const parts = [...tally].filter(([, t]) => t.up !== t.down).map(([k, t]) => {
    const stat = DECREES.find((x) => x.id === k)?.stat ?? k;
    return `the ${stat} (${[t.up && `blessed ${times(t.up)}`, t.down && `cursed ${times(t.down)}`].filter(Boolean).join(', ')})`;
  });
  return parts.length ? `Still felt from past years: ${parts.join('; ')}.` : '';
}

/** "The Year of the Mighty Home Run: home runs up about 13%." for this year, or ''. */
export function decreeLine(L: League, year: number): string {
  const d = decreeFor(L, year);
  return d ? `${d.label}: ${d.effect}.` : '';
}
