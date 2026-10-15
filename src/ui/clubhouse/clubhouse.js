
/* =============================================================================================
   Baseball Gods: the Clubhouse
   A walkable pixel home screen layered on the game. It mounts into the home screen and fills the
   window, and using things calls the game's own actions (window.__bg.act), so every screen it opens
   is the real one with the real league. MENU (or Esc) reaches the dashboard and every screen.

   Art comes from three places, best first:
     1. test art dropped into this browser (ART panel; kept in this browser only),
     2. files published with the game in art/ (listed in art/manifest.json),
     3. code-drawn stand-ins (everything you see until real art arrives).
   SPEC below is the art spec. The spec doc quotes these numbers, so change them together.
   ============================================================================================= */
(() => {
'use strict';

const SPEC = Object.freeze({
  tile: 16,                                   // px; every room, door and footprint sits on this grid
  sheet: { cols: 4, rows: 4, frameW: 16, frameH: 32 },   // character sheet: 4 walk frames x 4 facings
  facings: ['down', 'left', 'right', 'up'],   // sheet rows, top to bottom
  walkFps: 8, runFps: 12,                     // walk cycle speed (frames per second)
  speed: { walk: 80, run: 136, path: 104 },   // px per second
  viewTiles: 11,                              // at least this many tiles fit across the short side of the view
  hit: { w: 10, h: 6 },                       // collision box at the feet
  teamKeys: { main: '#2E64C8', shade: '#173264', accent: '#E04A3B', accentShade: '#70251E' },
});
const T = SPEC.tile;
const BATTING_LAB = 'https://claude.ai/artifact/8yhv2kVaS5oAbNVSRdoHP1';
const STORE_KEY = 'baseball-gods/clubhouse';
const VOID = '#050A1C';
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

/* ---------------------------------------------------------------- colors and tiny helpers */
const C = {
  out: '#0B0F1C', ink: '#2A2F3E', white: '#F2F4FA',
  wood: '#8A5A3B', woodL: '#A8724C', woodD: '#5E3B26',
  metal: '#6E7891', metalL: '#8E98B0', metalD: '#4A5268',
  paper: '#EADDB8', paperD: '#CDBB8E', paperInk: '#5B4A2E',
  gold: '#FFD25A', goldD: '#B08A2E', screen: '#0E1424', glow: '#3FA7D6',
  leaf: '#3D7A4A', leafL: '#5BA35F', pot: '#B4643C',
  fabric: '#7A2E3A', fabricL: '#9A4250',
  dirt: '#C98B57', dirtL: '#D69E66', dirtD: '#A86F43',
  sky: '#8FD8F7', skyL: '#EAF8FF', phone: '#B3222E',
  main: SPEC.teamKeys.main, shade: SPEC.teamKeys.shade, accent: SPEC.teamKeys.accent, accentShade: SPEC.teamKeys.accentShade,
};
const ICON_PAL = { r: '#E04A3B', g: '#C9D6F2', p: '#EADDB8', d: '#5B4A2E', y: '#FFD25A', o: '#FF8C2A', f: '#D9302B', i: '#EAF8FF', c: '#8FD8F7', b: '#4BA3D9', k: '#1A1F2E' };
// The game's own pixel icons, so the stand-ins speak the same visual language as the footer.
const ICONS = {
  temple: ['....ww....', '..wwwwww..', 'wwwwwwwwww', 'wwwwwwwwww', '.w..ww..w.', '.w..ww..w.', '.w..ww..w.', '.w..ww..w.', 'wwwwwwwwww', 'wwwwwwwwww'],
  pennant: ['.y........', '.wrr......', '.wrrrr....', '.wrrrrrrr.', '.wrrrr....', '.wrr......', '.w........', '.w........', '.w........', '.w........'],
  ball: ['...www...', '.wrwwwrw.', '.rwwwwwr.', 'wrwwwwwrw', 'wrwwwwwrw', 'wrwwwwwrw', '.rwwwwwr.', '.wrwwwrw.', '...www...'],
  bat: ['.......ww.', '......wwww', '.....wwww.', '....wwww..', '...www....', '..ww......', '.ww.......', 'ww........', 'w.........', 'ww........'],
  news: ['wwwwwwww.', 'w......ww', 'w.ww.w.ww', 'w......ww', 'w.wwww.ww', 'w......ww', 'wwwwwwwww'],
  dash: ['wwww.wwww', 'w..w.w..w', 'w..w.w..w', 'wwww.wwww', '.........', 'wwww.wwww', 'w..w.w..w', 'w..w.w..w', 'wwww.wwww'],
  walker: ['...ww...', '...ww...', '..wwww..', '.w.ww.w.', '.w.ww.w.', '...ww...', '..w..w..', '.ww..ww.'],
};

const hex2 = (h) => { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgb2 = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex2(a), y = hex2(b); return rgb2(x.map((v, i) => v + (y[i] - v) * t)); };
const halve = (h) => rgb2(hex2(h).map((v) => v * 0.5));
const hash = (a, b, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
function pen(ctx) { const f = (x, y, w, h, c) => { if (!c) return; ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }; f.ctx = ctx; return f; }
function disc(f, x, y, w, h, c) {
  for (let j = 0; j < h; j++) {
    const t = (j + 0.5 - h / 2) / (h / 2), half = (w / 2) * Math.sqrt(Math.max(0, 1 - t * t));
    const x0 = Math.round(x + w / 2 - half), x1 = Math.round(x + w / 2 + half);
    if (x1 > x0) f(x0, y + j, x1 - x0, 1, c);
  }
}
function block(f, x, y, w, h, top, c, topc) {
  f(x, y, w, h, C.out);
  f(x + 1, y + 1, w - 2, top - 1, topc || mix(c, '#FFFFFF', 0.16));
  f(x + 1, y + top, w - 2, h - top - 1, c);
  f(x + 1, y + top, w - 2, 1, mix(c, '#FFFFFF', 0.32));
  f(x + 1, y + h - 2, w - 2, 1, mix(c, '#000000', 0.28));
}
function icon(f, name, cx, cy, col) {
  const g = ICONS[name]; if (!g) return;
  const x0 = Math.round(cx - g[0].length / 2), y0 = Math.round(cy - g.length / 2);
  g.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch !== '.') f(x0 + i, y0 + j, 1, 1, ch === 'w' ? col : ICON_PAL[ch]); } });
}
function iconSvg(name, scale = 4) {
  const g = ICONS[name], w = g[0].length, h = g.length; let r = '';
  g.forEach((row, j) => { let i = 0; while (i < row.length) { if (row[i] === '.') { i++; continue; } const s = i; while (i < row.length && row[i] === row[s]) i++; r += `<rect x="${s}" y="${j}" width="${i - s}" height="1" fill="currentColor"/>`; } });
  return `<svg class="px" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${r}</svg>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ================================================================ the world
   Maps: '#' edge (solid), 'W' back wall face (solid), '.' floor, lowercase letter = doorway (walk
   into it), ' ' nothing. Back walls are 3 tiles tall (rows 0-2); floors start on row 3.
   Things: fp = footprint [col, row, wide, deep] in tiles (solid, art stands on its bottom edge);
   wall = [x, y] in px for things hung on the back wall; floor:true = flat things you stand on.
   use: 'go:<screen>' opens a game screen, 'act:<action>' runs a game action, 'win:<class>' shows a
   dashboard window, 'fn:<name>' runs a scene below, 'say' reads the lines in say. */
const ROOMS = {
  office: {
    name: "Manager's Office", theme: 'office',
    map: [
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '########aa##########',
    ],
    doors: { a: { to: 'hall', at: [5, 3], face: 'down', label: 'HALL' } },
    spawn: [10, 7, 'up'],
    things: [
      { id: 'window', wall: [136, 6], size: [48, 32], glass: [3, 3, 42, 26], use: 'fn:window' },
      { id: 'calendar', wall: [216, 8], size: [32, 32], label: 'SCHEDULE', use: 'go:games' },
      { id: 'clock', wall: [264, 8], size: [16, 16], label: 'SIM', use: 'fn:clock' },
      { id: 'computer', fp: [2, 3, 2, 1], size: [32, 32], label: 'LEADERS', use: 'go:leaders' },
      { id: 'cabinet', fp: [4, 3, 1, 1], size: [16, 32], label: 'GAME LOG', use: 'go:gamelog' },
      { id: 'chair', fp: [9, 4, 2, 1], size: [32, 32], use: 'say', say: ['Your chair. It squeaks in a way that sounds like booing.'] },
      { id: 'desk', fp: [8, 5, 4, 2], size: [64, 48], label: 'DESK', use: 'go:standings' },
      { id: 'tv', fp: [2, 8, 2, 1], size: [32, 32], glass: [4, 4, 24, 14], label: 'TONIGHT', use: 'fn:tv' },
      { id: 'armchair', fp: [14, 8, 2, 1], size: [32, 32], use: 'say', say: ['Comfortable. Dangerously comfortable.'] },
      { id: 'newspaper', fp: [16, 8, 1, 1], size: [16, 24], label: 'HEADLINES', use: 'go:news' },
      { id: 'plant', fp: [18, 10, 1, 1], size: [16, 32], use: 'say', say: ['A ficus. It has seen some things.'] },
    ],
  },
  hall: {
    name: 'Hallway', theme: 'hall',
    map: [
      '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW#',
      '#WWWooWWWWWWWWccWWWWWWWbbWWWWWW#',
      '#WWWooWWWWWWWWccWWWWWWWbbWWWWWW#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '########pp#########dd###########',
    ],
    doors: {
      o: { to: 'office', at: [9, 10], face: 'up', label: 'OFFICE' },
      c: { to: 'clubhouse', at: [9, 10], face: 'up', label: 'CLUBHOUSE' },
      b: { to: 'cages', at: [9, 10], face: 'up', label: 'CAGES' },
      p: { to: 'bullpen', at: [10, 3], face: 'down', label: 'BULLPEN' },
      d: { to: 'dugout', at: [5, 3], face: 'down', label: 'DUGOUT' },
    },
    spawn: [16, 5, 'down'],
    things: [
      { id: 'bulletin', wall: [112, 8], size: [48, 32], label: 'MISSIONS', use: 'say', say: ['Nothing is pinned up yet.', 'Side missions will go here.'] },
      { id: 'cooler', fp: [11, 3, 1, 1], size: [16, 32], use: 'say', say: ['Glug. You feel hydrated and slightly judged.'] },
      { id: 'trophies', fp: [17, 3, 3, 1], size: [48, 40], label: 'TROPHIES', use: 'say', say: ['The trophy case is empty.', 'Win something and the Gods might fill it.'] },
      { id: 'gods_door', wall: [440, 0], size: [48, 48], label: '???', use: 'fn:gods' },
    ],
    npcs: [{ id: 'sal', name: 'Sal', sheet: 'npc_sal', at: [25.5, 5], face: 'down', use: 'fn:sal' }],
  },
  clubhouse: {
    name: 'Clubhouse', theme: 'clubhouse',
    map: [
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '########aa##########',
    ],
    doors: { a: { to: 'hall', at: [15, 3], face: 'down', label: 'HALL' } },
    spawn: [9, 10, 'up'],
    things: [
      { id: 'lockers', fp: [1, 3, 8, 1], size: [128, 40], label: 'ROSTER', use: 'go:roster' },
      { id: 'whiteboard', wall: [184, 6], size: [48, 32], label: 'LINEUP', use: 'win:w-tonight' },
      { id: 'mirror', wall: [264, 6], size: [16, 32], label: 'YOUR TEAM', use: 'win:w-yours' },
      { id: 'bench', fp: [6, 6, 6, 1], size: [96, 24], use: 'say', say: ['Somebody left one sock on the bench. Just the one.'] },
      { id: 'couch', fp: [2, 9, 4, 1], size: [64, 32], use: 'say', say: ['You sit for a second. Nothing happens. It is great.'] },
      { id: 'jukebox', fp: [17, 9, 2, 1], size: [32, 40], label: 'MUSIC', use: 'act:settings' },
    ],
  },
  cages: {
    name: 'Batting Cages', theme: 'cages',
    map: [
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWWWWWWWWWWW#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '########aa##########',
    ],
    doors: { a: { to: 'hall', at: [24, 3], face: 'down', label: 'HALL' } },
    spawn: [9, 10, 'up'],
    things: [
      { id: 'cage_fences', fp: [2, 3, 6, 3], size: [96, 80], label: 'SWING FOR THE FENCES', use: 'fn:cage', game: 'Swing for the Fences' },
      { id: 'cage_shorten', fp: [11, 3, 6, 3], size: [96, 80], label: 'SHORTEN UP', use: 'fn:cage', game: 'Shorten Up' },
      { id: 'tee', fp: [14, 8, 1, 1], size: [16, 24], label: 'DRAW THE WALK', use: 'say', say: ['Draw the Walk is not built yet.', 'You will stand off the plate and dodge everything they throw.'] },
      { id: 'bat_rack', fp: [2, 9, 2, 1], size: [32, 32], use: 'say', say: ['Thirty-four ounces of ash. Also one bat somebody named Gary.'] },
    ],
  },
  bullpen: {
    name: 'Bullpen', theme: 'bullpen',
    map: [
      '#WWWWWWWWWWWWWWWWWW#',
      '#WWWWWWWWaaWWWWWWWW#',
      '#WWWWWWWWaaWWWWWWWW#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ],
    doors: { a: { to: 'hall', at: [9, 7], face: 'up', label: 'HALL' } },
    spawn: [10, 4, 'down'],
    things: [
      { id: 'mound_a', art: 'obj_mound', fp: [3, 6, 3, 2], floor: true, size: [48, 32], label: 'PITCHING', use: 'fn:mound' },
      { id: 'mound_b', art: 'obj_mound', fp: [13, 6, 3, 2], floor: true, size: [48, 32], label: 'PITCHING', use: 'fn:mound' },
      { id: 'pen_phone', wall: [272, 14], size: [16, 24], label: 'BULLPEN', use: 'win:w-tonight' },
      { id: 'pen_bench', fp: [6, 10, 8, 1], size: [128, 24], use: 'say', say: ['The relievers’ bench. Still warm.'] },
    ],
  },
  dugout: {
    name: 'Dugout', theme: 'dugout',
    map: [
      '#WWWWWWWWWWWWWWWWWWWWWW#',
      '#WWWaaWWWWWWWWWWWWWWWWW#',
      '#WWWaaWWWWWWWWWWWWWWWWW#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '########################',
    ],
    doors: { a: { to: 'hall', at: [20, 7], face: 'up', label: 'HALL' } },
    spawn: [5, 4, 'down'],
    things: [
      { id: 'dugout_bench', fp: [7, 3, 10, 1], size: [160, 24], use: 'say', say: ['Pine. Splinters included at no extra charge.'] },
      { id: 'lineup_card', wall: [272, 12], size: [16, 24], label: 'LINEUP', use: 'win:w-tonight' },
      { id: 'bat_rack_2', art: 'obj_bat_rack', fp: [18, 3, 2, 1], size: [32, 32], use: 'say', say: ['More bats. None of them are Gary.'] },
      { id: 'jug', fp: [21, 3, 1, 1], size: [16, 24], use: 'say', say: ['It is the orange flavor. It is always the orange flavor.'] },
      { id: 'steps', fp: [11, 9, 2, 1], size: [32, 16], sides: 'up', label: 'TAKE THE FIELD', use: 'fn:steps' },
    ],
  },
};
const START_ROOM = 'office';

// Derived geometry, computed once.
for (const [id, room] of Object.entries(ROOMS)) {
  room.id = id;
  room.cols = room.map[0].length; room.rows = room.map.length;
  room.map.forEach((row, r) => { if (row.length !== room.cols) console.warn(`[clubhouse] ${id} row ${r} is ${row.length} wide, expected ${room.cols}`); });
  room.npcs = room.npcs || [];
  room.floorTop = (() => { for (let r = 0; r < room.rows; r++) if (room.map[r].includes('.')) return r * T; return 3 * T; })();
  for (const t of room.things) {
    t.room = id; t.slot = t.art || 'obj_' + t.id;
    const [w, h] = t.size;
    if (t.wall) t.rect = { x: t.wall[0], y: t.wall[1], w, h };
    else if (t.floor) { const [c, r, fw, fh] = t.fp; t.rect = { x: c * T + (fw * T - w) / 2, y: r * T + (fh * T - h) / 2, w, h }; }
    else { const [c, r, fw, fh] = t.fp; t.rect = { x: Math.round(c * T + (fw * T - w) / 2), y: (r + fh) * T - h, w, h }; }
    t.solid = !!t.fp && !t.floor;
    t.base = t.wall ? -2 : t.floor ? -1 : (t.fp[1] + t.fp[3]) * T;
    // where using it works from: wall things from the floor row under them; others a few px around the footprint
    if (t.wall) t.zone = { x: t.rect.x - 2, y: room.floorTop - 8, w: t.rect.w + 4, h: 14 };
    else if (t.floor) { const [c, r, fw, fh] = t.fp; t.zone = { x: c * T, y: r * T, w: fw * T, h: fh * T }; }
    else { const [c, r, fw, fh] = t.fp; t.zone = { x: c * T - 4, y: r * T - 4, w: fw * T + 8, h: fh * T + 8 }; }
  }
  for (const n of room.npcs) { n.room = id; n.kind = 'npc'; }
}

/* ================================================================ art slots and loading */
const SLOTS = new Map();
SLOTS.set('player', { id: 'player', kind: 'sheet', w: 64, h: 128, title: 'You (walk sheet)' });
for (const room of Object.values(ROOMS)) {
  SLOTS.set('room_' + room.id, { id: 'room_' + room.id, kind: 'room', w: room.cols * T, h: room.rows * T, title: room.name + ' (background)', room: room.id });
  for (const t of room.things) if (!SLOTS.has(t.slot)) SLOTS.set(t.slot, { id: t.slot, kind: t.wall ? 'wall' : t.floor ? 'flat' : 'object', w: t.size[0], h: t.size[1], title: t.label || t.id.replace(/_/g, ' '), room: room.id, thing: t });
  for (const n of room.npcs) if (!SLOTS.has(n.sheet)) SLOTS.set(n.sheet, { id: n.sheet, kind: 'sheet', w: 64, h: 128, title: n.name + ' (walk sheet)', room: room.id });
}
// every slot also goes in the game's art registry (src/ui/art.ts), which builds the art kit
const REG = window.__bgArt || null;
if (REG) for (const s of SLOTS.values()) REG.slot({ id: s.id, w: s.w, h: s.h, label: s.title, group: 'clubhouse', place: s.room ? ROOMS[s.room].name : undefined, kind: s.kind, draw: () => standIn(s.id) });

const ART = {
  published: new Map(),   // slot -> image (art/ folder)
  local: new Map(),       // slot -> image (test art in this browser)
  notes: new Map(),       // slot -> size note for the panel
  stand: new Map(),       // slot -> canvas (code-drawn)
  cooked: new Map(),      // slot -> canvas (recolored for the current team)
  team: '',
  version: 0,
  source(slot) { return this.local.get(slot) || this.published.get(slot) || null; },
  origin(slot) { return this.local.has(slot) ? 'testing' : this.published.has(slot) ? 'published' : 'stand-in'; },
};
function teamColors() {
  let line = '', action = '';
  try { const st = document.documentElement.style; line = st.getPropertyValue('--line').trim(); action = st.getPropertyValue('--action').trim(); } catch { /* defaults */ }
  if (!/^#[0-9a-f]{6}$/i.test(line)) line = SPEC.teamKeys.main;
  if (!/^#[0-9a-f]{6}$/i.test(action)) action = SPEC.teamKeys.accent;
  return { main: line, shade: halve(line), accent: action, accentShade: halve(action) };
}
function recolor(src, team) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const c = cv(w, h), x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const keys = SPEC.teamKeys;
  if (team.main.toLowerCase() === keys.main.toLowerCase() && team.accent.toLowerCase() === keys.accent.toLowerCase()) return c;
  const map = new Map();
  for (const k of Object.keys(keys)) { const [r, g, b] = hex2(keys[k]); map.set((r << 16) | (g << 8) | b, hex2(team[k])); }
  try {
    const d = x.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      if (!a[i + 3]) continue;
      const m = map.get((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
      if (m) { a[i] = m[0]; a[i + 1] = m[1]; a[i + 2] = m[2]; }
    }
    x.putImageData(d, 0, 0);
  } catch { /* a tainted image keeps its own colors */ }
  return c;
}
// Sheets: if the right-facing row is empty, mirror the left-facing row into it.
function fixSheet(c) {
  const fw = Math.floor(c.width / SPEC.sheet.cols), fh = Math.floor(c.height / SPEC.sheet.rows);
  const x = c.getContext('2d');
  let empty = true;
  try {
    const d = x.getImageData(0, 2 * fh, c.width, fh).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { empty = false; break; }
  } catch { empty = false; }
  if (!empty) return c;
  for (let i = 0; i < SPEC.sheet.cols; i++) {
    x.save(); x.translate((i + 1) * fw, 2 * fh); x.scale(-1, 1);
    x.drawImage(c, i * fw, 1 * fh, fw, fh, 0, 0, fw, fh);
    x.restore();
  }
  return c;
}
function art(slot) {
  const team = teamColors(), tk = team.main + team.accent;
  if (tk !== ART.team) { ART.team = tk; ART.cooked.clear(); }
  let c = ART.cooked.get(slot);
  if (c) return c;
  const src = ART.source(slot) || standIn(slot);
  if (!src) return null;
  c = recolor(src, team);
  if (SLOTS.get(slot)?.kind === 'sheet') c = fixSheet(c);
  ART.cooked.set(slot, c);
  return c;
}
function artChanged(slot) { if (slot) ART.cooked.delete(slot); else ART.cooked.clear(); ART.version++; }
function sizeNote(slot, img) {
  const s = SLOTS.get(slot), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!s) return '';
  if (s.kind === 'sheet') {
    if (w % SPEC.sheet.cols || h % SPEC.sheet.rows) return `${w}×${h}: needs 4 equal columns and 4 equal rows`;
    if (w !== s.w || h !== s.h) return `${w}×${h}: frames are ${w / 4}×${h / 4}, spec is 16×32`;
    return '';
  }
  return w === s.w && h === s.h ? '' : `${w}×${h}, spec is ${s.w}×${s.h}`;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = url; });
}
async function loadPublished() {
  try {
    const r = await fetch('art/manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    const files = m && typeof m === 'object' ? (m.files || m) : {};
    await Promise.all(Object.entries(files).map(async ([slot, file]) => {
      if (!SLOTS.has(slot) || typeof file !== 'string') return;
      try { const img = await loadImage('art/' + file); ART.published.set(slot, img); artChanged(slot); } catch { /* skip a missing file */ }
    }));
    roomBgDirty = true;
  } catch { /* no published art yet */ }
}
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res) => {
      try {
        const r = indexedDB.open('baseball-gods-clubhouse', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('art');
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => res(null);
      } catch { res(null); }
    });
  },
  async run(mode, fn) {
    const db = await this.open(); if (!db) return null;
    return new Promise((res) => {
      try { const tx = db.transaction('art', mode), st = tx.objectStore('art'); const q = fn(st); tx.oncomplete = () => res(q ? q.result : true); tx.onerror = () => res(null); } catch { res(null); }
    });
  },
  put(k, v) { return this.run('readwrite', (s) => { s.put(v, k); }); },
  clear() { return this.run('readwrite', (s) => { s.clear(); }); },
  async all() {
    const db = await this.open(); if (!db) return [];
    return new Promise((res) => {
      try {
        const out = [], tx = db.transaction('art', 'readonly'), q = tx.objectStore('art').openCursor();
        q.onsuccess = () => { const c = q.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
        tx.oncomplete = () => res(out); tx.onerror = () => res(out);
      } catch { res([]); }
    });
  },
};
async function loadLocal() {
  const rows = await IDB.all();
  for (const [slot, val] of rows) {
    const blob = val instanceof Blob ? val : val && val.buf instanceof ArrayBuffer ? new Blob([val.buf], { type: val.type || 'image/png' }) : null;
    if (!SLOTS.has(slot) || !blob) continue;
    try { const img = await loadImage(URL.createObjectURL(blob)); ART.local.set(slot, img); ART.notes.set(slot, sizeNote(slot, img)); artChanged(slot); } catch { /* skip */ }
  }
  roomBgDirty = true;
}
async function addTestFiles(files) {
  const done = [], unknown = [], wrong = [];
  for (const file of files) {
    const name = file.name.toLowerCase().replace(/\.(png|gif|webp)$/, '');
    if (!SLOTS.has(name)) { unknown.push(file.name); continue; }
    try {
      const img = await loadImage(URL.createObjectURL(file));
      ART.local.set(name, img);
      const note = sizeNote(name, img); ART.notes.set(name, note); if (note) wrong.push(`${file.name} (${note})`);
      artChanged(name); done.push(name);
      file.arrayBuffer().then((buf) => IDB.put(name, { type: file.type || 'image/png', buf })).catch(() => {});
    } catch { unknown.push(file.name); }
  }
  roomBgDirty = true;
  const msg = [];
  if (done.length) msg.push(`Loaded ${done.length} file${done.length > 1 ? 's' : ''}: ${done.join(', ')}.`);
  if (wrong.length) msg.push(`Off-size: ${wrong.join('; ')}.`);
  if (unknown.length) msg.push(`No slot named ${unknown.join(', ')}. Rename to a name in the list.`);
  return msg.join(' ') || 'Nothing loaded.';
}
async function clearTestArt() {
  ART.local.clear(); ART.notes.clear(); artChanged(); roomBgDirty = true; await IDB.clear();
}

/* ================================================================ stand-in art (code-drawn) */
const FIG = {
  // front view (facing down). m main, s shade, a accent, A accent shade, k skin, K skin shade,
  // h hair, e eye, p pants, P pants shade, b shoes. Outlines are added afterwards.
  down0: ['................', '................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmaammm....', '...aaaaaaaaaa...', '....hkkkkkkh....', '....kkekkekk....', '....kkkkkkkk....', '.....KkkkkK.....',
    '......KKKK......', '...smmmaammms...', '..smmmmaammmms..', '..smmmmsmmmmms..', '..smmmmsmmmmms..', '..smmmmsmmmmms..', '..kmmmmsmmmmmk..', '...ssssssssss...',
    '....pppppppp....', '....pppPPppp....', '....ppp..ppp....', '....ppp..ppp....', '....ppP..Ppp....', '....ppP..Ppp....', '....bbb..bbb....', '...bbbb..bbbb...', '................'],
  down1: ['................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmaammm....', '...aaaaaaaaaa...', '....hkkkkkkh....', '....kkekkekk....', '....kkkkkkkk....', '.....KkkkkK.....',
    '......KKKK......', '...smmmaammms...', '..smmmmaammmms..', '..smmmmsmmmmms..', '..smmmmsmmmmms..', '..smmmmsmmmmms..', '..kmmmmsmmmmmk..', '...ssssssssss...',
    '....pppppppp....', '....pppPPppp....', '....ppp..ppp....', '....ppp..ppp....', '....ppP..Ppp....', '....ppP..bbb....', '....ppP.bbbb....', '....bbb.........', '...bbbb.........', '................'],
  up0: ['................', '................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmmmmmm....', '....mmmaammm....', '....hhhhhhhh....', '....hhhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....',
    '......KKKK......', '...smmmmmmmms...', '..smmmaaaammms..', '..smmmaAAammms..', '..smmmaaaammms..', '..smmmmmmmmmms..', '..kmmmmmmmmmmk..', '...ssssssssss...',
    '....pppppppp....', '....pppPPppp....', '....ppp..ppp....', '....ppp..ppp....', '....ppP..Ppp....', '....ppP..Ppp....', '....bbb..bbb....', '...bbbb..bbbb...', '................'],
  up1: ['................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmmmmmm....', '....mmmaammm....', '....hhhhhhhh....', '....hhhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....',
    '......KKKK......', '...smmmmmmmms...', '..smmmaaaammms..', '..smmmaAAammms..', '..smmmaaaammms..', '..smmmmmmmmmms..', '..kmmmmmmmmmmk..', '...ssssssssss...',
    '....pppppppp....', '....pppPPppp....', '....ppp..ppp....', '....ppp..ppp....', '....ppP..Ppp....', '....ppP..bbb....', '....ppP.bbbb....', '....bbb.........', '...bbbb.........', '................'],
  left0: ['................', '................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmmmmmm....', '.aaaammmmmmm....', '....kkkkkhhh....', '....kekkkhhh....', '....kkkkkkhh....', '.....kkkkKh.....',
    '......KKKK......', '.....smmmms.....', '.....mmmmmm.....', '.....mmsmmm.....', '.....mmsmmm.....', '.....mmsmmm.....', '.....mmkmmm.....', '.....ssssss.....',
    '.....pppppp.....', '.....pppppp.....', '.....ppPPpp.....', '.....ppPPpp.....', '.....ppPPpp.....', '.....ppPPpp.....', '.....bbbbbb.....', '....bbbbbbb.....', '................'],
  left1: ['................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmmmmmm....', '.aaaammmmmmm....', '....kkkkkhhh....', '....kekkkhhh....', '....kkkkkkhh....', '.....kkkkKh.....',
    '......KKKK......', '.....smmmms.....', '.....mmmmmm.....', '.....mmmsmm.....', '.....mmmsmm.....', '.....mmmmsm.....', '.....mmmmkm.....', '.....ssssss.....',
    '.....pppppp.....', '....pppppppp....', '...pppp..PPPP...', '...ppp....PPP...', '..ppp......PPP..', '..ppp......PPP..', '..ppp......PPP..', '.bbbb.....bbbb..', '.bbbb.....bbbb..', '................'],
  left3: ['................', '................', '................', '................', '................', '................',
    '.....mmmmmm.....', '....mmmmmmmm....', '....mmmmmmmm....', '.aaaammmmmmm....', '....kkkkkhhh....', '....kekkkhhh....', '....kkkkkkhh....', '.....kkkkKh.....',
    '......KKKK......', '.....smmmms.....', '.....mmmmmm.....', '.....msmmmm.....', '.....msmmmm.....', '....smmmmmm.....', '....kmmmmmm.....', '.....ssssss.....',
    '.....pppppp.....', '....pppppppp....', '...PPPP..pppp...', '...PPP....ppp...', '..PPP......ppp..', '..PPP......ppp..', '..PPP......ppp..', '.bbbb.....bbbb..', '.bbbb.....bbbb..', '................'],
};
const PAL_PLAYER = { m: C.main, s: C.shade, a: C.accent, A: C.accentShade, k: '#E8B48A', K: '#C08660', h: '#3A2A1E', e: '#1A1F2E', p: '#E6E9F0', P: '#AEB5C6', b: '#1A1F2E' };
const PAL_SAL = { m: '#4E7A5E', s: '#33503D', a: '#E8E2CF', A: '#B9B29A', k: '#D9A27A', K: '#B07F5A', h: '#B9BCC6', e: '#1A1F2E', p: '#6B5444', P: '#4E3D31', b: '#2A2018' };
function paintGrid(f, grid, pal, ox, oy, flip) {
  grid.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch !== '.') f(ox + (flip ? row.length - 1 - i : i), oy + j, 1, 1, pal[ch]); } });
}
function outline(c, color = C.out) {
  const x = c.getContext('2d'), w = c.width, h = c.height, d = x.getImageData(0, 0, w, h), a = d.data, o = new Uint8ClampedArray(a);
  const [r, g, b] = hex2(color);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const k = (y * w + i) * 4; if (a[k + 3]) continue;
    const n = (dx, dy) => { const xx = i + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && a[((yy * w) + xx) * 4 + 3] > 0; };
    if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) { o[k] = r; o[k + 1] = g; o[k + 2] = b; o[k + 3] = 255; }
  }
  d.data.set(o); x.putImageData(d, 0, 0);
}
function figureSheet(pal) {
  const { frameW: fw, frameH: fh, cols } = SPEC.sheet, c = cv(fw * cols, fh * 4), f = pen(c.getContext('2d'));
  const rows = [['down0', 'down1', 'down0', 'down1!'], ['left0', 'left1', 'left0', 'left3'], ['left0!', 'left1!', 'left0!', 'left3!'], ['up0', 'up1', 'up0', 'up1!']];
  rows.forEach((row, r) => row.forEach((key, i) => {
    const flip = key.endsWith('!'), g = FIG[key.replace('!', '')];
    paintGrid(f, g, pal, i * fw, r * fh, flip);
  }));
  // outline frame by frame so neighbours never bleed
  const out = cv(c.width, c.height), ox = out.getContext('2d');
  for (let r = 0; r < 4; r++) for (let i = 0; i < cols; i++) {
    const one = cv(fw, fh); one.getContext('2d').drawImage(c, i * fw, r * fh, fw, fh, 0, 0, fw, fh); outline(one);
    ox.drawImage(one, i * fw, r * fh);
  }
  return out;
}

const FLOORS = {
  office: { wall: '#4A3B5C', trim: '#2E2540', base: '#2E2540', floorA: '#7A5236', floorB: '#714B31', seam: '#5A3C27', wains: C.woodD },
  hall: { wall: '#3B4356', trim: '#262C3B', base: '#262C3B', floorA: '#5A6072', floorB: '#555B6C', seam: '#474C5C', stripe: C.accent },
  clubhouse: { wall: C.shade, trim: '#0E1730', base: '#0E1730', floorA: '#2A3046', floorB: '#272D42', seam: '#22283B', stripe: C.main },
  cages: { wall: '#26303D', trim: '#161D27', base: '#161D27', floorA: '#3E8A4A', floorB: '#398243', seam: '#2F6E3A', net: '#3B4A5C' },
  bullpen: { wall: '#1F4C3A', trim: '#F2C14E', base: '#163828', floorA: '#62B04F', floorB: '#58A747', seam: '#4F9C42' },
  dugout: { wall: '#4A4F5E', trim: '#2E3240', base: '#2E3240', floorA: '#3C404C', floorB: '#393D48', seam: '#30333E', rail: '#8C93A3' },
};
const isDoor = (ch) => ch >= 'a' && ch <= 'z';
function roomStandIn(room) {
  const w = room.cols * T, h = room.rows * T, c = cv(w, h), f = pen(c.getContext('2d')), th = FLOORS[room.theme] || FLOORS.hall;
  const at = (col, row) => (row < 0 || col < 0 || row >= room.rows || col >= room.cols) ? ' ' : room.map[row][col];
  for (let r = 0; r < room.rows; r++) for (let col = 0; col < room.cols; col++) {
    const ch = at(col, r), x = col * T, y = r * T;
    if (ch === ' ') continue;
    if (ch === '#') {
      f(x, y, T, T, C.out);
      if (at(col, r - 1) === '.' || isDoor(at(col, r - 1))) f(x, y, T, 2, '#2A3350');
      if (at(col + 1, r) === '.') f(x + T - 2, y, 2, T, '#1D2438');
      if (at(col - 1, r) === '.') f(x, y, 2, T, '#1D2438');
      if (room.theme === 'dugout' && r === room.rows - 1) { f(x, y + 2, T, 2, th.rail); f(x, y + 4, T, 1, '#5B6170'); if (col % 3 === 0) f(x + 6, y + 4, 2, 10, '#5B6170'); }
      continue;
    }
    if (ch === 'W' || (isDoor(ch) && r < 3)) {
      const top = r === 0 || at(col, r - 1) === '#', last = at(col, r + 1) === '.' || (isDoor(at(col, r + 1)) && r + 1 >= 3);
      if (isDoor(ch)) {
        f(x, y, T, T, '#0A0D18');
        if (!isDoor(at(col, r - 1))) { f(x, y, T, 4, '#05070D'); f(x, y, T, 2, C.metalL); }
        if (!isDoor(at(col - 1, r))) f(x, y, 2, T, C.metalL);
        if (!isDoor(at(col + 1, r))) f(x + T - 2, y, 2, T, C.metalL);
        continue;
      }
      f(x, y, T, T, th.wall);
      if (room.theme === 'cages') for (let j = 0; j < T; j += 2) for (let i = (j / 2) % 2; i < T; i += 4) f(x + i, y + j, 1, 1, th.net);
      if (room.theme === 'clubhouse' && r === 1) { f(x, y + 4, T, 3, th.stripe); }
      if (room.theme === 'hall' && r === 1) { f(x, y + 6, T, 2, th.stripe); }
      if (room.theme === 'bullpen') { if (col % 4 === 0) f(x, y, 1, T, '#1A4232'); }
      if (top) { f(x, y, T, 4, th.trim); f(x, y + 4, T, 1, mix(th.wall, '#FFFFFF', 0.18)); if (room.theme === 'bullpen') f(x, y, T, 3, '#F2C14E'); }
      if (last) {
        if (room.theme === 'office') { f(x, y + 2, T, 14, th.wains); f(x, y + 2, T, 2, C.woodL); if (col % 2 === 0) f(x + 7, y + 5, 1, 9, '#4C301F'); }
        f(x, y + 12, T, 4, th.base); f(x, y + 12, T, 1, mix(th.base, '#FFFFFF', 0.2));
      }
      continue;
    }
    // floor and the doorways cut into edges
    const k = hash(col, r, 7), alt = room.theme === 'cages' ? ((col >> 1) & 1) : room.theme === 'bullpen' ? (r & 1) : ((col + r) & 1);
    f(x, y, T, T, alt ? th.floorB : th.floorA);
    if (room.theme === 'office') { f(x, y + 7, T, 1, th.seam); f(x, y + 15, T, 1, th.seam); f(x + ((r * 5 + col * 3) % 12) + 2, y, 1, 7, th.seam); f(x + ((r * 7 + col * 5) % 12) + 2, y + 8, 1, 7, th.seam); }
    else if (room.theme === 'hall' || room.theme === 'dugout') { f(x, y, T, 1, th.seam); f(x, y, 1, T, th.seam); if (k % 5 === 0) f(x + (k % 13) + 1, y + ((k >> 4) % 13) + 1, 1, 1, th.seam); }
    else { for (let n = 0; n < 3; n++) { const q = hash(col, r, n); f(x + (q % 15), y + ((q >> 5) % 15), 1, 1, th.seam); } }
    if (isDoor(ch)) { f(x, y, T, T, mix(alt ? th.floorB : th.floorA, '#000000', 0.25)); f(x, y + 10, T, 6, mix(alt ? th.floorB : th.floorA, '#000000', 0.5)); }
    if (isDoor(at(col, r - 1)) && r >= 3) f(x + 1, y + 1, 14, 5, mix(th.floorA, '#000000', 0.35));
  }
  return c;
}

function thingStandIn(t) {
  const [w, h] = t.size, c = cv(w, h), f = pen(c.getContext('2d')), kit = t.kit || t.slot.replace(/^obj_/, '');
  const clear = (x, y, ww, hh) => c.getContext('2d').clearRect(x, y, ww, hh);
  switch (kit) {
    case 'window': {
      f(0, 0, 48, 32, C.out); f(1, 1, 46, 30, C.woodD); f(2, 2, 44, 28, C.wood); clear(3, 3, 42, 26);
      f(23, 3, 2, 26, C.wood); f(3, 15, 42, 1, C.wood); f(0, 28, 48, 4, C.out); f(1, 28, 46, 2, C.woodL); break;
    }
    case 'calendar': {
      f(15, 0, 2, 3, C.metalD); f(2, 3, 28, 29, C.out); f(3, 4, 26, 27, C.paper); f(3, 4, 26, 7, C.accent); f(6, 6, 20, 2, C.white);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) f(5 + i * 4, 13 + j * 4, 3, 3, C.paperD);
      f(12, 16, 5, 5, C.accent); f(13, 17, 3, 3, C.paper); f(3, 29, 26, 1, C.paperD); break;
    }
    case 'clock': {
      disc(f, 0, 0, 16, 16, C.out); disc(f, 1, 1, 14, 14, C.goldD); disc(f, 2, 2, 12, 12, C.white);
      f(7, 3, 2, 6, C.ink); f(8, 7, 4, 2, C.ink); f(7, 7, 2, 2, C.accent); break;
    }
    case 'computer': {
      block(f, 0, 14, 32, 18, 6, C.wood);
      f(6, 0, 20, 15, C.out); f(7, 1, 18, 12, C.metalD); f(8, 2, 16, 9, C.screen);
      [[10, 8, 3], [13, 6, 5], [16, 4, 7], [19, 7, 4]].forEach(([x, y, hh]) => f(x, y, 2, hh, C.gold));
      f(13, 13, 6, 2, C.metalD); f(7, 15, 18, 5, C.out); f(8, 16, 16, 3, C.metalL); f(9, 17, 14, 1, C.metal); break;
    }
    case 'cabinet': {
      block(f, 0, 0, 16, 32, 4, C.metal);
      [12, 21].forEach((y) => f(2, y, 12, 1, C.metalD));
      [7, 16, 25].forEach((y) => { f(5, y, 6, 2, C.metalD); f(5, y, 6, 1, C.metalL); });
      f(5, 5, 6, 1, C.paper); break;
    }
    case 'chair': {
      f(6, 0, 20, 22, C.out); f(7, 1, 18, 20, '#3A2E3A'); f(8, 2, 16, 2, '#54445A'); f(15, 4, 2, 15, '#2E2430');
      f(2, 14, 6, 9, C.out); f(3, 15, 4, 7, '#2E2430'); f(24, 14, 6, 9, C.out); f(25, 15, 4, 7, '#2E2430');
      f(5, 19, 22, 7, C.out); f(6, 20, 20, 5, '#463848'); f(14, 26, 4, 4, C.metalD); f(8, 29, 16, 3, C.out); f(9, 30, 3, 1, C.metal); f(20, 30, 3, 1, C.metal); break;
    }
    case 'desk': {
      block(f, 0, 8, 64, 40, 18, C.wood);
      f(3, 29, 18, 16, C.woodD); f(4, 30, 16, 6, C.wood); f(4, 37, 16, 7, C.wood); f(10, 32, 4, 1, C.gold); f(10, 40, 4, 1, C.gold);
      f(43, 29, 18, 16, C.woodD); f(44, 30, 16, 6, C.wood); f(44, 37, 16, 7, C.wood); f(50, 32, 4, 1, C.gold); f(50, 40, 4, 1, C.gold);
      f(26, 30, 12, 4, C.out); f(27, 31, 10, 2, C.gold);
      f(7, 12, 13, 9, C.out); f(8, 13, 11, 7, C.paper); f(9, 15, 8, 1, C.paperInk); f(9, 17, 6, 1, C.paperInk);
      f(29, 13, 5, 6, C.out); f(30, 14, 3, 4, C.white);
      icon(f, 'pennant', 50, 6, C.white); f(45, 11, 9, 3, C.out); f(46, 12, 7, 1, C.woodD); break;
    }
    case 'tv': {
      block(f, 0, 20, 32, 12, 4, C.woodD);
      f(2, 2, 28, 20, C.out); f(3, 3, 26, 18, '#1A1F2E'); clear(4, 4, 24, 14); f(26, 19, 1, 1, '#6BE08A'); f(5, 19, 6, 1, '#2A3046'); break;
    }
    case 'armchair': {
      f(3, 2, 26, 17, C.out); f(4, 3, 24, 15, C.fabric); f(5, 4, 22, 2, C.fabricL);
      f(0, 12, 8, 18, C.out); f(1, 13, 6, 16, C.fabricL); f(24, 12, 8, 18, C.out); f(25, 13, 6, 16, C.fabricL);
      f(7, 16, 18, 11, C.out); f(8, 17, 16, 9, C.fabric); f(9, 18, 14, 2, C.fabricL);
      f(3, 29, 3, 3, C.woodD); f(26, 29, 3, 3, C.woodD); break;
    }
    case 'newspaper': {
      f(1, 10, 14, 6, C.out); f(2, 11, 12, 4, C.woodL); f(2, 14, 12, 1, C.woodD); f(6, 16, 4, 6, C.out); f(7, 16, 2, 6, C.woodD);
      f(3, 21, 10, 3, C.out); f(4, 22, 8, 1, C.woodD);
      f(3, 5, 10, 8, C.out); f(4, 6, 8, 6, C.paper); f(5, 7, 6, 1, C.paperInk); f(5, 9, 3, 2, C.paperD); f(9, 9, 2, 1, C.paperInk); f(9, 11, 2, 1, C.paperInk); break;
    }
    case 'plant': {
      disc(f, 0, 2, 16, 22, C.out); disc(f, 1, 3, 14, 20, C.leaf); disc(f, 3, 5, 6, 9, C.leafL); disc(f, 8, 10, 5, 7, C.leafL);
      f(7, 20, 2, 4, C.woodD); f(3, 22, 10, 10, C.out); f(4, 23, 8, 8, C.pot); f(3, 22, 10, 2, C.out); f(4, 23, 8, 1, mix(C.pot, '#FFFFFF', 0.3)); break;
    }
    case 'bulletin': {
      f(0, 0, 48, 32, C.out); f(1, 1, 46, 30, C.woodD); f(3, 3, 42, 26, '#B08A5A');
      for (let n = 0; n < 40; n++) { const q = hash(n, 3, 9); f(4 + (q % 40), 4 + ((q >> 6) % 24), 1, 1, '#94703F'); }
      f(30, 10, 2, 2, C.accent); f(31, 12, 1, 1, C.metalD); break;
    }
    case 'cooler': {
      f(3, 0, 10, 12, C.out); f(4, 1, 8, 10, C.sky); f(5, 2, 2, 7, C.skyL); f(6, 11, 4, 2, '#4BA3D9');
      block(f, 1, 13, 14, 19, 3, C.white, '#D5DAE4'); f(4, 19, 3, 2, C.accent); f(9, 19, 3, 2, '#4BA3D9'); f(3, 24, 10, 2, C.metalD); break;
    }
    case 'trophies': {
      block(f, 0, 6, 48, 34, 6, C.woodD); f(3, 12, 42, 23, '#2A3350');
      f(3, 23, 42, 1, C.woodL); for (let i = 0; i < 4; i++) f(8 + i * 10, 14 + i, 1, 6, '#4C6A8A');
      f(18, 36, 12, 2, C.gold); break;
    }
    case 'gods_door': {
      disc(f, 2, 0, 44, 18, C.out); disc(f, 3, 1, 42, 16, C.goldD); disc(f, 6, 3, 36, 14, '#3A2A1E');
      f(2, 8, 44, 40, C.out); f(3, 9, 42, 39, C.goldD); f(6, 9, 36, 39, '#3A2A1E'); f(23, 6, 2, 42, '#22180F');
      for (let y = 12; y < 46; y += 8) { f(9, y, 11, 1, '#4C3828'); f(28, y, 11, 1, '#4C3828'); }
      icon(f, 'temple', 24, 13, C.gold); disc(f, 19, 27, 10, 10, C.out); disc(f, 20, 28, 8, 8, C.phone); f(23, 31, 2, 2, C.gold); break;
    }
    case 'lockers': {
      for (let i = 0; i < 8; i++) {
        const x = i * 16; block(f, x, 0, 16, 40, 4, C.main);
        [9, 11, 13].forEach((y) => f(x + 4, y, 8, 1, C.shade)); f(x + 11, 21, 2, 6, C.metalL); f(x + 5, 5, 6, 2, C.paper);
      }
      break;
    }
    case 'whiteboard': {
      f(0, 0, 48, 30, C.out); f(1, 1, 46, 28, C.metalL); f(2, 2, 44, 26, C.white);
      for (let k = 0; k < 5; k++) { f(5, 5 + k * 4, 2, 2, C.main); f(9, 6 + k * 4, 10 + ((k * 7) % 9), 1, '#2A3350'); }
      f(30, 9, 10, 1, C.accent); f(36, 7, 1, 5, C.accent); f(28, 17, 3, 3, C.accent); f(36, 21, 3, 3, C.accent);
      f(4, 28, 40, 4, C.out); f(5, 29, 38, 2, C.metalD); f(10, 28, 5, 1, C.accent); break;
    }
    case 'mirror': {
      f(0, 0, 16, 32, C.out); f(1, 1, 14, 30, C.woodL); f(3, 3, 10, 26, '#9FC4DA'); f(5, 6, 1, 9, C.skyL); f(7, 4, 1, 5, C.skyL); f(9, 20, 1, 6, '#C4DCEA'); break;
    }
    case 'bench': case 'pen_bench': case 'dugout_bench': {
      const wood = kit === 'dugout_bench' ? C.wood : C.woodL;
      block(f, 0, 6, w, 10, 5, wood);
      for (let x = 4; x < w - 4; x += 40) { f(x, 16, 4, 8, C.out); f(x + 1, 16, 2, 7, C.woodD); }
      f(w - 8, 16, 4, 8, C.out); f(w - 7, 16, 2, 7, C.woodD);
      if (kit === 'bench') { f(70, 4, 6, 4, C.out); f(71, 5, 4, 2, C.white); f(74, 6, 3, 2, C.white); }
      break;
    }
    case 'couch': {
      f(0, 0, 64, 18, C.out); f(1, 1, 62, 16, C.accentShade); f(2, 2, 60, 2, mix(C.accentShade, '#FFFFFF', 0.2));
      f(4, 14, 56, 13, C.out); f(5, 15, 54, 11, C.accent); f(23, 15, 1, 11, C.accentShade); f(41, 15, 1, 11, C.accentShade);
      f(0, 10, 8, 20, C.out); f(1, 11, 6, 18, C.accent); f(56, 10, 8, 20, C.out); f(57, 11, 6, 18, C.accent);
      f(3, 29, 3, 3, C.woodD); f(58, 29, 3, 3, C.woodD); break;
    }
    case 'jukebox': {
      disc(f, 2, 0, 28, 20, C.out); disc(f, 3, 1, 26, 18, '#8A5FC0');
      f(2, 10, 28, 30, C.out); f(3, 11, 26, 28, '#6B3FA0'); f(7, 10, 18, 10, C.out); f(8, 11, 16, 8, C.gold); f(10, 13, 12, 1, C.goldD); f(10, 16, 12, 1, C.goldD);
      f(7, 23, 18, 12, '#2A1E3A'); for (let x = 9; x < 24; x += 3) f(x, 24, 1, 10, '#4A3A5A');
      f(4, 12, 2, 24, C.gold); f(26, 12, 2, 24, C.gold); f(3, 37, 26, 2, '#4A2A70'); break;
    }
    case 'cage_fences': case 'cage_shorten': {
      f(3, 20, 90, 58, '#2F6B3A'); for (let n = 0; n < 50; n++) { const q = hash(n, 1, kit.length); f(4 + (q % 88), 21 + ((q >> 7) % 56), 1, 1, '#2A5F34'); }
      f(3, 4, 90, 26, '#1A2430'); for (let y = 5; y < 30; y += 2) for (let x = 4 + (y % 4 === 1 ? 0 : 2); x < 92; x += 4) f(x, y, 1, 1, '#3B4A5C');
      f(1, 2, 3, 78, C.metalD); f(92, 2, 3, 78, C.metalD); f(1, 2, 94, 3, C.metalD); f(1, 2, 94, 1, C.metalL);
      for (let y = 6; y < 78; y += 3) { f(4, y, 2, 1, '#55657A'); f(90, y, 2, 1, '#55657A'); }
      if (kit === 'cage_fences') { f(42, 28, 12, 9, C.out); f(43, 29, 10, 7, C.metal); disc(f, 44, 24, 8, 8, C.metalD); f(47, 27, 2, 2, C.out); }
      else { [[30, 46], [62, 46], [46, 34], [46, 58]].forEach(([x, y]) => { disc(f, x, y, 5, 5, C.out); disc(f, x + 1, y + 1, 3, 3, C.white); }); }
      f(44, 66, 9, 4, C.white); f(45, 70, 7, 1, C.white); f(46, 71, 5, 1, C.white); f(47, 72, 3, 1, C.white);
      f(30, 0, 36, 9, C.out); f(31, 1, 34, 7, kit === 'cage_fences' ? C.gold : '#6BE08A');
      icon(f, kit === 'cage_fences' ? 'bat' : 'ball', 48, 5, C.out); break;
    }
    case 'tee': {
      f(3, 20, 10, 4, C.out); f(4, 21, 8, 2, '#2A2F3E'); f(7, 9, 2, 11, C.out); f(7, 10, 2, 9, '#2A2F3E');
      disc(f, 3, 1, 10, 10, C.out); disc(f, 4, 2, 8, 8, C.white); f(6, 4, 1, 4, C.accent); f(9, 4, 1, 4, C.accent); break;
    }
    case 'bat_rack': {
      block(f, 0, 14, 32, 18, 4, C.woodD);
      for (let i = 0; i < 4; i++) { const x = 4 + i * 7; f(x, 0, 4, 24, C.out); f(x + 1, 1, 2, 21, C.woodL); f(x + 1, 1, 1, 21, '#C08A5E'); f(x, 22, 4, 2, C.out); }
      break;
    }
    case 'mound': {
      disc(f, 0, 0, 48, 32, C.dirtD); disc(f, 2, 1, 44, 28, C.dirt); disc(f, 10, 5, 28, 14, C.dirtL);
      f(20, 10, 8, 2, C.white); f(20, 12, 8, 1, '#8A8F9C'); break;
    }
    case 'pen_phone': {
      f(1, 0, 14, 24, C.out); f(2, 1, 12, 22, C.phone); f(3, 2, 10, 1, '#D2404C');
      f(4, 4, 8, 3, '#1A1F2E'); f(4, 4, 2, 7, '#1A1F2E'); f(10, 4, 2, 7, '#1A1F2E'); disc(f, 5, 13, 6, 6, C.white); f(7, 15, 2, 2, C.ink); break;
    }
    case 'lineup_card': {
      f(5, 0, 6, 3, '#E8E2CF'); f(1, 2, 14, 22, C.out); f(2, 3, 12, 20, C.white);
      for (let k = 0; k < 9; k++) f(4, 5 + k * 2, 3 + ((k * 5) % 6), 1, k % 3 === 0 ? C.main : C.ink); break;
    }
    case 'jug': {
      f(0, 2, 16, 6, C.out); f(1, 3, 14, 4, C.white); f(1, 6, 14, 18, C.out); f(2, 7, 12, 16, '#E8742A');
      f(2, 12, 12, 2, '#F2C14E'); f(6, 18, 4, 3, C.white); f(3, 8, 2, 12, '#F09A55'); break;
    }
    case 'steps': {
      f(0, 0, 32, 16, C.out); f(2, 0, 28, 5, '#8C93A3'); f(2, 5, 28, 5, '#6E7891'); f(2, 10, 28, 6, '#4A5268');
      f(2, 4, 28, 1, '#5B6170'); f(2, 9, 28, 1, '#3E4556'); break;
    }
    default: { block(f, 0, Math.max(0, h - 24), w, Math.min(24, h), 6, C.metal); }
  }
  return c;
}
function standIn(slot) {
  let c = ART.stand.get(slot);
  if (c) return c;
  const s = SLOTS.get(slot);
  if (!s) return null;
  if (slot === 'player') c = figureSheet(PAL_PLAYER);
  else if (slot === 'npc_sal') c = figureSheet(PAL_SAL);
  else if (s.kind === 'sheet') c = figureSheet(PAL_SAL);
  else if (s.kind === 'room') c = roomStandIn(ROOMS[s.room]);
  else c = thingStandIn(s.thing);
  ART.stand.set(slot, c);
  return c;
}

/* ================================================================ the game (window.__bg) */
let app = null;
const game = () => (app && app.game) || null;
function gameAct(name, data = {}) { try { const r = app.act(name, data); if (r && r.catch) r.catch((e) => console.warn('[clubhouse]', e)); } catch (e) { console.warn('[clubhouse]', e); } }
function dash(sel) { return document.querySelector('#app .screen-home ' + sel); }
const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
function todayGame() { const g = game(); if (!g || g.over) return null; try { return g.gameOn(g.day, g.userTeam) || null; } catch { return null; } }
function bannerDate() { const s = txt(dash('.banner-sub')); const m = s.match(/[A-Z]{3} [A-Z]{3} \d{1,2}/); return m ? m[0] : s || 'today'; }
/** Decision cards waiting on the desk (step 2.8): the desk opens them instead of the standings. */
function cardsWaiting() { const g = game(); return !!(g && g.cards && g.cards.desk && g.cards.desk.length); }
function headlinesNew() { const g = game(); if (!g) return false; return (g.headlines?.length || 0) > (S.seen[g.seed] ?? 0); }
function markHeadlinesSeen() { const g = game(); if (!g) return; const n = g.headlines?.length || 0; if (S.seen[g.seed] !== n) { S.seen[g.seed] = n; save(true); } }

/* ================================================================ state */
const S = {
  on: true, room: START_ROOM, labels: true, grid: false, hintDone: false, seen: {},
  p: { x: 0, y: 0, dir: 'up', moving: false, run: false, t: 0, frame: 0 },
  cam: { x: 0, y: 0, snap: true },
  keys: new Set(), path: null, steer: null, press: null,
  target: null, hover: null, say: null, panel: null, fade: null,
  input: (() => { try { return matchMedia('(pointer: coarse)').matches ? 'pointer' : 'keys'; } catch { return 'keys'; } })(), broken: false, salLine: 0, note: '', noteUntil: 0,
};
function placeAt(roomId, tx, ty, face) { S.room = roomId; S.p.x = tx * T; S.p.y = ty * T + 12; S.p.dir = face || 'down'; S.cam.snap = true; roomBgDirty = true; }
function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { d = null; }
  const room = ROOMS[START_ROOM];
  placeAt(START_ROOM, room.spawn[0], room.spawn[1], room.spawn[2]);
  if (!d || typeof d !== 'object') return;
  S.on = d.on !== false; S.labels = d.labels !== false; S.grid = !!d.grid; S.hintDone = !!d.hintDone;
  if (d.seen && typeof d.seen === 'object') S.seen = d.seen;
  if (ROOMS[d.room] && Number.isFinite(d.x) && Number.isFinite(d.y)) {
    S.room = d.room; S.p.x = d.x; S.p.y = d.y; S.p.dir = SPEC.facings.includes(d.dir) ? d.dir : 'down';
    if (blocked(S.p.x, S.p.y, true)) { const r = ROOMS[S.room]; placeAt(S.room, r.spawn[0], r.spawn[1], r.spawn[2]); }
  }
}
let saveTimer = 0;
function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ on: S.on, room: S.room, x: Math.round(S.p.x), y: Math.round(S.p.y), dir: S.p.dir, labels: S.labels, grid: S.grid, hintDone: S.hintDone, seen: S.seen })); } catch { /* private window */ }
  };
  if (now) write(); else saveTimer = setTimeout(write, 250);
}

/* ================================================================ collision and paths */
const room = () => ROOMS[S.room];
function tileAt(c, r) { const rm = room(); return (r < 0 || c < 0 || r >= rm.rows || c >= rm.cols) ? ' ' : rm.map[r][c]; }
function tileSolid(c, r) { const ch = tileAt(c, r); return !(ch === '.' || isDoor(ch)); }
function npcBox(n) { const x = n.at[0] * T, y = n.at[1] * T + 12; return { x: x - SPEC.hit.w / 2, y: y - SPEC.hit.h, w: SPEC.hit.w, h: SPEC.hit.h }; }
function blocked(x, y, doorsSolid = false) {
  const hw = SPEC.hit.w / 2, x0 = x - hw, x1 = x + hw, y0 = y - SPEC.hit.h, y1 = y;
  for (let r = Math.floor(y0 / T); r <= Math.floor((y1 - 0.001) / T); r++) for (let c = Math.floor(x0 / T); c <= Math.floor((x1 - 0.001) / T); c++) {
    if (tileSolid(c, r)) return true;
    if (doorsSolid && isDoor(tileAt(c, r))) return true;
  }
  for (const t of room().things) {
    if (!t.solid) continue;
    const [c, r, fw, fh] = t.fp;
    if (x1 > c * T && x0 < (c + fw) * T && y1 > r * T && y0 < (r + fh) * T) return true;
  }
  for (const n of room().npcs) { const b = npcBox(n); if (x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h) return true; }
  return false;
}
function canStand(c, r, doorOk) {
  const ch = tileAt(c, r);
  if (!(ch === '.' || (doorOk && isDoor(ch)))) return false;
  return !blocked(c * T + 8, r * T + 12, !doorOk);
}
function findPath(goals, doorOk) {
  const rm = room(), start = [Math.floor(S.p.x / T), Math.floor((S.p.y - 3) / T)], W = rm.cols, H = rm.rows;
  const key = (c, r) => r * W + c, goalSet = new Set(goals.map(([c, r]) => key(c, r)));
  if (goalSet.has(key(start[0], start[1]))) return [start];
  const dist = new Float64Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  dist[key(start[0], start[1])] = 0;
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  for (;;) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
    if (best < 0) return null;
    done[best] = 1;
    if (goalSet.has(best)) {
      const out = []; for (let k = best; k >= 0; k = prev[k]) out.push([k % W, Math.floor(k / W)]);
      return out.reverse();
    }
    const c = best % W, r = Math.floor(best / W);
    for (const [dc, dr, cost] of steps) {
      const nc = c + dc, nr = r + dr, nk = key(nc, nr);
      if (nc < 0 || nr < 0 || nc >= W || nr >= H || done[nk]) continue;
      const isGoal = goalSet.has(nk);
      if (!canStand(nc, nr, doorOk && isGoal)) continue;
      if (dc && dr && (!canStand(c + dc, r, false) || !canStand(c, r + dr, false))) continue;
      const nd = bd + cost;
      if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = best; }
    }
  }
}
function clearLine(x0, y0, x1, y1, doorOk) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
  for (let i = 1; i <= n; i++) { const t = i / n; if (blocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, !doorOk)) return false; }
  return true;
}
function spotsFor(t) {
  const rm = room(), out = [];
  if (t.kind === 'npc') { const c = Math.floor(t.at[0]), r = t.at[1]; for (const [dc, dr, face] of [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']]) out.push([c + dc, r + dr, face]); return out; }
  if (t.wall) {
    for (let c = Math.floor(t.rect.x / T); c <= Math.floor((t.rect.x + t.rect.w - 1) / T); c++) {
      for (let r = 0; r < rm.rows; r++) if (tileAt(c, r) === '.') { out.push([c, r, 'up']); break; }
    }
    return out;
  }
  const [c0, r0, fw, fh] = t.fp;
  if (t.floor) { for (let r = r0; r < r0 + fh; r++) for (let c = c0; c < c0 + fw; c++) out.push([c, r, 'down']); return out; }
  const sides = t.sides || 'any';
  if (sides === 'any' || sides.includes('up')) for (let c = c0; c < c0 + fw; c++) out.push([c, r0 + fh, 'up']);
  if (sides === 'any' || sides.includes('down')) for (let c = c0; c < c0 + fw; c++) out.push([c, r0 - 1, 'down']);
  if (sides === 'any' || sides.includes('left')) for (let r = r0; r < r0 + fh; r++) out.push([c0 + fw, r, 'left']);
  if (sides === 'any' || sides.includes('right')) for (let r = r0; r < r0 + fh; r++) out.push([c0 - 1, r, 'right']);
  if (sides === 'up') { out.length = 0; for (let c = c0; c < c0 + fw; c++) out.push([c, r0 - 1, 'down']); }
  return out;
}

/* ================================================================ movement */
function moveBy(dx, dy) {
  let moved = false;
  const stepAxis = (d, axis) => {
    let left = Math.abs(d); const s = Math.sign(d);
    while (left > 0) {
      const k = Math.min(1, left); left -= k;
      const nx = axis === 'x' ? S.p.x + s * k : S.p.x, ny = axis === 'y' ? S.p.y + s * k : S.p.y;
      if (!blocked(nx, ny)) { S.p.x = nx; S.p.y = ny; moved = true; continue; }
      // close the last sliver so you end up touching what stopped you
      for (let f = k / 2; f > 0.02; f /= 2) {
        const fx = axis === 'x' ? S.p.x + s * f : S.p.x, fy = axis === 'y' ? S.p.y + s * f : S.p.y;
        if (!blocked(fx, fy)) { S.p.x = fx; S.p.y = fy; moved = true; }
      }
      if (axis === 'x') S.p.x = Math.round(S.p.x * 8) / 8; else S.p.y = Math.round(S.p.y * 8) / 8;
      if (blocked(S.p.x, S.p.y)) { if (axis === 'x') S.p.x -= s / 8; else S.p.y -= s / 8; }
      // corner help: slide around a near miss so 2-tile doors and gaps are easy to hit
      let slid = false;
      for (let n = 1; n <= 6 && !slid; n++) for (const sg of [1, -1]) {
        const ox = axis === 'y' ? sg * n : 0, oy = axis === 'x' ? sg * n : 0;
        if (!blocked(nx + ox, ny + oy) && !blocked(S.p.x + ox, S.p.y + oy)) {
          if (axis === 'x' && !dy) { S.p.y += sg * Math.min(1, k); slid = moved = true; break; }
          if (axis === 'y' && !dx) { S.p.x += sg * Math.min(1, k); slid = moved = true; break; }
        }
      }
      break;
    }
  };
  if (dx) stepAxis(dx, 'x');
  if (dy) stepAxis(dy, 'y');
  return moved;
}
function faceFrom(dx, dy) { if (Math.abs(dx) > Math.abs(dy) + 0.01) return dx < 0 ? 'left' : 'right'; if (dy) return dy < 0 ? 'up' : 'down'; return S.p.dir; }
const FACE_V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function probe() { const [fx, fy] = FACE_V[S.p.dir]; return [S.p.x + fx * 9, S.p.y - 3 + fy * 9]; }
const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
function findTarget() {
  const [px, py] = probe(), rm = room();
  for (const n of rm.npcs) { const b = npcBox(n); if (inRect(px, py, { x: b.x - 6, y: b.y - 8, w: b.w + 12, h: b.h + 14 })) return n; }
  let best = null;
  for (const t of rm.things) {
    if (inRect(px, py, t.zone) || (t.floor && inRect(S.p.x, S.p.y - 3, t.zone))) { if (!best || (t.floor ? 0 : 1) > (best.floor ? 0 : 1)) best = t; }
  }
  return best;
}
function startPath(goals, then, doorOk) {
  const pts = findPath(goals.map((g) => [g[0], g[1]]), doorOk);
  if (!pts) { note('You can’t get there from here.'); return false; }
  const end = pts[pts.length - 1], goal = goals.find((g) => g[0] === end[0] && g[1] === end[1]);
  S.path = { pts: pts.map(([c, r]) => [c * T + 8, r * T + 12]), i: 0, then, face: goal && goal[2], doorOk, stuck: 0 };
  if (S.path.pts.length > 1) S.path.i = 1;
  return true;
}
function stopPath() { S.path = null; }

function update(dt) {
  const p = S.p;
  if (S.fade) { stepFade(dt); p.moving = false; return; }
  if (S.say) stepSay(dt);
  const blockedInput = !!(S.say || S.panel || (app && (app.modal || app.busy)));
  let dx = 0, dy = 0, speed = 0, viaPath = false;
  if (!blockedInput) {
    const k = S.keys;
    const kx = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0), ky = (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0);
    if (kx || ky) { stopPath(); S.steer = null; const l = Math.hypot(kx, ky); dx = kx / l; dy = ky / l; p.run = k.has('run'); speed = p.run ? SPEC.speed.run : SPEC.speed.walk; }
    else if (S.steer) {
      const vx = S.steer.x - p.x, vy = S.steer.y - (p.y - 6), l = Math.hypot(vx, vy);
      if (l > 4) { dx = vx / l; dy = vy / l; speed = l > 48 ? SPEC.speed.run : SPEC.speed.walk; p.run = l > 48; }
    } else if (S.path) {
      const pa = S.path;
      while (pa.i < pa.pts.length - 1 && clearLine(p.x, p.y, pa.pts[pa.i + 1][0], pa.pts[pa.i + 1][1], pa.doorOk && pa.i + 1 === pa.pts.length - 1)) pa.i++;
      const [tx, ty] = pa.pts[pa.i], vx = tx - p.x, vy = ty - p.y, l = Math.hypot(vx, vy);
      if (l < 1.2) {
        if (pa.i >= pa.pts.length - 1) { p.x = tx; p.y = ty; const then = pa.then, face = pa.face; stopPath(); if (face) p.dir = face; if (then) then(); }
        else pa.i++;
      } else { dx = vx / l; dy = vy / l; speed = SPEC.speed.path; viaPath = true; p.run = false; }
    }
  }
  p.moving = false;
  if (speed) {
    const step = Math.min(speed * dt, viaPath && S.path ? Math.hypot(S.path.pts[S.path.i][0] - p.x, S.path.pts[S.path.i][1] - p.y) : Infinity);
    const bx = p.x, by = p.y;
    moveBy(dx * step, dy * step);
    p.dir = faceFrom(dx, dy);
    const went = Math.hypot(p.x - bx, p.y - by);
    p.moving = went > 0.05;
    if (viaPath && S.path) { S.path.stuck = went < 0.05 ? S.path.stuck + dt : 0; if (S.path.stuck > 0.3) stopPath(); }
    if (p.moving && !S.hintDone) { S.hintDone = true; save(); }
    if (p.moving) save();
  }
  // walk cycle: 1-2-3-4 while moving; standing shows column 1
  if (p.moving) { p.t += dt * (p.run ? SPEC.runFps : SPEC.walkFps); p.frame = Math.floor(p.t) % 4; } else { p.t = 0; p.frame = 0; }
  // doorways
  const c = Math.floor(p.x / T), r = Math.floor((p.y - 3) / T), ch = tileAt(c, r);
  if (isDoor(ch) && room().doors[ch]) { const d = room().doors[ch]; stopPath(); S.steer = null; startFade(() => placeAt(d.to, d.at[0], d.at[1], d.face)); return; }
  S.target = blockedInput ? null : findTarget();
}

/* ================================================================ fades between rooms */
function startFade(swap) { S.keys.clear(); if (REDUCED) { swap(); S.p.moving = false; onRoomChange(); return; } S.fade = { t: 0, dur: 0.16, out: true, swap }; }
function stepFade(dt) {
  const f = S.fade; f.t += dt;
  if (f.out && f.t >= f.dur) { f.swap(); onRoomChange(); f.out = false; f.t = 0; f.dur = 0.2; }
  else if (!f.out && f.t >= f.dur) S.fade = null;
}
function fadeAlpha() { const f = S.fade; if (!f) return 0; return f.out ? clamp(f.t / f.dur, 0, 1) : clamp(1 - f.t / f.dur, 0, 1); }
function onRoomChange() { save(); buildTags(); updateHud(); S.target = null; }

/* ================================================================ drawing */
let buf = null, bctx = null, roomBg = null, roomBgDirty = true, zoom = 3, dpr = 1, viewW = 0, viewH = 0, lastDraw = 0, needDraw = true, hudPad = 0, hudCss = 0;
function skyColors() {
  let s = '';
  try { s = getComputedStyle(document.body).getPropertyValue('--sky').trim().toUpperCase(); } catch { /* default */ }
  if (s === '#4C8BD4') return { bands: ['#4C8BD4', '#79B4E9', '#B9DCF4'], hill: '#5F8C6C', temple: '#F3EAD2', stars: 0, when: 'day' };
  if (s === '#221B49') return { bands: ['#221B49', '#6E3060', '#E27B4B'], hill: '#3A3256', temple: '#FFE2B0', stars: 2, when: 'dusk' };
  return { bands: ['#050A1C', '#0B1430', '#17224A'], hill: '#141A33', temple: '#FFE2B0', stars: 6, when: 'night' };
}
function drawSky(f, x, y, w, h) {
  const s = skyColors();
  const b = Math.ceil(h / 3);
  s.bands.forEach((col, i) => f(x, y + i * b, w, Math.min(b, h - i * b), col));
  for (let i = 0; i < s.stars; i++) { const q = hash(i, 4, 4); f(x + 2 + (q % (w - 4)), y + 1 + ((q >> 5) % Math.max(1, b)), 1, 1, '#FFFFFF'); }
  disc(f, x - 6, y + h - 9, w * 0.7, 18, s.hill); disc(f, x + w * 0.45, y + h - 6, w * 0.7, 14, mix(s.hill, '#000000', 0.2));
  const tx = x + Math.round(w * 0.22), ty = y + h - 13;
  f(tx + 2, ty, 3, 1, s.temple); f(tx, ty + 1, 7, 1, s.temple); f(tx, ty + 2, 1, 3, s.temple); f(tx + 3, ty + 2, 1, 3, s.temple); f(tx + 6, ty + 2, 1, 3, s.temple); f(tx, ty + 5, 7, 1, s.temple);
  if (s.when === 'night') f(tx - 1, ty - 1, 9, 1, 'rgba(255,226,176,0.25)');
}
function drawTvScreen(f, x, y, w, h, now) {
  const g = game();
  if (todayGame()) {
    f(x, y, w, h, '#4F9C42'); f(x, y, w, 3, '#1B2130'); f(x + 2, y + 1, 4, 1, C.main); f(x + w - 6, y + 1, 4, 1, C.accent);
    const cx = x + w / 2, cy = y + h - 4;
    for (let i = 0; i < 6; i++) { f(cx - i, cy - 6 + i, 1, 1, '#C98B57'); f(cx + i, cy - 6 + i, 1, 1, '#C98B57'); }
    f(cx, cy, 1, 1, C.white); f(cx, cy - 3 - (Math.floor(now / 300) % 3), 1, 1, C.white);
  } else if (g && g.over) { f(x, y, w, h, '#0A0E1A'); }
  else {
    f(x, y, w, h, '#141A33'); const seed = Math.floor(now / 110);
    for (let n = 0; n < 40; n++) { const q = hash(n, seed, 2); f(x + (q % w), y + ((q >> 8) % h), 1, 1, q & 1 ? '#3A4468' : '#5A6488'); }
  }
}
function drawThing(t, now) {
  const im = art(t.slot); if (!im) return;
  const r = t.rect, w = im.width, h = im.height;
  let x, y;
  if (t.wall) { x = r.x + Math.round((r.w - w) / 2); y = r.y + (r.h - h); }
  else if (t.floor) { x = Math.round(r.x + (r.w - w) / 2); y = Math.round(r.y + (r.h - h) / 2); }
  else { x = Math.round(r.x + (r.w - w) / 2); y = r.y + r.h - h; }
  if (t.glass) {
    // the picture behind the glass: art leaves the glass transparent and the game paints this in
    const f = pen(bctx), [gx, gy, gw, gh] = t.glass;
    bctx.save(); bctx.beginPath(); bctx.rect(x + gx, y + gy, gw, gh); bctx.clip();
    if (t.id === 'window') drawSky(f, x + gx, y + gy, gw, gh); else drawTvScreen(f, x + gx, y + gy, gw, gh, now);
    bctx.restore();
  }
  bctx.drawImage(im, x, y);
}
function drawChar(sheetSlot, x, y, dir, frame) {
  const sh = art(sheetSlot); if (!sh) return;
  const fw = sh.width / SPEC.sheet.cols, fh = sh.height / SPEC.sheet.rows, row = SPEC.facings.indexOf(dir);
  const px = Math.round(x), py = Math.round(y);
  bctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  bctx.fillRect(px - 4, py - 2, 8, 1); bctx.fillRect(px - 5, py - 1, 10, 1); bctx.fillRect(px - 4, py, 8, 1);
  bctx.drawImage(sh, frame * fw, row * fh, fw, fh, Math.round(px - fw / 2), py - fh, fw, fh);
}
function drawMarker(cx, top, now) {
  const f = pen(bctx), bob = REDUCED ? 0 : (Math.floor(now / 260) % 2), x = Math.round(cx) - 4, y = top - 13 - bob;
  f(x, y, 9, 9, C.out); f(x + 1, y + 1, 7, 7, C.white); f(x + 3, y + 2, 3, 3, C.accent); f(x + 4, y + 5, 1, 1, C.accent); f(x + 4, y + 6, 1, 1, C.white); f(x + 3, y + 7, 3, 1, C.white);
  f(x + 4, y + 9, 2, 1, C.out); f(x + 4, y + 10, 1, 1, C.out); f(x + 4, y + 6, 1, 1, C.accent);
}
function markerOn(t) {
  if (t.id === 'newspaper') return headlinesNew();
  if (t.id === 'desk') return cardsWaiting();
  if (t.id === 'tv' || t.id === 'steps') return !!todayGame();
  return false;
}
function draw(now) {
  if (!buf || !ctx) return;
  const rm = room();
  if (roomBgDirty || !roomBg) { roomBg = art('room_' + rm.id); roomBgDirty = false; }
  // camera: keep you centered, clamp to the room, center rooms smaller than the view
  const vw = buf.width, vh = buf.height, rw = rm.cols * T, rh = rm.rows * T;
  const want = (len, room_, at) => room_ <= len ? Math.round((room_ - len) / 2) : clamp(Math.round(at - len / 2), 0, room_ - len);
  // the top bar owns a band at the top of the view; the room is framed below it
  const tx = want(vw, rw, S.p.x), ty = want(vh - hudPad, rh, S.p.y - 16) - hudPad;
  if (S.cam.snap) { S.cam.x = tx; S.cam.y = ty; S.cam.snap = false; }
  else { const k = 1 - Math.exp(-(now - (draw.last || now)) / 1000 * 10); S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k; if (Math.abs(tx - S.cam.x) < 0.5) S.cam.x = tx; if (Math.abs(ty - S.cam.y) < 0.5) S.cam.y = ty; }
  draw.last = now;
  const cx = Math.round(S.cam.x), cy = Math.round(S.cam.y);
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.fillStyle = VOID; bctx.fillRect(0, 0, vw, vh);
  bctx.setTransform(1, 0, 0, 1, -cx, -cy);
  if (roomBg) bctx.drawImage(roomBg, 0, 0);
  for (const t of rm.things) if (t.floor) drawThing(t, now);
  for (const t of rm.things) if (t.wall) drawThing(t, now);
  const list = [];
  for (const t of rm.things) if (!t.wall && !t.floor) list.push([t.base, 0, () => drawThing(t, now)]);
  for (const n of rm.npcs) list.push([n.at[1] * T + 12, 1, () => drawChar(n.sheet, n.at[0] * T, n.at[1] * T + 12, n.dir || n.face, 0)]);
  list.push([S.p.y, 1, () => drawChar('player', S.p.x, S.p.y, S.p.dir, S.p.frame)]);
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach((d) => d[2]());
  for (const t of rm.things) if (markerShown(t)) drawMarker(t.rect.x + t.rect.w / 2, t.rect.y, now);
  const fa = fadeAlpha();
  if (fa > 0) { bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.fillStyle = `rgba(5, 10, 28, ${fa})`; bctx.fillRect(0, 0, vw, vh); }
  // up to the screen at a whole-number zoom
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(buf, 0, 0, vw, vh, 0, 0, vw * zoom, vh * zoom);
  if (S.grid) drawGrid(cx, cy);
  view.cx = cx; view.cy = cy;
}
const view = { cx: 0, cy: 0 };
function drawGrid(cx, cy) {
  const rm = room(), z = zoom, X = (x) => Math.round((x - cx) * z) + 0.5, Y = (y) => Math.round((y - cy) * z) + 0.5;
  ctx.save(); ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  for (let c = 0; c <= rm.cols; c++) { ctx.moveTo(X(c * T), Y(0)); ctx.lineTo(X(c * T), Y(rm.rows * T)); }
  for (let r = 0; r <= rm.rows; r++) { ctx.moveTo(X(0), Y(r * T)); ctx.lineTo(X(rm.cols * T), Y(r * T)); }
  ctx.stroke();
  for (let r = 0; r < rm.rows; r++) for (let c = 0; c < rm.cols; c++) {
    const ch = tileAt(c, r);
    if (isDoor(ch)) { ctx.fillStyle = 'rgba(75,163,217,0.45)'; ctx.fillRect(X(c * T), Y(r * T), T * z, T * z); }
    else if (ch !== '.' && ch !== ' ') { ctx.fillStyle = 'rgba(224,74,59,0.22)'; ctx.fillRect(X(c * T), Y(r * T), T * z, T * z); }
  }
  for (const t of rm.things) {
    ctx.strokeStyle = 'rgba(255,210,90,0.95)'; ctx.setLineDash([4, 3]); ctx.strokeRect(X(t.rect.x), Y(t.rect.y), t.rect.w * z, t.rect.h * z);
    ctx.setLineDash([]);
    if (t.fp && !t.floor) { const [c, r, fw, fh] = t.fp; ctx.fillStyle = 'rgba(255,210,90,0.25)'; ctx.fillRect(X(c * T), Y(r * T), fw * T * z, fh * T * z); }
    ctx.strokeStyle = 'rgba(107,224,138,0.9)'; ctx.strokeRect(X(t.zone.x), Y(t.zone.y), t.zone.w * z, t.zone.h * z);
  }
  ctx.strokeStyle = '#FFFFFF'; ctx.strokeRect(X(S.p.x - SPEC.hit.w / 2), Y(S.p.y - SPEC.hit.h), SPEC.hit.w * z, SPEC.hit.h * z);
  const fr = SPEC.sheet; ctx.strokeStyle = 'rgba(143,216,247,0.9)'; ctx.strokeRect(X(Math.round(S.p.x) - fr.frameW / 2), Y(Math.round(S.p.y) - fr.frameH), fr.frameW * z, fr.frameH * z);
  ctx.restore();
}

/* ================================================================ DOM: the window, labels, talk, panels */
let elHub, elView, canvas, ctx, elLayer, elHud, elWhere, elRoom, elDate, elTools, elPop, elHint, elNote, elPrompt, elSay, elVeil, elSr, fileInput;
let tagEls = [];
function h(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
function buildDom() {
  elHub = h('section', 'hub'); elHub.setAttribute('aria-label', 'Clubhouse');
  elView = h('div', 'hub-view'); elView.tabIndex = 0; elView.setAttribute('role', 'application');
  elView.setAttribute('aria-label', 'Clubhouse. Walk with the arrow keys or WASD, press E to use things, or tap where to go.');
  canvas = h('canvas', 'hub-canvas'); ctx = canvas.getContext('2d');
  elLayer = h('div', 'hub-layer'); elLayer.setAttribute('aria-hidden', 'true');
  elPrompt = h('div', 'hub-prompt'); elPrompt.hidden = true; elLayer.appendChild(elPrompt);
  elHud = h('div', 'hub-hud');
  elWhere = h('div', 'hub-where');
  elRoom = h('h2', 'hub-room'); elDate = h('div', 'hub-date');
  elWhere.append(elRoom, elDate);
  elTools = h('div', 'hub-tools');
  elTools.innerHTML = `<button type="button" class="hub-btn hub-art-btn" data-hub="art" title="Try new art in the clubhouse">ART</button><button type="button" class="hub-btn hub-menu" data-hub="menu" aria-expanded="false" aria-haspopup="menu" title="Dashboard, screens and settings (Esc)">MENU</button><div class="hub-pop" role="menu" aria-label="Menu" hidden></div>`;
  elPop = elTools.querySelector('.hub-pop');
  elHud.append(elWhere, elTools);
  elHint = h('div', 'hub-hint'); elNote = h('div', 'hub-note'); elNote.hidden = true;
  elSay = h('div', 'hub-say'); elSay.hidden = true; elSay.setAttribute('role', 'dialog');
  elSr = h('div', 'hub-sr'); elSr.setAttribute('aria-live', 'polite');
  elVeil = h('div', 'hub-veil'); elVeil.hidden = true;
  fileInput = h('input'); fileInput.type = 'file'; fileInput.accept = 'image/png,image/gif,image/webp'; fileInput.multiple = true; fileInput.id = 'hub-art-files'; fileInput.hidden = true;
  elView.append(canvas, elLayer, elHud, elHint, elNote, elSay, elVeil, elSr, fileInput);
  elHub.appendChild(elView);

  elView.addEventListener('pointerdown', onPointerDown);
  elView.addEventListener('pointermove', onPointerMove);
  elView.addEventListener('pointerup', onPointerUp);
  elView.addEventListener('pointercancel', () => { S.steer = null; S.press = null; });
  elView.addEventListener('pointerleave', () => { if (!S.press) setHover(null); });
  elView.addEventListener('contextmenu', (e) => e.preventDefault());
  elView.addEventListener('click', onUiClick);
  elView.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); elView.classList.add('hub-drop'); } });
  elView.addEventListener('dragleave', () => elView.classList.remove('hub-drop'));
  elView.addEventListener('drop', async (e) => {
    elView.classList.remove('hub-drop');
    const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
    e.preventDefault(); const msg = await addTestFiles(files); artStatus = msg; note(msg, 5000); if (S.panel === 'art') renderArtPanel();
  });
  fileInput.addEventListener('change', async () => { const files = [...fileInput.files]; fileInput.value = ''; if (!files.length) return; artStatus = await addTestFiles(files); if (S.panel === 'art') renderArtPanel(); else note(artStatus, 5000); });
  new ResizeObserver(() => resize()).observe(elView);
}
function resize() {
  if (!elView || !elView.isConnected) return;
  const r = elView.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
  dpr = window.devicePixelRatio || 1;
  const dw = Math.floor(r.width * dpr), dh = Math.floor(r.height * dpr);
  zoom = Math.max(1, Math.floor(Math.min(dw, dh) / (SPEC.viewTiles * T)));
  viewW = dw; viewH = dh;
  canvas.width = dw; canvas.height = dh; canvas.style.width = dw / dpr + 'px'; canvas.style.height = dh / dpr + 'px';
  const bw = Math.ceil(dw / zoom), bh = Math.ceil(dh / zoom);
  if (!buf || buf.width !== bw || buf.height !== bh) { buf = cv(bw, bh); bctx = buf.getContext('2d'); bctx.imageSmoothingEnabled = false; }
  elView.classList.toggle('narrow', r.width < 560);
  hudCss = 10 + Math.max(elWhere.offsetHeight || 0, 32) + 6;
  hudPad = Math.ceil(hudCss * dpr / zoom);
  S.cam.snap = true; needDraw = true; remeasureTags();
}
const toCss = (x, y) => [(x - view.cx) * zoom / dpr, (y - view.cy) * zoom / dpr];
function buildTags() {
  if (!elLayer) return;
  tagEls.forEach((n) => n.remove()); tagEls = [];
  const rm = room();
  for (const t of rm.things) if (t.label) { const n = h('div', 'hub-tag'); n.textContent = t.label; n._for = t; elLayer.appendChild(n); tagEls.push(n); }
  for (const n of rm.npcs) { const e = h('div', 'hub-tag'); e.textContent = n.name.toUpperCase(); e._for = n; elLayer.appendChild(e); tagEls.push(e); }
  const seen = new Set();
  for (let r = 0; r < rm.rows; r++) for (let c = 0; c < rm.cols; c++) {
    const ch = rm.map[r][c]; if (!isDoor(ch) || seen.has(ch)) continue; seen.add(ch);
    let w = 0; while (rm.map[r][c + w] === ch) w++;
    let hgt = 0; while (rm.map[r + hgt] && rm.map[r + hgt][c] === ch) hgt++;
    const d = rm.doors[ch]; if (!d) continue;
    const e = h('div', 'hub-tag door'); e.textContent = d.label || d.to.toUpperCase();
    e._door = { x: (c + w / 2) * T, y: r < 3 ? r * T : r === rm.rows - 1 ? r * T + 2 : r * T, below: r === rm.rows - 1 };
    elLayer.appendChild(e); tagEls.push(e);
  }
}
const markerShown = (t) => t !== S.target && markerOn(t);
function anchorOf(t) {
  if (t.kind === 'npc') return toCss(t.at[0] * T, t.at[1] * T + 12 - 34);
  return toCss(t.rect.x + t.rect.w / 2, t.rect.y - (markerShown(t) ? 14 : 2));
}
// Signs and the prompt: the prompt takes its spot first, then signs from the bottom of the view up,
// each nudged above any sign it would cover and kept inside the view.
function placeTags() {
  const vw = elView.clientWidth, vh = elView.clientHeight, placed = [];
  const bars = hudBars();
  const tgt = (!S.say && !S.panel && !S.fade) ? S.target : null;
  const fit = (n, ax, bottom, gap) => {
    const x = clamp(ax - n._w / 2, 4, Math.max(4, vw - n._w - 4));
    let y = bottom - n._h - gap, down = false;
    const over = (p) => x < p.x + p.w + 2 && x + n._w + 2 > p.x && y < p.y + p.h + 2 && y + n._h + 2 > p.y;
    // climb above signs in the way; once pushed under the top bar, keep stepping down instead
    for (let k = 0; k < 10; k++) {
      if (y < 2) { y = 2; }
      const bar = bars.find(over);
      if (bar) { y = bar.y + bar.h + 3; down = true; continue; }
      const hit = placed.find(over);
      if (!hit) break;
      y = down ? hit.y + hit.h + 3 : hit.y - n._h - 3;
    }
    placed.push({ x, y, w: n._w, h: n._h });
    n.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  if (tgt) {
    const label = tgt.kind === 'npc' ? 'TALK' : (tgt.label || 'LOOK');
    const key = S.input === 'keys' ? '<span class="hub-key">E</span>' : '<span class="hub-key">TAP</span>';
    const html = `${key}<span>${esc(label)}</span>`;
    elPrompt.hidden = false;
    if (elPrompt._html !== html) { elPrompt.innerHTML = html; elPrompt._html = html; elPrompt._w = 0; }
    if (!elPrompt._w) { elPrompt._w = elPrompt.offsetWidth; elPrompt._h = elPrompt.offsetHeight; }
    const [ax, ay] = anchorOf(tgt);
    fit(elPrompt, ax, ay, 10);
  } else elPrompt.hidden = true;
  const items = [];
  for (const n of tagEls) {
    const t = n._for, d = n._door;
    let show = S.labels && !S.fade;
    if (t && t === S.hover && !S.fade) show = true;
    if (t && t === tgt) show = false;
    let ax = 0, ay = 0;
    if (show) {
      if (d) { [ax, ay] = toCss(d.x, d.y); if (d.below) ay += 22; }
      else [ax, ay] = anchorOf(t);
      if (ax < -24 || ax > vw + 24 || ay < -8 || ay > vh + 40) show = false;
    }
    n.hidden = !show;
    if (!show) continue;
    if (t) n.classList.toggle('hot', t === S.hover);
    if (!n._w) { n._w = n.offsetWidth; n._h = n.offsetHeight; }
    items.push({ n, ax, ay });
  }
  items.sort((a, b) => b.ay - a.ay).forEach((it) => fit(it.n, it.ax, it.ay, 4));
}
// boxes of the top bar (room name and buttons) in view coordinates; recomputed only when they change
let barsCache = null;
function hudBars() {
  if (barsCache) return barsCache;
  const vr = elView.getBoundingClientRect();
  // the room name and date, and the buttons that show; an open menu floats over the signs
  const els = [elWhere, ...elTools.querySelectorAll(':scope > .hub-btn')];
  barsCache = els.filter((n) => n && n.offsetParent).map((n) => { const r = n.getBoundingClientRect(); return { x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height }; });
  return barsCache;
}
function remeasureTags() { barsCache = null; tagEls.forEach((n) => { n._w = 0; }); if (elPrompt) elPrompt._w = 0; }
function updateHud() {
  if (!elRoom) return;
  if (elRoom.textContent !== room().name) barsCache = null;
  elRoom.textContent = room().name;
  const dl = dateLine(); if (elDate.textContent !== dl) { elDate.textContent = dl; barsCache = null; }
  const touch = matchMedia('(pointer: coarse)').matches;
  elHint.textContent = touch ? 'TAP WHERE TO GO · TAP THINGS TO USE THEM' : 'ARROWS OR WASD TO WALK · E TO USE · SHIFT TO RUN · ESC FOR THE MENU';
  elHint.hidden = S.hintDone || !!S.say;
}
// "YEAR 1 · WEEK 1 · FRI MAR 27", read off the game's banner (hidden while the clubhouse is up, but still rendered)
function dateLine() {
  const parts = txt(dash('.banner-sub')).split('·').map((s) => s.trim()).filter(Boolean).slice(0, 2);
  return [txt(dash('.banner-top')), ...parts].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- MENU */
// The dashboard first, then the screens from the game's own footer (same icons, same actions), then the
// clubhouse's switches. Screen items carry data-act, so the game's click handler opens them.
function menuOpen() { return !!(elPop && !elPop.hidden); }
function navIcon(svg) {
  if (!svg) return '<span class="ico"></span>';
  const c = svg.cloneNode(true), w = Number(c.getAttribute('width')) || 0, hh = Number(c.getAttribute('height')) || 0;
  if (w && hh) { c.setAttribute('width', String(w / 2)); c.setAttribute('height', String(hh / 2)); }
  c.setAttribute('aria-hidden', 'true');
  return `<span class="ico">${c.outerHTML}</span>`;
}
function menuShow() {
  if (!elPop) return;
  stopPath(); S.steer = null; S.keys.clear(); setHover(null);
  const item = (attrs, icon, label, val = '') => `<button type="button" class="hub-mi" role="menuitem" ${attrs}>${icon}<span>${esc(label)}</span>${val ? `<span class="val">${esc(val)}</span>` : ''}</button>`;
  const rule = '<div class="hub-mi-rule" role="separator"></div>';
  const out = [item('data-hub-toggle="1"', `<span class="ico">${iconSvg('dash', 2)}</span>`, 'DASHBOARD'), rule];
  const nav = [...document.querySelectorAll('#app .screen-home .footer .nav [data-act]')].filter((b) => b.dataset.to !== 'home');
  for (const b of nav) {
    if (b.dataset.act === 'settings') out.push(item('data-act="news"', `<span class="ico">${iconSvg('news', 2)}</span>`, 'HEADLINES'));
    const label = (b.dataset.tip || b.getAttribute('aria-label') || b.title || b.dataset.to || '').trim().toUpperCase();
    out.push(item(`data-act="${esc(b.dataset.act)}"${b.dataset.to ? ` data-to="${esc(b.dataset.to)}"` : ''}`, navIcon(b.querySelector('svg')), label));
  }
  out.push(rule);
  out.push(item('data-hub="labels"', '<span class="ico"></span>', 'SIGNS', S.labels ? 'ON' : 'OFF').replace('role="menuitem"', `role="menuitemcheckbox" aria-checked="${S.labels}"`));
  out.push(item('data-hub="art"', '<span class="ico"></span>', 'TRY NEW ART'));
  if (fsAvailable()) out.push(item('data-hub="fullscreen"', '<span class="ico"></span>', fsActive() ? 'LEAVE FULL SCREEN' : 'FULL SCREEN'));
  elPop.innerHTML = out.join('');
  elPop.hidden = false;
  const mb = elTools.querySelector('.hub-menu'); if (mb) mb.setAttribute('aria-expanded', 'true');
  const first = elPop.querySelector('.hub-mi'); if (first) first.focus({ preventScroll: true });
}
function menuClose(refocus = false) {
  if (!elPop || elPop.hidden) return;
  elPop.hidden = true;
  const mb = elTools.querySelector('.hub-menu'); if (mb) mb.setAttribute('aria-expanded', 'false');
  if (refocus) focusView();
}
function menuStep(d) {
  const its = [...elPop.querySelectorAll('.hub-mi')]; if (!its.length) return;
  const i = its.indexOf(document.activeElement);
  its[(i + d + its.length) % its.length].focus({ preventScroll: true });
}
// The browser's own full screen, for the whole game (screens opened from the clubhouse stay full screen too).
function fsAvailable() { const d = document; return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled); }
function fsActive() { const d = document; return !!(d.fullscreenElement || d.webkitFullscreenElement); }
function fsToggle() {
  const d = document, el = d.documentElement;
  try {
    const r = fsActive() ? (d.exitFullscreen || d.webkitExitFullscreen).call(d) : (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    if (r && r.catch) r.catch(() => note('Full screen is not available here.'));
  } catch { note('Full screen is not available here.'); }
}

let noteTimer = 0;
function note(msg, ms = 2600) { if (!elNote) return; elNote.textContent = msg; elNote.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(() => { elNote.hidden = true; }, ms); }

/* ---------------------------------------------------------------- talking */
function say(who, lines, choices = null, opts = {}) {
  stopPath(); S.steer = null; S.keys.clear();
  S.say = { who: who || '', lines: lines.slice(), i: 0, shown: 0, choices, sel: 0, onClose: opts.onClose || null };
  renderSay(true);
}
function closeSay() { const s = S.say; S.say = null; elSay.hidden = true; updateHud(); if (s && s.onClose) s.onClose(); focusView(); }
function stepSay(dt) {
  const s = S.say, line = s.lines[s.i] || '';
  if (s.shown < line.length) { s.shown = Math.min(line.length, s.shown + dt * (REDUCED ? 1e4 : 55)); renderSay(); }
}
function sayAdvance() {
  const s = S.say; if (!s) return;
  const line = s.lines[s.i] || '';
  if (s.shown < line.length) { s.shown = line.length; renderSay(); return; }
  if (s.i < s.lines.length - 1) { s.i++; s.shown = 0; renderSay(true); return; }
  if (s.choices && s.choices.length) { pick(s.sel); return; }
  closeSay();
}
function pick(i) {
  const s = S.say; if (!s || !s.choices) return; const ch = s.choices[i]; if (!ch) return;
  if (ch.href) return; // links are real <a> elements; the click opens them
  closeSay(); if (ch.run) ch.run();
}
function renderSay(full) {
  const s = S.say; if (!s) return;
  const line = s.lines[s.i] || '', last = s.i === s.lines.length - 1, done = s.shown >= line.length;
  if (full || !elSay._built) {
    elSr.textContent = (s.who ? s.who + ': ' : '') + line;
    elSay.innerHTML = `${s.who ? `<p class="hub-say-who">${esc(s.who)}</p>` : ''}<p class="hub-say-text"></p><div class="hub-choices" role="group" hidden></div><span class="hub-say-more" hidden></span>`;
    elSay._built = true;
  }
  elSay.querySelector('.hub-say-text').textContent = line.slice(0, Math.floor(s.shown));
  const box = elSay.querySelector('.hub-choices'), more = elSay.querySelector('.hub-say-more');
  const showChoices = last && done && s.choices && s.choices.length;
  if (showChoices && box.hidden) {
    box.innerHTML = s.choices.map((c, i) => c.href
      ? `<a class="hub-choice${i === s.sel ? ' sel' : ''}" data-choice="${i}" href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.label)}</a>`
      : `<button type="button" class="hub-choice${i === s.sel ? ' sel' : ''}" data-choice="${i}">${esc(c.label)}</button>`).join('');
    box.hidden = false;
  } else if (showChoices) box.querySelectorAll('.hub-choice').forEach((n, i) => n.classList.toggle('sel', i === s.sel));
  more.hidden = !done || !!showChoices;
  // keep the box out of your way: top of the view when you stand low
  const [, py] = toCss(S.p.x, S.p.y); const vh = elView.clientHeight || 1;
  elSay.classList.toggle('top', py > vh * 0.62);
  elSay.hidden = false; elHint.hidden = true;
}

/* ---------------------------------------------------------------- panels (dashboard windows and art) */
let artStatus = '';
let kitBusy = false;
async function downloadKit() {
  if (!REG || kitBusy) return;
  kitBusy = true; artStatus = 'Packing the art kit…'; renderArtPanel();
  try {
    const kit = await REG.buildKit();
    const n = kit.listing.waiting.length, done = kit.listing.published.length;
    const what = `${n} slot${n === 1 ? '' : 's'} waiting for art${done ? `, ${done} already in the game` : ''}`;
    const r = await REG.saveKit(kit);
    artStatus = r === 'saved' ? `Art kit saved: ${what}.` : r === 'declined' ? 'Art kit not saved.' : `Couldn't save the art kit here (${what}).`;
  } catch (e) { artStatus = "Couldn't pack the art kit."; }
  kitBusy = false;
  if (S.panel === 'art') renderArtPanel(); else note(artStatus, 5000);
}
function openPanel(kind, node) {
  stopPath(); S.steer = null; S.keys.clear(); S.panel = kind;
  elVeil.innerHTML = ''; elVeil.appendChild(node); elVeil.hidden = false;
  const btn = elVeil.querySelector('[data-hub="close"]'); if (btn) btn.focus({ preventScroll: true });
}
function closePanel() { S.panel = null; elVeil.hidden = true; elVeil.innerHTML = ''; focusView(); }
function openWindow(cls) {
  const src = dash('.' + cls);
  if (!src) { say('', ['Nothing to show here right now.']); return; }
  const clone = src.cloneNode(true);
  clone.removeAttribute('aria-labelledby');
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  clone.querySelectorAll('[data-key]').forEach((n) => n.removeAttribute('data-key'));
  const wrap = h('div', 'hub-panel');
  wrap.dataset.win = cls;
  const bar = h('div', 'hub-panel-bar', '<button type="button" class="btn btn-secondary" data-hub="close"><span>CLOSE</span></button>');
  wrap.append(clone, bar);
  openPanel('win', wrap);
}
function refreshWindow() { if (S.panel !== 'win') return; const w = elVeil.querySelector('.hub-panel'); if (w && w.dataset.win) { const cls = w.dataset.win; closePanel(); openWindow(cls); } }
function renderArtPanel() {
  const rm = room(), all = !!renderArtPanel.all;
  const slots = all ? [...SLOTS.values()] : [...SLOTS.values()].filter((s) => s.id === 'player' || s.room === rm.id);
  const kindName = { sheet: 'walk sheet', room: 'room', object: 'thing', wall: 'on the wall', flat: 'on the floor' };
  let lastRoom = '';
  const rows = slots.map((s) => {
    const o = ART.origin(s.id), n = ART.notes.get(s.id);
    const head = all && s.room && s.room !== lastRoom ? `<div class="sub">${esc(ROOMS[s.room].name.toUpperCase())}</div>` : '';
    if (s.room) lastRoom = s.room;
    const st = o === 'testing' ? (n ? `<span class="warn">TESTING · ${esc(n)}</span>` : '<span class="ok">TESTING</span>') : o === 'published' ? '<span class="ok">IN THE GAME</span>' : '<span class="muted">STAND-IN</span>';
    return `${head}<div class="n">${esc(s.id)}.png <span class="muted">${esc(kindName[s.kind] || '')}</span></div><div>${s.w}×${s.h}</div><div class="st">${st}</div>`;
  }).join('');
  const node = h('div', 'hub-panel wide');
  node.innerHTML = `<section class="win hub-art" aria-label="Try new art"><span class="studs" aria-hidden="true"></span>
<header class="win-head"><h2 class="win-title">Try new art</h2><span class="win-label">${esc(rm.name.toUpperCase())}</span></header>
<div class="win-body scroll">
<p>Drop PNG files anywhere on the clubhouse, or pick them here. Name each file after its slot below, like <b>player.png</b>. Your art shows up right away and stays in this browser only.${REG ? ' DOWNLOAD ART KIT packs every slot still waiting for art, at its exact size and file name, with labeled guides.' : ''}</p>
<div class="row"><button type="button" class="btn btn-primary" data-hub="pick"><span>PICK FILES</span></button><button type="button" class="btn btn-ghost${S.grid ? ' on' : ''}" data-hub="grid" aria-pressed="${S.grid}"><span>GRID (G)</span></button><button type="button" class="btn btn-ghost${all ? ' on' : ''}" data-hub="all" aria-pressed="${all}"><span>ALL ROOMS</span></button><button type="button" class="btn btn-secondary" data-hub="clear-art"><span>CLEAR TEST ART</span></button>${REG ? `<button type="button" class="btn btn-secondary" data-hub="kit"${kitBusy ? ' disabled' : ''}><span>${kitBusy ? 'PACKING…' : 'DOWNLOAD ART KIT'}</span></button>` : ''}</div>
<p class="hub-art-status" role="status">${esc(artStatus)}</p>
<div class="hub-slots"><div class="h">FILE</div><div class="h">SIZE</div><div class="h st">NOW</div>${rows}</div>
</div></section><div class="hub-panel-bar"><button type="button" class="btn btn-secondary" data-hub="close"><span>CLOSE</span></button></div>`;
  if (S.panel === 'art') { elVeil.innerHTML = ''; elVeil.appendChild(node); } else openPanel('art', node);
}

