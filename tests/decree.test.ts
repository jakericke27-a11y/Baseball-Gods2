import { describe, expect, it } from 'vitest';
import { BASELINE_ENVIRONMENT, DIALS } from '../src/engine/atbat/environment';
import { DECREE_LINGER, decreeFor, decreeWinter, DECREES } from '../src/engine/decree';
import { generateLeague } from '../src/engine/generate';
import { activeModifiers, yearEnvironment } from '../src/engine/modifiers';
import { createRng } from '../src/engine/rng';
import { SNAPSHOT_VERSION, upgradeSnapshot, type SeasonSnap } from '../src/engine/snapshot';

describe("the Gods' decree", () => {
  it('none in Year 1; one a year after that, never the same stat twice running', () => {
    const L = generateLeague(4);
    expect(decreeWinter(L, 0, createRng(1))).toBeUndefined();
    let last = '';
    for (let y = 1; y <= 30; y++) {
      const d = decreeWinter(L, y, createRng(y))!;
      expect(d.from).toBe(y + 1);
      expect(d.kind).not.toBe(last);
      expect(DECREES.some((k) => k.id === d.kind)).toBe(true);
      expect(d.label).toMatch(/^The Year of the \w+ /);
      last = d.kind;
    }
    expect(L.modifiers.length).toBe(30);
  });

  it("a decree shifts its year's dials, then leaves a quarter behind for good", () => {
    const L = generateLeague(4);
    const d = decreeWinter(L, 1, createRng(9))!;
    const [dial, shift] = Object.entries(d.dials)[0] as [keyof typeof BASELINE_ENVIRONMENT, number];
    expect(activeModifiers(L, 2)).toEqual([d]);
    expect(yearEnvironment(L, 2)[dial]).toBeCloseTo(BASELINE_ENVIRONMENT[dial] + shift);
    expect(yearEnvironment(L, 1)).toEqual(BASELINE_ENVIRONMENT);
    decreeWinter(L, 2, createRng(10)); // Year 2 ends: its decree settles
    expect(L.env[dial]).toBeCloseTo(BASELINE_ENVIRONMENT[dial] + DECREE_LINGER * shift);
    for (const k of DIALS) if (k !== dial) expect(L.env[k]).toBe(BASELINE_ENVIRONMENT[k]);
  });

  it('asking twice in one winter changes nothing', () => {
    const L = generateLeague(4);
    const a = decreeWinter(L, 1, createRng(3)), b = decreeWinter(L, 1, createRng(99));
    expect(b).toBe(a);
    expect(L.modifiers.length).toBe(1);
    expect(decreeFor(L, 2)).toBe(a);
  });

  it('old saves upgrade to the baseline dials with no decrees', () => {
    const L = generateLeague(4) as unknown as Record<string, unknown>;
    delete L.env; delete L.modifiers; delete L.wishlist;
    const up = upgradeSnapshot({ v: 6, league: L } as unknown as SeasonSnap);
    expect(up.v).toBe(SNAPSHOT_VERSION);
    expect(up.league.wishlist).toEqual([]);
    expect(up.league.env).toEqual(BASELINE_ENVIRONMENT);
    expect(up.league.modifiers).toEqual([]);
  });
});
