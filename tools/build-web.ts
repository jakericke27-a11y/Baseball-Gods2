/**
 * Build the browser game: one self-contained page.
 *   dist/web/index.html     full page, for running locally (npm run play)
 *   dist/web/artifact.html  the same page without the document skeleton, for publishing
 *   dist/web/music/         your soundtrack (copied from public/music)
 *
 * The page is: the game's stylesheet (with the Determination Mono font embedded), the game's
 * script, then the clubhouse (walkable home screen) as its own style + script block between
 * <!-- clubhouse:start --> and <!-- clubhouse:end -->. The clubhouse hooks into the game
 * through window.__bg (set in src/ui/main.ts) and turns itself off if it ever throws.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/ui/main.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none',
});
const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script');
const js = escapeScript(out.outputFiles[0].text);

// Determination Mono, embedded so the page needs no font download. Non-commercial license:
// swap for Pixel Operator (CC0) or Departure Mono (OFL) before any public release.
const fontB64 = readFileSync('src/ui/fonts/determination-mono.ttf').toString('base64');
const fontFace =
  '/* Determination Mono Web, from FontSpace (fontspace.com/determination-mono-web-font-f23209).\n' +
  '   Listed designer: Abacadaba. Based on 8-bit Operator (Grand Chaos Productions), modified by theFIZZYnato.\n' +
  '   License: CC BY-NC-ND (non-commercial, no derivatives). Embedded unmodified. Drawn on a 16px grid. */\n' +
  `@font-face { font-family: 'Determination Mono'; src: url(data:font/ttf;base64,${fontB64}) format('truetype'); font-display: swap; }\n`;
const css = fontFace + readFileSync('src/ui/ui.css', 'utf8');

const clubhouseCss = readFileSync('src/ui/clubhouse/clubhouse.css', 'utf8');
const clubhouseJs = escapeScript(readFileSync('src/ui/clubhouse/clubhouse.js', 'utf8'));
const clubhouse = `<!-- clubhouse:start -->\n<style>${clubhouseCss}</style>\n<script>${clubhouseJs}</script>\n<!-- clubhouse:end -->`;

const fonts = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jacquard+24&family=Atkinson+Hyperlegible:wght@400;700&display=swap">',
].join('\n');
const body = '<canvas id="park" aria-hidden="true"></canvas>\n<div id="app"></div>\n<noscript><p style="padding:24px;font:20px monospace;color:#F2F4FA;background:#050A1C">Baseball Gods needs JavaScript to run.</p></noscript>';
const fragment = `<title>Baseball Gods</title>\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>${js}</script>\n\n${clubhouse}\n\n`;
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>Baseball Gods</title>\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n<script>${js}</script>\n\n${clubhouse}\n</body>\n</html>\n`;
mkdirSync('dist/web/music', { recursive: true });
writeFileSync('dist/web/index.html', full);
writeFileSync('dist/web/artifact.html', fragment);
for (const f of readdirSync('public/music')) copyFileSync(`public/music/${f}`, `dist/web/music/${f}`);
console.log(`dist/web/index.html ${(full.length / 1024).toFixed(0)} KB (game script ${(js.length / 1024).toFixed(0)} KB, clubhouse ${(clubhouseJs.length / 1024).toFixed(0)} KB)`);
