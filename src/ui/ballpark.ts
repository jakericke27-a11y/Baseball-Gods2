/**
 * The ballpark, drawn pixel by pixel. Pure: no DOM; returns RGBA bytes for a W×H art grid
 * (each art pixel is shown as a 3–4px block). Camera sits high behind home plate looking straight
 * out to center, so the field fills the bottom and the sky above is open for weather and the Gods.
 *
 * Ground pixels are inverse-projected onto the field (feet from home plate: +x toward first base,
 * +y toward center) and colored by what is there, so mowing stripes, the infield and the side
 * stands all sit in true perspective.
 */
export type Lighting = 'day' | 'dusk' | 'night';
type RGB = [number, number, number];

export interface Figure {
  /** Feet from home plate: +x toward first base, +y toward center field. */
  x: number; y: number;
  jersey: RGB; cap: RGB;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

interface Palette {
  sky: [RGB, RGB, RGB]; stars: number; sun: RGB | null; moon: boolean; clouds: RGB | null;
  farHills: RGB; nearHills: RGB; trees: RGB; temple: RGB; templeGlow: RGB | null;
  structure: RGB; structureDark: RGB; seatA: RGB; seatB: RGB; crowd: RGB[]; crowdDensity: number;
  wall: RGB; wallTop: RGB; eye: RGB; pole: RGB;
  grassA: RGB; grassB: RGB; foulGrass: RGB; dirt: RGB; dirtDark: RGB; track: RGB; mound: RGB; chalk: RGB;
  tower: RGB; bulbs: RGB; glow: RGB | null; board: RGB; boardFrame: RGB; boardLights: RGB[];
}

const PALETTES: Record<Lighting, Palette> = {
  day: {
    sky: [hex('#4C8BD4'), hex('#79B4E9'), hex('#B9DCF4')], stars: 0, sun: hex('#FFF1A8'), moon: false, clouds: hex('#F4F9FF'),
    farHills: hex('#9BB6D4'), nearHills: hex('#5F8C6C'), trees: hex('#3D6A4B'), temple: hex('#F3EAD2'), templeGlow: null,
    structure: hex('#C7CDD8'), structureDark: hex('#98A2B4'), seatA: hex('#2F5D9E'), seatB: hex('#26508A'),
    crowd: ['#E04A3B', '#F2C14E', '#FFFFFF', '#2E64C8', '#F28C38', '#5BD27A', '#C9D6F2', '#1A1A2E'].map(hex), crowdDensity: 0.42,
    wall: hex('#1F4C3A'), wallTop: hex('#F2C14E'), eye: hex('#163828'), pole: hex('#F2C14E'),
    grassA: hex('#62B04F'), grassB: hex('#4F9C42'), foulGrass: hex('#4C9440'), dirt: hex('#C98B57'), dirtDark: hex('#B47646'),
    track: hex('#A66A45'), mound: hex('#D69E66'), chalk: hex('#FFFFFF'),
    tower: hex('#8C93A3'), bulbs: hex('#E8ECF4'), glow: null, board: hex('#1B2130'), boardFrame: hex('#3B4356'),
    boardLights: [hex('#F2C14E'), hex('#E04A3B'), hex('#C9D6F2')],
  },
  dusk: {
    sky: [hex('#221B49'), hex('#6E3060'), hex('#E27B4B')], stars: 0.25, sun: hex('#FFB65C'), moon: false, clouds: hex('#E59A7C'),
    farHills: hex('#5C4878'), nearHills: hex('#3A3256'), trees: hex('#2B2645'), temple: hex('#FFE2B0'), templeGlow: null,
    structure: hex('#8D82A2'), structureDark: hex('#675C80'), seatA: hex('#2B4C80'), seatB: hex('#23406E'),
    crowd: ['#D9483B', '#E8B84A', '#E8E2F0', '#3F6CC0', '#E88A3C', '#58B872', '#B9C2E0', '#1A1A2E'].map(hex), crowdDensity: 0.48,
    wall: hex('#1C3F33'), wallTop: hex('#EDB64A'), eye: hex('#12301F'), pole: hex('#EDB64A'),
    grassA: hex('#4E9A55'), grassB: hex('#418749'), foulGrass: hex('#3F8246'), dirt: hex('#B47A53'), dirtDark: hex('#9E6745'),
    track: hex('#92603F'), mound: hex('#C08A5E'), chalk: hex('#FFF4E8'),
    tower: hex('#6F6A86'), bulbs: hex('#FFF4D6'), glow: hex('#FFE7B0'), board: hex('#161A28'), boardFrame: hex('#332F4A'),
    boardLights: [hex('#F2C14E'), hex('#E04A3B'), hex('#C9D6F2')],
  },
  night: {
    sky: [hex('#050A1C'), hex('#0B1735'), hex('#17294F')], stars: 1, sun: null, moon: true, clouds: null,
    farHills: hex('#23304F'), nearHills: hex('#141E37'), trees: hex('#0C1426'), temple: hex('#C9D6F6'), templeGlow: null,
    structure: hex('#3A4562'), structureDark: hex('#283149'), seatA: hex('#1E3360'), seatB: hex('#182A52'),
    crowd: ['#C8463B', '#D8AE48', '#D8DCEA', '#3A62B4', '#D07C38', '#4EA868', '#9EAAD0', '#10142A'].map(hex), crowdDensity: 0.5,
    wall: hex('#173A2E'), wallTop: hex('#E8B23E'), eye: hex('#0D2419'), pole: hex('#E8B23E'),
    grassA: hex('#4A9A5C'), grassB: hex('#3D874F'), foulGrass: hex('#3A7E4A'), dirt: hex('#A97556'), dirtDark: hex('#946248'),
    track: hex('#86593F'), mound: hex('#B88460'), chalk: hex('#F4F8FF'),
    tower: hex('#59627C'), bulbs: hex('#FFFFFF'), glow: hex('#FFF3C8'), board: hex('#0E1220'), boardFrame: hex('#2B3550'),
    boardLights: [hex('#FFD25A'), hex('#FF5A48'), hex('#D6E0FF')],
  },
};

// 4×4 ordered (Bayer) dither: the pixel-art way to blend two colors without a gradient wash.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number, t: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < t;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (a: number, b: number) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export interface BallparkGeometry {
  W: number; H: number; cx: number; f: number; k: number; h0: number; homeY: number;
  /** Ground point (feet) → art pixel. */
  project(x: number, y: number, z?: number): [number, number];
}

