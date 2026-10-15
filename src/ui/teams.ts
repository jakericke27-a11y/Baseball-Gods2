/**
 * Placeholder team identities: names and colors. Your team's colors dress the whole interface.
 * The names are MLB's, for testing only (swap them before any release); ids 1–15 are the AL, 16–30 the NL,
 * five to a division in the engine's order (East, Central, West).
 */
export const LEAGUES = ['AL', 'NL'];
export const LEAGUE_NAMES = ['American League', 'National League'];
export const DIVISIONS = ['East', 'Central', 'West'];
const CLUBS: Array<[city: string, name: string]> = [
  ['New York', 'Yankees'], ['Boston', 'Red Sox'], ['Toronto', 'Blue Jays'], ['Tampa Bay', 'Rays'], ['Baltimore', 'Orioles'],
  ['Cleveland', 'Guardians'], ['Minnesota', 'Twins'], ['Detroit', 'Tigers'], ['Kansas City', 'Royals'], ['Chicago', 'White Sox'],
  ['Houston', 'Astros'], ['Texas', 'Rangers'], ['Seattle', 'Mariners'], ['Los Angeles', 'Angels'], ['Oakland', 'Athletics'],
  ['Atlanta', 'Braves'], ['Philadelphia', 'Phillies'], ['New York', 'Mets'], ['Miami', 'Marlins'], ['Washington', 'Nationals'],
  ['Milwaukee', 'Brewers'], ['Chicago', 'Cubs'], ['St. Louis', 'Cardinals'], ['Cincinnati', 'Reds'], ['Pittsburgh', 'Pirates'],
  ['Los Angeles', 'Dodgers'], ['San Diego', 'Padres'], ['San Francisco', 'Giants'], ['Arizona', 'Diamondbacks'], ['Colorado', 'Rockies'],
];
const club = (id: number) => CLUBS[(Math.max(1, id) - 1) % CLUBS.length];
/** The short name used everywhere: "Yankees". */
export const teamName = (id: number) => club(id)[1];
/** City and name, for page titles and the team picker: "New York Yankees". */
export const teamFull = (id: number) => club(id).join(' ');

/** [team color, action color] for teams 1–30. */
const PAIRS: Array<[string, string]> = [
  ['#2E64C8', '#E04A3B'], ['#B3222E', '#2B4C9B'], ['#2F7A44', '#E3A33B'], ['#E8742A', '#3A4A6E'], ['#6B3FA0', '#E8B53A'],
  ['#178C8C', '#E8604C'], ['#1F3A6E', '#F08A24'], ['#7A1F2E', '#D9A93A'], ['#2E9E4F', '#1E3A8A'], ['#4AA3DF', '#1C2F5E'],
  ['#C42F7A', '#2C2C6E'], ['#3D6B5C', '#D9653B'], ['#D4A017', '#3B3B4F'], ['#5B6B7A', '#E04A3B'], ['#A3243B', '#E0A81E'],
  ['#0F7B6C', '#E8B93E'], ['#3B5BA9', '#F28C38'], ['#9C2E6E', '#2E9E95'], ['#2A4D69', '#E0533D'], ['#C2502A', '#2E5E8C'],
  ['#5A8F29', '#3A2E6E'], ['#7C4DFF', '#E8A83D'], ['#00838F', '#E8505B'], ['#8E2430', '#4C7DC9'], ['#3F7D5E', '#C8553D'],
  ['#E0A23A', '#2B3A67'], ['#4B4FA8', '#E36A3B'], ['#B5452E', '#1F4E5F'], ['#1E6091', '#E8913E'], ['#6D2C8E', '#3AA88A'],
];

/** A team's two colors, for chips beside its name. */
export const teamPair = (teamId: number): [string, string] => PAIRS[(Math.max(1, teamId) - 1) % PAIRS.length];

type RGB = [number, number, number];
const toRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface TeamColors {
  line: string; frame: string; tint: RGB; ink: string; action: string; actionShadow: string; hi: string; muted: string; jersey: RGB;
}

export function teamColors(teamId: number): TeamColors {
  const [lineHex, actionHex] = PAIRS[(teamId - 1) % PAIRS.length];
  const line = toRgb(lineHex), action = toRgb(actionHex);
  const night: RGB = [5, 10, 28];
  const frame = mix(line, [255, 255, 255], 0.74);
  const tint = mix(line, night, 0.86).map(Math.round) as RGB;
  return {
    line: lineHex, frame: toHex(frame), tint, ink: toHex(mix(line, [0, 0, 0], 0.5)),
    action: actionHex, actionShadow: toHex(mix(action, [0, 0, 0], 0.5)),
    hi: `rgba(${line.join(', ')}, 0.35)`, muted: toHex(mix(frame, tint, 0.3)), jersey: line,
  };
}

/** Repaint the interface in a team's colors (CSS custom properties on the root element). */
export function applyTeamColors(c: TeamColors): void {
  const s = document.documentElement.style;
  s.setProperty('--line', c.line);
  s.setProperty('--frame', c.frame);
  s.setProperty('--tint', c.tint.join(', '));
  s.setProperty('--ink', c.ink);
  s.setProperty('--action', c.action);
  s.setProperty('--action-shadow', c.actionShadow);
  s.setProperty('--hi', c.hi);
  s.setProperty('--muted', c.muted);
}
