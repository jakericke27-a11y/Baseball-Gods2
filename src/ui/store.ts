/**
 * The browser's database (IndexedDB): league saves by slot, and a profile that outlives any one league
 * (achievements and the difficulty setup will live there). One slot today ('slot1'); the store is
 * keyed by slot so more can come later. Every call fails soft: no database means no autosave, and the
 * page says so, but the game still runs and files still export.
 */
import type { SaveMeta } from './savefile';

const DB = 'baseball-gods', VERSION = 1, LEAGUES = 'leagues', PROFILE = 'profile';
export const SLOT = 'slot1';

interface LeagueRow { slot: string; meta: SaveMeta; bytes: Uint8Array }

let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((res) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEAGUES)) db.createObjectStore(LEAGUES, { keyPath: 'slot' });
        if (!db.objectStoreNames.contains(PROFILE)) db.createObjectStore(PROFILE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch { res(null); }
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((res, rej) => {
    if (!db) { rej(new Error('no database')); return; }
    try {
      const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => rej(tx.error ?? new Error('database error'));
    } catch (e) { rej(e); }
  }));
}

/** Write a league to its slot. Resolves false if the browser wouldn't store it. */
export async function putLeague(slot: string, bytes: Uint8Array, meta: SaveMeta): Promise<boolean> {
  try { await run(LEAGUES, 'readwrite', (s) => s.put({ slot, meta, bytes } satisfies LeagueRow)); return true; } catch { return false; }
}
export async function getLeague(slot: string): Promise<LeagueRow | null> {
  try { return ((await run<LeagueRow>(LEAGUES, 'readonly', (s) => s.get(slot))) ?? null); } catch { return null; }
}
export async function deleteLeague(slot: string): Promise<void> {
  try { await run(LEAGUES, 'readwrite', (s) => s.delete(slot)); } catch { /* nothing to delete */ }
}

export async function profileGet<T>(key: string): Promise<T | undefined> {
  try { return await run<T>(PROFILE, 'readonly', (s) => s.get(key) as IDBRequest<T>); } catch { return undefined; }
}
export async function profileSet(key: string, value: unknown): Promise<boolean> {
  try { await run(PROFILE, 'readwrite', (s) => s.put(value, key)); return true; } catch { return false; }
}

/** Ask the browser not to clear our data under storage pressure (Safari clears idle sites otherwise). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false); } catch { return false; }
}
