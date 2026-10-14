/**
 * The app: which screen is up, what the player clicked, and keeping the ballpark, music and save
 * in step. Screens are HTML strings (views/); one delegated listener handles every button.
 */
import { newBoardState, type BoardState } from './views/board';
import { DRAFT_SPEEDS } from './views/draft';
import { gameDays } from './views/screens';
import type { LeadState } from './views/leaders';
import type { PitchDetail } from '../engine/game/text';
import { regularOver } from '../engine/season/season';
import { release, signFreeAgent, swap, toggleClaim, type MoveError } from '../engine/roster';
import { lightingAt, type Lighting } from '../engine/season/schedule';
import type { League } from '../engine/types';
import { autoPick, autoPicks, done, onClock, pick, type DraftState } from '../engine/draft';
import type { GameMove, GameResult } from '../engine/game/types';
import { finishFounding, foundingLeague, generateLeague } from '../engine/generate';
import { promote } from '../engine/offseason';
import { Music } from './audio';
import { BASE_SPOTS, FIELD_SPOTS, drawFigures, renderBallpark, type Figure } from './ballpark';
import { buildReplay, nextAtBat, nextInning, type Replay } from './replay';
import { offerFile } from './download';
import { SaveError, decodeSave, encodeSave, saveFileName, type SaveMeta } from './savefile';
import { Game, SAVE_VERSION, clearSave, fromPassword, newSeed, readSave, toPassword, writeSave, type SaveData } from './state';
import { SLOT, deleteLeague, getLeague, putLeague, requestPersistence } from './store';
import { applyTeamColors, teamColors, teamName } from './teams';
import { view } from './views';

export type Screen = 'title' | 'picker' | 'draft' | 'home' | 'watch' | 'standings' | 'games' | 'leaders' | 'races' | 'scouting' | 'roster' | 'gamelog' | 'news' | 'offseason';
export type Modal = { kind: 'settings' } | { kind: 'player'; id: number } | { kind: 'password' } | { kind: 'restart' };
/** Live games: who makes your team's moves. 'ask': the bench coach asks first; 'me': nothing moves unless you do;
 *  'ai': the bench coach decides and play flows (you can still step in). */
export type ManagerMode = 'ask' | 'me' | 'ai';
export interface Settings { readable: boolean; detail: PitchDetail; music: boolean; volume: number; manager: ManagerMode }
export interface Busy { label: string; done: number; total: number; note: string; stoppable: boolean }
export interface Watch {
  replay: Replay; at: number; auto: boolean;
  /** The game's index in the season's results (-1 while it's still live). */
  index: number;
  /** Your game, being played now: the frames end at the decision point it's waiting at. */
  live: boolean;
  /** Key-moment alerts already shown (each stops auto-play once). */
  alerted: Set<string>;
  /** The alert showing now, if any. */
  alert: string;
}

const SETTINGS_KEY = 'baseball-gods/settings';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const MOVE_ERRORS: Record<MoveError, string> = {
  'no-moves': 'No moves left this month', 'not-reserve': 'He isn\'t on your reserves', 'not-active': 'He isn\'t on your active 26',
  'different-group': 'Call up a pitcher for a pitcher, a bat for a bat', 'full-40': 'Your 40-man roster is full',
  'not-free-agent': 'He isn\'t a free agent anymore', 'on-waivers': 'He\'s on waivers',
};
/** After a call-up: where the man sent down went. */
function canOptionLabel(g: Game, downId: number): string {
  const p = g.players.get(downId);
  if (!p) return 'Done';
  return g.league.waivers.some((w) => w.playerId === downId) ? `${p.name} is out of options: on waivers for 3 days` : `${p.name} optioned to the reserves`;
}