const CAM_HEIGHT = 98, CAM_BACK = 220;

export function geometry(W: number, H: number): BallparkGeometry {
  const f = Math.min(0.93 * W, 1.55 * H);
  const k = CAM_HEIGHT * f;
  const homeY = H - 3;
  const h0 = homeY - k / CAM_BACK;
  const cx = W / 2;
  return {
    W, H, cx, f, k, h0, homeY,
    project(x, y, z = 0) {
      const d = y + CAM_BACK;
      return [cx + (x * f) / d, h0 + ((CAM_HEIGHT - z) * f) / d];
    },
  };
}

const fenceR = (theta: number) => 330 + 70 * Math.cos(2 * theta);
const foulWidth = (a: number) => 52 - 28 * Math.min(1, Math.max(0, a / 330));

type Cls = 'grass' | 'infield' | 'dirt' | 'mound' | 'track' | 'foul' | 'stands' | 'beyond' | 'void';

function classify(x: number, y: number): { c: Cls; u: number; v: number } {
  const ax = Math.abs(x);
  if (ax > y) {
    // Foul side of the line: grass, then the seating bowl, then nothing (background shows).
    const p = (ax - y) / Math.SQRT2, a = (ax + y) / Math.SQRT2;
    if (y < -48) return { c: 'void', u: 0, v: 0 };
    if (a > 330) return { c: 'beyond', u: 0, v: 0 };
    const w = foulWidth(a);
    if (Math.hypot(x, y) < 13) return { c: 'dirt', u: 0, v: 0 };
    if (p <= w) return { c: 'foul', u: p, v: a };
    if (p > w + 150) return { c: 'void', u: 0, v: 0 };
    return { c: 'stands', u: p - w, v: a };
  }
  const r = Math.hypot(x, y);
  const R = fenceR(Math.atan2(x, y));
  if (r > R) return { c: 'beyond', u: 0, v: 0 };
  if (r > R - 14) return { c: 'track', u: 0, v: 0 };
  const dm = Math.hypot(x, y - 59);
  if (dm < 9) return { c: 'mound', u: 0, v: 0 };
  if (r < 13) return { c: 'dirt', u: 0, v: 0 };
  if (ax + Math.abs(y - 63.64) < 58.5) return { c: 'infield', u: x, v: y };
  if (Math.hypot(x, y - 60.5) < 95) return { c: 'dirt', u: 0, v: 0 };
  return { c: 'grass', u: x, v: y };
}

