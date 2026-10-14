/**
 * Art slots: every picture in the game that will one day be real art (design rule 7, color blocks
 * until art). A slot is an id (its PNG file name), a size at 1x, a label, a group and a block color.
 * Until art arrives the game shows the slot's stand-in: a code-drawn picture where one exists
 * (`draw`), otherwise a flat color block with the label.
 *
 * Published art sits next to the page in art/, listed in art/manifest.json as
 * {"files": {"<id>": "<id>.png"}}. The art kit (clubhouse ART panel, DOWNLOAD ART KIT) packs every
 * slot still waiting for art, so a slot registered anywhere shows up in the kit with no other change.
 *
 * The clubhouse is plain JS appended after the game, so the registry is also on window.__bgArt.
 */

import { offerFile } from './download';
import { zip } from './zip';

export interface ArtSlotDef {
  /** File name without .png: lowercase letters, digits and underscores. */
  id: string;
  w: number;
  h: number;
  label: string;
  /** Where it lives: 'clubhouse', 'cards', 'gods', 'teams'... */
  group: string;
  /** What sort of picture: 'object', 'sheet', 'room', 'block'... */
  kind?: string;
  /** Block color; picked from the id when left out. */
  color?: string;
  /** A finer place inside the group (a clubhouse room, say). */
  place?: string;
  /** A code-drawn stand-in; without one the kit uses the color block. */
  draw?: () => HTMLCanvasElement | null;
}
export interface ArtSlot extends ArtSlotDef { kind: string; color: string }

export const BLOCK_COLORS = ['#4BA3D9', '#E04A3B', '#FFD25A', '#5BA35F', '#B4643C', '#8E6BD1', '#3FA7D6', '#D96BA0', '#8E98B0', '#FF8C2A'];

export function blockColor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return BLOCK_COLORS[(h >>> 0) % BLOCK_COLORS.length];
}

const slots = new Map<string, ArtSlot>();
const guides = new Map<string, () => HTMLCanvasElement | null>();

/** Register a slot. Registering the same id again with the same size returns the first one. */
export function artSlot(def: ArtSlotDef): ArtSlot {
  if (!/^[a-z0-9_]+$/.test(def.id)) throw new Error(`art slot id "${def.id}": use lowercase letters, digits and _`);
  if (!(Number.isInteger(def.w) && Number.isInteger(def.h) && def.w > 0 && def.h > 0)) throw new Error(`art slot ${def.id}: size must be whole pixels`);
  const had = slots.get(def.id);
  if (had) {
    if (had.w !== def.w || had.h !== def.h) throw new Error(`art slot ${def.id} is already ${had.w}x${had.h}`);
    if (!had.draw && def.draw) had.draw = def.draw;
    return had;
  }
  const s: ArtSlot = { ...def, kind: def.kind ?? 'block', color: def.color ?? blockColor(def.id) };
  slots.set(s.id, s);
  return s;
}
export const artSlots = (): ArtSlot[] => [...slots.values()];
export const getArtSlot = (id: string): ArtSlot | undefined => slots.get(id);

/** A labeled guide picture for the kit (a room plan, a sheet layout). */
export function artGuide(name: string, draw: () => HTMLCanvasElement | null): void {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`art guide "${name}": use lowercase letters, digits and _`);
  guides.set(name, draw);
}
export const artGuides = (): string[] => [...guides.keys()];

