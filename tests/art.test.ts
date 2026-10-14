import { describe, expect, it } from 'vitest';
import { artSlot, artSlots, blockColor, blockHtml, kitListing, kitReadme } from '../src/ui/art';
import { crc32, unzip, zip } from '../src/ui/zip';

describe('art slots', () => {
  it('a registered slot gets a color and shows up in the kit listing', () => {
    const before = artSlots().length;
    const s = artSlot({ id: 'test_card_frame', w: 48, h: 64, label: 'Card frame', group: 'cards' });
    expect(artSlots().length).toBe(before + 1);
    expect(s.color).toBe(blockColor('test_card_frame'));
    expect(s.kind).toBe('block');
    const l = kitListing(artSlots(), new Set());
    expect(l.waiting.map((x) => x.id)).toContain('test_card_frame');
    expect(kitReadme(l, [])).toContain('test_card_frame.png');
    expect(blockHtml('test_card_frame')).toContain('width:48px;height:64px');
  });
  it('published slots leave the waiting list', () => {
    artSlot({ id: 'test_logo', w: 32, h: 32, label: 'Logo', group: 'teams' });
    const l = kitListing(artSlots(), new Set(['test_logo']));
    expect(l.waiting.map((x) => x.id)).not.toContain('test_logo');
    expect(l.published.map((x) => x.id)).toEqual(['test_logo']);
  });
  it('same id again is the same slot; a different size is an error; bad ids are refused', () => {
    const a = artSlot({ id: 'test_same', w: 16, h: 16, label: 'A', group: 'x' });
    expect(artSlot({ id: 'test_same', w: 16, h: 16, label: 'B', group: 'x' })).toBe(a);
    expect(() => artSlot({ id: 'test_same', w: 16, h: 32, label: 'A', group: 'x' })).toThrow();
    expect(() => artSlot({ id: 'Bad Name', w: 16, h: 16, label: 'A', group: 'x' })).toThrow();
    expect(() => artSlot({ id: 'test_half', w: 1.5, h: 16, label: 'A', group: 'x' })).toThrow();
  });
});

describe('the kit zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
  it('writes a valid stored zip that lists every file', () => {
    const enc = new TextEncoder();
    const z = zip([{ name: 'README.txt', data: enc.encode('hi') }, { name: 'guides/a.png', data: new Uint8Array([1, 2, 3]) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cd = v.getUint32(end + 16, true);
    expect(v.getUint32(cd, true)).toBe(0x02014b50);
  });
  it('reads back what it writes, stored or deflated', async () => {
    const enc = new TextEncoder(), big = enc.encode('baseball '.repeat(5000));
    const files = [{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b.bin', data: big }];
    for (const z of [zip(files), await zip(files, true)]) {
      const back = await unzip(z);
      expect(new TextDecoder().decode(back.get('a.txt'))).toBe('hello');
      expect(back.get('dir/b.bin')).toEqual(big);
    }
    expect((await zip(files, true)).length).toBeLessThan(big.length / 10);
    await expect(unzip(enc.encode('nope'))).rejects.toThrow();
  });
});
