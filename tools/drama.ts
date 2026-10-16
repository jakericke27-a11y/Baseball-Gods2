/**
 * The Drama index over a season: win-probability sanity checks, then the spread of scores (median, the top tenth),
 * how often a team's games clear the decision-card bar, and the season's most dramatic games.
 *   npm run drama [seed]
 */
import { BASELINE_ENVIRONMENT, applyEnvironment } from '../src/engine/atbat/environment';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { gameDrama, winProb } from '../src/engine/game/drama';
import { generateLeague } from '../src/engine/generate';
import { createSeason, simToEnd } from '../src/engine/season/season';
import { DRAMA_CARD } from '../src/engine/game/drama';

const seed = Number(process.argv[2] ?? 77);
console.log('Win probability (home):');
for (const [label, a] of [['first pitch', [1, 0, 0, 0, 0]], ['bot 9, tied, 0 out', [9, 1, 0, 0, 0]], ['bot 9, down 1, 2 out, bases loaded', [9, 1, 2, 7, -1]], ['top 9, up 1, 0 out', [9, 0, 0, 0, 1]], ['top 5, up 3', [5, 0, 0, 0, 3]], ['bot 1, down 4', [1, 1, 0, 0, -4]]] as Array<[string, number[]]>)
  console.log(`  ${label.padEnd(36)} ${(100 * winProb(a[0], a[1], a[2], a[3], a[4])).toFixed(1)}%`);
const s = createSeason(generateLeague(seed), applyEnvironment(DEFAULT_PARAMS, BASELINE_ENVIRONMENT), { year: 1, seed, logs: true });
simToEnd(s);
const games = s.results.filter((r) => r.log && r.kind !== 'post').map((r) => ({ r, d: gameDrama(r.log!, r.innings) }));
const sc = games.map((g) => g.d.score).sort((a, b) => a - b);
const q = (p: number) => sc[Math.floor(p * (sc.length - 1))];
console.log(`\n${games.length} games. Drama: 10th pct ${q(0.1)}, median ${q(0.5)}, 75th ${q(0.75)}, 90th ${q(0.9)}, 97th ${q(0.97)}, max ${q(1)}`);
console.log(`At 100: ${sc.filter((x) => x >= 100).length} games; 95+: ${sc.filter((x) => x >= 95).length}; 90+: ${sc.filter((x) => x >= 90).length}`);
console.log(`Card bar ${DRAMA_CARD}: ${(100 * sc.filter((x) => x >= DRAMA_CARD).length / sc.length).toFixed(1)}% of games, about ${(2 * 162 * sc.filter((x) => x >= DRAMA_CARD).length / sc.length / 2).toFixed(1)} a season for one team`);
const moments = new Map<string, number>();
for (const g of games) for (const m of g.d.moments) { const k = m.replace(/\d+ innings/, 'extra innings').replace(/\d+ down/, 'N down').replace(/\d+ late/, 'N late'); moments.set(k, (moments.get(k) ?? 0) + 1); }
console.log(`Moments that break the cap: ${[...moments].map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log('\nThe most dramatic:');
for (const g of games.sort((a, b) => b.d.score - a.d.score).slice(0, 5))
  console.log(`  ${g.d.score}  ${g.r.score[0]}-${g.r.score[1]}${g.r.innings > 9 ? ` (${g.r.innings})` : ''}  swing ${g.d.swing.toFixed(2)}, lead changes ${g.d.leadChanges}, biggest ${(100 * Math.abs(g.d.biggest?.delta ?? 0)).toFixed(0)}%${g.d.moments.length ? ` · ${g.d.moments.join(', ')}` : ''}`);
