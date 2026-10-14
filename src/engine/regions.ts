/**
 * The 14 birth regions, ported from regions_and_generation.sql.
 * 12 standard regions lean one attribute to 60 (others 48).
 * The Rift: all 50 with double variance. Elysian Gardens: all 55.
 */
export type TendencyKey =
  | 'power' | 'contact' | 'discipline' | 'speed' | 'clutch'
  | 'velocity' | 'control' | 'movement' | 'stamina'
  | 'instincts' | 'cannon' | 'glove';

export interface Region {
  id: number;
  name: string;
  environment: string;
  /** Non-standard region (wider variance or elevated tendencies). */
  special: boolean;
  /** Attribute standard deviation at generation. */
  stdev: number;
  tendencies: Record<TendencyKey, number>;
  godsFavorSkew: number;
  spawnWeight: number;
}

const KEYS: TendencyKey[] = [
  'power', 'contact', 'discipline', 'speed', 'clutch',
  'velocity', 'control', 'movement', 'stamina',
  'instincts', 'cannon', 'glove',
];

function leaning(primary: TendencyKey): Record<TendencyKey, number> {
  const t = {} as Record<TendencyKey, number>;
  for (const k of KEYS) t[k] = k === primary ? 60 : 48;
  return t;
}

function flat(value: number): Record<TendencyKey, number> {
  const t = {} as Record<TendencyKey, number>;
  for (const k of KEYS) t[k] = value;
  return t;
}

const std = (id: number, name: string, environment: string, primary: TendencyKey): Region => ({
  id, name, environment, special: false, stdev: 10,
  tendencies: leaning(primary), godsFavorSkew: 0, spawnWeight: 1.0,
});

export const REGIONS: Region[] = [
  std(1, 'The Ironworks', 'volcanic', 'power'),
  std(2, 'Silkshore', 'coastal', 'contact'),
  std(3, 'The Athenaeum', 'urban_ancient', 'discipline'),
  std(4, 'Windhollow', 'plains', 'speed'),
  std(5, 'Gallows End', 'frontier', 'clutch'),
  std(6, 'Mount Pyre', 'mountain_volcanic', 'velocity'),
  std(7, 'Meridian', 'urban_planned', 'control'),
  std(8, 'The Undertow', 'swamp', 'movement'),
  std(9, 'Oxenfeld', 'agrarian', 'stamina'),
  std(10, 'Duskwood', 'forest', 'instincts'),
  std(11, 'The Ramparts', 'cliff_fortress', 'cannon'),
  std(12, 'Glass Flats', 'salt_flat', 'glove'),
  {
    id: 13, name: 'The Rift', environment: 'dimensional_tear', special: true, stdev: 20,
    tendencies: flat(50), godsFavorSkew: 5, spawnWeight: 0.05,
  },
  {
    id: 14, name: 'Elysian Gardens', environment: 'paradise', special: true, stdev: 10,
    tendencies: flat(55), godsFavorSkew: -5, spawnWeight: 0.03,
  },
];
