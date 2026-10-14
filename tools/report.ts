/**
 * Season report for a calibrated environment.
 *   npx tsx tools/report.ts [preset]
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { DEFAULT_PARAMS } from '../src/engine/atbat/params';
import { applyEnvironment, type LeagueEnvironment } from '../src/engine/atbat/environment';
import { Loc, Outcome, PitchResult, pitchLocOf, pitchResultOf } from '../src/engine/atbat/codes';
import { generateLeague } from '../src/engine/generate';
import { estRunsPerGame, rates, runPaSeason, type Line } from './lib/pa-season';

const preset = process.argv[2] ?? 'baseline';
const env = JSON.parse(readFileSync(`calibration/${preset}.json`, 'utf8')) as LeagueEnvironment;
const params = applyEnvironment(DEFAULT_PARAMS, env);
const league = generateLeague(2026);

runPaSeason(league, params, 1, { log: false }); // JIT warm-up
const noLog = runPaSeason(league, params, 42, { log: false });
const res = runPaSeason(league, params, 42, { log: true });
const T = res.totals, r = rates(T);
const pct = (x: number, d = 1) => (100 * x).toFixed(d) + '%';

console.log(`\n=== ${preset.toUpperCase()} — one season, ${T.games} games ===`);
console.log(`time: ${noLog.ms.toFixed(0)} ms without logging, ${res.ms.toFixed(0)} ms with full pitch log`);
console.log(`PA ${T.PA}  pitches ${T.P}  P/PA ${r.PperPA.toFixed(2)}`);
console.log(`AVG ${r.AVG.toFixed(3)} OBP ${r.OBP.toFixed(3)} SLG ${r.SLG.toFixed(3)}  K ${pct(r.K)} BB ${pct(r.BB)} ` +
  `HR/600 ${r.HR600.toFixed(1)} 2B/600 ${r.D600.toFixed(1)} 3B/600 ${r.T600.toFixed(1)} BABIP ${r.BABIP.toFixed(3)}  est R/G ${estRunsPerGame(T).toFixed(1)}`);

const allP = T.P, inZone = T.pitchesByLoc[Loc.Heart] + T.pitchesByLoc[Loc.Edge];
const swings = T.swingsByLoc.reduce((a, b) => a + b, 0), contact = T.contactByLoc.reduce((a, b) => a + b, 0);
const zSw = (T.swingsByLoc[Loc.Heart] + T.swingsByLoc[Loc.Edge]) / inZone;
const oSw = T.swingsByLoc[Loc.Chase] / T.pitchesByLoc[Loc.Chase];
const zCt = (T.contactByLoc[Loc.Heart] + T.contactByLoc[Loc.Edge]) / (T.swingsByLoc[Loc.Heart] + T.swingsByLoc[Loc.Edge]);
const oCt = T.contactByLoc[Loc.Chase] / T.swingsByLoc[Loc.Chase];
console.log(`\nPitch level: zone ${pct(inZone / allP)}  swing ${pct(swings / allP)}  zone-swing ${pct(zSw)}  chase ${pct(oSw)}  ` +
  `contact ${pct(contact / swings)} (zone ${pct(zCt)}, chase ${pct(oCt)})`);
const pr = T.pitchResults;
console.log(`Pitch outcomes: ball ${pct(pr[PitchResult.Ball] / allP)}  called K ${pct(pr[PitchResult.CalledStrike] / allP)}  ` +
  `swinging K ${pct(pr[PitchResult.SwingingStrike] / allP)}  foul ${pct(pr[PitchResult.Foul] / allP)}  in play ${pct(pr[PitchResult.InPlay] / allP)}`);
const bip = T.bipByType.reduce((a, b) => a + b, 0);
console.log(`Batted balls: GB ${pct(T.bipByType[1] / bip)}  LD ${pct(T.bipByType[2] / bip)}  FB ${pct(T.bipByType[3] / bip)}  ` +
  `PU ${pct(T.bipByType[4] / bip)}  HR/FB ${pct(T.hrByType[3] / T.bipByType[3])}`);

const tail = (k: number) => T.paLength.slice(k).reduce((a, b) => a + b, 0);
console.log(`\nAt-bat length: ` + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}:${pct(T.paLength[n] / T.PA)}`).join(' '));
console.log(`10+ pitch PAs ${tail(10)}  12+ ${tail(12)}  15+ ${tail(15)}  longest ${T.paLength.findLastIndex((c) => c > 0)}`);
console.log(`Strikeouts looking: ${pct(T.kLooking / T.K)} of Ks`);
console.log(`3-pitch Ks ${T.threePitchK}  10+ pitch Ks ${T.tenPlusK}  full-count walks ${T.fullCountWalks}  ` +
  `first-pitch HRs ${T.firstPitchHR} (${pct(T.firstPitchHR / T.HR)} of all HRs)`);

// Leaderboards
const qualified = [...res.batting.entries()].filter(([, l]) => l.PA >= 502);
const name = (id: number) => res.players.get(id)!.name;
const rt = (id: number) => { const x = res.players.get(id)!.ratings; return `pow ${x.power} con ${x.contact} eye ${x.discipline}`; };
const show = (title: string, rows: Array<[number, Line]>, fmt: (l: Line) => string) => {
  console.log(`\n${title}`);
  for (const [id, l] of rows) console.log(`  ${name(id).padEnd(18)} ${fmt(l).padEnd(34)} (${rt(id)})`);
};
const by = (f: (l: Line) => number) => [...qualified].sort((a, b) => f(b[1]) - f(a[1]));
const avg = (l: Line) => l.H / l.AB;
show('HR leaders', by((l) => l.HR).slice(0, 5), (l) => `${l.HR} HR, ${avg(l).toFixed(3)}, ${l.PA} PA`);
show('Batting average leaders', by(avg).slice(0, 5), (l) => `${avg(l).toFixed(3)}, ${l.HR} HR, ${pct(l.K / l.PA)} K`);
const hrs = qualified.map(([, l]) => l.HR).sort((a, b) => a - b), avgs = qualified.map(([, l]) => avg(l)).sort((a, b) => a - b);
const ks = qualified.map(([, l]) => l.K / l.PA).sort((a, b) => a - b), bbs = qualified.map(([, l]) => l.BB / l.PA).sort((a, b) => a - b);
const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
console.log(`\nSpread among ${qualified.length} qualified hitters (min / median / max):`);
console.log(`  HR ${hrs[0]} / ${q(hrs, 0.5)} / ${hrs[hrs.length - 1]}   AVG ${avgs[0].toFixed(3)} / ${q(avgs, 0.5).toFixed(3)} / ${avgs[avgs.length - 1].toFixed(3)}`);
console.log(`  K% ${pct(ks[0])} / ${pct(q(ks, 0.5))} / ${pct(ks[ks.length - 1])}   BB% ${pct(bbs[0])} / ${pct(q(bbs, 0.5))} / ${pct(bbs[bbs.length - 1])}`);
const sp = [...res.pitching.entries()].filter(([, l]) => l.outs >= 486);
const kp = sp.map(([, l]) => l.K / l.PA).sort((a, b) => a - b);
console.log(`  Qualified pitchers: ${sp.length}, K% ${pct(kp[0])} / ${pct(q(kp, 0.5))} / ${pct(kp[kp.length - 1])}`);

// Log size
const raw = res.log!;
const gz = gzipSync(raw, { level: 6 });
const fullFormat = T.PA * 14 + T.P; // + ~6 bytes/PA of game context once the game loop exists
console.log(`\nPitch log this season: ${(raw.length / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzipped ` +
  `(${(raw.length / T.PA).toFixed(1)} bytes per PA incl. pitches)`);
console.log(`With full game context (~14 B/PA + 1 B/pitch): ~${(fullFormat / 1e6).toFixed(1)} MB raw, ` +
  `~${((fullFormat * gz.length) / raw.length / 1e6).toFixed(1)} MB gzipped per season`);

// Decode one long at-bat straight from the bytes
const WORD: Record<number, string> = {
  [PitchResult.Ball]: 'ball', [PitchResult.CalledStrike]: 'called strike', [PitchResult.SwingingStrike]: 'swinging strike',
  [PitchResult.Foul]: 'foul', [PitchResult.InPlay]: 'in play', [PitchResult.HitByPitch]: 'hit by pitch',
};
const LOCW: Record<number, string> = { [Loc.Heart]: 'middle', [Loc.Edge]: 'corner', [Loc.Chase]: 'off the plate' };
const OUT: Record<number, string> = {
  [Outcome.StrikeoutSwinging]: 'strikes out swinging', [Outcome.StrikeoutLooking]: 'strikes out looking',
  [Outcome.Walk]: 'walks', [Outcome.HitByPitch]: 'is hit by the pitch', [Outcome.Single]: 'singles', [Outcome.Double]: 'doubles',
  [Outcome.Triple]: 'triples', [Outcome.HomeRun]: 'HOMERS', [Outcome.GroundOut]: 'grounds out', [Outcome.FlyOut]: 'flies out',
  [Outcome.LineOut]: 'lines out', [Outcome.PopOut]: 'pops out',
};
for (let i = 0; i < raw.length;) {
  const bat = raw[i] | (raw[i + 1] << 8), pit = raw[i + 2] | (raw[i + 3] << 8), out = raw[i + 4], n = raw[i + 7];
  if (n >= 12 && (out === Outcome.HomeRun || out === Outcome.Double || out === Outcome.StrikeoutSwinging)) {
    let b = 0, s = 0; const steps: string[] = [];
    for (let k = 0; k < n; k++) {
      const byte = raw[i + 8 + k], pr2 = pitchResultOf(byte);
      steps.push(`${b}-${s} ${WORD[pr2]} (${LOCW[pitchLocOf(byte)]})`);
      if (pr2 === PitchResult.Ball) b++; else if (pr2 === PitchResult.CalledStrike || pr2 === PitchResult.SwingingStrike) s++;
      else if (pr2 === PitchResult.Foul && s < 2) s++;
    }
    console.log(`\nDecoded from the log — ${name(bat)} vs ${name(pit)}, ${n} pitches:\n  ` + steps.join(', ') + `\n  → ${name(bat)} ${OUT[out]}.`);
    break;
  }
  i += 8 + n;
}
