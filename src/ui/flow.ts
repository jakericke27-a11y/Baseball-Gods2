/**
 * Fixed screens whose lists run long (Leaders, its races and streaks): windows sit side by side at full height, and
 * a window too tall for the screen hands its overflow to a copy of itself in the next column ("... cont."), so lists
 * grow sideways instead of down. Lists that may split are marked `data-flow`; a table keeps its header row.
 * Runs after each render, only where the layout is the desktop one (the flow box is a flex row).
 */
export function flowColumns(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.flow').forEach((box) => {
    if (getComputedStyle(box).display !== 'flex') return;
    const maxH = box.clientHeight;
    if (maxH < 200) return;
    const wins = [...box.children] as HTMLElement[];
    for (let i = 0; i < wins.length && i < 60; i++) {
      const w = wins[i];
      w.style.maxHeight = 'none'; // measure the window at its natural height
      const tall = () => w.offsetHeight > maxH + 1;
      if (!tall()) { w.style.maxHeight = ''; continue; }
      const lists = [...w.querySelectorAll<HTMLElement>('[data-flow]')];
      const itemsOf = (l: HTMLElement) => [...l.children].filter((c) => !c.classList.contains('thead')) as HTMLElement[];
      if (!lists.length || lists.reduce((n, l) => n + itemsOf(l).length, 0) < 2) { w.style.maxHeight = ''; continue; }
      const copy = w.cloneNode(true) as HTMLElement;
      const copyLists = [...copy.querySelectorAll<HTMLElement>('[data-flow]')];
      copyLists.forEach((l) => itemsOf(l).forEach((c) => c.remove()));
      copy.querySelectorAll('.win-body > :not([data-flow]):not(:has([data-flow])):not(.sub-h)').forEach((n) => n.remove());
      const t = copy.querySelector<HTMLElement>('.win-title');
      if (t) { t.id = `${t.id}-${i}`; if (!t.textContent!.endsWith(' (cont.)')) t.textContent += ' (cont.)'; }
      copy.setAttribute('aria-labelledby', t?.id ?? '');
      copy.querySelector('.win-label')?.remove();
      let moved = 0;
      while (tall()) {
        const k = lists.map((l) => itemsOf(l).length).findLastIndex((n) => n > 0);
        const total = lists.reduce((n, l) => n + itemsOf(l).length, 0);
        if (k < 0 || total <= 1) break;
        const it = itemsOf(lists[k]).at(-1)!;
        const dest = copyLists[k], head = dest.querySelector(':scope > .thead');
        if (head) head.after(it); else dest.prepend(it);
        moved++;
      }
      w.style.maxHeight = '';
      if (!moved) continue;
      // drop the copy's empty lists (and their headings); drop the original's emptied ones too
      copyLists.forEach((l) => { if (!itemsOf(l).length) { const h = l.previousElementSibling; if (h?.classList.contains('sub-h')) h.remove(); l.remove(); } });
      lists.forEach((l) => { if (!itemsOf(l).length) { const h = l.previousElementSibling; if (h?.classList.contains('sub-h')) h.remove(); l.remove(); } });
      w.after(copy);
      wins.splice(i + 1, 0, copy);
    }
    // every window on the screen matches the longest one
    const tallest = Math.min(maxH, Math.max(...wins.map((w) => w.offsetHeight)));
    wins.forEach((w) => { w.style.height = `${tallest}px`; });
  });
}
