/**
 * The decision cards and missions themselves (step 2.8's first deck). Each card says who it's about (bind), what it says,
 * and what each answer does; cards.ts does the drawing, deadlines, dice and saving. Add a card by adding an entry.
 * Effects are small on purpose: a few rating points for a week or two, a nudge to a ceiling, a follow-up months later.
 */
import { gameDrama } from '../engine/game/drama';
import { Moment } from '../engine/game/types';
import { artSlot } from './art';
import type { CardDef, Ctx, Effect, MissionDef } from './cards';
import { mine, pick, regulars } from './cards';
import { hotCold } from './races';

const N = (c: Ctx, id: number) => c.g.name(id);
const last = (c: Ctx, id: number) => N(c, id).split(' ').slice(-1)[0];
const coin = (c: Ctx, p = 0.5) => c.rng.next() < p;
function rt(pid: number, rating: 'power' | 'contact' | 'discipline' | 'speed' | 'velocity' | 'control' | 'movement' | 'stamina' | 'instincts' | 'glove' | 'cannon' | 'clutchRisp' | 'clutchPressure', delta: number, days?: number): Effect {
  return { kind: 'rating', pid, rating, delta, ...(days ? { days } : {}) };
}
const note = (text: string): Effect => ({ kind: 'note', text });
const head = (text: string, big = false): Effect => ({ kind: 'headline', text, big });
const yourGame = (c: Ctx) => { const r = c.result; if (!r) return null; const side = r.teamIds[0] === c.g.userTeam ? 0 : 1; return { r, side, won: r.score[side] > r.score[1 - side] }; };