export function renderBallpark(W: number, H: number, lighting: Lighting): Uint8ClampedArray {
  const P = PALETTES[lighting];
  const G = geometry(W, H);
  const { cx, f, k, h0 } = G;
  const px = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, c: RGB) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const rect = (x0: number, y0: number, w: number, h: number, c: RGB) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, c);
  };
  const sc = f / 335; // scale relative to the 1440×900 reference
  const rand = mulberry(20261009);

  // Where the stadium's skyline sits: top of the outfield bleachers at center field.
  const fenceRowCenter = h0 + k / (400 + CAM_BACK);
  const bleacherTop = fenceRowCenter - (9 + 42) * f / (400 + CAM_BACK);
  const skyBottom = bleacherTop + 4;

  // ---- 1. Sky: three bands with ordered-dither transitions.
  const b1 = skyBottom * 0.42, b2 = skyBottom * 0.74, tw = Math.max(6, skyBottom * 0.12);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = P.sky[0];
      if (y >= b1 - tw / 2) c = dither(x, y, (y - (b1 - tw / 2)) / tw) ? P.sky[1] : P.sky[0];
      if (y >= b1 + tw / 2) c = P.sky[1];
      if (y >= b2 - tw / 2) c = dither(x, y, (y - (b2 - tw / 2)) / tw) ? P.sky[2] : P.sky[1];
      if (y >= b2 + tw / 2) c = P.sky[2];
      set(x, y, c);
    }
  }
  // Stars and moon (night), sun and clouds (day, dusk).
  if (P.stars > 0) {
    const n = Math.round((W * skyBottom) / 260 * P.stars);
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * skyBottom * 0.8, big = rand() < 0.08;
      const c: RGB = rand() < 0.7 ? [234, 240, 255] : [255, 236, 190];
      set(x, y, c);
      if (big) { set(x - 1, y, c); set(x + 1, y, c); set(x, y - 1, c); set(x, y + 1, c); }
    }
  }
  if (P.moon) {
    const mx = W * 0.8, my = skyBottom * 0.22, r = Math.max(4, 6 * sc);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const lit = (x + r * 0.45) ** 2 + (y - r * 0.15) ** 2 > (r * 0.85) ** 2;
      set(mx + x, my + y, lit ? [242, 238, 214] : [205, 200, 178]);
    }
  }
  if (P.sun) {
    const dusk = lighting === 'dusk';
    const sx = dusk ? W * 0.27 : W * 0.82, sy = dusk ? skyBottom * 0.86 : skyBottom * 0.2, r = Math.max(5, (dusk ? 11 : 7) * sc);
    for (let y = -r - 3; y <= r + 3; y++) for (let x = -r - 3; x <= r + 3; x++) {
      const d2 = x * x + y * y;
      if (d2 <= r * r) set(sx + x, sy + y, P.sun);
      else if (d2 <= (r + 3) * (r + 3) && dither(sx + x, sy + y, 0.35)) set(sx + x, sy + y, P.sun);
    }
  }
  if (P.clouds) {
    const puffs = [[0.12, 0.18, 26], [0.47, 0.1, 18], [0.63, 0.3, 30], [0.9, 0.42, 16]];
    for (const [fx, fy, w] of puffs) {
      const x0 = W * fx, y0 = skyBottom * fy, cw = w * sc;
      rect(x0, y0, cw, 3 * sc + 1, P.clouds);
      rect(x0 + cw * 0.18, y0 - 2 * sc - 1, cw * 0.5, 2 * sc + 1, P.clouds);
      rect(x0 + cw * 0.5, y0 - 3 * sc - 1, cw * 0.28, 3 * sc + 1, P.clouds);
    }
  }

  // ---- 2. Hills: a far range with the Gods' temple on its peak, nearer wooded hills.
  const farBase = skyBottom + 2;
  let peakX = 0, peakY = H;
  const farTop: number[] = [];
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const ridge = farBase - (14 + 9 * Math.sin(t * 7.1 + 0.6) + 6 * Math.sin(t * 15.3 + 2.1) + 10 * Math.exp(-(((t - 0.36) / 0.07) ** 2))) * sc;
    farTop[x] = ridge;
    if (ridge < peakY) { peakY = ridge; peakX = x; }
    for (let y = Math.floor(ridge); y < farBase + 2; y++) set(x, y, P.farHills);
  }
  const nearBase = farBase + 4 * sc;
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const ridge = nearBase - (6 + 4 * Math.sin(t * 9.7 + 1.3) + 3 * Math.sin(t * 23.1)) * sc;
    for (let y = Math.floor(ridge); y < nearBase + 4; y++) set(x, y, P.nearHills);
    if (x % Math.max(3, Math.round(5 * sc)) === 0 && hash2(x, 7) < 0.6) {
      const th = 2 + Math.round(hash2(x, 9) * 2 * sc);
      for (let y = 0; y < th; y++) set(x, ridge - 1 - y, P.trees);
      set(x - 1, ridge - th + 1, P.trees); set(x + 1, ridge - th + 1, P.trees);
    }
  }
  // The temple: a pediment, three columns, a base. Tiny, but it is always there, watching.
  {
    const tx = Math.round(peakX), ty = Math.round(peakY);
    const T = P.temple;
    if (P.templeGlow) for (let y = -6; y <= 2; y++) for (let x = -7; x <= 7; x++) if (x * x + y * y * 2 < 50 && dither(tx + x, ty + y, 0.3)) set(tx + x, ty - 3 + y, P.templeGlow);
    rect(tx - 4, ty - 1, 9, 1, T);
    for (const c of [-3, 0, 3]) rect(tx + c, ty - 4, 1, 3, T);
    rect(tx - 4, ty - 5, 9, 1, T);
    rect(tx - 3, ty - 6, 7, 1, T);
    rect(tx - 1, ty - 7, 3, 1, T);
  }

  // ---- 3. Light towers and the scoreboard, behind the bleachers.
  const towerXs = [cx - 0.62 * f, cx - 0.3 * f, cx + 0.3 * f, cx + 0.62 * f];
  for (const tx of towerXs) {
    const top = bleacherTop - 30 * sc, bottom = bleacherTop + 20 * sc;
    rect(tx, top, Math.max(1, sc), bottom - top, P.tower);
    const bw = Math.round(11 * sc) | 1, bh = Math.max(3, Math.round(5 * sc));
    const bx = tx - bw / 2 + 0.5, by = top - bh;
    if (P.glow) {
      for (let y = -bh - 4; y < bh * 2 + 4; y++) for (let x = -6; x < bw + 6; x++) {
        const gx = bx + x, gy = by + y;
        const dx = Math.max(0, -x, x - bw + 1), dy = Math.max(0, -y, y - bh + 1);
        if (dx + dy > 0 && dx + dy < 6 && dither(gx, gy, (6 - dx - dy) / 10)) set(gx, gy, P.glow);
      }
    }
    rect(bx - 1, by - 1, bw + 2, bh + 2, P.tower);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) set(bx + x, by + y, (x + y) % 2 === 0 || P.glow ? P.bulbs : P.structureDark);
  }
  {
    const bw = Math.round(46 * sc), bh = Math.round(15 * sc);
    const bx = cx - bw / 2, by = bleacherTop - bh - 3 * sc;
    rect(bx - 1, by - 1, bw + 2, bh + 2, P.boardFrame);
    rect(bx, by, bw, bh, P.board);
    rect(cx - 1, by + bh, 2, 6 * sc, P.boardFrame);
    // A line score of lights: nine innings, two teams.
    const cell = Math.max(2, Math.round(3 * sc));
    const cells = Math.max(0, Math.min(9, Math.floor((bw - 12 * sc) / ((cell + 1) * 1.15))));
    for (let row = 0; row < 2; row++) for (let i = 0; i < cells; i++) {
      const on = hash2(i, row + (lighting === 'night' ? 11 : 3)) < 0.45;
      rect(bx + 3 * sc + i * (cell + 1) * 1.15, by + 3 * sc + row * (cell + 2), cell, cell, on ? P.boardLights[row] : P.boardFrame);
    }
    rect(bx + bw - 9 * sc, by + 3 * sc, 6 * sc, 2 * cell + 2, P.boardLights[2]);
  }

  // ---- 4. The ground, column by column from home outward; then the wall and bleachers.
  const startY = Math.max(0, Math.floor(h0) + 1);
  const crowd = (a: number, b: number): RGB | null => (hash2(a, b) < P.crowdDensity ? P.crowd[Math.floor(hash2(b, a) * P.crowd.length)] : null);
  for (let x = 0; x < W; x++) {
    let wallBase = -1, lastStands = -1;
    for (let y = H - 1; y >= startY; y--) {
      const d = k / (y + 0.5 - h0);
      const yf = d - CAM_BACK, xf = ((x + 0.5 - cx) * d) / f;
      const { c, u, v } = classify(xf, yf);
      if (c === 'beyond') { wallBase = y; break; }
      if (c === 'void') { lastStands = y; break; }
      let col: RGB;
      switch (c) {
        case 'grass': case 'infield': {
          const period = c === 'infield' ? 15 : 22;
          const stripe = (Math.floor((u + v) / period) + Math.floor((v - u) / period)) & 1;
          col = stripe ? P.grassA : P.grassB;
          break;
        }
        case 'foul': col = P.foulGrass; break;
        case 'dirt': col = (x + y) % 7 === 0 ? P.dirtDark : P.dirt; break;
        case 'mound': col = P.mound; break;
        case 'track': col = P.track; break;
        case 'stands': {
          const row = Math.floor(u / 3.2), seat = Math.floor(v / 2.2);
          if (v % 46 < 2.6) col = P.structureDark; // aisle
          else if (u < 2.5) col = P.wall; // the low wall in front of the first row
          else col = crowd(row, seat) ?? (row % 2 ? P.seatA : P.seatB);
          break;
        }
        default: col = P.grassA;
      }
      set(x, y, col);
    }
    if (lastStands >= 0) {
      // Top of a side stand: a concourse facade and its roof edge.
      const fh = Math.max(3, Math.round(5 * sc));
      rect(x, lastStands - fh + 1, 1, fh, P.structure);
      set(x, lastStands - fh, P.structureDark);
    }
    if (wallBase >= 0) {
      const d = k / (wallBase + 0.5 - h0);
      const yf = d - CAM_BACK, xf = ((x + 0.5 - cx) * d) / f;
      const theta = Math.atan2(xf, yf);
      const wallH = Math.max(2, Math.round((9 * f) / d));
      const standH = Math.round((42 * f) / d);
      const wallTop = wallBase - wallH + 1;
      for (let y = wallTop; y <= wallBase; y++) set(x, y, P.wall);
      set(x, wallTop, P.wallTop);
      if (Math.abs(theta) < 0.11) {
        for (let y = wallTop - Math.round(standH * 0.85); y < wallTop; y++) set(x, y, P.eye);
      } else {
        for (let i = 1; i <= standH; i++) {
          const y = wallTop - i;
          const row = Math.floor(i / 2);
          if (i === standH) set(x, y, P.structureDark);
          else if (i > standH - 3) set(x, y, P.structure);
          else set(x, y, crowd(row, x) ?? (row % 2 ? P.seatA : P.seatB));
        }
      }
      if (Math.abs(Math.abs(theta) - Math.PI / 4) < 0.012) for (let y = wallTop - standH - 6; y < wallBase; y++) set(x, y, P.pole);
    }
  }

  // ---- 5. Chalk, bases, the rubber and the plate.
  for (let s = 0; s < 236; s += 0.2) {
    for (const sign of [-1, 1]) {
      const [x, y] = G.project(sign * s, s); // the lines run at 45°: (±t, t) out to the poles at (±233, 233)
      set(x, y, P.chalk);
    }
  }
  for (const [bx, by] of [[63.64, 63.64], [0, 127.28], [-63.64, 63.64]]) {
    const [x, y] = G.project(bx, by);
    set(x, y, P.chalk); set(x + 1, y, P.chalk);
  }
  {
    const [x, y] = G.project(0, 60.5);
    set(x, y, P.chalk); set(x - 1, y, P.chalk);
    const [hx, hy] = G.project(0, 0.7);
    for (const dx of [-1, 0, 1]) set(hx + dx, hy, P.chalk);
    set(hx, hy + 1, P.chalk);
  }

  return px;
}

