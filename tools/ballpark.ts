/** Render the ballpark to PNGs for a look: npx tsx tools/ballpark.ts [outDir] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderBallpark, drawFigures, FIELD_SPOTS, BASE_SPOTS, type Figure } from '../src/ui/ballpark';
import { encodePng } from './lib/png';

const out = process.argv[2] ?? 'dist/ballpark';
mkdirSync(out, { recursive: true });
const home: Figure['jersey'] = [240, 240, 236], away: Figure['jersey'] = [150, 156, 170];
const figures: Figure[] = [
  ...Object.values(FIELD_SPOTS).map(([x, y]) => ({ x, y, jersey: home, cap: [46, 100, 200] as Figure['cap'] })),
  { x: -4, y: 1, jersey: away, cap: [179, 34, 46] }, { x: BASE_SPOTS[1][0], y: BASE_SPOTS[1][1], jersey: away, cap: [179, 34, 46] },
];
for (const [w, h, tag] of [[360, 225, 'desktop'], [640, 270, 'wide'], [130, 281, 'phone']] as const) {
  for (const light of ['day', 'dusk', 'night'] as const) {
    if (tag !== 'desktop' && light !== 'dusk') continue;
    const t0 = performance.now();
    const base = renderBallpark(w, h, light);
    const px = tag === 'desktop' && light === 'night' ? drawFigures(base, w, h, figures) : base;
    const ms = performance.now() - t0;
    writeFileSync(`${out}/${tag}-${light}.png`, encodePng(px, w, h, tag === 'phone' ? 3 : 2));
    console.log(`${tag} ${light}: ${w}x${h} art px in ${ms.toFixed(1)} ms`);
  }
}
