# Baseball Gods

A pixel-art baseball GM sim with a pitch-by-pitch engine, playable in the browser. Design: DESIGN.md.

## Play it
- **In the browser:** the published link (no install).
- **Offline:** open `dist/web/index.html` (double-click). Everything works except loading music from the
  `music` folder, which browsers block for local files. Use `npm run play` for that.

## Run it locally (Windows / Mac / Linux)
1. Install Node.js LTS from nodejs.org (one time).
2. In this folder: `npm install` (one time).
3. `npm run play`, then open http://localhost:5173. This builds the game and serves it, music folder included.

## Commands
- `npm run play` — build and serve the browser game
- `npm run build:web` — build `dist/web/index.html` (local) and `dist/web/artifact.html` (published page)
- `npm run smoke` — build, then play through every screen and a full season in a headless browser DOM
- `npm test` — engine checks: determinism, count rules, ratings, calibration, schedule, full-season replay
- `npm run season -- baseline` — a full season in the terminal: standings, leaders, usage
- `npm run ballpark` — render the pixel ballpark to PNGs in dist/ballpark

## Your music
See MUSIC.md. Short version: drop OGG files in `public/music/`, list them in `public/music/manifest.json`,
run `npm run play`. To hear a track in the game without any of that, use Settings → Music → choose a file.