/** Draw players onto a copy of a rendered park (cheap, so the static park can be cached). */
export function drawFigures(base: Uint8ClampedArray, W: number, H: number, figures: Figure[]): Uint8ClampedArray {
  const px = base.slice();
  const G = geometry(W, H);
  const set = (x: number, y: number, c: RGB) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const skin: RGB[] = [[241, 194, 150], [198, 134, 90], [141, 85, 54], [224, 172, 125]];
  figures.forEach((fig, i) => {
    const [x, y] = G.project(fig.x, fig.y);
    const big = y > H * 0.72;
    const s = skin[i % skin.length];
    const X = Math.round(x), Y = Math.round(y);
    if (big) {
      // 3 wide, 6 tall, feet on the spot.
      set(X - 1, Y - 6, fig.cap); set(X, Y - 6, fig.cap); set(X + 1, Y - 6, fig.cap);
      set(X, Y - 5, s);
      set(X - 1, Y - 4, fig.jersey); set(X, Y - 4, fig.jersey); set(X + 1, Y - 4, fig.jersey);
      set(X - 1, Y - 3, fig.jersey); set(X, Y - 3, fig.jersey); set(X + 1, Y - 3, fig.jersey);
      set(X - 1, Y - 2, [236, 236, 236]); set(X + 1, Y - 2, [236, 236, 236]);
      set(X - 1, Y - 1, [30, 30, 40]); set(X + 1, Y - 1, [30, 30, 40]);
    } else {
      set(X, Y - 4, fig.cap);
      set(X, Y - 3, s);
      set(X, Y - 2, fig.jersey); set(X - 1, Y - 2, fig.jersey); set(X + 1, Y - 2, fig.jersey);
      set(X, Y - 1, [236, 236, 236]);
    }
  });

  return px;
}

/** Where fielders stand (feet from home). Scoring numbers 1–9. */
export const FIELD_SPOTS: Record<number, [number, number]> = {
  1: [0, 58], 2: [0, -4], 3: [62, 84], 4: [34, 134], 5: [-58, 82], 6: [-34, 134], 7: [-165, 255], 8: [0, 315], 9: [165, 255],
};
/** Runners stand just off the bag, toward the next base. */
export const BASE_SPOTS: Array<[number, number]> = [[58, 66], [6, 124], [-58, 66]];