export const CARD_DEFS: CardDef[] = [
  // ---------------------------------------------------------------- storyline (one a week)
  {
    id: 'feud', title: 'Clubhouse Feud', kind: 'story', weight: 1.2, deadline: [7, 7],
    bind: (c) => { const ps = mine(c.g, 'all'); if (ps.length < 2) return null; const a = pick(c.rng, ps)!; const b = pick(c.rng, ps.filter((p) => p.id !== a.id))!; return { p: [a.id, b.id] }; },
    text: (c, b) => `${N(c, b.p![0])} and ${N(c, b.p![1])} had to be pulled apart by the batting cage. Something about a borrowed bat and a stolen parking spot. The clubhouse is picking sides.`,
    choices: [
      { label: (c, b) => `Back ${last(c, b.p![0])}`, hint: 'One gets a lift, the other stews', effects: (c, b) => [rt(b.p![0], 'clutchPressure', 4, 14), rt(b.p![1], 'clutchPressure', -4, 14)] },
      { label: (c, b) => `Back ${last(c, b.p![1])}`, hint: 'One gets a lift, the other stews', effects: (c, b) => [rt(b.p![1], 'clutchPressure', 4, 14), rt(b.p![0], 'clutchPressure', -4, 14)] },
      { label: 'Stay out of it', hint: 'Let them sort it out themselves', coach: 2, effects: (c, b) => [note('You stay out of it'), { kind: 'later', days: [60, 150], note: 'The feud settled itself', effects: [rt(b.p![0], 'clutchPressure', 2), rt(b.p![1], 'clutchPressure', 2), head(`${N(c, b.p![0])} and ${N(c, b.p![1])}, once at each other's throats, are now inseparable`)] }] },
    ],
    expire: (c, b) => [rt(b.p![0], 'contact', -2, 14), rt(b.p![1], 'contact', -2, 14)], expireText: 'It festered',
  },
  {
    id: 'extra-bp', title: 'Extra Batting Practice', kind: 'story', deadline: [7, 7],
    bind: (c) => { const p = pick(c.rng, regulars(c.g)); return p ? { p: [p.id] } : null; },
    text: (c, b) => `${N(c, b.p![0])} wants the cage open at 6 a.m. every day this week. "I'm close," he says. "I can feel it."`,
    choices: [
      { label: 'Open the cage', hint: 'Sharper bat, tired eyes', coach: 2, effects: (c, b) => [rt(b.p![0], 'contact', 4, 14), rt(b.p![0], 'discipline', -2, 14)] },
      { label: 'Rest is part of it', hint: 'Nothing changes', effects: () => [note('He grumbles and goes home')] },
    ],
  },
  {
    id: 'slump', title: 'Slump', kind: 'story', weight: 1.3, deadline: [5, 7],
    bind: (c) => { const regs = new Set(regulars(c.g).map((p) => p.id)); const cold = hotCold(c.g, 14).coldBats.find((f) => regs.has(f.id)); return cold ? { p: [cold.id], text: cold.line } : null; },
    text: (c, b) => `${N(c, b.p![0])} is ${b.text} over the last two weeks. The writers have noticed. So has he.`,
    choices: [
      { label: 'Sit him a few days', hint: 'Clear his head', effects: (c, b) => [rt(b.p![0], 'contact', 3, 10), rt(b.p![0], 'power', 3, 10)] },
      { label: 'Ride it out', hint: 'A coin flip: he busts out, or sinks', coach: 2, effects: (c, b) => (coin(c) ? [rt(b.p![0], 'contact', 5, 14), head(`${N(c, b.p![0])} says the manager's faith turned his season around`)] : [rt(b.p![0], 'contact', -3, 14)]) },
      { label: 'Tinker with his swing', hint: 'Short-term pain, long-term ceiling', effects: (c, b) => [rt(b.p![0], 'contact', -3, 21), { kind: 'potential', pid: b.p![0], delta: 2 }] },
    ],
    expire: (c, b) => [rt(b.p![0], 'contact', -2, 7)], expireText: 'Nobody said anything',
  },
  {
    id: 'new-pitch', title: 'A New Pitch', kind: 'story', deadline: [10, 14],
    bind: (c) => { const p = pick(c.rng, mine(c.g, 'arm')); return p ? { p: [p.id] } : null; },
    text: (c, b) => `${N(c, b.p![0])} has been messing with a new grip in the bullpen. "Give me a month," he says. "It'll be filthy."`,
    choices: [
      { label: 'Let him work on it', hint: 'Better stuff for good, shaky command for a month', effects: (c, b) => [rt(b.p![0], 'movement', 3), rt(b.p![0], 'control', -4, 30)] },
      { label: 'Not mid-season', hint: 'Nothing changes', coach: 2, effects: () => [note('He shelves the pitch')] },
    ],
  },
  {
    id: 'mentor', title: 'Old Hand, New Kid', kind: 'story', weight: 0.6, deadline: [14, 21],
    bind: (c) => { const ps = mine(c.g, 'all'); const vet = pick(c.rng, ps.filter((p) => p.age >= 31)); const kid = pick(c.rng, ps.filter((p) => p.age <= 24)); return vet && kid ? { p: [vet.id, kid.id] } : null; },
    text: (c, b) => `${N(c, b.p![0])} has been watching ${N(c, b.p![1])} from the end of the bench. "Kid's got it," he tells you. "He just doesn't know what to do with it yet."`,
    choices: [
      { label: 'Pair them up', hint: "The kid's ceiling rises; the vet finds a purpose", coach: 2, effects: (c, b) => [{ kind: 'potential', pid: b.p![1], delta: 2 }, rt(b.p![0], 'clutchPressure', 2)] },
      { label: 'Let the kid find his own way', hint: 'Nothing changes', effects: () => [note('The kid keeps to himself')] },
    ],
  },
  {
    id: 'reporter', title: 'The Beat Writer', kind: 'story', deadline: [3, 4],
    bind: (c) => { const regs = new Set(regulars(c.g).map((p) => p.id)); const cold = hotCold(c.g, 14).coldBats.find((f) => regs.has(f.id)); return { p: cold ? [cold.id] : [] }; },
    text: (c, b) => `The beat writer from the Gazette wants five minutes before the game.${b.p?.length ? ` He's going to ask about ${N(c, b.p[0])}.` : ''}`,
    choices: [
      { label: 'Talk up the team', hint: 'The clubhouse likes reading it', coach: 2, effects: (c) => [{ kind: 'team', rating: 'clutchPressure', delta: 2, days: 7 }, head('The manager: "This group is special. Write it down."')] },
      { label: 'Call out the slumper', hint: 'He answers the bell, or he shrinks', effects: (c, b) => (b.p?.length ? (coin(c) ? [rt(b.p[0], 'power', 4, 14), head(`${N(c, b.p[0])} responds to his manager with a loud week`)] : [rt(b.p[0], 'contact', -3, 14)]) : [note('Nobody to call out')]) },
      { label: 'No comment', hint: 'Nothing changes', effects: () => [note('The story runs without you')] },
    ],
  },
  {
    id: 'omen', title: 'An Omen', kind: 'story', weight: 0.7, deadline: [5, 7],
    bind: (c) => { const best = [...regulars(c.g)].sort((a, b) => b.ratings.power + b.ratings.contact - a.ratings.power - a.ratings.contact)[0]; return best ? { p: [best.id] } : null; },
    text: (c, b) => `A crow has sat on the scoreboard for three straight games. The grounds crew swears it watches ${N(c, b.p![0])} hit. The old-timers say the Gods want something.`,
    choices: [
      { label: (c, b) => `Burn ${last(c, b.p![0])}'s batting gloves`, hint: 'He hates it now. The Gods may remember', effects: (c, b) => [rt(b.p![0], 'contact', -2, 7), { kind: 'later', days: [30, 60], note: 'The Gods remembered the offering', effects: [{ kind: 'team', rating: 'power', delta: 2, days: 21 }, head('A strange warm wind has followed the ballclub for weeks')] }] },
      { label: "It's a bird", hint: 'Probably nothing', coach: 2, effects: (c, b) => (coin(c, 0.35) ? [{ kind: 'later', days: [30, 90], note: 'The Gods remembered the slight', effects: [rt(b.p![0], 'power', -3, 30), head(`${N(c, b.p![0])} can't shake the feeling something is watching him`)] }] : [note('The crow flies off')]) },
    ],
  },
  {
    id: 'superstition', title: 'The Streak', kind: 'story', deadline: [4, 6],
    bind: (c) => { const ids = new Set(mine(c.g, 'bat').map((p) => p.id)); const s = [...c.g.streaks.hit].filter(([id, n]) => ids.has(id) && n >= 8).sort((a, b) => b[1] - a[1])[0]; return s ? { p: [s[0]], n: s[1] } : null; },
    text: (c, b) => `${N(c, b.p![0])} has hit in ${b.n} straight. He hasn't washed his socks, eaten anything but chicken, or spoken to a reporter since it started. The clubhouse would like a word.`,
    choices: [
      { label: 'Indulge the ritual', hint: "Don't touch a thing", coach: 2, effects: (c, b) => [rt(b.p![0], 'contact', 3, 14), rt(b.p![0], 'clutchPressure', 2, 14)] },
      { label: 'Make him shower', hint: 'The clubhouse thanks you. He may not', effects: (c, b) => [{ kind: 'team', rating: 'clutchPressure', delta: 1, days: 7 }, rt(b.p![0], 'contact', -2, 7)] },
    ],
  },
  {
    id: 'prove-it', title: 'Prove It', kind: 'story', weight: 0.8, deadline: [5, 7],
    bind: (c) => { const p = [...regulars(c.g)].sort((a, b) => b.ratings.power - a.ratings.power)[c.rng.int(3)]; return p ? { p: [p.id] } : null; },
    text: (c, b) => `${N(c, b.p![0])} stops by your office. "Bet you I hit more homers in the next 30 days than anybody thinks." He wants a deal: if he does it, he wants your public word he's a cornerstone.`,
    choices: [
      { label: "You're on", hint: 'A mission: hit the mark for a lasting boost', coach: 2, effects: (c, b) => [{ kind: 'mission', mission: 'homers', bind: b }] },
      { label: 'Just play ball', hint: 'Nothing changes', effects: () => [note('He shrugs and leaves')] },
    ],
  },
  {
    id: 'stretch', title: 'Clubhouse Meeting', kind: 'story', weight: 0.8, deadline: [3, 5],
    bind: (c) => (c.g.season.standings.get(c.g.userTeam) ? { p: [] } : null),
    text: () => `The veterans want a closed-door meeting. They think this team can win seven of its next ten. They want you to say it out loud.`,
    choices: [
      { label: 'Say it out loud', hint: 'A mission: seven of ten', coach: 2, effects: (c, b) => [{ kind: 'mission', mission: 'stretch', bind: b }] },
      { label: 'Keep it to yourselves', hint: 'Nothing changes', effects: () => [note('The meeting ends quietly')] },
    ],
  },
  {
    id: 'workhorse', title: 'Give Me the Ball', kind: 'story', weight: 0.7, deadline: [5, 7],
    bind: (c) => { const p = pick(c.rng, mine(c.g, 'sp')); return p ? { p: [p.id] } : null; },
    text: (c, b) => `${N(c, b.p![0])} is tired of handing the ball to the bullpen in the sixth. "Let me go seven in my next three," he says. "Watch."`,
    choices: [
      { label: 'Let him go', hint: 'A mission: seven innings in three straight starts', coach: 2, effects: (c, b) => [{ kind: 'mission', mission: 'workhorse', bind: b }] },
      { label: 'We go by the numbers', hint: 'Nothing changes', effects: () => [note('He takes it like a pro')] },
    ],
  },

  // ---------------------------------------------------------------- from your games (Drama)
  {
    id: 'walkoff', title: 'Walk-Off', kind: 'game', weight: 3, deadline: [3, 4],
    bind: (c) => { const y = yourGame(c); if (!y || !y.won) return null; const w = y.r.moments.find((m) => m.kind === Moment.WalkOff && c.g.teamOf.get(m.playerId) === c.g.userTeam); return w ? { p: [w.playerId] } : null; },
    text: (c, b) => `${N(c, b.p![0])} ended it. The dugout emptied, somebody brought out the shaving cream, and the clubhouse is still loud an hour later.`,
    choices: [
      { label: 'Let them celebrate', hint: 'Ride the high', coach: 2, effects: (c, b) => [{ kind: 'team', rating: 'clutchPressure', delta: 3, days: 7 }, rt(b.p![0], 'clutchPressure', 3, 21)] },
      { label: "Act like you've been there", hint: 'Steady: a quieter lift for longer', effects: (c, b) => [{ kind: 'team', rating: 'clutchRisp', delta: 1, days: 21 }] },
    ],
  },
  {
    id: 'blown-lead', title: 'One That Got Away', kind: 'game', weight: 2, deadline: [3, 4],
    bind: (c) => {
      const y = yourGame(c); if (!y || y.won || !y.r.log) return null;
      const d = gameDrama(y.r.log, y.r.innings), myWp = d.curve.map((p) => (y.side === 1 ? p : 1 - p));
      if (Math.max(...myWp) < 0.75) return null;
      const pid = d.biggest && c.g.teamOf.get(d.biggest.pitcher) === c.g.userTeam ? d.biggest.pitcher : y.r.decisions.loss;
      return pid && c.g.teamOf.get(pid) === c.g.userTeam ? { p: [pid] } : null;
    },
    text: (c, b) => `You had it. Then you didn't. ${N(c, b.p![0])} sat at his locker for an hour after the last out, still in his spikes.`,
    choices: [
      { label: 'Back him publicly', hint: 'He gets his confidence back', coach: 2, effects: (c, b) => [rt(b.p![0], 'control', 4, 14), head(`Manager on ${last(c, b.p![0])}: "He's our guy. Next question."`)] },
      { label: 'Let him hear it', hint: 'The team bristles; he might too', effects: (c, b) => (coin(c) ? [rt(b.p![0], 'velocity', 3, 14)] : [rt(b.p![0], 'control', -3, 14)]) },
      { label: 'Say nothing', hint: 'Time heals', effects: () => [note('Tomorrow is another game')] },
    ],
  },
  {
    id: 'marathon', title: 'Marathon', kind: 'game', weight: 2, deadline: [2, 3],
    bind: (c) => { const y = yourGame(c); return y && y.r.innings >= 12 ? { p: [], n: y.r.innings } : null; },
    text: (c, b) => `${b.n} innings. Everybody's legs are gone, the bullpen is empty and the clubhouse spread ran out in the 14th.`,
    choices: [
      { label: 'Cancel batting practice', hint: 'Fresh legs for a few days', coach: 2, effects: () => [{ kind: 'team', rating: 'speed', delta: 2, days: 4 }, { kind: 'team', rating: 'stamina', delta: 3, days: 4 }] },
      { label: 'Nobody rests', hint: 'Grit, at a price', effects: () => [{ kind: 'team', rating: 'contact', delta: -2, days: 4 }, { kind: 'flag', key: 'grit', delta: 1 }, note('The team grinds on')] },
    ],
  },
  {
    id: 'clutch-hero', title: 'Big Moment', kind: 'game', weight: 2, deadline: [3, 4],
    bind: (c) => {
      const y = yourGame(c); if (!y || !y.won || !y.r.log) return null;
      const d = gameDrama(y.r.log, y.r.innings), big = d.biggest;
      if (!big || c.g.teamOf.get(big.batter) !== c.g.userTeam || Math.abs(big.delta) < 0.2) return null;
      return { p: [big.batter], n: Math.round(100 * Math.abs(big.delta)) };
    },
    text: (c, b) => `${N(c, b.p![0])} came through when it mattered: one swing moved the game ${b.n}%. The fans want him in the middle of the order.`,
    choices: [
      { label: 'Give him the game ball', hint: 'He believes it now', coach: 2, effects: (c, b) => [rt(b.p![0], 'clutchRisp', 3)] },
      { label: "Remind him it's one game", hint: 'Focus: a short boost', effects: (c, b) => [rt(b.p![0], 'contact', 2, 14)] },
    ],
  },

  // ---------------------------------------------------------------- winter (Opening Day of a new year)
  {
    id: 'decree', title: 'The Gods Have Spoken', kind: 'winter', weight: 100, deadline: [10, 10],
    bind: (c) => (c.g.offseason?.decree && !c.g.cards.desk.some((x) => x.def === 'decree' && x.year === c.g.year) ? { p: [], text: `${c.g.offseason.decree.label}: ${c.g.offseason.decree.effect}` } : null),
    text: (c, b) => `The scroll arrived at the ballpark before dawn. ${b.text}. Every manager in the league has one on his desk this morning.`,
    choices: [
      { label: 'Accept the will of the Gods', hint: 'Nothing changes', coach: 3, effects: () => [note('You pin the scroll to the wall')] },
      { label: 'Petition the Gods', hint: "They're listening. Maybe", effects: () => [{ kind: 'flag', key: 'petitions', delta: 1 }, head('A manager has petitioned the Gods. The Gods have not replied')] },
    ],
  },
  {
    id: 'winter-ball', title: 'Winter Ball', kind: 'winter', deadline: [14, 14],
    bind: (c) => { const kid = [...mine(c.g, 'all')].filter((p) => p.age <= 25).sort((a, b) => a.age - b.age)[0]; return kid ? { p: [kid.id] } : null; },
    text: (c, b) => `A winter league club wants ${N(c, b.p![0])} for the rest of the off-season. Long bus rides, real at-bats.`,
    choices: [
      { label: 'Send him', hint: 'His ceiling rises', coach: 2, effects: (c, b) => [{ kind: 'potential', pid: b.p![0], delta: 2 }] },
      { label: 'Let him rest', hint: 'Nothing changes', effects: () => [note('He spends the winter fishing')] },
    ],
  },
  {
    id: 'owner-call', title: 'The Owner Calls', kind: 'winter', deadline: [14, 14],
    bind: () => ({ p: [] }),
    text: () => `The owner wants to know the plan for the year. He's not asking.`,
    choices: [
      { label: 'Win now', hint: 'The team hears it', coach: 2, effects: () => [{ kind: 'team', rating: 'clutchPressure', delta: 2, days: 30 }] },
      { label: 'Build for later', hint: 'The kids get the attention', effects: (c) => mine(c.g, 'all').filter((p) => p.age <= 24).slice(0, 2).map((p): Effect => ({ kind: 'potential', pid: p.id, delta: 2 })) },
      { label: 'Trust the Gods', hint: 'Who knows', effects: (c) => (coin(c) ? [{ kind: 'team', rating: 'power', delta: 2, days: 30 }] : [note('The Gods are quiet')]) },
    ],
  },
];

