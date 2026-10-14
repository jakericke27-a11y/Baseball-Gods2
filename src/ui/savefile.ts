/**
 * Save files: a league's whole state as one .zip, the same bytes in the browser's database and in an
 * exported file. Inside: save.json (what the league is, as plain data) and logs.bin (every game's
 * pitch log back to back). Loading a file never replays anything, so saves survive engine changes;
 * old formats upgrade on load (snapshot.ts for the season, FILE_UPGRADES here for the wrapper).
 */
import type { OffseasonReport } from '../engine/offseason';
import { restoreSeason, snapshotSeason, type SeasonSnap } from '../engine/snapshot';
import { Game, type Headline } from './state';
import { teamName } from './teams';
import { unzip, zip } from './zip';

export const FILE_FORMAT = 'baseball-gods-save';
export const FILE_VERSION = 1;

/** What a slot or file holds, readable without restoring the league. */
export interface SaveMeta { team: number; teamName: string; year: number; day: number; savedAt: string }

interface SaveJson {
  format: string; v: number; meta: SaveMeta;
  game: { seed: number; userTeam: number; headlines: Headline[]; offseason?: OffseasonReport | null };
  season: SeasonSnap;
  /** [offset, length] in logs.bin for each log the season lists. */
  logs: Array<[number, number]>;
}

const FILE_UPGRADES: Record<number, (j: SaveJson) => SaveJson> = {};

export const metaOf = (g: Game): SaveMeta => ({ team: g.userTeam, teamName: teamName(g.userTeam), year: g.season.year, day: g.day, savedAt: new Date().toISOString() });

export async function encodeSave(g: Game): Promise<{ bytes: Uint8Array; meta: SaveMeta }> {
  const { data, logs } = snapshotSeason(g.season);
  const index: Array<[number, number]> = [];
  let at = 0;
  for (const l of logs) { index.push([at, l.length]); at += l.length; }
  const bin = new Uint8Array(at);
  logs.forEach((l, i) => bin.set(l, index[i][0]));
  const meta = metaOf(g);
  const json: SaveJson = { format: FILE_FORMAT, v: FILE_VERSION, meta, game: { seed: g.seed, userTeam: g.userTeam, headlines: g.headlines, offseason: g.offseason }, season: data, logs: index };
  const bytes = await zip([{ name: 'save.json', data: new TextEncoder().encode(JSON.stringify(json)) }, { name: 'logs.bin', data: bin }], true);
  return { bytes, meta };
}

export class SaveError extends Error {}

export async function decodeSave(bytes: Uint8Array): Promise<{ game: Game; meta: SaveMeta }> {
  let files: Map<string, Uint8Array>;
  try { files = await unzip(bytes); } catch { throw new SaveError("That file isn't a Baseball Gods save."); }
  const raw = files.get('save.json');
  if (!raw) throw new SaveError("That file isn't a Baseball Gods save.");
  let j: SaveJson;
  try { j = JSON.parse(new TextDecoder().decode(raw)) as SaveJson; } catch { throw new SaveError('That save file is damaged.'); }
  if (j.format !== FILE_FORMAT) throw new SaveError("That file isn't a Baseball Gods save.");
  if (j.v > FILE_VERSION) throw new SaveError('That save is from a newer version of the game. Update the game, then load it.');
  while (j.v < FILE_VERSION) { const up = FILE_UPGRADES[j.v]; if (!up) throw new SaveError('That save is too old to load.'); j = up(j); }
  const bin = files.get('logs.bin') ?? new Uint8Array(0);
  const logs = j.logs.map(([o, n]) => bin.slice(o, o + n));
  let season;
  try { season = restoreSeason(j.season, logs); }
  catch (e) { throw new SaveError(/newer/.test(String(e)) ? 'That save is from a newer version of the game. Update the game, then load it.' : 'That save file is damaged.'); }
  const game = new Game(j.game.seed, j.game.userTeam, undefined, season);
  game.headlines = j.game.headlines;
  game.offseason = j.game.offseason ?? null;
  return { game, meta: j.meta };
}

export const saveFileName = (m: SaveMeta) => `baseball-gods-${m.teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-y${m.year}-d${m.day + 1}.zip`;
