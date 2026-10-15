import { describe, expect, it } from 'vitest';
import { answerCard, applyEffects, planMonth } from '../src/ui/cards';
import { decodeSave, encodeSave } from '../src/ui/savefile';
import { Game } from '../src/ui/state';

/** Sim n days in a mode, answering every card with its first choice (or rolling every third). */
function play(g: Game, days: number, mode: 'day' | 'week' | 'month' | 'end', answer = true) {
  g.simMode = mode;
  if (mode === 'month') planMonth(g, days);
  const landed: number[] = [];
  for (let i = 0; i < days && !g.over; i++) {
    g.simDay();
    for (const c of g.landed) {
      landed.push(c.uid);
      if (answer) answerCard(g, c.uid, c.uid % 3 === 0 ? 'roll' : 0);
    }
    g.landed = [];
  }
  return landed;
}

describe('decision cards', () => {
  it('week sims bring a card a week plus some from big games; month sims four to six; season sims none', () => {
    const g = new Game(4242, 9);
    const weeks = play(g, 70, 'week');
    expect(weeks.length).toBeGreaterThanOrEqual(8); // ten weeks: storyline cards, plus game cards
    const month = play(g, 30, 'month');
    expect(month.length).toBeGreaterThanOrEqual(3);
    expect(month.length).toBeLessThanOrEqual(6);
    expect(play(g, 30, 'end').length).toBe(0);
    expect(g.cards.log.length).toBeGreaterThan(5);
  });

  it('unanswered cards expire, temporary effects come off, and everything survives a save', async () => {
    const g = new Game(777, 4);
    play(g, 60, 'week', false);
    expect(g.cards.log.some((l) => l.how === 'expired')).toBe(true);
    // answer what's left, then check the ledger reverses cleanly
    for (const c of [...g.cards.desk]) answerCard(g, c.uid, 0);
    const temps = g.cards.temps.map((t) => ({ ...t }));
    const { bytes } = await encodeSave(g);
    const back = (await decodeSave(bytes)).game;
    expect(back.cards.temps).toEqual(temps);
    expect(back.cards.log.length).toBe(g.cards.log.length);
    for (const t of temps) expect(back.players.get(t.pid)?.ratings[t.rating]).toBe(g.players.get(t.pid)?.ratings[t.rating]);
    // a temporary effect comes off on time, and only it
    const pid = back.plan.lineup[0].player.id, was = back.players.get(pid)!.ratings.contact;
    applyEffects(back, [{ kind: 'rating', pid, rating: 'contact', delta: 5, days: 3 }], 'test');
    expect(back.players.get(pid)!.ratings.contact).toBe(Math.min(85, was + 5));
    back.simMode = 'end';
    for (let i = 0; i < 4; i++) back.simDay();
    expect(back.players.get(pid)!.ratings.contact).toBe(was);
  });
});
