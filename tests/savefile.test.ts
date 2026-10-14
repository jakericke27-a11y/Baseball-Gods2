import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, SaveError } from '../src/ui/savefile';
import { Game } from '../src/ui/state';
import { zip } from '../src/ui/zip';

describe('save files', () => {
  it('a league round-trips through a file mid-season and plays on identically', async () => {
    const a = new Game(31337, 12), b = new Game(31337, 12);
    for (let i = 0; i < 40; i++) { a.simDay(); b.simDay(); }
    const { bytes, meta } = await encodeSave(a);
    expect(meta).toMatchObject({ team: 12, year: 1, day: 40 });
    const { game: c } = await decodeSave(bytes);
    expect(c.day).toBe(40);
    expect(c.headlines).toEqual(a.headlines);
    expect([...c.byDay]).toEqual([...a.byDay]);
    for (let i = 0; i < 30; i++) { b.simDay(); c.simDay(); }
    expect(JSON.stringify([...c.season.standings.values()])).toBe(JSON.stringify([...b.season.standings.values()]));
    expect(c.headlines).toEqual(b.headlines);
    expect(c.season.results.at(-1)!.log).toEqual(b.season.results.at(-1)!.log);
  }, 60000);
  it('explains files it cannot load', async () => {
    await expect(decodeSave(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(SaveError);
    const other = zip([{ name: 'save.json', data: new TextEncoder().encode('{"format":"something-else"}') }]);
    await expect(decodeSave(other)).rejects.toThrow(/isn't a Baseball Gods save/);
    const newer = zip([{ name: 'save.json', data: new TextEncoder().encode('{"format":"baseball-gods-save","v":99}') }]);
    await expect(decodeSave(newer)).rejects.toThrow(/newer version/);
  });
});
