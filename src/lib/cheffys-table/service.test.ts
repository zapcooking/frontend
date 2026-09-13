import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import {
  pantry,
  customers,
  emptyDish,
  evaluate,
  validateDish,
  prepTime,
  startService,
  serve,
  nextCustomer,
  saveService,
  emptyBook,
  readBook,
  type Dish
} from './service';
const toast: Dish = {
  ingredients: ['bread', 'tomato', 'oil'],
  cook: 'assemble',
  time: 2,
  style: 'toast',
  garnish: 'lemon',
  finish: 'last'
};
test('twenty distinct ingredients form a complete illustrated pantry', () => {
  assert.equal(pantry.length, 20);
  assert.equal(new Set(pantry.map((f) => f.id)).size, 20);
  assert.ok(pantry.every((f) => f.note && f.likes.length));
});
test('scores are deterministic and a simple thoughtful dish can delight a customer', () => {
  const before = JSON.stringify(toast);
  const r = evaluate(toast, customers[0]);
  assert.deepEqual(evaluate(toast, customers[0]), r);
  assert.equal(JSON.stringify(toast), before);
  assert.equal(r.stars, 5);
  assert.ok(r.quality >= 90);
  assert.ok(r.notes.some((n) => n.kind === 'good' && n.title === 'Good service'));
  assert.equal(
    r.components.reduce((n, c) => n + c.score, 0),
    r.quality
  );
});
test('complexity earns points for good execution, not extra ingredients alone', () => {
  const simple = evaluate(toast, customers[0]);
  const complex = evaluate(
    { ...toast, ingredients: ['bread', 'tomato', 'oil', 'chicken'] },
    customers[0]
  );
  assert.ok(complex.score > simple.score);
  const mess = evaluate(
    {
      ...toast,
      ingredients: ['bread', 'tomato', 'oil', 'garlic', 'salmon', 'chili'],
      cook: 'roast',
      time: 20,
      finish: 'early'
    },
    customers[0]
  );
  assert.ok(mess.quality < 75);
  assert.equal(mess.score, Math.round(mess.quality * 8));
  assert.ok(mess.score < simple.score);
});
test('guest preferences, dietary requests and time budget matter', () => {
  const mild = evaluate(toast, customers[0]);
  const spicy = evaluate({ ...toast, garnish: 'chili' }, customers[0]);
  assert.ok(spicy.quality < mild.quality);
  assert.ok(spicy.notes.some((n) => n.title === 'Keep it mild'));
  const plant: Dish = {
    ingredients: ['rice', 'tofu', 'broccoli', 'oil'],
    cook: 'steam',
    time: 8,
    style: 'bowl',
    garnish: 'lemon',
    finish: 'last'
  };
  const wrong = evaluate(
    { ...plant, ingredients: ['rice', 'salmon', 'broccoli', 'oil'] },
    customers[1]
  );
  assert.ok(wrong.quality < 75);
  assert.ok(wrong.notes.some((n) => n.title === 'Read the request'));
  assert.ok(evaluate(plant, customers[1]).quality > wrong.quality);
});
test('method, cooking window and finishing timing explain specific consequences', () => {
  const brief = evaluate({ ...toast, cook: 'roast', time: 2 }, customers[0]);
  assert.ok(brief.notes.some((n) => n.title === 'Give the method time'));
  const early = evaluate({ ...toast, finish: 'early', garnish: 'basil' }, customers[0]);
  const late = evaluate({ ...toast, finish: 'last', garnish: 'basil' }, customers[0]);
  assert.ok(late.quality > early.quality);
  assert.ok(early.notes.some((n) => n.title === 'Keep the toast crisp'));
  assert.ok(early.notes.some((n) => n.title === 'Finish fresh'));
});
test('invalid input cannot produce a score', () => {
  for (const d of [
    { ...toast, ingredients: [] },
    { ...toast, ingredients: ['tomato', 'tomato', 'oil'] },
    { ...toast, time: NaN },
    { ...toast, time: 21 },
    { ...toast, ingredients: ['fake', 'rice', 'oil'] },
    { ...toast, cook: 'magic' }
  ] as Dish[]) {
    assert.ok(validateDish(d));
    assert.throws(() => evaluate(d, customers[0]));
  }
  assert.ok(validateDish(emptyDish()));
  assert.equal(prepTime(toast), 10);
});
test('three guest service enforces review between plates and ends exactly once', () => {
  let s = startService();
  assert.equal(nextCustomer(s), s);
  for (let i = 0; i < 3; i++) {
    const old = s;
    s = serve(s, toast);
    assert.equal(old.reviews.length, i);
    assert.equal(s.reviews.length, i + 1);
    assert.equal(serve(s, toast), s);
    s = nextCustomer(s);
  }
  assert.equal(s.status, 'complete');
  assert.equal(serve(s, toast), s);
  assert.equal(nextCustomer(s), s);
  const b = saveService(emptyBook(), s);
  assert.equal(b.services, 1);
  assert.equal(
    b.best,
    s.reviews.reduce((n, r) => n + r.score, 0)
  );
  assert.equal(saveService(b, startService()), b);
});
test('Daily Service uses a shared date roster and preserves a better previous score', () => {
  assert.deepEqual(startService('daily', '2026-09-05'), startService('daily', '2026-09-05'));
  assert.notDeepEqual(
    startService('daily', '2026-09-05').roster,
    startService('daily', '2026-09-06').roster
  );
  let s = startService('daily', '2026-09-05');
  for (let i = 0; i < 3; i++) s = nextCustomer(serve(s, toast));
  const b = saveService({ ...emptyBook(), daily: { '2026-09-05': 9999 } }, s);
  assert.equal(b.daily['2026-09-05'], 9999);
});

test('save history is bounded and blocked storage falls back to an empty record book', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      }
    });
    assert.deepEqual(readBook(), emptyBook());
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
  let s = startService('daily', '2026-09-05');
  for (let i = 0; i < 3; i++) s = nextCustomer(serve(s, toast));
  const daily = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [new Date(2026, 0, i + 1).toISOString().slice(0, 10), i])
  );
  assert.equal(Object.keys(saveService({ ...emptyBook(), daily }, s).daily).length, 60);
});
