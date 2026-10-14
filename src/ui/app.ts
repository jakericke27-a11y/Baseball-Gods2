/**
 * The app: which screen is up, what the player clicked, and keeping the ballpark, music and save
 * in step. Screens are HTML strings (views/); one delegated listener handles every button.
 */
import type { PitchDetail } from '../engine/game/text';
import { regularOver } from '../engine/season/season';
import { lightingAt, type Lighting } from '../engine/season/schedule';
import type { League } from '../engine/types';
import { generateLeague } from '../engine/generate';
import { Music } from './audio';
import { BASE_SPOTS, FIELD_SPOTS, drawFigures, renderBallpark, type Figure } from './ballpark';
import { buildReplay, nextAtBat, nextInning, type Replay } from './replay';
import { offerFile } from './download';
import { SaveError, decodeSave, encodeSave, saveFileName, type SaveMeta } from './savefile';
import { Game, SAVE_VERSION, clearSave, fromPassword, newSeed, readSave, toPassword, writeSave, type SaveData } from './state';
import { SLOT, deleteLeague, getLeague, putLeague, requestPersistence } from './store';
import { applyTeamColors, teamColors, teamName } from './teams';
import { view } from './views';

export type Screen = 'title' | 'picker' | 'home' | 'watch' | 'standings' | 'games' | 'leaders' | 'roster' | 'gamelog' | 'news';
export type Modal = { kind: 'settings' } | { kind: 'player'; id: number } | { kind: 'password' } | { kind: 'restart' };
export interface Settings { readable: boolean; detail: PitchDetail; music: boolean; volume: number }
export interface Busy { label: string; done: number; total: number; note: string; stoppable: boolean }
export interface Watch { replay: Replay; at: number; auto: boolean; index: number }

const SETTINGS_KEY = 'baseball-gods/settings';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class App {
  screen: Screen = 'title';
  titleStage: 'press' | 'menu' = 'press';
  modal: Modal | null = null;
  game: Game | null = null;
  settings: Settings = { readable: false, detail: 'final', music: true, volume: 0.7 };
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
  password(): string { return this.game ? toPassword(this.saveData()) : ''; }

  /** Autosave: the whole league to the database slot, after the screen has updated. Saves queue up; only the latest is written. */
  private persist() {
    if (!this.game) return;
    this.dirty = true;
    if (!this.saving) this.saving = this.flush().finally(() => { this.saving = null; });
  }
  private async flush(): Promise<void> {
    while (this.dirty && this.game) {
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
      if (!ok) { const s = this.saveData(); writeSave(s); this.saved = s; this.storage = 'none'; continue; }
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

    this.updatePark();
    this.updateMusic();
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
    await this.withBusy('Restoring Year 1', s.day, false, async (step) => {
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
  watchToday(): void {
    const g = this.game;
    if (!g || g.over) return;
    const results = g.simDay();
    this.persist();
    const mine = results.find((r) => r.teamIds.includes(g.userTeam));
    if (mine) this.openReplay(g.resultIndexOf(mine));
    else this.render();
  }

  openReplay(index: number): void {
    const g = this.game!;
    const r = g.season.results[index];
    this.stopAuto();
    this.watch = { replay: buildReplay(r, g.name, teamName, this.settings.detail, g.userTeam), at: 0, auto: false, index };
    this.screen = 'watch';
    this.stickLog = true;
    this.render();
  }

  private stepWatch(to: number): void {
    const w = this.watch;
    if (!w) return;
    const last = w.replay.frames.length - 1;
    const target = Math.max(0, Math.min(last, to));
    if (target === w.at) return;
    // Play the most important stinger crossed on the way.
    let sting: string | undefined;
    for (let j = w.at + 1; j <= target; j++) { const s = w.replay.frames[j].stinger; if (s === 'walkoff' || (s && !sting)) sting = s; }
    w.at = target;
    if (sting) void this.music.stinger(sting);
    if (w.at === last) this.stopAuto();
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
      if (this.watch.at >= this.watch.replay.frames.length - 1) { this.stopAuto(); this.render(); return; }
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
    if (act === 'load-file') { const f = (el as HTMLInputElement).files?.[0]; (el as HTMLInputElement).value = ''; if (f) void this.loadFile(f); }
    else if (act === 'roster-team') { this.rosterTeam = Number(el.value); this.render(); }
    else if (act === 'set-readable') { this.settings.readable = (el as HTMLInputElement).checked; document.documentElement.classList.toggle('readable', this.settings.readable); this.saveSettings(); this.parkKey = ''; this.render(); }
    else if (act === 'set-music') { this.settings.music = (el as HTMLInputElement).checked; this.music.setEnabled(this.settings.music); this.saveSettings(); }
    else if (act === 'set-volume') { this.settings.volume = Number(el.value) / 100; this.music.setVolume(this.settings.volume); this.saveSettings(); }
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
      case 'start-year': {
        if (!this.picker) return;
        await this.newGame(this.picker.seed, this.picker.team, this.picker.league);
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
      case 'w-ab': if (this.watch) this.stepWatch(nextAtBat(this.watch.replay, this.watch.at)); return;
      case 'w-inning': if (this.watch) this.stepWatch(nextInning(this.watch.replay, this.watch.at)); return;
      case 'w-end': if (this.watch) this.stepWatch(this.watch.replay.frames.length - 1); return;
      case 'w-auto': this.toggleAuto(); return;
      case 'w-box': if (this.watch) { this.stopAuto(); void this.act('go', { to: 'games', index: String(this.watch.index) }); } return;
      case 'games-day': {
        if (!g) return;
        const days = [...g.byDay.keys()].sort((a, b) => a - b);
        const i = days.indexOf(this.gamesDay);
        const next = days[i + Number(d.step)];
        if (next !== undefined) { this.gamesDay = next; this.gamesPick = -1; this.render(); }
        return;
      }
      case 'games-pick': this.gamesPick = Number(d.index); this.render(); return;
      case 'log-pick': this.logPick = Number(d.index); this.render(); return;
      case 'news': if (g) { this.screen = 'news'; this.render(); } return;
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
