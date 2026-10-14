# Baseball Gods — notes for Claude Code

Read DESIGN.md before changing engine behavior. Keep this file short.

## Commands
- `npm ci --legacy-peer-deps` — install (vitest's optional esbuild peer conflicts with the pinned esbuild)
- `npm run play` — build the browser game and serve it at http://localhost:5173
- `npm run smoke` — build, then script a playthrough of every screen in a headless DOM (must pass)
- `npm test` — determinism, count rules, rating monotonicity, calibration (must pass)
- `npm run typecheck`
- `npm run calibrate -- baseline` — retune league dials after changing any at-bat parameter
- `npm run report -- baseline` — one full season: league line, pitch metrics, leaderboards, log size
- `npm run curves -- baseline` — what each rating does
- `npm run season -- baseline` — a full season: standings, playoff picture, leaders, pitcher usage
- `npm run years -- 20 --check` — 20 seasons back to back against the saved baseline (run after any engine change;
  `--save` records a new baseline once a change is deliberate; `--no-gods` checks the players alone, without decrees)
- `npm run decrees` — what every decree (blessing and curse) does to a season
- `npm run games -- baseline` — a full season of real games: league line, run math, integrity, box score, play-by-play

## Rules
- `src/ui/` is the browser game: views return HTML strings; one delegated click handler in `app.ts`.
  Pixel art is drawn as grids in code (`sprites.ts`, `ballpark.ts`); any sprite can be swapped for a PNG later.
- UI changes: run `npm run smoke`, and look at the page before calling it done.
- The clubhouse (`src/ui/clubhouse/`) is plain JS appended by the build; it reaches the game through `window.__bg`
  (`render`, `act`, `screen`, `game`), so keep those stable. The smoke test runs on the dashboard (no canvas in a
  headless DOM); check the clubhouse in a real browser.
- The build output must match what's published: never patch the published page by hand. Change the source, rebuild.
- `src/engine/` never imports UI code or touches the DOM. It must run in Node.
- All randomness goes through `Rng` (src/engine/rng.ts). Never `Math.random()`.
- Changed a sensitivity or base in `atbat/params.ts`? Re-run calibrate, then tests.
- New pictures (cards, Gods, logos, portraits) get an art slot: `artSlot()` in `src/ui/art.ts`, shown as a color block
  until art arrives; the art kit picks it up on its own.
- Record design decisions in DESIGN.md (decisions log). No separate patch/instruction docs.
- Prefer deleting code to adding it. No speculative features.