for (const d of CARD_DEFS) artSlot({ id: `dcard_${d.id.replace(/-/g, '_')}`, w: 120, h: 64, label: d.title, group: 'cards', kind: 'card art' });

// ---------------------------------------------------------------- missions
const batOf = (c: Ctx, id: number) => c.g.season.batting.get(id);
const pitOf = (c: Ctx, id: number) => c.g.season.pitching.get(id);
const rec = (c: Ctx) => c.g.season.standings.get(c.g.userTeam)!;

export const MISSION_DEFS: MissionDef[] = [
  {
    id: 'homers', title: 'Prove It', days: 30,
    target: (c, b) => { const l = batOf(c, b.p![0]); const pace = l && l.PA ? l.HR / Math.max(1, c.g.day) : 0.15; return Math.max(4, Math.ceil(pace * 30 * 1.3)); },
    goal: (c, b, t) => `${N(c, b.p![0])}: ${t} home runs in 30 days`,
    base: (c, b) => [batOf(c, b.p![0])?.HR ?? 0],
    progress: (c, m) => (batOf(c, m.bind.p![0])?.HR ?? 0) - m.base[0],
    success: (c, b) => [rt(b.p![0], 'power', 2), head(`${N(c, b.p![0])} makes good on his promise`, true)],
    failure: (c, b) => [rt(b.p![0], 'contact', -3, 14), head(`${N(c, b.p![0])} comes up short of his own bet`)],
  },
  {
    id: 'stretch', title: 'Seven of Ten', days: 14,
    target: () => 7,
    goal: () => 'Win 7 of your next 10 games',
    base: (c) => [rec(c).W, rec(c).L],
    progress: (c, m) => { const r = rec(c), w = r.W - m.base[0], l = r.L - m.base[1]; return w + l >= 10 || l > 3 ? (w >= 7 ? 7 : -1) : w; },
    success: () => [{ kind: 'team', rating: 'clutchPressure', delta: 2, days: 30 }, head('The veterans were right: seven of ten', true)],
    failure: () => [note('The stretch slipped away')],
  },
  {
    id: 'workhorse', title: 'Give Me the Ball', days: 21,
    target: () => 3,
    goal: (c, b) => `${N(c, b.p![0])}: seven innings in each of his next three starts`,
    base: (c, b) => [pitOf(c, b.p![0])?.GS ?? 0, c.g.season.results.length],
    progress: (c, m) => {
      const id = m.bind.p![0];
      let ok = 0;
      for (const r of c.g.season.results.slice(m.base[1])) {
        const l = r.pitching.get(id);
        if (!l?.GS) continue;
        if (l.outs >= 21) ok++; else return -1; // one short start ends it
      }
      return ok;
    },
    success: (c, b) => [rt(b.p![0], 'stamina', 2), head(`${N(c, b.p![0])}: three starts, seven innings each, as promised`, true)],
    failure: (c, b) => [note(`${last(c, b.p![0])} came out early`)],
  },
];