/* ---------------------------------------------------------------- using things */
const SCENES = {
  clock() {
    const g = game();
    if (!g) return say('Clock', ['The clock keeps ticking.']);
    if (g.over) return say('Clock', ['The year is over. Winter is coming: players age, some retire, teams sign replacements.'], [{ label: 'ON TO NEXT YEAR', run: () => gameAct('to-offseason') }, { label: 'NOT YET' }]);
    const lines = [`It is ${bannerDate()}.`, todayGame() ? 'You play today. Simming plays the game without you. How far ahead?' : 'How far ahead?'];
    say('Clock', lines, [
      { label: 'A DAY', run: () => gameAct('sim-day') }, { label: 'A WEEK', run: () => gameAct('sim-week') },
      { label: 'A MONTH', run: () => gameAct('sim-month') }, { label: 'TO THE END', run: () => gameAct('sim-end') }, { label: 'NEVER MIND' },
    ]);
  },
  tv() {
    const g = game();
    if (g && g.over) return say('TV', ['The season is over. It is all reruns now.']);
    if (todayGame()) return say('TV', [`Tonight: ${txt(dash('.w-tonight .win-label')) || 'your game'}.`, 'Watch it pitch by pitch?'], [{ label: 'WATCH', run: () => gameAct('watch') }, { label: 'NOT NOW' }]);
    const notes = [...document.querySelectorAll('#app .screen-home .w-tonight .note')].map(txt).filter(Boolean);
    say('TV', notes.length ? notes : ['No game for you today.']);
  },
  steps() {
    const g = game();
    if (g && g.over) return say('', ['The season is over. The field is quiet.']);
    if (todayGame()) return say('', [`${txt(dash('.w-tonight .win-label')) || 'Game time'}.`, 'Take the field?'], [{ label: 'PLAY BALL', run: () => gameAct('watch') }, { label: 'NOT YET' }]);
    say('', ['No game today. The grounds crew is mowing the outfield in stripes.']);
  },
  window() {
    const s = skyColors().when;
    say('', [s === 'day' ? 'The temple on the hill catches the sun.' : s === 'dusk' ? 'The sky over the temple is going orange. Game time soon.' : 'The temple glows on the hill. The Gods are up late.']);
  },
  cage(t) {
    // A copy of the game that carries the lab inside (the offline file) opens it right here; otherwise the cage links out.
    const lab = window.__bgLab;
    if (lab && typeof lab.open === 'function') return say('', [`${t.game} is set up in the Batting Lab.`, 'Take some cuts?'], [{ label: 'STEP IN', run: () => lab.open(t.id === 'cage_shorten' ? 'contact' : 'derby') }, { label: 'NOT NOW' }]);
    say('', [`${t.game} is set up in the Batting Lab for now.`, 'Take some cuts?'], [{ label: 'OPEN THE BATTING LAB', href: BATTING_LAB }, { label: 'NOT NOW' }]);
  },
  mound() { say('', ['Pitching games are next up.', 'For now the mound is just dirt with ambitions.']); },
  gods() { say('', ['The door is sealed. It is warm to the touch.', 'Something on the other side is humming the seventh-inning stretch.', 'Boss battles and the Gods’ favor will live here.']); },
  sal(n) {
    const sets = [
      ['Morning, skip.', 'The Gods were in here earlier. They left the coffee pot on.'],
      ['Cages are up the hall. The pitching machine bites.'],
      ['Somebody has to draw this place. Right now it is all boxes.'],
      ['If you hear humming behind the sealed door, that is normal.', 'Mostly.'],
    ];
    n.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[S.p.dir];
    const lines = sets[S.salLine % sets.length]; S.salLine++;
    say(n.name, lines, null, { onClose: () => { n.dir = null; } });
  },
};
function use(t) {
  if (!t) return;
  const [kind, arg] = (t.use || 'say').split(':');
  if (kind === 'go') {
    const g = game(); if (!g) return;
    if (arg === 'news') markHeadlinesSeen();
    save(true);
    if (arg === 'roster') return gameAct('go', { to: 'roster', team: String(g.userTeam) });
    if (t.id === 'desk' && cardsWaiting()) return gameAct('go', { to: 'desk' });
    return gameAct('go', { to: arg });
  }
  if (kind === 'act') { save(true); return gameAct(arg, {}); }
  if (kind === 'win') return openWindow(arg);
  if (kind === 'fn' && SCENES[arg]) return SCENES[arg](t);
  say('', t.say || ['Nothing happens.']);
}
function walkToUse(t) {
  const spots = spotsFor(t).filter(([c, r]) => canStand(c, r, false) || (Math.floor(S.p.x / T) === c && Math.floor((S.p.y - 3) / T) === r));
  if (!spots.length) { note('Nowhere to stand there.'); return; }
  startPath(spots, () => { S.target = findTarget(); use(t); }, false);
}

