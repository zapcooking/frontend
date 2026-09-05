import { it, expect, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createServiceBook } from './serviceBook';
import { historyKey, type HistoryTransport } from './history';
import { startService, nextCustomer, serve, type Dish } from './service';
const dish: Dish = {
  ingredients: ['bread', 'tomato', 'oil'],
  cook: 'assemble',
  time: 2,
  style: 'toast',
  garnish: 'lemon',
  finish: 'last'
};
function completed() {
  let s = startService();
  for (let i = 0; i < 3; i++) s = nextCustomer(serve(s, dish));
  return s;
}
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v)
  });
  return values;
}
afterEach(() => vi.unstubAllGlobals());
it('keeps guest services local and reloads them without publishing', () => {
  storage();
  const publish = vi.fn();
  const b = createServiceBook({ owner: () => '', load: async () => [], publish });
  b.identity('');
  b.complete(completed());
  expect(get(b).entries).toHaveLength(1);
  b.identity('');
  expect(get(b).entries).toHaveLength(1);
  expect(publish).not.toHaveBeenCalled();
  b.destroy();
});
it('isolates identities and ignores a late publish acknowledgement after switching accounts', async () => {
  const values = storage();
  let owner = 'alice';
  let finish!: () => void;
  const transport: HistoryTransport = {
    owner: () => owner,
    load: async () => [],
    publish: () => new Promise<void>((r) => (finish = r))
  };
  const b = createServiceBook(transport);
  b.identity(owner);
  b.complete(completed());
  expect(get(b).saving).toBe(true);
  owner = 'bob';
  b.identity(owner);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(get(b).owner).toBe('bob');
  expect(get(b).entries).toHaveLength(0);
  expect(JSON.parse(values.get(historyKey('alice'))!)).toHaveLength(1);
  b.destroy();
});
it('keeps failed sync pending and acknowledges a successful manual retry', async () => {
  storage();
  let online = false;
  const b = createServiceBook({
    owner: () => 'alice',
    load: async () => [],
    publish: async () => {
      if (!online) throw new Error('offline');
    }
  });
  b.identity('alice');
  b.complete(completed());
  await Promise.resolve();
  await Promise.resolve();
  expect(get(b).entries[0].synced).toBe(false);
  online = true;
  await b.sync(false);
  expect(get(b).entries[0].synced).toBe(true);
  b.destroy();
});
it('reports blocked storage honestly while preserving an in-memory guest result', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    }
  });
  const b = createServiceBook({ owner: () => '', load: async () => [], publish: async () => {} });
  b.identity('');
  b.complete(completed());
  expect(get(b).localSaved).toBe(false);
  expect(get(b).entries).toHaveLength(1);
  b.destroy();
});

it('queues a service completed while an earlier run is awaiting acknowledgement', async () => {
  storage();
  let acknowledge!: () => void;
  const publish = vi
    .fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => (acknowledge = resolve)))
    .mockResolvedValue(undefined);
  const b = createServiceBook({ owner: () => 'alice', load: async () => [], publish });
  b.identity('alice');
  b.complete(completed());
  b.complete(completed());
  expect(publish).toHaveBeenCalledTimes(1);
  expect(get(b).entries).toHaveLength(2);
  acknowledge();
  await vi.waitFor(() => expect(get(b).saving).toBe(false));
  expect(publish).toHaveBeenCalledTimes(2);
  expect(get(b).entries.every((entry) => entry.synced)).toBe(true);
  b.destroy();
});