export class App {
  screen: Screen = 'title';
  titleStage: 'press' | 'menu' = 'press';
  modal: Modal | null = null;
  game: Game | null = null;
  settings: Settings = { readable: false, detail: 'final', music: true, volume: 0.7, manager: 'ask' };
  /** The league in this browser's database slot, if any. */
  slot: SaveMeta | null = null;
  /** An old-style save (seed, team, day; replayed to load), from before full saves or when the database is unavailable. */
  saved: SaveData | null = null;
  /** Where autosaves go: the database (kept, or kept unless the browser clears it), or only the old replay save. */
  storage: 'persistent' | 'kept' | 'none' | 'unknown' = 'unknown';
  fileMsg = '';
  picker: { seed: number; league: League; team: number } | null = null;
  watch: Watch | null = null;
  gamesDay = -1;
  gamesPick = -1;
  logPick = -1;
  rosterTeam = 0;
  rosterTab: 'lineup' | 'staff' | 'moves' = 'lineup';
  /** The founding draft in progress (no league to play yet). */
  founding: { seed: number; team: number; league: League; draft: DraftState; byHand: boolean } | null = null;
  /** The prospect board's sort and filters (draft night and the scouting hub share them). */
  board: BoardState = newBoardState();
  /** The scouting hub: the next draft's class, or every amateur. */
  hubClass: 'next' | 'all' = 'next';
  /** Draft night's clock: AI picks tick by unless paused. `fresh` marks the newest pick for a moment. */
  draftLive: { paused: boolean; speed: keyof typeof DRAFT_SPEEDS; fresh: number } = { paused: false, speed: 'normal', fresh: 0 };
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** The Leaders screen: which view and filters. */
  lead: LeadState = { view: 'leaders', scope: 'all', side: 'bat', when: 'season' };
  /** The winter report: your team or the whole league. */
  offScope: 'team' | 'league' = 'team';
  /** Hot and cold: the window in days. */
  formDays: 7 | 14 | 30 = 14;
  /** A player whose RELEASE was pressed once (the second press confirms). */
  releaseArmed = 0;
  busy: Busy | null = null;
  toast = '';
  passwordMsg = '';
  musicMsg = '';
  restartArmed = false;
  readonly music = new Music();

  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private stop = false;
  private autoTimer = 0;
  private toastTimer = 0;
  private tickerEl: HTMLElement | null = null;
  private tickerKey = '';
  private parkKey = '';
  private parkBase: { key: string; px: Uint8ClampedArray } | null = null;
  private stickLog = false;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private persistAsked = false;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement) {
    this.root = root;
    this.canvas = canvas;
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
      if (s) this.settings = { ...this.settings, ...s };
    } catch { /* defaults */ }
    this.saved = readSave();
    this.music.enabled = this.settings.music;
    this.music.volume = this.settings.volume;
    document.documentElement.classList.toggle('readable', this.settings.readable);
    applyTeamColors(teamColors(this.saved?.team ?? 1));
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e); });
    document.addEventListener('keydown', (e) => this.onKey(e));
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => { this.parkKey = ''; this.updatePark(); }, 120); });
    void this.music.loadManifest();
  }

  // ------------------------------------------------------------------ lifecycle

  /** Boot, optionally resuming a save (used when the page is updated while open). */
  async start(resume?: { save?: SaveData; screen?: Screen }): Promise<void> {
    const row = await getLeague(SLOT);
    this.slot = row?.meta ?? null;
    if (this.slot) applyTeamColors(teamColors(this.slot.team));
    if (resume?.save) {
      if (this.slot) await this.loadSlot(); else await this.load(resume.save);
      if (resume.screen && resume.screen !== 'title' && resume.screen !== 'picker' && resume.screen !== 'watch') this.screen = resume.screen;
      this.render();
      return;
    }
    this.render();
  }

  snapshot(): { save?: SaveData; screen: Screen } {
    return { save: this.game ? this.saveData() : undefined, screen: this.screen };
  }

  saveData(): SaveData {
    const g = this.game!;
    return { v: SAVE_VERSION, seed: g.seed, team: g.userTeam, day: g.day };
  }
  /** The 10-character password replays Year 1 only (seed, team, day). */
  password(): string { return this.game && this.game.year === 1 && !this.game.draftedByHand && !this.game.movedByHand ? toPassword(this.saveData()) : ''; }

  /** The draft on screen, whichever kind. */
  draftSession(): { league: League; draft: DraftState; userTeam: number } | null {
    if (this.founding) return { league: this.founding.league, draft: this.founding.draft, userTeam: this.founding.team };
    const w = this.game?.winter;
    return w?.draft ? { league: this.game!.league, draft: w.draft, userTeam: this.game!.userTeam } : null;
  }

  /** Autosave: the whole league to the database slot, after the screen has updated. Saves queue up; only the latest is written. */
  private persist() {
    if (!this.game || this.game.winter) return; // mid-winter there's nothing to save: the year-end save replays the winter exactly
    if (this.game.live) { this.dirty = true; return; } // mid-game: saved once the day is done
    this.dirty = true;
    if (!this.saving) this.saving = this.flush().finally(() => { this.saving = null; });
  }
  private async flush(): Promise<void> {
    while (this.dirty && this.game) {
      if (this.game.live) return; // a live game in progress: wait for the day to finish
      this.dirty = false;
      const g = this.game;
      await tick();
      let ok = false;
      try {
        const { bytes, meta } = await encodeSave(g); // the snapshot is taken before its first await, so simming on is safe
        if (this.game !== g) continue;
        ok = await putLeague(SLOT, bytes, meta);
        if (ok) { this.slot = meta; this.saved = null; clearSave(); }
      } catch { ok = false; }
      if (!ok) { if (g.year === 1) { const s = this.saveData(); writeSave(s); this.saved = s; } this.storage = 'none'; continue; }
      if (!this.persistAsked) { this.persistAsked = true; this.storage = (await requestPersistence()) ? 'persistent' : 'kept'; }
      else if (this.storage === 'none' || this.storage === 'unknown') this.storage = 'kept';
    }
  }
  /** Resolves when every queued autosave is written (tests use it). */
  whenSaved(): Promise<void> { return this.saving ?? Promise.resolve(); }

  /** What CONTINUE would open: the database slot, else an old-style save. */
  continueInfo(): { team: number; year: number; day: number } | null {
    return this.slot ? { team: this.slot.team, year: this.slot.year, day: this.slot.day } : this.saved ? { team: this.saved.team, year: 1, day: this.saved.day } : null;
  }

  /** Open the league in the database slot. */
  async loadSlot(): Promise<boolean> {
    const row = await getLeague(SLOT);
    if (!row) { this.slot = null; return false; }
    try { await this.openSave(row.bytes, 'Opening your league'); return true; }
    catch (e) { this.fileMsg = e instanceof SaveError ? `Couldn't open the saved league: ${e.message}` : "Couldn't open the saved league."; return false; }
  }
  private async openSave(bytes: Uint8Array, label: string): Promise<void> {
    let g: Game | null = null;
    await this.withBusy(label, 1, false, async () => { await tick(); g = (await decodeSave(bytes)).game; });
    this.game = g!;
    this.afterLoad();
    this.screen = 'home';
  }
  /** Load a save file chosen by the player; it becomes the league in this browser. */
  async loadFile(file: File): Promise<void> {
    this.fileMsg = '';
    try {
      await this.openSave(new Uint8Array(await file.arrayBuffer()), 'Opening the file');
      this.persist();
    } catch (e) {
      this.fileMsg = e instanceof SaveError ? e.message : "Couldn't read that file.";
    }
    this.render();
  }
  async exportFile(): Promise<void> {
    if (!this.game) return;
    const { bytes, meta } = await encodeSave(this.game);
    const r = await offerFile(saveFileName(meta), bytes, 'application/zip');
    this.showToast(r === 'saved' ? 'Save file ready' : r === 'declined' ? 'Not saved' : "Couldn't save a file here");
  }
  private saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ rendering

  render(): void {
    const scrolls = new Map<string, number>();
    this.root.querySelectorAll<HTMLElement>('[data-scroll]').forEach((el) => scrolls.set(el.dataset.scroll!, el.scrollTop));
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && this.root.contains(active) ? active.dataset.key : undefined;
    if (this.tickerEl) this.tickerEl.remove();

    this.root.innerHTML = view(this);

    // Keep the headline ticker running across re-renders unless its headlines changed.
    const slot = this.root.querySelector<HTMLElement>('[data-ticker]');
    if (slot) {
      const key = slot.dataset.ticker!;
      if (this.tickerEl && key === this.tickerKey) slot.replaceWith(this.tickerEl);
      else { this.tickerEl = slot; this.tickerKey = key; }
    } else { this.tickerEl = null; this.tickerKey = ''; }

    this.root.querySelectorAll<HTMLElement>('[data-scroll]').forEach((el) => {
      if (el.dataset.stick === 'bottom' && this.stickLog) el.scrollTop = el.scrollHeight;
      else if (scrolls.has(el.dataset.scroll!)) el.scrollTop = scrolls.get(el.dataset.scroll!)!;
    });
    this.stickLog = false;
    const focusTarget = focusKey ? this.root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`) : null;
    if (focusTarget) focusTarget.focus({ preventScroll: true });
    else if (this.modal) this.root.querySelector<HTMLElement>('.modal [data-autofocus], .modal button')?.focus({ preventScroll: true });

    this.streakFlips();
    this.draftClock();
    this.updatePark();
    this.updateMusic();
  }

  /** Draft night: while the AI is on the clock and nothing is paused, make its next pick after a beat. */
  private draftClock(): void {
    if (this.draftTimer) return;
    const v = this.screen === 'draft' ? this.draftSession() : null;
    if (!v || done(v.draft) || onClock(v.draft) === v.userTeam || this.draftLive.paused || this.modal) return;
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      const w = this.screen === 'draft' ? this.draftSession() : null;
      if (!w || done(w.draft) || onClock(w.draft) === w.userTeam || this.draftLive.paused || this.modal) return;
      autoPick(w.league, w.draft);
      this.draftLive.fresh = w.draft.picks.length;
      this.render();
    }, DRAFT_SPEEDS[this.draftLive.speed]);
  }

  /** Heat each team row last showed. When a hot team cools or a cold one warms, its row plays the flip once. */
  private shownHeat = new Map<number, number>();
  private shownHeatYear = 0;
  private streakFlips(): void {
    const g = this.game;
    if (!g) return;
    if (g.year !== this.shownHeatYear) { this.shownHeat.clear(); this.shownHeatYear = g.year; }
    const seen = new Map<number, number>();
    this.root.querySelectorAll<HTMLElement>('.trow[data-team]').forEach((el) => {
      const id = Number(el.dataset.team), h = Number(el.dataset.heat), was = this.shownHeat.get(id);
      if (was !== undefined && was > 0 && h <= 0) el.classList.add('fx-out');
      else if (was !== undefined && was < 0 && h >= 0) el.classList.add('fx-thaw');
      seen.set(id, h);
    });
    for (const [id, h] of seen) this.shownHeat.set(id, h);
  }

  private updatePark(): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    const S = vw >= 900 ? 4 : 3;
    const W = Math.ceil(vw / S), H = Math.ceil(vh / S);
    let lighting: Lighting = 'night';
    let figures: Figure[] = [];
    const g = this.game;
    if (this.screen === 'watch' && this.watch) {
      const r = this.watch.replay.result, f = this.watch.replay.frames[this.watch.at];
      lighting = lightingAt(r.start, f.inning);
      if (f.kind !== 'final') figures = this.fieldFigures(f.half, f.batter, f.pitcher, f.bases);
    } else if (g && this.screen !== 'title' && this.screen !== 'picker') {
      const today = g.gameOn(g.day, g.userTeam);
      lighting = g.over ? 'night' : today ? lightingAt(today.start) : 'day';
    }
    const key = `${W}x${H}:${lighting}:${figures.map((p) => `${p.x | 0},${p.y | 0},${p.cap.join('.')}`).join('|')}`;
    if (key === this.parkKey) return;
    this.parkKey = key;
    const baseKey = `${W}x${H}:${lighting}`;
    if (!this.parkBase || this.parkBase.key !== baseKey) this.parkBase = { key: baseKey, px: renderBallpark(W, H, lighting) };
    const px = figures.length ? drawFigures(this.parkBase.px, W, H, figures) : this.parkBase.px;
    const c = this.canvas;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.style.width = `${W * S}px`;
    c.style.height = `${H * S}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
    document.body.style.setProperty('--sky', lighting === 'day' ? '#4C8BD4' : lighting === 'dusk' ? '#221B49' : '#050A1C');
  }

  private fieldFigures(half: number, batter: number, pitcher: number, bases: number): Figure[] {
    const g = this.game!, r = this.watch!.replay.result;
    const fieldSide = 1 - half;
    const fieldTeam = r.teamIds[fieldSide], batTeam = r.teamIds[half];
    const homeJersey: Figure['jersey'] = [240, 240, 236], awayJersey: Figure['jersey'] = [150, 156, 170];
    const fj = fieldSide === 1 ? homeJersey : awayJersey, bj = half === 1 ? homeJersey : awayJersey;
    const fc = teamColors(fieldTeam).jersey, bc = teamColors(batTeam).jersey;
    const figs: Figure[] = Object.entries(FIELD_SPOTS).map(([, [x, y]]) => ({ x, y, jersey: fj, cap: fc }));
    const p = g.players.get(batter), arm = g.players.get(pitcher);
    const side = p?.bats === 'S' ? (arm?.throws === 'R' ? 1 : -1) : p?.bats === 'L' ? 1 : -1;
    figs.push({ x: 4 * side, y: 1, jersey: bj, cap: bc });
    BASE_SPOTS.forEach(([x, y], i) => { if (bases & (1 << i)) figs.push({ x, y, jersey: bj, cap: bc }); });
    return figs;
  }

  private updateMusic(): void {
    if (this.busy) { void this.music.play('sim'); return; }
    if (this.screen === 'title' || this.screen === 'picker') { void this.music.play('title'); return; }
    if (this.screen === 'watch') { void this.music.play('game'); return; }
    const g = this.game;
    if (!g) return;
    if (g.over) { void this.music.play('offseason'); return; }
    void this.music.play(g.season.regularDays - g.day <= 30 ? 'pennant' : 'hub');
  }

  showToast(text: string): void {
    this.toast = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast = ''; this.root.querySelector('.toast')?.remove(); }, 2600);
    this.render();
  }

  // ------------------------------------------------------------------ flows

  private async withBusy(label: string, total: number, stoppable: boolean, work: (step: (done: number, note?: string) => Promise<void>) => Promise<void>) {
    this.busy = { label, done: 0, total, note: '', stoppable };
    this.stop = false;
    this.render();
    await tick();
    let last = 0;
    const step = async (done: number, note?: string) => {
      if (!this.busy) return;
      this.busy.done = done;
      if (note) this.busy.note = note;
      const now = performance.now();
      if (now - last < 40 && done < total) return;
      last = now;
      const bar = this.root.querySelector<HTMLElement>('[data-busy-bar]');
      if (bar) bar.style.setProperty('--done', String(total ? done / total : 0));
      const t = this.root.querySelector('[data-busy-count]');
      if (t) t.textContent = `${done} / ${total}`;
      const n = this.root.querySelector('[data-busy-note]');
      if (n && this.busy.note) n.textContent = this.busy.note;
      await tick();
    };
    try { await work(step); } finally { this.busy = null; }
  }

  /** New league from the team picker. */
  async newGame(seed: number, team: number, league?: League): Promise<void> {
    await this.withBusy('Building the schedule', 1, false, async () => { await tick(); this.game = new Game(seed, team, league); });
    this.afterLoad();
    this.persist();
    this.screen = 'home';
    this.render();
  }

  /** Replay a saved year up to its day. */
  async load(s: SaveData): Promise<void> {
    let g: Game | null = null;
    await this.withBusy('Replaying Year 1', s.day, false, async (step) => {
      await tick();
      g = new Game(s.seed, s.team);
      while (g.day < s.day && !g.over) {
        g.simDay();
        await step(g.day, g.headlines.at(-1)?.text);
      }
    });
    this.game = g;
    this.afterLoad();
    this.persist();
    this.screen = 'home';
  }

  private afterLoad() {
    const g = this.game!;
    applyTeamColors(teamColors(g.userTeam));
    this.rosterTeam = g.userTeam;
    this.gamesDay = -1; this.gamesPick = -1; this.logPick = -1;
    this.watch = null; this.modal = null; this.picker = null;
  }

  /** Simulate forward: 'day' plays the next day with games; numbers are calendar days; 'end' finishes the year. */
  async sim(span: 'day' | number | 'end'): Promise<void> {
    const g = this.game;
    if (!g || g.over || this.busy) return;
    if (span === 'day') {
      let played = 0;
      while (!g.over && played === 0) played = g.simDay().length;
      this.persist();
      this.render();
      return;
    }
    // The schedule grows in October (Game 163s, each new round), so spans are counted in days, not schedule length.
    const toPost = span === 'end' && !regularOver(g.season);
    const from = g.day;
    const target = span === 'end' ? Infinity : g.day + span; // to the end of the regular season includes any Game 163
    const total = span === 'end' ? Math.max(1, (toPost ? g.season.regularDays : g.season.schedule.days) - from) : span;
    await this.withBusy(span === 'end' ? (toPost ? 'Simming to the end of the regular season' : 'Simming the rest of the postseason') : `Simming ${span} days`, total, true, async (step) => {
      while (g.day < target && !g.over && !this.stop && !(toPost && regularOver(g.season))) {
        g.simDay();
        await step(g.day - from, g.headlines.at(-1)?.text);
      }
    });
    this.persist();
    this.render();
  }

  /** Play today and watch your game. */
  /** Play today with your game live: the rest of the league sims around it. */
  watchToday(): void {
    const g = this.game;
    if (!g || g.over) return;
    if (!g.startLive()) { g.simDay(); this.persist(); this.render(); return; }
    this.stopAuto();
    if (!g.live) { this.liveDone(); return; }
    this.watch = { replay: this.liveReplay(), at: 0, auto: false, index: -1, live: true, alerted: new Set(), alert: '' };
    this.screen = 'watch';
    this.stickLog = true;
    this.render();
  }

  /** The live game so far, as a replay ending at the decision point it's waiting at. */
  private liveReplay(): Replay {
    const g = this.game!, d = g.live!.day, c = d.call!;
    const partial: GameResult = {
      day: g.day, start: d.game.start, teamIds: [d.setups[0].teamId, d.setups[1].teamId], score: c.score, innings: c.inning,
      lineScore: [[], []], hits: [0, 0], errors: [0, 0], lob: [0, 0], outsRecorded: [0, 0], batting: new Map(), pitching: new Map(),
      lineups: [d.setups[0].lineup, d.setups[1].lineup], pitchersUsed: c.pitchersUsed, decisions: { win: 0, loss: 0, save: 0 },
      budgets: new Map(), pitchResults: [], moments: [], log: c.log ?? new Uint8Array(0),
      ...(d.game.kind ? { kind: d.game.kind } : {}), ...(d.game.series ? { series: d.game.series, game: d.game.game } : {}),
    };
    return buildReplay(partial, g.name, teamName, this.settings.detail, g.userTeam, c);
  }
  /** Your live game ended: show the whole game, save the day. */
  private liveDone(): void {
    const g = this.game!;
    const idx = [...g.season.results.keys()].reverse().find((i) => g.season.results[i].teamIds.includes(g.userTeam) && g.season.results[i].day === g.day - 1);
    this.persist();
    if (idx === undefined) { this.render(); return; }
    const at = this.watch?.at ?? 0;
    this.watch = { replay: buildReplay(g.season.results[idx], g.name, teamName, this.settings.detail, g.userTeam), at: 0, auto: this.watch?.auto ?? false, index: idx, live: false, alerted: new Set(), alert: '' };
    this.watch.at = Math.min(at + 1, this.watch.replay.frames.length - 1);
    this.screen = 'watch';
    this.stickLog = true;
    this.render();
  }

  /**
   * What stops a live game before the next at-bat, by your manager mode: a move the bench coach wants (Ask me: he
   * asks; Me: you decide) blocks; key moments pause auto-play once. In AI mode nothing stops.
   */
  liveStop(): { block: boolean; text: string } | null {
    const g = this.game, c = g?.live?.day.call, w = this.watch;
    if (!g || !c || !w) return null;
    const mode = this.settings.manager;
    if (mode === 'ai') return null;
    const me = g.liveSide, fielding = c.half !== me;
    const mine = c.pitchers[me], name = g.name(mine.id);
    if (fielding && c.aiPitch[me]) {
      return { block: true, text: mode === 'ask' ? `Bench coach: ${name} has thrown ${mine.pitches} pitches. Bring in ${g.name(c.aiPitch[me])}?`
        : `${name} has thrown ${mine.pitches} pitches. Your call: make a change or leave him in.` };
    }
    const lateClose = c.inning >= 7 && Math.abs(c.score[0] - c.score[1]) <= 1;
    let key = '', text = '';
    if (fielding && mine.pitches >= 0.9 * mine.budget) { key = `tired:${mine.id}`; text = `${name} is tiring (${mine.pitches} pitches).`; }
    else if (!fielding && lateClose && (c.bases[1] || c.bases[2])) { key = `risp:${c.inning}:${c.half}:${c.outs}:${c.batter}`; text = `Late and close with a runner in scoring position: a pinch hitter or runner?`; }
    if (key && !w.alerted.has(key)) return { block: false, text: (w.alerted.add(key), text) };
    return null;
  }

  /** Play the live game on to its next decision point (unless something stops it). Returns false if it stopped. */
  private liveForward(): boolean {
    const g = this.game!, w = this.watch!;
    const stop = this.liveStop();
    if (stop) { w.alert = stop.text; this.stopAuto(); return false; }
    w.alert = '';
    const res = g.liveAdvance();
    if (res || !g.live) { this.liveDone(); return false; }
    w.replay = this.liveReplay();
    return true;
  }

  /** A manager's move in the live game: it happens now, the game waits for you again. */
  private liveMove(m: GameMove): void {
    const g = this.game, w = this.watch;
    if (!g?.live || !w) return;
    g.liveMove(m);
    w.alert = '';
    w.replay = this.liveReplay();
    w.at = w.replay.frames.length - 1;
    this.stickLog = true;
    this.render();
  }

  /** The live game is waiting on a pitching decision from you (Ask me or Me mode). */
  liveBlocked(): boolean {
    const g = this.game, c = g?.live?.day.call;
    return !!c && !!g && this.settings.manager !== 'ai' && c.half !== g.liveSide && !!c.aiPitch[g.liveSide];
  }
  /** At the end of what's been played in a live game (where moves can be made). */
  liveEdge(): boolean {
    const w = this.watch;
    if (!w?.live) return false;
    // nothing left to see but the next batter stepping in
    for (let j = w.at + 1; j < w.replay.frames.length; j++) if (w.replay.frames[j].kind !== 'up' && w.replay.frames[j].kind !== 'start') return false;
    return true;
  }

  /** Leaving a live game: the bench coach finishes it. */
  private leaveLive(): void {
    const g = this.game;
    if (!g?.live) return;
    this.stopAuto();
    g.liveFinish();
    this.persist();
    if (this.watch) this.watch.live = false;
  }

  openReplay(index: number): void {
    const g = this.game!;
    const r = g.season.results[index];
    this.stopAuto();
    this.watch = { replay: buildReplay(r, g.name, teamName, this.settings.detail, g.userTeam), at: 0, auto: false, index, live: false, alerted: new Set(), alert: '' };
    this.screen = 'watch';
    this.stickLog = true;
    this.render();
  }

  private stepWatch(to: number): void {
    const w = this.watch;
    if (!w) return;
    // Live: stepping past what's been played plays on (the frames grow; the target is re-aimed at the new frames).
    if (w.live && to > w.replay.frames.length - 1) {
      const before = w.replay.frames.length;
      if (w.at < before - 1) { /* catch up first */ }
      else if (!this.liveForward()) { if (w.live) this.render(); return; }
      if (!w.live) return; // the game ended and liveDone took over
      const grew = w.replay.frames.length - before;
      to = Math.min(to === Infinity ? w.replay.frames.length - 1 : to, w.replay.frames.length - 1);
      if (grew <= 0 && w.at >= w.replay.frames.length - 1) { this.render(); return; }
    }
    const last = w.replay.frames.length - 1;
    const target = Math.max(0, Math.min(last, to));
    if (target === w.at) return;
    // Play the most important stinger crossed on the way.
    let sting: string | undefined;
    for (let j = w.at + 1; j <= target; j++) { const s = w.replay.frames[j].stinger; if (s === 'walkoff' || (s && !sting)) sting = s; }
    w.at = target;
    if (sting) void this.music.stinger(sting);
    if (w.at === last && !w.live) this.stopAuto();
    this.stickLog = true;
    this.render();
  }

  private toggleAuto(): void {
    const w = this.watch;
    if (!w) return;
    if (w.auto) { this.stopAuto(); this.render(); return; }
    w.auto = true;
    const run = () => {
      if (!this.watch?.auto || this.screen !== 'watch') return;
      const f = this.watch.replay.frames[this.watch.at];
      if (this.watch.at >= this.watch.replay.frames.length - 1 && !this.watch.live) { this.stopAuto(); this.render(); return; }
      this.stepWatch(this.watch.at + 1);
      const next = this.watch.replay.frames[this.watch.at];
      this.autoTimer = window.setTimeout(run, next.kind === 'result' || next.kind === 'event' || f.kind === 'result' ? 1500 : 650);
    };
    this.render();
    this.autoTimer = window.setTimeout(run, 400);
  }
  private stopAuto() {
    clearTimeout(this.autoTimer);
    if (this.watch) this.watch.auto = false;
  }

  // ------------------------------------------------------------------ input

  private onClick(e: MouseEvent): void {
    if (this.screen === 'title' && this.titleStage === 'press') { this.pressStart(); return; }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.hasAttribute('disabled')) {
      if ((e.target as HTMLElement).classList.contains('modal-veil')) { this.modal = null; this.restartArmed = false; this.render(); }
      return;
    }
    void this.act(el.dataset.act!, el.dataset, el);
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const act = el.dataset.act;
    if (!act) return;
    if (this.game && (act === 'lineup-pos' || act === 'lineup-sub' || act === 'rot-swap' || act === 'pen-role' || act === 'call-up')) {
      const g = this.game, i = Number(el.dataset.i), v = el.value;
      if (!v) return;
      if (act === 'lineup-pos') g.lineupPos(i, Number(v));
      else if (act === 'lineup-sub') g.lineupSub(i, Number(v));
      else if (act === 'rot-swap') g.rotationSwap(i, Number(v));
      else if (act === 'pen-role') g.penRole(i, v as 'CL' | 'SU' | 'MR' | 'LR');
      else {
        const err = swap(g.season, g.userTeam, Number(el.dataset.id), Number(v));
        if (err) this.showToast(MOVE_ERRORS[err]);
        else this.showToast(canOptionLabel(g, Number(v)));
      }
      this.persist(); this.render();
      return;
    }
    if (act === 'load-file') { const f = (el as HTMLInputElement).files?.[0]; (el as HTMLInputElement).value = ''; if (f) void this.loadFile(f); }
    else if (act === 'board-set') { const f = el.dataset.f as keyof BoardState; (this.board as unknown as Record<string, unknown>)[f] = f === 'pos' ? el.value : Number(el.value); this.render(); }
    else if (act === 'roster-team') { this.rosterTeam = Number(el.value); this.render(); }
    else if (act === 'set-readable') { this.settings.readable = (el as HTMLInputElement).checked; document.documentElement.classList.toggle('readable', this.settings.readable); this.saveSettings(); this.parkKey = ''; this.render(); }
    else if (act === 'set-music') { this.settings.music = (el as HTMLInputElement).checked; this.music.setEnabled(this.settings.music); this.saveSettings(); }
    else if (act === 'set-volume') { this.settings.volume = Number(el.value) / 100; this.music.setVolume(this.settings.volume); this.saveSettings(); }
    else if (act === 'set-manager') { this.settings.manager = el.value as ManagerMode; this.saveSettings(); if (this.watch) this.watch.alert = ''; this.render(); }
    else if (act === 'set-detail') { this.settings.detail = el.value as PitchDetail; this.saveSettings(); this.render(); }
    else if (act === 'music-file') {
      const input = el as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const form = input.closest('form')!;
      const cue = (form.querySelector('[name=cue]') as HTMLSelectElement).value;
      const ls = Number((form.querySelector('[name=loopStart]') as HTMLInputElement).value) || 0;
      const le = Number((form.querySelector('[name=loopEnd]') as HTMLInputElement).value) || 0;
      this.musicMsg = 'Loading…';
      this.render();
      void this.music.useFile(cue, file, ls, le).then((msg) => { this.musicMsg = msg; this.render(); });
    }
  }

  private onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement;
    if (form.dataset.form === 'password') {
      const text = (form.querySelector('input') as HTMLInputElement).value;
      const s = fromPassword(text);
      if (!s) { this.passwordMsg = "That password doesn't work. Check for typos: 10 letters and numbers."; this.render(); return; }
      this.passwordMsg = '';
      this.modal = null;
      void this.load(s).then(() => this.render());
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.screen === 'title' && this.titleStage === 'press') { e.preventDefault(); this.pressStart(); return; }
    if (e.key === 'Escape') {
      if (this.modal) { this.modal = null; this.restartArmed = false; this.render(); return; }
      if (this.screen !== 'title' && this.screen !== 'home' && this.game && !this.busy) { void this.act('go', { to: 'home' }); return; }
    }
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || this.modal || this.busy) return;
    if (this.screen === 'watch' && this.watch) {
      if (e.key === ' ') { e.preventDefault(); this.stepWatch(this.watch.at + 1); }
      else if (e.key === 'a' || e.key === 'A') this.stepWatch(nextAtBat(this.watch.replay, this.watch.at));
    }
  }

  private pressStart(): void {
    this.music.unlock();
    this.titleStage = 'menu';
    this.render();
  }

  async act(act: string, d: DOMStringMap | Record<string, string | undefined>, el?: HTMLElement): Promise<void> {
    const g = this.game;
    switch (act) {
      case 'press': this.pressStart(); return;
      case 'new-league': {
        const seed = newSeed();
        const league = generateLeague(seed);
        this.picker = { seed, league, team: this.continueInfo()?.team ?? 1 };
        applyTeamColors(teamColors(this.picker.team));
        this.screen = 'picker';
        this.modal = null;
        this.render();
        return;
      }
      case 'reroll': {
        if (!this.picker) return;
        const seed = newSeed();
        this.picker = { ...this.picker, seed, league: generateLeague(seed) };
        this.render();
        return;
      }
      case 'pick-team': {
        if (!this.picker) return;
        this.picker.team = Number(d.id);
        applyTeamColors(teamColors(this.picker.team));
        this.render();
        return;
      }
      case 'start-year': { // draft your own team: the founding draft, picking whenever you're on the clock
        if (!this.picker) return;
        const { league, draft } = foundingLeague(this.picker.seed);
        this.founding = { seed: this.picker.seed, team: this.picker.team, league, draft, byHand: false };
        this.screen = 'draft'; this.draftLive.paused = false;
        this.render();
        return;
      }
      case 'auto-draft': { // the AI drafts every team (the grades on the picker are this league)
        if (!this.picker) return;
        await this.newGame(this.picker.seed, this.picker.team, this.picker.league);
        return;
      }
      case 'draft-pick': {
        const v = this.draftSession();
        if (!v || done(v.draft) || onClock(v.draft) !== v.userTeam) return;
        pick(v.league, v.draft, Number(d.id));
        if (this.founding) this.founding.byHand = true;
        this.draftLive.fresh = v.draft.picks.length;
        this.persist(); this.render();
        return;
      }
      case 'draft-auto': { // the AI picks for you from here (your board first) and finishes the draft
        const v = this.draftSession();
        if (!v) return;
        if (this.founding && v.league.wishlist.length) this.founding.byHand = true; // your board shaped it: the password can't replay this league
        autoPicks(v.league, v.draft, 0, { team: v.userTeam, ids: v.league.wishlist });
        this.persist(); this.render();
        return;
      }
      case 'draft-skip': { const v = this.draftSession(); if (v) autoPicks(v.league, v.draft, v.userTeam); this.render(); return; }
      case 'draft-pause': this.draftLive.paused = !this.draftLive.paused; this.render(); return;
      case 'draft-speed': this.draftLive.speed = d.speed as App['draftLive']['speed']; this.render(); return;
      case 'board-sort': { const b = this.board; if (b.sort === d.k) b.desc = !b.desc; else { b.sort = d.k!; b.desc = !['name', 'pos', 'age'].includes(d.k!); } this.render(); return; }
      case 'hub-class': this.hubClass = d.c as App['hubClass']; this.render(); return;
      case 'board-side': this.board.side = d.f as BoardState['side']; this.render(); return;
      case 'board-starred': this.board.starred = !this.board.starred; this.render(); return;
      case 'board-reset': this.board = { ...newBoardState(), sort: this.board.sort, desc: this.board.desc }; this.render(); return;
      case 'wish': {
        const L = this.founding?.league ?? g?.league;
        if (!L) return;
        const id = Number(d.id), at = L.wishlist.indexOf(id);
        if (at >= 0) L.wishlist.splice(at, 1); else L.wishlist.push(id);
        this.persist(); this.render();
        return;
      }
      case 'wish-move': {
        const L = this.founding?.league ?? g?.league;
        if (!L) return;
        const id = Number(d.id), at = L.wishlist.indexOf(id), to = at + Number(d.dir);
        if (at < 0 || to < 0 || to >= L.wishlist.length) return;
        [L.wishlist[at], L.wishlist[to]] = [L.wishlist[to], L.wishlist[at]];
        this.persist(); this.render();
        return;
      }
      case 'draft-finish': {
        if (this.founding) {
          const f = this.founding;
          autoPicks(f.league, f.draft, 0, { team: f.team, ids: f.league.wishlist });
          finishFounding(f.league, f.draft);
          this.founding = null;
          await this.newGame(f.seed, f.team, f.league);
          if (this.game) { this.game.draftedByHand = f.byHand; this.persist(); }
        } else if (g?.winter) {
          await this.withBusy('The rest of the winter: prospects, signings, Opening Day', 1, false, async () => { await tick(); g.finishWinter(); });
          this.afterLoad();
          this.screen = 'offseason';
          this.persist();
          this.render();
        }
        return;
      }
      case 'continue': {
        if (this.slot) { if (!(await this.loadSlot())) { this.screen = 'title'; } this.render(); }
        else if (this.saved) { await this.load(this.saved); this.render(); }
        return;
      }
      case 'load-file-pick': this.root.querySelector<HTMLInputElement>('[data-act="load-file"]')?.click(); return;
      case 'export-file': await this.exportFile(); return;
      case 'to-title': {
        this.screen = 'title'; this.titleStage = 'menu'; this.picker = null;
        if (g) applyTeamColors(teamColors(g.userTeam));
        this.render();
        return;
      }
      case 'password-open': this.modal = { kind: 'password' }; this.passwordMsg = ''; this.render(); return;
      case 'go': {
        if (!g) return;
        const to = (d.to ?? 'home') as Screen;
        if (this.screen === 'watch') this.stopAuto();
        if (g.live) this.leaveLive(); // leaving your live game: the bench coach finishes it
        if (to === 'games' && d.index !== undefined) { this.gamesPick = Number(d.index); this.gamesDay = g.season.results[this.gamesPick].day; }
        if (to === 'gamelog' && d.index !== undefined) this.logPick = Number(d.index);
        if (to === 'roster' && d.team !== undefined) this.rosterTeam = Number(d.team);
        this.screen = to;
        this.modal = null;
        this.render();
        return;
      }
      case 'team': { this.rosterTeam = Number(d.id); this.screen = 'roster'; this.modal = null; this.render(); return; }
      case 'player': this.modal = { kind: 'player', id: Number(d.id) }; this.render(); return;
      case 'settings': this.modal = { kind: 'settings' }; this.musicMsg = ''; this.render(); return;
      case 'close': this.modal = null; this.restartArmed = false; this.render(); return;
      case 'sim-day': await this.sim('day'); return;
      case 'sim-week': await this.sim(7); return;
      case 'sim-month': await this.sim(30); return;
      case 'sim-end': await this.sim('end'); return;
      case 'stop-sim': this.stop = true; return;
      case 'watch': this.watchToday(); return;
      case 'replay': this.openReplay(Number(d.index)); return;
      case 'w-pitch': if (this.watch) this.stepWatch(this.watch.at + 1); return;
      case 'w-ab': if (this.watch) { if (this.liveEdge() && !this.liveForward()) { this.render(); return; } if (this.watch.live || this.watch.at < this.watch.replay.frames.length - 1) this.stepWatch(nextAtBat(this.watch.replay, this.watch.at)); } return;
      case 'w-inning': {
        const w = this.watch;
        if (!w) return;
        if (w.live) { // play on until the half-inning turns over (or something stops it)
          const half = (f: { inning: number; half: number }) => f.inning * 2 + f.half;
          const from = half(w.replay.frames[w.at]);
          while (w.live && half(w.replay.frames[w.replay.frames.length - 1]) === from) { w.at = w.replay.frames.length - 1; if (!this.liveForward()) break; }
          if (w.live) { w.at = w.replay.frames.length - 1; this.stickLog = true; this.render(); }
          return;
        }
        this.stepWatch(nextInning(w.replay, w.at)); return;
      }
      case 'w-end': {
        const w = this.watch;
        if (!w) return;
        if (w.live) {
          while (w.live) { w.at = w.replay.frames.length - 1; if (!this.liveForward()) break; }
          const now = this.watch!; // the finished game replaces the live one
          if (!now.live) now.at = now.replay.frames.length - 1;
          this.stickLog = true; this.render();
          return;
        }
        this.stepWatch(w.replay.frames.length - 1); return;
      }
      case 'live-ok': { const c = g?.live?.day.call; if (c && g) this.liveMove({ kind: 'pitcher', side: g.liveSide, id: c.aiPitch[g.liveSide] }); return; }
      case 'live-keep': if (g?.live) this.liveMove({ kind: 'keep', side: g.liveSide }); return;
      case 'live-catch': if (this.watch) { this.watch.at = this.watch.replay.frames.length - 1; this.stickLog = true; this.render(); } return;
      case 'live-go': { // play on past an alert or after your moves
        const w = this.watch;
        if (w && g?.live) { const stop = this.liveStop(); if (stop?.block) { w.alert = stop.text; this.render(); return; } w.alert = ''; const res = g.liveAdvance(); if (res || !g.live) { this.liveDone(); return; } w.replay = this.liveReplay(); this.stepWatch(w.at + 1); }
        return;
      }
      case 'live-pitch': case 'live-ph': case 'live-pr': case 'live-def': {
        if (!g?.live) return;
        const val = (sel: string) => Number(this.root.querySelector<HTMLSelectElement>(sel)?.value ?? 0);
        const me = g.liveSide;
        if (act === 'live-pitch') { const id = val('#live-pitch-sel'); if (id) this.liveMove({ kind: 'pitcher', side: me, id }); }
        else if (act === 'live-ph') { const id = val('#live-ph-sel'); if (id) this.liveMove({ kind: 'sub', side: me, slot: g.live.day.call!.slot, id, why: 'hitter' }); }
        else if (act === 'live-pr') { const id = val('#live-pr-sel'), base = val('#live-pr-base'); if (id) this.liveMove({ kind: 'runner', side: me, base, id }); }
        else { const id = val('#live-def-sel'), slot = val('#live-def-slot'); if (id) this.liveMove({ kind: 'sub', side: me, slot, id, why: 'field' }); }
        return;
      }
      case 'w-auto': this.toggleAuto(); return;
      case 'w-box': if (this.watch) { this.stopAuto(); void this.act('go', { to: 'games', index: String(this.watch.index) }); } return;
      case 'games-day': {
        if (!g) return;
        const days = gameDays(g);
        const i = days.indexOf(this.gamesDay);
        const next = days[i + Number(d.step)];
        if (next !== undefined) { this.gamesDay = next; this.gamesPick = -1; this.render(); }
        return;
      }
      case 'games-pick': this.gamesPick = Number(d.index); this.render(); return;
      case 'log-pick': this.logPick = Number(d.index); this.render(); return;
      case 'lead': (this.lead as unknown as Record<string, string>)[d.k!] = d.v!; this.render(); return;
      case 'off-scope': this.offScope = d.scope as App['offScope']; this.render(); return;
      case 'form-days': this.formDays = Number(d.days) as App['formDays']; this.render(); return;
      case 'news': if (g) { this.screen = 'news'; this.render(); } return;
      case 'roster-tab': this.rosterTab = d.tab as App['rosterTab']; this.releaseArmed = 0; this.render(); return;
      case 'roster-auto': {
        if (!g) return;
        const part = d.part as 'lineup' | 'staff' | 'roster';
        g.setAuto(part, !g.team.auto![part]);
        this.persist(); this.render();
        return;
      }
      case 'lineup-move': if (g) { g.lineupMove(Number(d.i), Number(d.dir)); this.persist(); this.render(); } return;
      case 'rot-move': if (g) { g.rotationMove(Number(d.i), Number(d.dir)); this.persist(); this.render(); } return;
      case 'release-arm': this.releaseArmed = Number(d.id); this.render(); return;
      case 'release': {
        if (!g) return;
        const err = release(g.season, g.userTeam, Number(d.id));
        this.releaseArmed = 0;
        this.showToast(err ? MOVE_ERRORS[err] : 'Released: on waivers for 3 days');
        this.persist(); this.render();
        return;
      }
      case 'promote': {
        if (!g) return;
        const pr = g.league.prospects.find((x) => x.player.id === Number(d.id) && x.teamId === g.userTeam);
        if (!pr || g.team.playerIds.length >= 40) { this.showToast('Your 40-man roster is full'); return; }
        promote(g.league, g.team, pr); g.players.set(pr.player.id, pr.player); g.teamOf.set(pr.player.id, g.userTeam);
        this.showToast(`${pr.player.name} joins your reserves`);
        this.persist(); this.render();
        return;
      }
      case 'claim': if (g) { toggleClaim(g.league, g.userTeam, Number(d.id)); this.persist(); this.render(); } return;
      case 'sign': {
        if (!g) return;
        const err = signFreeAgent(g.season, g.userTeam, Number(d.id));
        this.showToast(err ? MOVE_ERRORS[err] : 'Signed to your reserves');
        this.persist(); this.render();
        return;
      }
      case 'to-offseason': {
        if (!g || !g.over || this.busy) return;
        let draft: DraftState | null = null;
        await this.withBusy('The winter: aging, retirements, the amateur pool', 1, false, async () => { await tick(); draft = g.beginWinter().draft; });
        if (draft) { // draft night: the AI picks until you're on the clock
          this.screen = 'draft'; this.draftLive.paused = false;
          this.render();
          return;
        }
        await this.withBusy('The winter: signings', 1, false, async () => { await tick(); g.finishWinter(); });
        this.afterLoad();
        this.screen = 'offseason';
        this.persist();
        this.render();
        return;
      }
      case 'copy-password': {
        const code = this.password();
        try { await navigator.clipboard.writeText(code); this.showToast('Password copied'); }
        catch {
          const field = this.root.querySelector<HTMLInputElement>('[data-password-field]');
          field?.focus(); field?.select();
          this.showToast('Select the password and copy it');
        }
        return;
      }
      case 'restart-open': this.modal = { kind: 'restart' }; this.render(); return;
      case 'restart-arm': this.restartArmed = true; this.render(); return;
      case 'restart-disarm': this.restartArmed = false; this.render(); return;
      case 'restart-confirm': {
        clearSave();
        await deleteLeague(SLOT);
        this.saved = null; this.slot = null;
        this.game = null;
        this.restartArmed = false;
        await this.act('new-league', {});
        return;
      }
      case 'music-stop': this.music.stop(); this.musicMsg = 'Stopped.'; this.render(); return;
      default: void el;
    }
  }
}
