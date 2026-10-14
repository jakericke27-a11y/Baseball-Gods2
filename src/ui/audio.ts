/**
 * Music. The soundtrack is the player's own: tracks listed in music/manifest.json play for named cues
 * (title, hub, game, sim, pennant, offseason, plus one-shot stingers). Missing cues are silent, and a
 * missing loop cue keeps whatever is already playing. Tracks can also be loaded from the player's
 * computer for the current session, to hear a work in progress in the game.
 */
export interface Cue { id: string; file: string; loopStart?: number; loopEnd?: number; volume?: number }

export const LOOP_CUES = ['title', 'hub', 'game', 'sim', 'pennant', 'offseason'] as const;
export const STINGERS = ['homer', 'walkoff', 'nohitter', 'decree'] as const;
const FALLBACK: Record<string, string[]> = { game: ['hub'], pennant: ['hub'], offseason: ['hub'] };

interface Track { buffer: AudioBuffer; loopStart: number; loopEnd: number; volume: number }

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cues = new Map<string, Cue>();
  private tracks = new Map<string, Track>();
  private custom = new Set<string>();
  private current: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: string | null = null;
  enabled = true;
  volume = 0.7;

  async loadManifest(url = 'music/manifest.json'): Promise<void> {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      const list: unknown = await r.json();
      if (!Array.isArray(list)) return;
      for (const c of list as Cue[]) if (c && typeof c.id === 'string' && typeof c.file === 'string') this.cues.set(c.id, c);
    } catch { /* no manifest: silence */ }
  }

  /** Browsers allow sound only after a click or key press; call this from one. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; return; }
    if (this.wanted) { const w = this.wanted; this.wanted = null; void this.play(w); }
  }

  get unlocked() { return !!this.ctx; }
  has(id: string) { return this.cues.has(id) || this.custom.has(id); }
  listCues() { return [...new Set([...this.cues.keys(), ...this.custom])]; }

  setEnabled(on: boolean) { this.enabled = on; this.applyVolume(); }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  private applyVolume() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  private resolve(id: string): string | null {
    if (this.has(id)) return id;
    for (const f of FALLBACK[id] ?? []) if (this.has(f)) return f;
    return null;
  }

  private async trackFor(id: string): Promise<Track | null> {
    const have = this.tracks.get(id);
    if (have) return have;
    const cue = this.cues.get(id);
    if (!cue || !this.ctx) return null;
    try {
      const r = await fetch(`music/${cue.file}`);
      if (!r.ok) return null;
      const buffer = await this.ctx.decodeAudioData(await r.arrayBuffer());
      const t: Track = { buffer, loopStart: cue.loopStart ?? 0, loopEnd: cue.loopEnd ?? 0, volume: cue.volume ?? 1 };
      this.tracks.set(id, t);
      return t;
    } catch { return null; }
  }

  /** Switch the looping track. Unknown cues keep the current music. */
  async play(id: string): Promise<void> {
    const real = this.resolve(id);
    if (!real) return;
    this.wanted = real;
    if (!this.ctx || !this.master) return;
    if (this.current?.id === real) return;
    const t = await this.trackFor(real);
    if (!t || this.wanted !== real || this.current?.id === real) return;
    this.fadeOut();
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = true;
    if (t.loopEnd > t.loopStart) { src.loopStart = t.loopStart; src.loopEnd = t.loopEnd; }
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(t.volume, now + 0.5);
    src.connect(gain).connect(this.master);
    src.start();
    this.current = { id: real, src, gain };
  }

  private fadeOut() {
    if (!this.current || !this.ctx) return;
    const { src, gain } = this.current;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    src.stop(now + 0.55);
    this.current = null;
  }

  stop() { this.wanted = null; this.fadeOut(); }

  /** A one-shot over the music, which ducks while it plays. */
  async stinger(id: string): Promise<void> {
    if (!this.has(id) || !this.ctx || !this.master) return;
    const t = await this.trackFor(id);
    if (!t) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = t.volume;
    src.connect(gain).connect(this.master);
    if (this.current) {
      const g = this.current.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.25, now + 0.15);
      g.setValueAtTime(0.25, now + t.buffer.duration);
      g.linearRampToValueAtTime(1, now + t.buffer.duration + 0.6);
    }
    src.start();
  }

  /** Use a file from the player's computer for a cue, for this session. */
  async useFile(id: string, file: File, loopStart = 0, loopEnd = 0): Promise<string> {
    if (!this.ctx) this.unlock();
    if (!this.ctx) return 'This browser cannot play audio here.';
    try {
      const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
      this.tracks.set(id, { buffer, loopStart, loopEnd: loopEnd > loopStart ? Math.min(loopEnd, buffer.duration) : 0, volume: 1 });
      this.custom.add(id);
      if (this.current?.id === id) this.fadeOut();
      if ((STINGERS as readonly string[]).includes(id)) void this.stinger(id);
      else void this.play(id);
      return `Playing ${file.name} (${buffer.duration.toFixed(1)} s) as "${id}".`;
    } catch {
      return `Couldn't read ${file.name}. Use OGG, MP3 or WAV.`;
    }
  }
}
