import { it, expect } from 'vitest';
import { startService, serve, nextCustomer, type Dish } from './service';
import {
  makeRun,
  parseRun,
  mergeHistory,
  historyBook,
  historyKey,
  syncHistory,
  type HistoryTransport,
  type HistoryEntry
} from './history';
const dish: Dish = {
  ingredients: ['bread', 'tomato', 'oil'],
  cook: 'assemble',
  time: 2,
  style: 'toast',
  garnish: 'lemon',
  finish: 'last'
};
function completed() {
  let s = startService('daily', '2026-09-05');
  for (let i = 0; i < 3; i++) s = nextCustomer(serve(s, dish));
  return s;
}
const saved = () => makeRun(completed(), 'run-test-0001', '2026-09-05T12:00:00.000Z');
it('round trips dishes and recomputes scores rather than trusting payload scores', () => {
  const run = parseRun({ ...saved(), score: 99999999 });
  expect(run).not.toBeNull();
  expect(historyBook([{ run: run!, synced: true }]).best).toBe(
    completed().reviews.reduce((n, r) => n + r.score, 0)
  );
  expect(makeRun(completed()).id).toBeTruthy();
});
it('rejects malformed remote history and unfinished services', () => {
  for (const run of [
    null,
    {},
    { ...saved(), dishes: [dish] },
    { ...saved(), version: 99 },
    { ...saved(), dishes: [{ ...dish, ingredients: null }, dish, dish] },
    { ...saved(), dishes: [{ ...dish, time: NaN }, dish, dish] }
  ])
    expect(parseRun(run)).toBeNull();
  expect(() => makeRun(startService('service'))).toThrow();
});
it('isolates guest and different identity storage keys', () => {
  expect(new Set(['', 'a'.repeat(64), 'b'.repeat(64)].map(historyKey)).size).toBe(3);
});
it('deduplicates retries, bounds history, and preserves acknowledgement', () => {
  const run = saved();
  expect(mergeHistory([{ run, synced: true }], [{ run, synced: false }])).toEqual([
    { run, synced: true }
  ]);
  const many = Array.from({ length: 120 }, (_, i) => ({
    run: { ...run, id: `run-number-${i.toString().padStart(4, '0')}` },
    synced: true
  }));
  expect(mergeHistory(many).length).toBe(100);
  expect(
    historyBook(mergeHistory([{ run, synced: false }], [{ run, synced: true }])).services
  ).toBe(1);
});
it('merges cross-device services and only publishes pending local runs', async () => {
  const run = saved(),
    remote = { ...run, id: 'remote-run-0002' };
  const published: string[] = [];
  const transport: HistoryTransport = {
    owner: () => 'alice',
    load: async () => [remote],
    publish: async (_, r) => {
      published.push(r.id);
    }
  };
  let entries: HistoryEntry[] = [];
  const result = await syncHistory('alice', [{ run, synced: false }], transport, (x) => {
    entries = x;
  });
  expect(published).toEqual([run.id]);
  expect(result.length).toBe(2);
  expect(entries.every((e) => e.synced)).toBe(true);
});
it('keeps a failed save pending and retries without duplicating the service', async () => {
  const initial = [{ run: saved(), synced: false }];
  let entries = initial;
  const transport: HistoryTransport = {
    owner: () => 'alice',
    load: async () => [],
    publish: async () => {
      throw new Error('denied');
    }
  };
  await expect(
    syncHistory('alice', initial, transport, (x) => {
      entries = x;
    })
  ).rejects.toThrow('denied');
  expect(entries[0].synced).toBe(false);
  transport.publish = async () => {};
  const result = await syncHistory('alice', entries, transport, () => {});
  expect(result).toHaveLength(1);
  expect(result[0].synced).toBe(true);
});
it('does not apply hydration or publish pending work after account switching', async () => {
  let owner = 'alice',
    updated = false,
    published = false;
  const transport: HistoryTransport = {
    owner: () => owner,
    load: async () => {
      owner = 'bob';
      return [saved()];
    },
    publish: async () => {
      published = true;
    }
  };
  await expect(
    syncHistory('alice', [{ run: saved(), synced: false }], transport, () => {
      updated = true;
    })
  ).rejects.toThrow('Account changed');
  expect(updated).toBe(false);
  expect(published).toBe(false);
});
it('persists acknowledged runs before a later publish fails', async () => {
  const run = saved();
  let calls = 0;
  let result: HistoryEntry[] = [];
  const transport: HistoryTransport = {
    owner: () => 'alice',
    load: async () => [],
    publish: async () => {
      if (++calls === 2) throw new Error('offline');
    }
  };
  await expect(
    syncHistory(
      'alice',
      [
        { run, synced: false },
        { run: { ...run, id: 'run-test-0002' }, synced: false }
      ],
      transport,
      (x) => {
        result = x;
      }
    )
  ).rejects.toThrow();
  expect(result.filter((e) => e.synced)).toHaveLength(1);
});
