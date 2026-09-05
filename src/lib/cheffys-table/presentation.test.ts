import { it, expect } from 'vitest';
import { kitchenReducer as step, kitchenState, serviceCard } from './presentation';
import { evaluate } from './service';
const begin = () =>
  step(step(kitchenState(), { type: 'start', mode: 'daily', date: '2026-09-05' }), {
    type: 'begin'
  });
function plate() {
  let s = begin();
  for (const id of ['bread', 'tomato', 'oil']) s = step(s, { type: 'toggle', id });
  s = step(s, {
    type: 'dish',
    change: { cook: 'assemble', time: 2, style: 'toast', garnish: 'lemon' }
  });
  return step(s, { type: 'station', phase: 'plate' });
}
it('guards stations and pauses decisions while a sheet is open', () => {
  let s = begin();
  expect(step(s, { type: 'station', phase: 'cook' })).toBe(s);
  s = step(s, { type: 'overlay', overlay: 'settings' });
  expect(step(s, { type: 'toggle', id: 'tomato' })).toBe(s);
  expect(step(s, { type: 'begin' })).toBe(s);
});
it('limits the board, toggles selected foods, and ignores unknown ingredients', () => {
  let s = begin();
  for (const id of ['bread', 'tomato', 'oil', 'tofu', 'rice', 'basil'])
    s = step(s, { type: 'toggle', id });
  expect(step(s, { type: 'toggle', id: 'chili' })).toBe(s);
  expect(step(s, { type: 'toggle', id: 'bogus' })).toBe(s);
  s = step(s, { type: 'toggle', id: 'rice' });
  expect(s.dish.ingredients).toHaveLength(5);
});
it('freezes the submitted plate through serving and prevents duplicate scoring', () => {
  let s = plate();
  const expected = evaluate(s.dish, s.service.roster[0]);
  s = step(s, { type: 'send' });
  expect(s.phase).toBe('serving');
  expect(step(s, { type: 'toggle', id: 'chili' })).toBe(s);
  expect(step(s, { type: 'dish', change: { time: 20 } })).toBe(s);
  expect(step(s, { type: 'overlay', overlay: 'settings' })).toBe(s);
  s = step(s, { type: 'served' });
  expect(s.service.reviews[0]).toEqual(expected);
  expect(step(s, { type: 'served' })).toBe(s);
  expect(step(s, { type: 'next' }).phase).toBe('arrival');
});
it('restarting invalidates a stale serve completion without changing daily determinism', () => {
  const pending = step(plate(), { type: 'send' });
  const reset = step(pending, { type: 'start', mode: 'daily', date: '2026-09-05' });
  expect(step(reset, { type: 'served' })).toBe(reset);
  expect(reset.service.roster).toEqual(pending.service.roster);
  expect(reset.service.reviews).toHaveLength(0);
});
it('completes only after three reactions and produces a useful non-posting share object', () => {
  let s = plate();
  for (let i = 0; i < 3; i++) {
    if (i) {
      s = step(s, { type: 'begin' });
      for (const id of ['bread', 'tomato', 'oil']) s = step(s, { type: 'toggle', id });
      s = step(s, { type: 'station', phase: 'plate' });
    }
    s = step(step(step(s, { type: 'send' }), { type: 'served' }), { type: 'next' });
  }
  expect(s.phase).toBe('complete');
  expect(step(s, { type: 'next' })).toBe(s);
  const card = serviceCard(s.service, 'https://zap.cooking');
  expect(card.text).toContain('2026-09-05 UTC');
  expect(card.text).toContain('https://zap.cooking/cheffys-table');
  expect(card.score).toBe(s.service.reviews.reduce((n, r) => n + r.score, 0));
});