/* ---------------------------------------------------------------- input */
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ShiftLeft: 'run', ShiftRight: 'run' };
function active() { return !!(mounted && S.on && !S.broken && app && app.screen === 'home' && app.game && !app.modal && !app.busy); }
function onKeyDown(e) {
  if (!active() || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const onControl = !!(e.target && e.target.closest && e.target.closest('button, a, [role="button"]'));
  const inSay = !!(e.target && e.target.closest && e.target.closest('.hub-say'));
  const consume = () => { e.preventDefault(); e.stopPropagation(); };
  S.input = 'keys';
  if (menuOpen()) {
    if (e.key === 'Escape' || e.code === 'KeyM') { consume(); menuClose(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { consume(); menuStep(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Tab' || ((e.code === 'Enter' || e.code === 'Space') && onControl)) return;
    consume(); return;
  }
  if (S.panel) { if (e.key === 'Escape') { consume(); closePanel(); } return; }
  if (S.say) {
    const s = S.say, showing = s.choices && s.i === s.lines.length - 1 && s.shown >= (s.lines[s.i] || '').length;
    if (e.key === 'Escape') { consume(); closeSay(); return; }
    const chosen = e.target && e.target.closest && e.target.closest('[data-choice]');
    if (chosen && (e.code === 'Space' || e.code === 'Enter')) {
      const i = Number(chosen.dataset.choice);
      if (s.choices && s.choices[i] && s.choices[i].href) { setTimeout(closeSay, 0); return; }
      consume(); s.sel = i; pick(i); return;
    }
    if (showing && ['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(e.code)) { consume(); s.sel = (s.sel + s.choices.length - 1) % s.choices.length; renderSay(); focusChoice(); return; }
    if (showing && ['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(e.code)) { consume(); s.sel = (s.sel + 1) % s.choices.length; renderSay(); focusChoice(); return; }
    if (['KeyE', 'KeyZ'].includes(e.code) || ((e.code === 'Space' || e.code === 'Enter') && (!onControl || inSay))) {
      if (showing && s.choices[s.sel].href) { if (!inSay || !onControl) { consume(); focusChoice(); } return; }
      consume(); sayAdvance(); return;
    }
    return;
  }
  const dir = KEYMAP[e.code];
  if (dir) {
    if (dir !== 'run' && onControl && !elView.contains(e.target)) { try { e.target.blur(); } catch { /* fine */ } focusView(); }
    if (dir !== 'run') consume();
    S.keys.add(dir); return;
  }
  if (e.code === 'KeyE' || e.code === 'KeyZ' || ((e.code === 'Space' || e.code === 'Enter') && !onControl)) {
    consume();
    if (S.target) use(S.target);
    return;
  }
  if (e.key === 'Escape' || e.code === 'KeyM') { consume(); menuShow(); return; }
  if (e.code === 'KeyG') { consume(); S.grid = !S.grid; save(); if (S.panel === 'art') renderArtPanel(); return; }
  if (e.code === 'KeyL') { consume(); S.labels = !S.labels; save(); updateHud(); }
}
function onKeyUp(e) { const dir = KEYMAP[e.code]; if (dir) S.keys.delete(dir); }
function focusChoice() { const n = elSay.querySelector(`[data-choice="${S.say ? S.say.sel : 0}"]`); if (n) n.focus({ preventScroll: true }); }
function focusView() { if (mounted && elView && document.activeElement !== elView && !(app && app.modal)) { try { elView.focus({ preventScroll: true }); } catch { /* fine */ } } }

function worldAt(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * dpr / zoom + view.cx, (e.clientY - r.top) * dpr / zoom + view.cy];
}
function pickAt(wx, wy) {
  const rm = room();
  for (const n of rm.npcs) { const x = n.at[0] * T, y = n.at[1] * T + 12; if (wx >= x - 8 && wx < x + 8 && wy >= y - 30 && wy < y + 2) return n; }
  const hits = rm.things.filter((t) => inRect(wx, wy, t.rect) || (t.fp && !t.floor && inRect(wx, wy, { x: t.fp[0] * T, y: t.fp[1] * T, w: t.fp[2] * T, h: t.fp[3] * T })));
  hits.sort((a, b) => b.base - a.base);
  return hits[0] || null;
}
function setHover(t) { if (S.hover !== t) { S.hover = t; elView.classList.toggle('pointing', !!t); } }
function onPointerDown(e) {
  if (e.target.closest('.hub-hud, .hub-say, .hub-veil')) return;
  menuClose();
  if (!active()) return;
  if (e.button !== undefined && e.button !== 0) return;
  S.input = 'pointer'; updateHud();
  focusView();
  const [wx, wy] = worldAt(e);
  S.press = { x: e.clientX, y: e.clientY, t: performance.now(), wx, wy, id: e.pointerId, drag: false };
  try { elView.setPointerCapture(e.pointerId); } catch { /* fine */ }
}
function onPointerMove(e) {
  if (!active()) return;
  const [wx, wy] = worldAt(e);
  if (!S.press) { if (e.pointerType === 'mouse' && !S.say && !S.panel) setHover(pickAt(wx, wy)); return; }
  const p = S.press;
  if (!p.drag && (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12 || performance.now() - p.t > 220)) { p.drag = true; stopPath(); }
  if (p.drag && !S.say && !S.panel) S.steer = { x: wx, y: wy };
}
function onPointerUp(e) {
  const p = S.press; S.press = null;
  if (!p || !active()) { S.steer = null; return; }
  if (S.say) { if (!e.target.closest('.hub-say')) sayAdvance(); S.steer = null; return; }
  if (S.panel) return;
  if (p.drag || S.steer) { S.steer = null; return; }
  tapAt(p.wx, p.wy);
}
function tapAt(wx, wy) {
  const t = pickAt(wx, wy);
  if (t) {
    if (S.target === t) { use(t); return; }
    walkToUse(t); return;
  }
  const c = Math.floor(wx / T), r = Math.floor(wy / T), ch = tileAt(c, r);
  if (isDoor(ch)) {
    // any tile of that doorway will do; the nearest one wins
    const rm = room(), goals = [];
    for (let rr = 0; rr < rm.rows; rr++) for (let cc = 0; cc < rm.cols; cc++) if (rm.map[rr][cc] === ch) goals.push([cc, rr]);
    startPath(goals, null, true); return;
  }
  if (canStand(c, r, false)) {
    if (startPath([[c, r]], null, false) && S.path) { const end = S.path.pts[S.path.pts.length - 1]; const ex = clamp(wx, c * T + 5, c * T + 11), ey = clamp(wy + 4, r * T + 7, r * T + 15); if (!blocked(ex, ey, true)) { end[0] = ex; end[1] = ey; } }
    return;
  }
  // a wall or a dark corner: walk to the nearest floor tile
  let best = null, bd = Infinity; const rm = room();
  for (let rr = 0; rr < rm.rows; rr++) for (let cc = 0; cc < rm.cols; cc++) if (canStand(cc, rr, false)) { const d = Math.hypot(cc * T + 8 - wx, rr * T + 8 - wy); if (d < bd) { bd = d; best = [cc, rr]; } }
  if (best && bd < 48) startPath([best], null, false);
}
function onUiClick(e) {
  if (e.target.closest('.hub-pop [data-act]')) { menuClose(); return; }
  const b = e.target.closest('[data-hub], [data-choice]');
  if (e.target.closest('.hub-say') && !b) { sayAdvance(); return; }
  if (!b) { if (S.panel && e.target === elVeil) closePanel(); return; }
  if (b.dataset.choice !== undefined) {
    const i = Number(b.dataset.choice), ch = S.say && S.say.choices && S.say.choices[i];
    if (ch && ch.href) { setTimeout(closeSay, 0); return; }
    e.preventDefault(); pick(i); return;
  }
  const what = b.dataset.hub;
  if (what === 'menu') { if (menuOpen()) menuClose(true); else menuShow(); return; }
  menuClose();
  if (what === 'labels') { S.labels = !S.labels; save(); updateHud(); focusView(); }
  else if (what === 'fullscreen') { fsToggle(); focusView(); }
  else if (what === 'art') { artStatus = artStatus || ''; renderArtPanel(); }
  else if (what === 'close') closePanel();
  else if (what === 'pick') fileInput.click();
  else if (what === 'grid') { S.grid = !S.grid; save(); renderArtPanel(); }
  else if (what === 'all') { renderArtPanel.all = !renderArtPanel.all; renderArtPanel(); }
  else if (what === 'kit') downloadKit();
  else if (what === 'clear-art') { clearTestArt().then(() => { artStatus = 'Test art cleared. Stand-ins are back.'; renderArtPanel(); }); }
}

/* ================================================================ mounting into the game */
let mounted = false, raf = 0, lastT = 0;
function loop(t) {
  if (!mounted) { raf = 0; return; }
  const dt = Math.min(0.05, Math.max(0, (t - (lastT || t)) / 1000)); lastT = t;
  try {
    update(dt);
    const busy = S.p.moving || S.fade || S.path || S.steer || Math.abs(S.cam.x - Math.round(S.cam.x)) > 0 || needDraw;
    if (busy || t - lastDraw > 100) { draw(t); lastDraw = t; needDraw = false; }
    placeTags();
  } catch (e) { fail(e); return; }
  raf = requestAnimationFrame(loop);
}
function mount(frame) {
  if (!elHub) buildDom();
  frame.classList.add('hub-on');
  const footer = frame.querySelector(':scope > .footer');
  if (elHub.parentNode !== frame || elHub.nextSibling !== footer) frame.insertBefore(elHub, footer);
  if (!mounted) {
    mounted = true; lastT = 0; S.keys.clear();
    resize(); buildTags(); updateHud();
    if (!raf) raf = requestAnimationFrame(loop);
  } else { resize(); updateHud(); }
  needDraw = true;
  if (S.panel === 'win') refreshWindow();
  if (!app.modal && (!document.activeElement || document.activeElement === document.body)) focusView();
}
function unmount() {
  menuClose();
  if (!mounted) return;
  mounted = false; S.keys.clear(); S.steer = null; S.press = null; stopPath();
  if (S.say) { S.say = null; if (elSay) elSay.hidden = true; }
  if (S.panel) closePanel();
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (elHub && elHub.parentNode) elHub.remove();
  save(true);
}
// On the dashboard, a little walker at the front of the headlines ticker leads back to the clubhouse.
function tickerButton(frame) {
  const tk = frame.querySelector(':scope > .ticker');
  if (!tk || tk.querySelector('.hub-back')) return;
  const b = h('button', 'ticker-label hub-back', iconSvg('walker', 3));
  b.type = 'button'; b.dataset.hubToggle = '1'; b.title = 'Back to the clubhouse'; b.setAttribute('aria-label', 'Back to the clubhouse');
  tk.insertBefore(b, tk.firstChild);
}
function afterRender() {
  if (!app) return;
  if (app.screen === 'news') markHeadlinesSeen();
  const frame = document.querySelector('#app .frame.screen-home');
  const home = !!frame && app.screen === 'home' && !!app.game;
  if (!home) { unmount(); return; }
  if (S.on && !S.broken) mount(frame); else { unmount(); frame.classList.remove('hub-on'); tickerButton(frame); }
}
function fail(e) {
  console.error('[clubhouse] turned off after an error:', e);
  S.broken = true; try { unmount(); } catch { /* fine */ }
  const frame = document.querySelector('#app .frame.screen-home'); if (frame) frame.classList.remove('hub-on');
}
function onDocClick(e) {
  const b = e.target.closest && e.target.closest('[data-hub-toggle]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  S.on = !S.on; S.broken = false; save();
  if (b.classList.contains('hub-back')) b.remove();
  afterRender();
  if (S.on) focusView(); else { const nb = document.querySelector('#app .hub-back'); if (nb) nb.focus({ preventScroll: true }); }
}
function boot(tries = 0) {
  app = window.__bg;
  if (!app || typeof app.render !== 'function') { if (tries < 200) setTimeout(() => boot(tries + 1), 50); return; }
  if (app.__clubhouse) return;
  app.__clubhouse = true;
  load();
  const orig = app.render;
  app.render = function (...args) { const r = orig.apply(this, args); try { afterRender(); } catch (e) { fail(e); } return r; };
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => { S.keys.clear(); S.steer = null; });
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
  window.addEventListener('pagehide', () => save(true));
  try { afterRender(); } catch (e) { fail(e); }
  try { document.fonts && document.fonts.ready.then(() => { remeasureTags(); needDraw = true; }); } catch { /* fine */ }
  loadPublished(); loadLocal();
}

/* ================================================================ templates for the art kit and a test handle */
let guideCache = null;
function guideCanvases() {
  if (guideCache) return guideCache;
  const out = {};
  const scaled = (src, k) => { const c = cv(src.width * k, src.height * k), x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, c.width, c.height); return c; };
  const font = (px) => `${px}px 'Determination Mono', 'Courier New', monospace`;
  // the walk sheet guide
  {
    const k = 8, src = standIn('player'), g = scaled(src, k), pad = 120, top = 56;
    const c = cv(g.width + pad + 24, g.height + top + 40), x = c.getContext('2d');
    x.fillStyle = '#10162B'; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = false;
    for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) { x.fillStyle = (r + i) % 2 ? '#1A2340' : '#151D36'; x.fillRect(pad + i * 16 * k, top + r * 32 * k, 16 * k, 32 * k); }
    x.drawImage(g, pad, top);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2;
    for (let r = 0; r <= 4; r++) { x.beginPath(); x.moveTo(pad, top + r * 32 * k); x.lineTo(pad + 64 * k, top + r * 32 * k); x.stroke(); }
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(pad + i * 16 * k, top); x.lineTo(pad + i * 16 * k, top + 128 * k); x.stroke(); }
    x.fillStyle = '#FFD25A'; x.font = font(16); x.textBaseline = 'middle';
    ['DOWN', 'LEFT', 'RIGHT', 'UP'].forEach((t, r) => x.fillText(t, 16, top + r * 32 * k + 16 * k));
    x.textAlign = 'center'; ['1 STAND', '2 STEP', '3 STAND', '4 STEP'].forEach((t, i) => x.fillText(t, pad + i * 16 * k + 8 * k, top - 22));
    x.strokeStyle = '#6BE08A'; x.setLineDash([6, 4]);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) { const fx = pad + i * 16 * k, fy = top + r * 32 * k; x.strokeRect(fx + 3 * k, fy + 26 * k, 10 * k, 6 * k); }
    x.setLineDash([]); x.fillStyle = '#E04A3B';
    for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) { const fx = pad + i * 16 * k + 8 * k, fy = top + (r + 1) * 32 * k; x.fillRect(fx - 4, fy - 4, 8, 8); }
    x.textAlign = 'left'; x.fillStyle = '#C9D6F2'; x.font = font(16);
    x.fillText('Each frame 16x32 px. Red dot = feet (bottom center). Green box = 10x6 collision.', 16, c.height - 20);
    out['guide_player_sheet.png'] = c;
  }
  // a guide per room: grid, solid tiles, doors, footprints and art boxes, named
  for (const rm of Object.values(ROOMS)) {
    const k = 4, bg = standIn('room_' + rm.id), w = rm.cols * T * k, hh = rm.rows * T * k, top = 40;
    const c = cv(w + 32, hh + top + 16), x = c.getContext('2d');
    x.fillStyle = '#10162B'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
    x.globalAlpha = 0.55; x.drawImage(bg, 16, top, w, hh); x.globalAlpha = 1;
    for (const t of rm.things) { const im = standIn(t.slot); const r = t.rect; x.globalAlpha = 0.85; x.drawImage(im, 16 + r.x * k, top + r.y * k, r.w * k, r.h * k); x.globalAlpha = 1; }
    for (let r = 0; r < rm.rows; r++) for (let col = 0; col < rm.cols; col++) {
      const ch = rm.map[r][col];
      if (isDoor(ch)) { x.fillStyle = 'rgba(75,163,217,0.55)'; x.fillRect(16 + col * T * k, top + r * T * k, T * k, T * k); }
      else if (ch === '#' || ch === 'W') { x.fillStyle = 'rgba(224,74,59,0.18)'; x.fillRect(16 + col * T * k, top + r * T * k, T * k, T * k); }
    }
    x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 1;
    for (let col = 0; col <= rm.cols; col++) { x.beginPath(); x.moveTo(16 + col * T * k + 0.5, top); x.lineTo(16 + col * T * k + 0.5, top + hh); x.stroke(); }
    for (let r = 0; r <= rm.rows; r++) { x.beginPath(); x.moveTo(16, top + r * T * k + 0.5); x.lineTo(16 + w, top + r * T * k + 0.5); x.stroke(); }
    x.font = font(16); x.textBaseline = 'top';
    for (const t of rm.things) {
      const r = t.rect;
      x.strokeStyle = '#FFD25A'; x.lineWidth = 2; x.setLineDash([6, 4]); x.strokeRect(16 + r.x * k + 1, top + r.y * k + 1, r.w * k - 2, r.h * k - 2); x.setLineDash([]);
      if (t.fp && !t.floor) { x.fillStyle = 'rgba(255,210,90,0.28)'; x.fillRect(16 + t.fp[0] * T * k, top + t.fp[1] * T * k, t.fp[2] * T * k, t.fp[3] * T * k); }
      const name = t.slot.replace(/^obj_/, ''), tw = x.measureText(name).width + 8;
      x.fillStyle = 'rgba(5,10,28,0.85)'; x.fillRect(16 + r.x * k + 2, top + r.y * k + 2, tw, 20);
      x.fillStyle = '#FFD25A'; x.fillText(name, 16 + r.x * k + 6, top + r.y * k + 4);
    }
    for (const n of rm.npcs) { x.drawImage(standIn(n.sheet), 0, 0, 16, 32, 16 + (n.at[0] * T - 8) * k, top + (n.at[1] * T + 12 - 32) * k, 16 * k, 32 * k); }
    x.fillStyle = '#C9D6F2'; x.textBaseline = 'middle';
    x.fillText(`${rm.name}: room_${rm.id}.png is ${rm.cols * T}x${rm.rows * T} px (${rm.cols}x${rm.rows} tiles). Red = wall, blue = doorway, gold = things.`, 16, 20);
    out[`guide_room_${rm.id}.png`] = c;
  }
  // all things at 4x on one sheet, with names and sizes
  {
    const k = 4, items = [...SLOTS.values()].filter((s) => s.thing), pad = 16, colW = 0;
    let x0 = pad, y0 = 48, rowH = 0; const maxW = 1400;
    const boxes = items.map((s) => { const w = Math.max(s.w * k, 150), hgt = s.h * k + 44; if (x0 + w > maxW) { x0 = pad; y0 += rowH + 16; rowH = 0; } const b = { s, x: x0, y: y0, w, h: hgt }; x0 += w + 16; rowH = Math.max(rowH, hgt); return b; });
    const c = cv(maxW + pad, y0 + rowH + 24 + colW), x = c.getContext('2d');
    x.fillStyle = '#10162B'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
    x.font = font(16); x.textBaseline = 'top'; x.fillStyle = '#C9D6F2'; x.fillText('Every thing in the clubhouse at 4x, with its file name and size at 1x. Gold band = footprint.', pad, 16);
    for (const b of boxes) {
      const s = b.s, im = standIn(s.id);
      x.fillStyle = '#151D36'; x.fillRect(b.x, b.y, s.w * k, s.h * k);
      x.drawImage(im, b.x, b.y, s.w * k, s.h * k);
      const t = s.thing; if (t.fp && !t.floor) { const fpH = t.fp[3] * T * k, fpW = t.fp[2] * T * k; x.fillStyle = 'rgba(255,210,90,0.3)'; x.fillRect(b.x + (s.w * k - fpW) / 2, b.y + s.h * k - fpH, fpW, fpH); }
      x.fillStyle = '#FFD25A'; x.fillText(`${s.id}.png`, b.x, b.y + s.h * k + 6);
      x.fillStyle = '#C9D6F2'; x.fillText(`${s.w}x${s.h}${t.wall ? ' wall' : t.floor ? ' floor' : ` fp ${t.fp[2]}x${t.fp[3]}`}`, b.x, b.y + s.h * k + 24);
    }
    out['guide_things.png'] = c;
  }
  guideCache = out;
  return out;
}
const GUIDE_NAMES = ['guide_player_sheet', ...Object.keys(ROOMS).map((id) => 'guide_room_' + id), 'guide_things'];
if (REG) for (const n of GUIDE_NAMES) REG.guide(n, () => guideCanvases()[n + '.png'] || null);
/** Every stand-in and guide as data URLs (debug handle; the ART panel's DOWNLOAD ART KIT makes the zip). */
function templates() {
  const out = {};
  for (const s of SLOTS.values()) out[`${s.id}.png`] = standIn(s.id);
  Object.assign(out, guideCanvases());
  const res = {}; for (const [k2, c] of Object.entries(out)) res[k2] = c.toDataURL('image/png');
  return res;
}
window.__hub = {
  spec: SPEC, rooms: ROOMS, slots: SLOTS,
  get state() { return { on: S.on, room: S.room, x: S.p.x, y: S.p.y, dir: S.p.dir, frame: S.p.frame, moving: S.p.moving, target: S.target && (S.target.id || S.target.name), say: S.say && { who: S.say.who, line: S.say.lines[S.say.i], i: S.say.i, n: S.say.lines.length, done: S.say.shown >= (S.say.lines[S.say.i] || '').length, choices: S.say.choices && S.say.choices.map((c) => c.label) }, panel: S.panel, mounted, zoom, dpr, broken: S.broken, path: !!S.path, fade: !!S.fade, cam: { ...view }, art: { local: [...ART.local.keys()], published: [...ART.published.keys()] } }; },
  teleport(r, tx, ty, face) { placeAt(r, tx, ty, face); onRoomChange(); },
  tapWorld: (x, y) => tapAt(x, y),
  worldToClient(x, y) { const r = canvas.getBoundingClientRect(); return [r.left + (x - view.cx) * zoom / dpr, r.top + (y - view.cy) * zoom / dpr]; },
  use(id) { const t = room().things.find((q) => q.id === id) || room().npcs.find((n) => n.id === id); if (t) use(t); },
  menu: { open: () => menuShow(), close: () => menuClose(), get isOpen() { return menuOpen(); } },
  templates,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot()); else boot();
})();
