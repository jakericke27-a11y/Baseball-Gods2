/**
 * Turns a 40-man roster into a game plan: lineup (with positions and batting order),
 * a rotation sized by the team's locked flag, and a bullpen with roles.
 * 26 active = 13 position players' worth of lineup/bench + 13 pitchers (rotation + bullpen).
 */
import type { BullpenArm, LineupSlot } from '../game/types';
import type { League, Player, TeamStrategy } from '../types';

export interface TeamPlan {
  teamId: number;
  lineup: LineupSlot[];
  /** Ordered: the ace is rotation[0]. */
  rotation: Player[];
  bullpen: BullpenArm[];
  strategy: TeamStrategy;
}

const POS_NUM: Record<string, number> = { C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
const batScore = (p: Player) => p.ratings.power + p.ratings.contact + p.ratings.discipline + 0.3 * p.ratings.speed;
const fieldScore = (p: Player) => p.ratings.instincts + p.ratings.glove + p.ratings.cannon;
const onBase = (p: Player) => p.ratings.contact + p.ratings.discipline + 0.3 * p.ratings.speed;
const pitchScore = (p: Player) => p.ratings.velocity + p.ratings.control + p.ratings.movement;
const STAFF_SIZE = 13;

export function buildTeamPlans(league: League): Map<number, TeamPlan> {
  const players = new Map(league.players.map((p) => [p.id, p]));
  const plans = new Map<number, TeamPlan>();
  for (const t of league.teams) {
    const roster = t.playerIds.map((id) => players.get(id)!);

    // Lineup: best bat at each position, best remaining bat at DH.
    const hitters = roster.filter((p) => p.position !== 'P');
    const slots: LineupSlot[] = [];
    for (const [pos, num] of Object.entries(POS_NUM)) {
      const best = hitters.filter((h) => h.position === pos && !slots.some((s) => s.player === h)).sort((a, b) => batScore(b) - batScore(a))[0];
      if (best) slots.push({ player: best, pos: num });
    }
    // Nobody natural at a spot (retirements can leave a hole): the best remaining glove-and-bat covers it out of position.
    for (const [pos, num] of Object.entries(POS_NUM)) {
      if (slots.some((s) => s.pos === num)) continue;
      const cover = hitters.filter((h) => !slots.some((s) => s.player === h)).sort((a, b) => (batScore(b) + fieldScore(b)) - (batScore(a) + fieldScore(a)))[0];
      if (cover) slots.push({ player: cover, pos: num });
      void pos;
    }
    slots.push({ player: hitters.filter((h) => !slots.some((s) => s.player === h)).sort((a, b) => batScore(b) - batScore(a))[0], pos: 0 });
    // Batting order: two best on-base guys up top, then the bats by strength.
    const top = [...slots].sort((a, b) => onBase(b.player) - onBase(a.player)).slice(0, 2);
    const rest = slots.filter((s) => !top.includes(s)).sort((a, b) => batScore(b.player) - batScore(a.player));
    const lineup = [...top, ...rest];

    // Rotation: top N starters by stuff + command; stamina breaks thin staffs.
    const pitchers = roster.filter((p) => p.position === 'P').sort((a, b) => pitchScore(b) - pitchScore(a));
    const N = t.strategy.rotationSize;
    const rotation = pitchers.filter((p) => p.pitcherRole === 'SP').slice(0, N);
    for (const p of [...pitchers].sort((a, b) => b.ratings.stamina - a.ratings.stamina)) {
      if (rotation.length >= N) break;
      if (!rotation.includes(p)) rotation.push(p);
    }
    rotation.sort((a, b) => pitchScore(b) - pitchScore(a));

    // Bullpen: best remaining arms. Closer = best stuff (a natural closer if there is one),
    // two setup men, long relief from the highest-stamina arms, the rest middle relief.
    const pen = pitchers.filter((p) => !rotation.includes(p)).slice(0, STAFF_SIZE - N);
    const closer = pen.find((p) => p.pitcherRole === 'CL') ?? pen[0];
    const others = pen.filter((p) => p !== closer);
    // Setup men cover the 7th–8th, so stamina counts as well as stuff.
    const setup = [...others].sort((a, b) => (pitchScore(b) + 0.6 * b.ratings.stamina) - (pitchScore(a) + 0.6 * a.ratings.stamina)).slice(0, 2);
    const longCount = pen.length >= 8 ? 2 : 1;
    const long = others.filter((p) => !setup.includes(p)).sort((a, b) => b.ratings.stamina - a.ratings.stamina).slice(0, longCount);
    const bullpen: BullpenArm[] = [
      { player: closer, role: 'CL' },
      ...setup.map((player) => ({ player, role: 'SU' as const })),
      ...long.map((player) => ({ player, role: 'LR' as const })),
      ...others.filter((p) => !setup.includes(p) && !long.includes(p)).map((player) => ({ player, role: 'MR' as const })),
    ];
    plans.set(t.id, { teamId: t.id, lineup, rotation, bullpen, strategy: t.strategy });
  }
  return plans;
}
