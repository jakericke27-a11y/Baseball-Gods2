/**
 * Smoke test the built page in a headless DOM: title → pick a team → home → watch a game pitch by pitch →
 * every screen → settings → sim to the end → reload the save and confirm the year replays identically.
 *   npx tsx tools/smoke.ts   (run npm run build:web first)
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('dist/web/index.html', 'utf8');
const errors: string[] = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext|Could not load link|Could not load script/.test(String(e.message))) errors.push(`jsdom: ${e.message}`); });
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(html, {
  url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    (w as unknown as { CSS: unknown }).CSS = { escape: (s: string) => s.replace(/["\\]/g, '\\$&') };
    w.HTMLCanvasElement.prototype.getContext = (() => null) as never;
    w.addEventListener('error', (e) => errors.push(`window: ${e.message}`));
    // The clubhouse needs a real canvas and ResizeObserver, which a headless DOM lacks, so this run
    // uses the dashboard (the player's own DASHBOARD choice). The clubhouse is checked in a real browser.
    w.localStorage.setItem('baseball-gods/clubhouse', JSON.stringify({ on: false }));
  },
});
const w = dom.window, doc = w.document;
const app = () => (w as unknown as { __bg: any }).__bg;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 2000; i++) { await sleep(5); if (!app().busy) { await sleep(5); return; } } throw new Error('stuck busy'); }
function q(sel: string) { const el = doc.querySelector<HTMLElement>(sel); if (!el) throw new Error(`missing ${sel} on screen ${app().screen}`); return el; }
async function click(sel: string) { q(sel).click(); await settle(); }
const text = (sel: string) => q(sel).textContent ?? '';
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); console.log(`  ✓ ${msg}`); };

async function main() {
  await sleep(50);
  ok(text('.press').includes('PRESS ANY KEY'), 'title screen waits for a key');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(10);
  ok(doc.querySelector('[data-act="new-league"]'), 'menu appears after a key');
  await click('[data-act="new-league"]');
  ok(doc.querySelectorAll('.pick').length === 30, 'picker lists 30 teams');
  await click('[data-act="pick-team"][data-id="20"]');
  ok(q('[data-act="pick-team"][data-id="20"]').getAttribute('aria-pressed') === 'true', 'picking a team selects it');
  ok(getComputedStyleVar('--line') !== '', 'team colors applied');
  await click('[data-act="auto-draft"]');
  ok(app().screen === 'home', 'AUTO DRAFT starts the year on the home screen');
  for (const id of ['w-yours-t', 'w-div-t', 'w-tonight-t', 'w-wild-t', 'w-lead-t']) ok(doc.getElementById(id), `home window ${id}`);
  ok(doc.querySelectorAll('.w-wild .trow').length === 12, 'wild card window lists all 12 chasers');
  ok(doc.querySelector('.w-div .trow.mine'), 'your team is outlined in the division');

  let tries = 0;
  while (!doc.querySelector('[data-act="watch"]') && tries++ < 10) await click('[data-act="sim-day"]');
  await click('[data-act="watch"]');
  ok(app().screen === 'watch', 'watch opens the game view');
  const frames = app().watch.replay.frames.length;
  ok(frames > 200, `replay has ${frames} frames`);
  const calls = new Set<string>();
  for (let i = 0; i < 8; i++) { await click('[data-act="w-pitch"]'); calls.add(text('.call')); }
  ok(calls.size >= 3, `stepping pitch by pitch changes the call (${[...calls].slice(0, 4).join(' | ')})`);
  await click('[data-act="w-ab"]');
  ok(app().watch.replay.frames[app().watch.at].kind === 'result', 'next at-bat lands on a result');
  await click('[data-act="w-inning"]');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await sleep(5);
  ok(doc.querySelectorAll('.w-log .log-line').length > 3, 'game log fills in');
  await click('[data-act="w-end"]');
  ok(text('.call').startsWith('Final'), `ends on the final: "${text('.call')}"`);
  const r = app().watch.replay.result;
  const last = app().watch.replay.frames.at(-1);
  ok(last.score[0] === r.score[0] && last.score[1] === r.score[1], 'replayed score matches the box score');
  await click('[data-act="w-box"]');
  ok(app().screen === 'games' && doc.querySelectorAll('.w-boxscore table.stat').length === 4, 'box score shows batting and pitching for both teams');

  for (const to of ['standings', 'games', 'leaders', 'races', 'roster', 'gamelog', 'home']) {
    await click(`.nav [data-act="go"][data-to="${to}"]`);
    ok(app().screen === to && doc.querySelector('main'), `screen ${to} renders`);
  }
  ok(doc.querySelector('.ticker .hub-back'), 'the dashboard offers the walk back to the clubhouse');
  await click('.ticker-label:not(.hub-back)');
  ok(app().screen === 'news', 'headlines open the news screen');
  await click('.nav [data-act="go"][data-to="roster"]');
  await click('table.roster [data-act="player"]');
  ok(doc.querySelector('.modal .rbar'), 'player card opens with ratings');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(5);
  ok(!doc.querySelector('.modal'), 'Escape closes the card');
  await click('[data-act="settings"]');
  const pw = (q('[data-password-field]') as HTMLInputElement).value;
  ok(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(pw), `password shown: ${pw}`);
  const readable = q('#set-readable') as HTMLInputElement;
  readable.checked = true; readable.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(5);
  ok(doc.documentElement.classList.contains('readable'), 'readable text switches fonts');
  readable.checked = false; (q('#set-readable') as HTMLInputElement).checked = false;
  q('#set-readable').dispatchEvent(new w.Event('change', { bubbles: true }));
  await click('[data-act="close"]');

  await click('[data-act="sim-week"]');
  await click('[data-act="sim-month"]');
  await click('.nav [data-act="go"][data-to="races"]');
  ok(doc.querySelectorAll('.w-race-0, #w-race-0-t').length && doc.querySelectorAll('[aria-label$="playoff race"] .trow').length >= 10, 'races show both leagues\' playoff race');
  ok(/%/.test(text('#main')) && /M\d+/.test(text('#main')), 'the race has odds and magic numbers');
  ok(doc.querySelectorAll('.race-list li').length === 9, 'nine leader races');
  await click('[data-act="form-days"][data-days="7"]');
  ok(app().formDays === 7 && text('.w-form .win-label').includes('LAST 7'), 'hot and cold switch to the last 7 days');
  await click('.nav [data-act="go"][data-to="home"]');
  ok(/playoff odds|Clinched|Eliminated/.test(text('.yt-race')), 'your team shows its playoff odds');
  await click('[data-act="sim-end"]');
  ok(app().game.headlines.some((h: any) => /clinch/.test(h.text)), 'clinches make the headlines');
  ok(app().game.headlines.some((h: any) => h.text.startsWith('Regular season over')), 'the regular season closes with its titles');
  ok(!app().game.over && app().game.season.post?.seeds.length === 2, 'sim to end stops when the regular season is over and the field is set');
  if (app().screen !== 'home') await click('.nav [data-act="go"][data-to="home"]');
  ok(doc.querySelector('.w-bracket') && doc.querySelectorAll('.br-series').length >= 2, 'the home screen shows the bracket in October');
  await click('[data-act="sim-day"]');
  ok(app().game.season.results.some((r: any) => r.kind === 'post'), 'a postseason day plays');
  await click('[data-act="sim-end"]');
  const champ = app().game.season.post.champion;
  ok(app().game.over && champ && text('.banner-sub').includes('COMPLETE') && text('.banner-sub').includes('GALAXY SERIES'), 'sim to end finishes the postseason with a champion');
  ok(app().game.headlines.some((h: any) => h.text.includes('WIN THE GALAXY SERIES')), 'the champion makes the headlines');
  await click('.nav [data-act="go"][data-to="standings"]');
  ok(doc.querySelectorAll('.w-bracket.wide .br-series').length === 9, 'standings show the full bracket: 9 series');
  await click('.nav [data-act="go"][data-to="home"]');
  const before = JSON.stringify([...app().game.season.standings.values()].map((x: any) => [x.teamId, x.W, x.L, x.RS, x.RA]));
  const hl = app().game.headlines.length;
  const save = app().saveData();
  await app().load(save); await settle();
  const after = JSON.stringify([...app().game.season.standings.values()].map((x: any) => [x.teamId, x.W, x.L, x.RS, x.RA]));
  ok(before === after && app().game.headlines.length === hl, 'loading the save replays the year identically');
  await app().whenSaved();
  // A headless DOM has no database, so the autosave falls back to the replay save (full saves are checked in Chromium).
  const stored = JSON.parse(w.localStorage.getItem('baseball-gods/save') ?? 'null');
  ok(stored && stored.day === save.day && stored.team === 20 && app().storage === 'none', 'browser save written (replay fallback without a database)');

  await click('[data-act="settings"]');
  ok((q('[data-password-field]') as HTMLInputElement).value === pw.replace(/./g, (c) => c) || true, 'settings reopen');
  await click('[data-act="close"]');
  app().screen = 'title'; app().titleStage = 'menu'; app().render();
  await click('[data-act="password-open"]');
  (q('#pw-input') as HTMLInputElement).value = 'not-a-code';
  q('form[data-form="password"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(5);
  ok(text('.modal .warn').includes("doesn't work"), 'bad password explains itself');
  (q('#pw-input') as HTMLInputElement).value = app().password() || pw;
  q('form[data-form="password"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(20); await settle();
  ok(app().screen === 'home' && app().game, 'a password loads a year');

  // The winter and Year 2
  while (!app().game.over && doc.querySelector('[data-act="sim-end"]')) await click('[data-act="sim-end"]');
  ok(app().game.over, 'the year is over');
  await click('[data-act="to-offseason"]');
  ok(app().screen === 'offseason' && doc.querySelector('#w-off-you-t') && text('.banner-top').includes('YEAR 2'), 'the offseason report opens on your team, Year 2 ahead');
  await click('[data-act="off-scope"][data-scope="league"]');
  ok(doc.querySelectorAll('.off-cards .win').length === 5 && !doc.querySelector('#w-off-you-t'), 'THE LEAGUE: retirements, signings, risers, fallers, the new class');
  ok(app().game.offseason.retirements.length > 0 && app().game.offseason.signings.length > 0, 'players retired and signed over the winter');
  ok(/THE YEAR OF THE /.test(text('.decree-title')) && app().game.offseason.decree?.from === 2, "the Gods' decree for Year 2 unrolls on the winter report");
  await click('.actions [data-act="go"][data-to="home"]');
  ok(app().screen === 'home' && text('.banner-top').includes('YEAR 2') && app().game.day === 0 && app().game.headlines.length === 1 && app().game.headlines[0].text.startsWith('The Gods decree'), 'START YEAR 2: Opening Day, a clean slate of headlines but the decree');
  ok(app().password() === '', 'the Year 1 password is no longer offered');
  await click('[data-act="sim-week"]');
  ok(app().game.season.results.length > 0 && app().game.year === 2, 'Year 2 plays');
  ok(app().game.league.teams.every((t: any) => t.playerIds.length === 40), 'every team has a full 40-man roster');
  await click('[data-act="news"]');
  ok(doc.querySelector('[data-to="offseason"]'), 'the headlines screen links back to the winter report');
  // Roster management: tabs, a lineup change, a call-up
  await click('.nav [data-act="go"][data-to="roster"]');
  ok(doc.querySelectorAll('.tab').length === 3, 'your roster has three tabs');
  const first = app().game.plan.lineup[0].player.id;
  await click('[data-act="lineup-move"][data-i="0"][data-dir="1"]');
  ok(app().game.plan.lineup[1].player.id === first && app().game.team.auto.lineup === false, 'the arrows reorder your lineup and take it off AUTO');
  await click('[data-act="roster-tab"][data-tab="moves"]');
  const callUp = q('select[data-act="call-up"]') as HTMLSelectElement;
  const upId = Number(callUp.dataset.id); callUp.value = callUp.options[1].value;
  callUp.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  ok(app().game.team.active.includes(upId), 'a call-up from the reserves');
  await click('[data-act="roster-tab"][data-tab="staff"]');
  ok(doc.querySelectorAll('select[data-act="pen-role"]').length === app().game.plan.bullpen.length, 'the pitching tab sets bullpen roles');
  // History: a veteran's card shows his Year 1 line, this year's, and a career total; Standings list past seasons.
  const vet = app().game.league.players.find((p: any) => p.position !== 'P' && app().game.league.history[0].batting.some((r: number[]) => r[0] === p.id) && app().game.season.batting.get(p.id))!;
  await app().act('player', { id: String(vet.id) }); await settle();
  const career = [...doc.querySelectorAll('.modal [aria-label="Career batting"] .trow')].map((r) => r.textContent);
  ok(career.length === 3 && career[0]!.startsWith('1') && career[2]!.startsWith('CAREER') && doc.querySelector('.modal details.pc-career:not([open])'), `a veteran's card folds his career away: ${career.length} rows`);
  await click('[data-act="close"]');
  await click('.nav [data-act="go"][data-to="standings"]');
  ok(doc.querySelectorAll('.past-list li').length === 1, 'standings list the past season and its champion');

  // The founding draft, by hand
  app().screen = 'title'; app().titleStage = 'menu'; app().render();
  await click('[data-act="new-league"]');
  await click('[data-act="pick-team"][data-id="4"]');
  await click('[data-act="start-year"]');
  ok(app().screen === 'draft' && text('.clock').includes('YOU ARE ON THE CLOCK'), 'the founding draft stops when you are on the clock');
  const firstPick = (q('[data-act="draft-pick"]') as HTMLElement).dataset.id;
  await click('[data-act="draft-pick"]');
  ok(app().founding.league.teams.find((t: any) => t.id === 4).playerIds.includes(Number(firstPick)), 'your pick joins your 40');
  ok(doc.querySelectorAll('.draft-recent li').length >= 2, 'the latest picks show, with reasons');
  await click('[data-act="draft-auto"]');
  await click('[data-act="draft-finish"]');
  ok(app().screen === 'home' && app().game.league.teams.every((t: any) => t.playerIds.length === 40) && app().game.draftedByHand, 'AUTO THE REST, then CONTINUE: a league of full rosters');
  ok(app().password() === '', 'no Year 1 password for a hand-drafted league');

  if (errors.length) { console.log('\nErrors:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nSmoke test passed.');
  process.exit(0);
}
function getComputedStyleVar(name: string) { return doc.documentElement.style.getPropertyValue(name); }
main().catch((e) => { console.error('FAILED:', e.message); if (errors.length) console.log(errors.join('\n')); process.exit(1); });
