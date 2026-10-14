/**
 * Many years back to back: is the league stable? Ages, talent (spread and top end), the league line,
 * retirements and signings, year by year. Nothing is recalibrated between years.
 *   npm run years -- 20 [seed]
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { playerValue } from '../src/engine/development';
import { generateLeague } from '../src/engine/generate';
import { nextSeason } from '../src/engine/offseason';
import { activeOf, RULES } from '../src/engine/roster';
import { createSeason, simDays, simToEnd, type Season } from '../src/engine/season/season';

const N = Number(process.argv[2] ?? 20), SEED = Number(process.argv[3] ?? 2026);
const P = applyEnvironment(DEFAULT_PARAMS, JSON.parse(readFileSync('calibration/baseline.json', 'utf8')) as LeagueEnvironment);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const f = (x: number, d = 1) => x.toFixed(d);

function line(s: Season) {
  let PA = 0, AB = 0, H = 0, HR = 0, K = 0, BB = 0, R = 0;
  for (const b of s.batting.values()) { PA += b.PA; AB += b.AB; H += b.H; HR += b.HR; K += b.K; BB += b.BB; R += b.R; }
  const games = s.results.filter((g) => g.kind !== 'post').length;
  return { AVG: H / AB, HR600: (600 * HR) / PA, K: K / PA, BB: BB / PA, RG: R / games };
}

console.log(`year  age   <25%  33+%   val   sd   top30  hit   pit  |  AVG   HR/600  K%    BB%   R/G  | retire sign  FA   champ`);
let s = createSeason(generateLeague(SEED), P, { year: 1, seed: SEED, postseason: true, rosterRules: true });
const t0 = performance.now();
let illegal = 0, moves = 0;
for (let y = 1; y <= N; y++) {
  const L = s.league.players;
  const vals = L.map(playerValue).sort((a, b) => b - a);
  // roster legality, checked every 20 days through the year
  for (; s.day < s.regularDays; simDays(s, 20)) for (const t of s.league.teams) {
    const act = activeOf(t), arms = act.filter((id) => s.players.get(id)?.position === 'P').length;
    if (t.playerIds.length > RULES.forty || act.length !== RULES.active || arms !== RULES.pitchers || !act.every((id) => t.playerIds.includes(id))) illegal++;
  }
  simToEnd(s);
  moves += s.league.teams.reduce((n, t) => n + (t.moves?.count ?? 0), 0);
  const l = line(s);
  const champ = s.post?.champion ?? 0;
  const { season, report } = y < N ? nextSeason(s) : { season: s, report: null };
  console.log(`${String(y).padStart(4)}  ${f(mean(L.map((p) => p.age)))}  ${f(100 * L.filter((p) => p.age < 25).length / L.length, 0).padStart(4)}  ${f(100 * L.filter((p) => p.age >= 33).length / L.length, 0).padStart(4)}  ` +
    `${f(mean(vals))}  ${f(sd(vals))}  ${f(mean(vals.slice(0, 30)))}  ${f(mean(L.filter((p) => p.position !== 'P').map(playerValue)))}  ${f(mean(L.filter((p) => p.position === 'P').map(playerValue)))}  |  ` +
    `${l.AVG.toFixed(3)}  ${f(l.HR600).padStart(5)}  ${f(100 * l.K)}  ${f(100 * l.BB, 1).padStart(4)}  ${f(l.RG, 2)}  |  ${String(report?.retirements.length ?? '').padStart(4)}  ${String(report?.signings.length ?? '').padStart(4)}  ${String(s.league.freeAgents.length).padStart(4)}  ${champ}`);
  s = season;
}
console.log(`\n${N} years in ${f((performance.now() - t0) / 1000)} s · illegal rosters seen: ${illegal} · AI moves in the last month of each year: ${moves}`);
