/**
 * Pixel art drawn as grids. '.' is empty, 'w' takes the current text color (so a parent can recolor
 * an icon), other letters map to fixed colors. Every art pixel is 4 screen pixels.
 */
const COLORS: Record<string, string> = {
  r: '#E04A3B', g: '#C9D6F2', p: '#EADDB8', d: '#5B4A2E', y: '#FFD25A', o: '#FF8C2A', f: '#D9302B',
  i: '#EAF8FF', c: '#8FD8F7', b: '#4BA3D9', k: '#1A1F2E',
};

function rects(rows: string[], colors: Record<string, string>): string {
  const out: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      const x0 = x;
      while (x < row.length && row[x] === ch) x++;
      out.push(`<rect x="${x0}" y="${y}" width="${x - x0}" height="1" fill="${ch === 'w' ? 'currentColor' : colors[ch]}"/>`);
    }
  });
  return out.join('');
}

export function svg(rows: string[], unit = 4, colors = COLORS): string {
  const w = rows[0].length, h = rows.length;
  return `<svg class="px" width="${w * unit}" height="${h * unit}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects(rows, colors)}</svg>`;
}

/** As a CSS url() for backgrounds. */
export function svgUrl(rows: string[], colors = COLORS): string {
  const w = rows[0].length, h = rows.length;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects(rows, colors)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}

const GRIDS = {
  temple: ['....ww....', '..wwwwww..', 'wwwwwwwwww', 'wwwwwwwwww', '.w..ww..w.', '.w..ww..w.', '.w..ww..w.', '.w..ww..w.', 'wwwwwwwwww', 'wwwwwwwwww'],
  pennant: ['.y........', '.wrr......', '.wrrrr....', '.wrrrrrrr.', '.wrrrr....', '.wrr......', '.w........', '.w........', '.w........', '.w........'],
  ball: ['...www...', '.wrwwwrw.', '.rwwwwwr.', 'wrwwwwwrw', 'wrwwwwwrw', 'wrwwwwwrw', '.rwwwwwr.', '.wrwwwrw.', '...www...'],
  jersey: ['..ww..ww..', 'wwww..wwww', 'wwwwwwwwww', 'wwwwwwwwww', '..wwwwww..', '..rrrrrr..', '..wwwwww..', '..wwwwww..', '..wwwwww..', '..wwwwww..'],
  scroll: ['ww......ww', 'wwppppppww', 'wwpddddpww', 'wwppppppww', 'wwpdddppww', 'wwppppppww', 'wwppppppww', 'ww......ww'],
  hourglass: ['wwwwwwww', '.w....w.', '.wwwwww.', '..wwww..', '...ww...', '...ww...', '..w..w..', '.w.ww.w.', '.wwwwww.', 'wwwwwwww'],
  bat: ['.......ww.', '......wwww', '.....wwww.', '....wwww..', '...www....', '..ww......', '.ww.......', 'ww........', 'w.........', 'ww........'],
  ff: ['w....w....', 'ww...ww...', 'www..www..', 'wwww.wwww.', 'wwww.wwww.', 'www..www..', 'ww...ww...', 'w....w....'],
  crown: ['w...w...w', 'ww.www.ww', 'wwwwwwwww', 'wwrwwwrww', 'wwwwwwwww', 'wwwwwwwww'],
  cog: ['...ww...', '.w.ww.w.', '.wwwwww.', 'www..www', 'www..www', '.wwwwww.', '.w.ww.w.', '...ww...'],
  news: ['wwwwwwww.', 'w......ww', 'w.ww.w.ww', 'w......ww', 'w.wwww.ww', 'w......ww', 'wwwwwwwww'],
  expand: ['..wwww', '....ww', '...w.w', '..w..w', '.w....', 'w.....'],
  play: ['w.....', 'ww....', 'www...', 'wwww..', 'www...', 'ww....', 'w.....'],
  pause: ['ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww'],
  left: ['...w', '..ww', '.www', 'wwww', '.www', '..ww', '...w'],
  right: ['w...', 'ww..', 'www.', 'wwww', 'www.', 'ww..', 'w...'],
  box: ['wwwwwwwww', 'w.w.w.w.w', 'wwwwwwwww', 'w.w.w.w.w', 'wwwwwwwww', 'w.w.w.w.w', 'wwwwwwwww'],
  close: ['w....w', '.w..w.', '..ww..', '..ww..', '.w..w.', 'w....w'],
  scope: ['..wwww....', '.w....w...', 'w..ww..w..', 'w.w....w..', 'w......w..', '.w....w...', '..wwwwww..', '......www.', '.......www', '........ww'],
  flag: ['wwwyywwyyw', 'wwwyywwyyw', 'wyywwyywwy', 'wyywwyywwy', 'wwwyywwyyw', 'wwwyywwyyw', 'w.........', 'w.........', 'w.........', 'w.........'],
  deck: ['..wwwwww..', '.w......w.', 'wwwwww..w.', 'w....w..w.', 'w.ww.w..w.', 'w....w..w.', 'w.ww.w.w..', 'w....ww...', 'w....w....', 'wwwwww....'],
  book: ['.www..www.', 'wpppwwpppw', 'wpddwwddpw', 'wpppwwpppw', 'wpddwwddpw', 'wpppwwpppw', 'wpddwwddpw', 'wpppwwpppw', 'wwwwwwwwww', '....ww....'],
  swap: ['......w...', '......ww..', 'wwwwwwwww.', '......ww..', '......w...', '...w......', '..ww......', '.wwwwwwwww', '..ww......', '...w......'],
  note: ['...www', '...w.w', '...w.w', '...w..', '.www..', 'wwww..', '.ww...'],
} as const;