/** A slot as HTML for the game's screens: its color block with the label, at `unit` px per art pixel. */
export function blockHtml(id: string, unit = 1): string {
  const s = slots.get(id);
  if (!s) return '';
  const esc = s.label.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<span class="art-block" data-art="${s.id}" title="${esc}" style="width:${s.w * unit}px;height:${s.h * unit}px;background:${s.color}"><span>${esc}</span></span>`;
}

/** The color block itself, drawn at 1x. */
export function colorBlock(s: ArtSlot): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const x = c.getContext('2d')!;
  x.fillStyle = s.color; x.fillRect(0, 0, s.w, s.h);
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.fillRect(0, s.h - 1, s.w, 1); x.fillRect(s.w - 1, 0, 1, s.h);
  const px = Math.min(16, Math.floor(s.h / 2), Math.floor((s.w - 4) / Math.max(1, s.label.length) * 1.8));
  if (px >= 6) {
    x.font = `${px}px 'Determination Mono', 'Courier New', monospace`;
    x.fillStyle = '#0B0F1C'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(s.label, s.w / 2, s.h / 2, s.w - 4);
  }
  return c;
}

/* ---------------------------------------------------------------- the art kit */

export interface KitListing { waiting: ArtSlot[]; published: ArtSlot[] }
export function kitListing(all: ArtSlot[], published: ReadonlySet<string>): KitListing {
  return { waiting: all.filter((s) => !published.has(s.id)), published: all.filter((s) => published.has(s.id)) };
}

export function kitReadme(l: KitListing, guideNames: string[]): string {
  const rows = (list: ArtSlot[]) => {
    const groups = new Map<string, ArtSlot[]>();
    for (const s of list) { const g = s.place ? `${s.group} / ${s.place}` : s.group; groups.set(g, [...(groups.get(g) ?? []), s]); }
    return [...groups].map(([g, ss]) => `${g.toUpperCase()}\n${ss.map((s) => `  ${(s.id + '.png').padEnd(28)} ${(s.w + 'x' + s.h).padEnd(9)} ${s.kind.padEnd(8)} ${s.label}`).join('\n')}`).join('\n\n');
  };
  return [
    'Baseball Gods art kit',
    '',
    `${l.waiting.length} slots are waiting for art${l.published.length ? `; ${l.published.length} already have published art and are left out` : ''}.`,
    'Each stand-in PNG here is the exact size and the final file name. Draw over it at 1x, keep the name,',
    'and drop the file on the clubhouse (or ART > PICK FILES) to try it in your browser.',
    'Four colors turn into the team\'s colors: #2E64C8 main, #173264 main shade, #E04A3B accent, #70251E accent shade.',
    'guides/ has labeled plans (rooms, the walk sheet, every thing at 4x). slots.json lists every slot.',
    'To publish art for everyone: the PNGs go in art/ next to the game, listed in art/manifest.json',
    '(manifest.json here is a ready one for every file in this kit).',
    '',
    'WAITING FOR ART',
    '',
    rows(l.waiting) || '  (none: everything has art)',
    '',
    guideNames.length ? `GUIDES\n${guideNames.map((n) => `  guides/${n}.png`).join('\n')}` : '',
    '',
  ].join('\n');
}

/** Slot ids with published art: listed in art/manifest.json and the file loads. */
export async function publishedArt(base = 'art/'): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-store' });
    if (!r.ok) return out;
    const m = await r.json();
    const files = (m && typeof m === 'object' ? (m.files || m) : {}) as Record<string, unknown>;
    await Promise.all(Object.entries(files).map(([id, file]) => typeof file !== 'string' ? null : new Promise<void>((res) => {
      const i = new Image(); i.onload = () => { out.add(id); res(); }; i.onerror = () => res(); i.src = base + file;
    })));
  } catch { /* no published art yet */ }
  return out;
}

async function pngBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('could not draw a PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface Kit { bytes: Uint8Array; listing: KitListing; files: string[] }
export async function buildKit(published?: ReadonlySet<string>): Promise<Kit> {
  const listing = kitListing(artSlots(), published ?? await publishedArt());
  const enc = new TextEncoder(), files: Array<{ name: string; data: Uint8Array }> = [];
  for (const s of listing.waiting) files.push({ name: `${s.id}.png`, data: await pngBytes(s.draw?.() ?? colorBlock(s)) });
  const guideNames: string[] = [];
  for (const [name, draw] of guides) { const c = draw(); if (c) { files.push({ name: `guides/${name}.png`, data: await pngBytes(c) }); guideNames.push(name); } }
  const status = (s: ArtSlot) => (listing.waiting.includes(s) ? 'waiting' : 'published');
  const json = artSlots().map((s) => ({ id: s.id, file: `${s.id}.png`, w: s.w, h: s.h, kind: s.kind, group: s.group, place: s.place, label: s.label, color: s.color, status: status(s) }));
  files.push({ name: 'slots.json', data: enc.encode(JSON.stringify(json, null, 2) + '\n') });
  files.push({ name: 'manifest.json', data: enc.encode(JSON.stringify({ files: Object.fromEntries(listing.waiting.map((s) => [s.id, `${s.id}.png`])) }, null, 2) + '\n') });
  files.unshift({ name: 'README.txt', data: enc.encode(kitReadme(listing, guideNames)) });
  return { bytes: zip(files), listing, files: files.map((f) => f.name) };
}

export const KIT_FILE = 'baseball-gods-art-kit.zip';

/** Hand the kit to the viewer. */
export const saveKit = (kit: Kit) => offerFile(KIT_FILE, kit.bytes, 'application/zip');

export const artApi = { slot: artSlot, slots: artSlots, get: getArtSlot, guide: artGuide, guides: artGuides, blockHtml, colorBlock, publishedArt, buildKit, saveKit };
if (typeof window !== 'undefined') (window as unknown as { __bgArt?: typeof artApi }).__bgArt = artApi;
