/**
 * Play a full season and print standings, leaders and pitcher usage.
 *   npx tsx tools/season.ts [preset] [seed]
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { generateLeague } from '../src/engine/generate';
import { divisionStandings } from '../src/engine/season/season';
import { MOMENT_NAMES } from '../src/engine/game/types';
import { runGameSeason } from './lib/game-season';
import { rates } from './lib/pa-season';

const preset = process.argv[2] ?? 'baseline';
const seed = Number(process.argv[3] ?? 42);
const env = JSON.parse(readFileSync(`calibration/${preset}.json`, 'utf8')) as LeagueEnvironment;
const league = generateLeague(2026);
const r = runGameSeason(league, applyEnvironment(DEFAULT_PARAMS, env), seed);
const s = r.season;
const LEAGUES = ['League A', 'League B'], DIVS = ['East', 'Central', 'West'];
const teamName = (id: number) => `Team ${String(id).padStart(2, '0')}`;
const name = (id: number) => r.players.get(id)!.name;
const pct = (w: number, l: number) => (w / Math.max(1, w + l)).toFixed(3).replace(/^0/, '');

console.log(`\n=== YEAR ${s.year} (${preset}) — ${r.games} games over ${s.schedule.days} days, simmed in ${(r.ms / 1000).toFixed(1)} s ===`);
const tables = divisionStandings(s);
for (const lg of [0, 1]) {
  console.log(`\n${LEAGUES[lg]}`);
  const lgTables = tables.filter((t) => t.league === lg);
  for (const t of lgTables) {
    console.log(`  ${DIVS[t.division].padEnd(10)}   W   L   PCT    GB   RS   RA  Home   Away  Strk  L10`);
    for (const row of t.rows) {
      const l10 = row.last10.reduce((a, b) => a + b, 0);
      console.log(`  ${teamName(row.teamId).padEnd(10)} ${String(row.W).padStart(3)} ${String(row.L).padStart(3)}  ${pct(row.W, row.L)} ${(row.gb ? row.gb.toFixed(1) : '—').padStart(5)}` +
        ` ${String(row.RS).padStart(4)} ${String(row.RA).padStart(4)} ${`${row.homeW}-${row.homeL}`.padStart(6)} ${`${row.awayW}-${row.awayL}`.padStart(6)}` +
        ` ${(row.streak > 0 ? 'W' + row.streak : 'L' + -row.streak).padStart(5)} ${`${l10}-${10 - l10}`.padStart(5)}`);
    }
  }
  // 2019 format: three division winners + two wild cards.
  const winners = lgTables.map((t) => t.rows[0]).sort((a, b) => b.W - a.W);
  const wild = lgTables.flatMap((t) => t.rows.slice(1)).sort((a, b) => b.W - a.W).slice(0, 2);
  console.log(`  Playoffs: ${winners.map((w, i) => `#${i + 1} ${teamName(w.teamId)} (${w.W}-${w.L})`).join(', ')}; ` +
    `wild cards ${wild.map((w) => `${teamName(w.teamId)} (${w.W}-${w.L})`).join(' vs ')}`);
}

const lr = rates(r.totals);
console.log(`\nLeague: ${lr.AVG.toFixed(3)}/${lr.OBP.toFixed(3)}/${lr.SLG.toFixed(3)}, ${(r.runs / r.games).toFixed(2)} runs/game, ` +
  `K ${(100 * lr.K).toFixed(1)}%, BB ${(100 * lr.BB).toFixed(1)}%, HR/600 ${lr.HR600.toFixed(1)}`);

const bats = [...r.batting.entries()].filter(([, l]) => l.PA >= 502);
const lead = <T>(rows: Array<[number, T]>, f: (x: T) => number, fmt: (x: T) => string, asc = false) =>
  [...rows].sort((a, b) => (asc ? f(a[1]) - f(b[1]) : f(b[1]) - f(a[1]))).slice(0, 3).map(([id, x]) => `${name(id)} ${fmt(x)}`).join(', ');
console.log(`AVG: ${lead(bats, (l) => l.H / l.AB, (l) => (l.H / l.AB).toFixed(3))}`);
console.log(`HR:  ${lead(bats, (l) => l.HR, (l) => String(l.HR))}    RBI: ${lead(bats, (l) => l.RBI, (l) => String(l.RBI))}`);
console.log(`SB:  ${lead(bats, (l) => l.SB, (l) => String(l.SB))}`);
const arms = [...r.pitching.entries()];
const qual = arms.filter(([, p]) => p.outs >= 486);
const era = (p: (typeof arms)[0][1]) => (27 * p.ER) / Math.max(1, p.outs);
console.log(`W:   ${lead(arms, (p) => p.W, (p) => `${p.W}-${p.L}`)}    ERA: ${lead(qual, era, (p) => era(p).toFixed(2), true)}`);
console.log(`K:   ${lead(arms, (p) => p.K, (p) => String(p.K))}    SV: ${lead(arms, (p) => p.SV, (p) => String(p.SV))}`);
const relief = arms.filter(([, p]) => p.GS === 0);
console.log(`Relief IP: ${lead(relief, (p) => p.outs, (p) => `${Math.floor(p.outs / 3)} (${p.G} G)`)}`);

const tg = 2 * r.games, avgP = r.pitchersUsed.reduce((a, c, k) => a + c * k, 0) / tg;
const upTo3 = (r.pitchersUsed[1] + r.pitchersUsed[2] + r.pitchersUsed[3]) / tg;
console.log(`\nUsage: ${avgP.toFixed(2)} pitchers per team-game (${(100 * upTo3).toFixed(0)}% of games use 3 or fewer), ` +
  `starters ${(r.starterOuts / 3 / r.starts).toFixed(1)} IP/start, ${r.completeGames} complete games, most starts ${Math.max(...arms.map(([, p]) => p.GS))}`);
console.log('Moments: ' + MOMENT_NAMES.map((n, k) => `${n} ${r.moments[k]}`).join(' · '));