export type IconName = keyof typeof GRIDS;
export const icon = (name: IconName, unit = 4) => svg(GRIDS[name] as unknown as string[], unit);

/** The cursor that marks a focused menu item: the pixel baseball, as a background image. */
export const BALL_URL = svgUrl(GRIDS.ball.map((r) => r.replace(/w/g, 'i')) as string[]);

// Streak dressing: three sizes each, two frames each (stacked vertically) so CSS can flicker them.
const FLAME = [
  ['...o......y.', '.ffof..ffo..', 'ooyyyooyyyoo'],
  ['...o......y.', '..ff....f...', '.ffof..ffo..', 'ffoyofffoyof', 'ooyyyooyyyoo'],
  ['..y....o....', '...o......y.', '..ff....f.o.', '.ffof..ffo..', '.foyff.foyf.', 'ffoyofffoyof', 'ooyyyooyyyoo'],
];
const FLAME_B = [
  ['......o...y.', '..fof..ffo..', 'ooyyyooyyyoo'],
  ['......o.y...', '.f....f.f...', '..ffo.ffof..', 'ffoyfoffoyof', 'ooyyyooyyyoo'],
  ['....y....o..', '.o.....y....', '.f..ff...ff.', '..ffo.ffof..', '.ffoyf.foyf.', 'fyoyofffoyof', 'ooyyyooyyyoo'],
];
const ICE = [
  ['cicccciccicc', '.ic..ci..ic.', '..c...i.....'],
  ['cicccciccicc', '.ic..ci..ic.', '.ic...i..i..', '..c...i.....', '......c.....'],
  ['cicccciccicc', 'cic..cic.icc', '.ic..ci..ic.', '.ic...i..i..', '..c...i..c..', '......c.....', '......c.....'],
];
const ICE_B = ICE.map((rows) => rows.map((r, y) => (y === 0 ? r : r.replace(/i/, 'b'))));

/** CSS for the six streak classes (hot-1..3, cold-1..3): height and a two-frame sprite strip. */
export function streakCss(): string {
  const rules: string[] = [];
  for (let lvl = 1; lvl <= 3; lvl++) {
    const f = FLAME[lvl - 1], fb = FLAME_B[lvl - 1], ic = ICE[lvl - 1], ib = ICE_B[lvl - 1];
    // drawn at 3px a pixel (36px a tile); a budding streak burns fainter than a raging one
    const op = [0.5, 0.72, 0.92][lvl - 1];
    rules.push(`.hot-${lvl}{--strip-h:${f.length * 3}px;--strip-o:${op};--strip:${svgUrl([...f, ...fb])}}`);
    rules.push(`.cold-${lvl}{--strip-h:${ic.length * 3}px;--strip-o:${op};--strip:${svgUrl([...ic, ...ib])}}`);
  }
  rules.push(`:root{--ball:${BALL_URL}}`);
  return rules.join('\n');
}
