/**
 * Full-season report through the real game loop.
 *   npx tsx tools/games.ts [preset]
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { boxScore, playByPlay } from '../src/engine/game/text';
import { MOMENT_NAMES } from '../src/engine/game/types';
import { baseRuns, rates } from './lib/pa-season';
import { runGameSeason } from './lib/game-season';

const preset = process.argv[2] ?? 'baseline';
const env = JSON.parse(readFileSync(`calibration/${preset}.json`, 'utf8')) as LeagueEnvironment;
const params = applyEnvironment(DEFAULT_PARAMS, env);
const league = generateLeague(2026);

runGameSeason(league, params, 1); // JIT warm-up
const quick = runGameSeason(league, params, 42);
const s = runGameSeason(league, params, 42, { log: true, keep: 40 });
const T = s.totals, r = rates(T), tg = 2 * s.games;
const pct = (x: number) => (100 * x).toFixed(1) + '%';
const per = (x: number) => (x / tg).toFixed(2);

console.log(`\n=== ${preset.toUpperCase()} — ${s.games} real games ===`);
console.log(`time: ${quick.ms.toFixed(0)} ms per season (${(s.ms).toFixed(0)} ms with full logging)`);
console.log(`AVG ${r.AVG.toFixed(3)} OBP ${r.OBP.toFixed(3)} SLG ${r.SLG.toFixed(3)}  K ${pct(r.K)} BB ${pct(r.BB)} HR/600 ${r.HR600.toFixed(1)} ` +
  `2B/600 ${r.D600.toFixed(1)} 3B/600 ${r.T600.toFixed(1)}  P/PA ${r.PperPA.toFixed(2)}  SwStr ${pct(s.pitchResults[2] / T.P)}`);
const expected = baseRuns(T);
console.log(`Runs/game ${(s.runs / s.games).toFixed(2)}  —  the batting line implies ${(expected / s.games).toFixed(2)} ` +
  `(${((100 * s.runs) / expected - 100).toFixed(1)}%)   RBI/R ${(T.RBI / s.runs).toFixed(3)}`);
console.log(`Per team-game (2019 MLB in brackets): SB ${per(T.SB)} [0.47]  CS ${per(T.CS)} [0.17]  GIDP ${per(T.GIDP)} [0.71]  ` +
  `SF ${per(T.SF)} [0.24]  E ${per(s.errors)} [0.60]  HBP ${per(T.HBP)} [0.41]  LOB ${per(s.lob)}`);
console.log(`Starters: ${pct(s.starterOuts / s.allOuts)} of innings [~55%], ${(s.starterOuts / 3 / s.starts).toFixed(2)} IP per start [~5.0], ` +
  `CG ${s.completeGames} [~45], team shutouts ${s.shutouts} [~268]`);
const I = s.integrity;
console.log(`Integrity: run-credit mismatches ${I.runsMismatch}, RBI>R ${I.rbiOverRuns}, ER>R ${I.erOverRuns}, ` +
  `outs mismatches ${I.outsMismatch}, games missing W/L ${I.missingDecision}`);

const wins = [...s.wins.values()].sort((a, b) => b - a);
console.log(`Best record ${wins[0]}-${162 - wins[0]}, worst ${wins[wins.length - 1]}-${162 - wins[wins.length - 1]}`);
console.log(`\nMoments (per season):`);
console.log('  ' + MOMENT_NAMES.map((n, k) => `${n}: ${s.moments[k]}`).join('  |  '));

const name = (id: number) => s.players.get(id)!.name;
const qual = [...s.batting.entries()].filter(([, l]) => l.PA >= 502);
const top = (f: (l: (typeof qual)[0][1]) => number, n = 3) => [...qual].sort((a, b) => f(b[1]) - f(a[1])).slice(0, n);
console.log(`\nHR: ${top((l) => l.HR).map(([id, l]) => `${name(id)} ${l.HR}`).join(', ')}   ` +
  `RBI: ${top((l) => l.RBI).map(([id, l]) => `${name(id)} ${l.RBI}`).join(', ')}   ` +
  `SB: ${top((l) => l.SB).map(([id, l]) => `${name(id)} ${l.SB}`).join(', ')}`);
const pit = [...s.pitching.entries()];
const era = (p: (typeof pit)[0][1]) => (27 * p.ER) / Math.max(1, p.outs);
const sps = pit.filter(([, p]) => p.outs >= 486).sort((a, b) => era(a[1]) - era(b[1]));
console.log(`ERA (162+ IP): ${sps.slice(0, 3).map(([id, p]) => `${name(id)} ${era(p).toFixed(2)} (${p.W}-${p.L}, ${Math.floor(p.outs / 3)} IP)`).join(', ')}  |  ` +
  `qualified: ${sps.length}, league ERA ${((27 * pit.reduce((a, [, p]) => a + p.ER, 0)) / pit.reduce((a, [, p]) => a + p.outs, 0)).toFixed(2)}`);
const sv = pit.sort((a, b) => b[1].SV - a[1].SV).slice(0, 3);
console.log(`Saves: ${sv.map(([id, p]) => `${name(id)} ${p.SV}`).join(', ')}   most starts: ${Math.max(...pit.map(([, p]) => p.GS))}`);
console.log(`\nLog: ${(s.logBytes / 1e6).toFixed(2)} MB raw per season, ` +
  `~${((s.logBytes * gzipSync(s.kept[0].log!).length) / s.kept[0].log!.length / 1e6).toFixed(2)} MB gzipped (est.)`);

// A dramatic sample game: prefer one with a walk-off or a late go-ahead homer.
const pick = s.kept.find((g) => g.moments.some((m) => m.kind === 1)) ?? s.kept[0];
const teamName = (id: number) => `Team ${String(id).padStart(2, '0')}`;
console.log('\n' + boxScore(pick, name, teamName));
const lines = playByPlay(pick.log!, name, [teamName(pick.teamIds[0]), teamName(pick.teamIds[1])], 'full');
const lastHeader = lines.map((l, k) => (l.startsWith('\n') ? k : -1)).filter((k) => k >= 0).slice(-3)[0];
console.log('\nPlay-by-play (last innings):' + lines.slice(lastHeader).join('\n'));
