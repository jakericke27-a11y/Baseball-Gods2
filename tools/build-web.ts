/**
 * Build the browser game: one self-contained page.
 *   dist/web/index.html     full page, for running locally (npm run play)
 *   dist/web/artifact.html  the same page without the document skeleton, for publishing
 *   dist/web/music/         your soundtrack (copied from public/music)
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/ui/main.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/ui/ui.css', 'utf8');
const fonts = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jacquard+24&family=Pixelify+Sans:wght@400;600;700&family=VT323&family=Atkinson+Hyperlegible:wght@400;700&display=swap">',
].join('\n');
const body = '<canvas id="park" aria-hidden="true"></canvas>\n<div id="app"></div>\n<noscript><p style="padding:24px;font:20px monospace;color:#F2F4FA;background:#050A1C">Baseball Gods needs JavaScript to run.</p></noscript>';
const fragment = `<title>Baseball Gods</title>\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>${js}</script>\n`;
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>Baseball Gods</title>\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n<script>${js}</script>\n</body>\n</html>\n`;
mkdirSync('dist/web/music', { recursive: true });
writeFileSync('dist/web/index.html', full);
writeFileSync('dist/web/artifact.html', fragment);
for (const f of readdirSync('public/music')) copyFileSync(`public/music/${f}`, `dist/web/music/${f}`);
console.log(`dist/web/index.html ${(full.length / 1024).toFixed(0)} KB (script ${(js.length / 1024).toFixed(0)} KB)`);
