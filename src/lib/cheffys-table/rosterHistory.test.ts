import { afterEach, expect, it, vi } from 'vitest';
import { customers, startService, serve, nextCustomer, type Dish, type Service } from './service';
import {
  parseRun,
  makeRun,
  restoreService,
  mergeHistory,
  historyBook,
  readHistory,
  writeHistory,
  historyKey,
  syncHistory,
  type SavedService,
  type HistoryEntry
} from './history';
import * as oldClient from './legacy/historyV1';
import { startService as startV1 } from './legacy/serviceV1';
import fixtures from './fixtures/legacy-services.json';

const dishes = fixtures.cases[0].run.dishes as Dish[];
const orderedRosters = customers.flatMap((a) =>
  customers
    .filter((b) => b.id !== a.id)
    .flatMap((b) => customers.filter((c) => c.id !== a.id && c.id !== b.id).map((c) => [a, b, c]))
);
const finish = (service: Service) =>
  dishes.reduce((s, dish) => nextCustomer(serve(s, dish)), service);
const v2 = () =>
  makeRun(finish(startService('daily', '2026-09-06')), 'new-run-0001', '2026-09-06T12:00:00.000Z');
const legacy = () => oldClient.parseRun(fixtures.cases[0].run)!;
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('can draw all 60 Open Kitchen orders without duplicates or mutating the customer pool', () => {
  const original = structuredClone(customers),
    seen = new Set<string>();
  const random = vi.spyOn(Math, 'random');
  for (let a = 0; a < 5; a++)
    for (let b = 0; b < 4; b++)
      for (let c = 0; c < 3; c++) {
        random
          .mockReturnValueOnce((a + 0.5) / 5)
          .mockReturnValueOnce((b + 0.5) / 4)
          .mockReturnValueOnce((c + 0.5) / 3);
        const s = startService('service', '2026-09-06');
        expect(new Set(s.roster.map((c) => c.id)).size).toBe(3);
        seen.add(s.roster.map((c) => c.id).join(','));
      }
  expect(seen.size).toBe(60);
  expect(customers).toEqual(original);
});

for (const roster of orderedRosters) {
  it(`restores every dish, guest and score for ${roster.map((c) => c.id).join(' → ')} in both v2 modes`, () => {
    for (const mode of ['service', 'daily'] as const) {
      const played = finish({ mode, date: '2026-09-06', roster, reviews: [], status: 'building' });
      const run = makeRun(played);
      expect(run.version).toBe(2);
      expect(run.roster).toEqual(roster.map((c) => c.id));
      const roundTrip = parseRun(JSON.parse(JSON.stringify(run)))!;
      expect(restoreService(roundTrip)).toEqual(played);
      expect(historyBook([{ run: roundTrip, synced: false }]).best).toBe(
        played.reviews.reduce((n, r) => n + r.score, 0)
      );
    }
  });
}

it('captures Daily IDs while leaving the existing UTC-date roster algorithm unchanged', () => {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('No random draws in Daily');
  });
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const service = startService('daily', date);
    expect(service).toEqual(startV1('daily', date));
    const run = makeRun(finish(service));
    expect(run.roster).toEqual(service.roster.map((c) => c.id));
    expect(restoreService(run).roster).toEqual(service.roster);
  }
  expect(random).not.toHaveBeenCalled();
});

for (const fixture of fixtures.cases) {
  it(`keeps the complete legacy ${fixture.run.mode} fixture and record book unchanged`, () => {
    const parsed = parseRun(fixture.run)!;
    expect(parsed).toEqual(fixture.run);
    expect(restoreService(parsed)).toEqual(fixture.service);
    expect(historyBook([{ run: parsed, synced: true }])).toEqual(fixture.book);
    // A field added to a v1 payload cannot smuggle in the new roster rules.
    expect(parseRun({ ...fixture.run, roster: ['robin', 'jules', 'alex'] })).toEqual(fixture.run);
  });
}

it('does not consult live randomness or mutable current guest definitions when restoring either version', () => {
  const modern = v2(),
    before = restoreService(modern),
    old = legacy();
  const first = customers[0],
    original = { ...first };
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Restoration drew randomness');
  });
  try {
    first.patience = 1;
    first.name = 'Changed in a later game';
    customers.reverse();
    expect(restoreService(modern)).toEqual(before);
    expect(restoreService(old)).toEqual(fixtures.cases[0].service);
  } finally {
    customers.reverse();
    Object.assign(first, original);
  }
});

it('rejects missing, repeated, unknown or malformed guest IDs before scoring/restoration', () => {
  const valid = v2();
  for (const roster of [
    undefined,
    null,
    'maya,theo,jules',
    [],
    ['maya'],
    ['maya', 'theo'],
    ['maya', 'theo', 'jules', 'alex'],
    ['maya', 'maya', 'jules'],
    ['maya', 'theo', 'missing'],
    ['Maya', 'theo', 'jules'],
    ['maya', 2, 'jules'],
    ['maya', {}, 'jules'],
    Object.assign(new Array(3), { 0: 'maya', 2: 'jules' })
  ]) {
    const bad = { ...valid, roster };
    expect(parseRun(bad)).toBeNull();
    expect(mergeHistory([{ run: bad as SavedService, synced: true }])).toEqual([]);
    expect(() => restoreService(bad as SavedService)).toThrow('Invalid saved service');
  }
  expect(
    parseRun({ ...valid, dishes: [{ ...dishes[0], time: 999 }, ...dishes.slice(1)] })
  ).toBeNull();
  expect(parseRun({ ...valid, version: 3 })).toBeNull();
});

it('rejects a completed service whose reviews do not correspond to its ordered roster', () => {
  const s = finish(startService('daily', '2026-09-06'));
  expect(() => makeRun({ ...s, roster: [...s.roster].reverse() })).toThrow('Reviews do not match');
});

it('takes a detached roster snapshot and never trusts a supplied remote score', () => {
  const raw = { ...v2(), score: 999999 };
  const parsed = parseRun(raw)!;
  raw.roster.reverse();
  expect(parsed).not.toHaveProperty('score');
  expect(parsed.version === 2 && parsed.roster).not.toEqual(raw.roster);
  const played = finish(startService('daily', '2026-09-06'));
  const saved = makeRun(played),
    ids = [...saved.roster];
  played.roster.reverse();
  expect(saved.roster).toEqual(ids);
});

it('pins choice (a): the frozen old client drops v2 from its merged/scored history until upgrade', async () => {
  storage();
  const old = legacy(),
    modern = v2();
  expect(oldClient.parseRun(modern)).toBeNull();
  const onlyOld = [{ run: old, synced: true }];
  const mixed = [modern, old];
  const publish = vi.fn();
  const result = await oldClient.syncHistory(
    'alice',
    [],
    {
      owner: () => 'alice',
      load: async () => mixed as oldClient.SavedService[],
      publish
    },
    (entries) => oldClient.writeHistory('alice', entries)
  );
  expect(result).toEqual(onlyOld);
  expect(oldClient.readHistory('alice')).toEqual(onlyOld);
  expect(oldClient.historyBook(result)).toEqual(fixtures.cases[0].book);
  expect(
    oldClient.historyBook(
      oldClient.mergeHistory([{ run: modern as unknown as oldClient.SavedService, synced: true }])
    )
  ).toEqual({ version: 2, best: 0, services: 0, lessons: [], daily: {} });
  expect(publish).not.toHaveBeenCalled();
  // Its omission does not delete the immutable per-run record from the relay.
  expect(mixed).toEqual([modern, old]);
  const upgraded = await syncHistory(
    'alice',
    result,
    { owner: () => 'alice', load: async () => mixed, publish },
    () => {}
  );
  expect(historyBook(upgraded).services).toBe(2);
  expect(restoreService(upgraded.find((e) => e.run.version === 2)!.run)).toEqual(
    restoreService(modern)
  );
});

it('isolates v2 local storage from old-client rewrites and imports later v1 runs on upgrade', () => {
  const values = storage(),
    old = legacy(),
    modern = v2();
  oldClient.writeHistory('alice', [{ run: old, synced: false }]);
  const originalCache = values.get(oldClient.historyKey('alice'));
  const upgraded = mergeHistory([{ run: modern, synced: false }], readHistory('alice'));
  expect(writeHistory('alice', upgraded)).toBe(true);
  expect(values.get(oldClient.historyKey('alice'))).toBe(originalCache);
  expect(historyKey('alice')).not.toBe(oldClient.historyKey('alice'));
  const v2Cache = values.get(historyKey('alice'));
  const later = { ...old, id: 'legacy-later-0002' };
  oldClient.writeHistory('alice', [{ run: later, synced: false }]);
  expect(values.get(historyKey('alice'))).toBe(v2Cache);
  expect(readHistory('alice')).toHaveLength(3);
  expect(readHistory('bob')).toEqual([]);
  expect(readHistory('')).toEqual([]);
  expect(restoreService(readHistory('alice').find((e) => e.run.version === 2)!.run)).toEqual(
    restoreService(modern)
  );
});

it('reads either cache independently and deduplicates acknowledged legacy imports', () => {
  const values = storage(),
    old = legacy(),
    modern = v2();
  oldClient.writeHistory('alice', [{ run: old, synced: false }]);
  values.set(historyKey('alice'), 'broken JSON');
  expect(readHistory('alice')).toEqual([{ run: old, synced: false }]);
  writeHistory('alice', [
    { run: modern, synced: false },
    { run: old, synced: true }
  ]);
  expect(readHistory('alice')).toHaveLength(2);
  expect(readHistory('alice').find((e) => e.run.id === old.id)!.synced).toBe(true);
  values.set(oldClient.historyKey('alice'), 'broken JSON');
  expect(readHistory('alice')).toHaveLength(2);
});

it('keeps mixed-version immutable run IDs, partial acknowledgments and retry deduplication', async () => {
  const old = legacy(),
    modern = v2();
  let entries: HistoryEntry[] = [
    { run: old, synced: false },
    { run: modern, synced: false }
  ];
  const published: string[] = [];
  const transport = {
    owner: () => 'alice',
    load: async () => [],
    publish: async (_owner: string, run: SavedService) => {
      published.push(run.id);
      if (published.length === 2) throw new Error('offline');
    }
  };
  await expect(
    syncHistory(
      'alice',
      entries,
      transport,
      (result) => {
        entries = result;
      },
      false
    )
  ).rejects.toThrow('offline');
  expect(entries.filter((e) => e.synced)).toHaveLength(1);
  const pending = entries.find((e) => !e.synced)!;
  const retry = await syncHistory(
    'alice',
    entries,
    {
      ...transport,
      publish: async (_owner, run) => {
        expect(run).toEqual(pending.run);
      }
    },
    () => {},
    false
  );
  expect(retry).toHaveLength(2);
  expect(retry.every((e) => e.synced)).toBe(true);
  const altered = { ...modern, roster: [...modern.roster].reverse() } as SavedService;
  expect(mergeHistory([{ run: modern, synced: false }], [{ run: altered, synced: true }])).toEqual([
    { run: modern, synced: true }
  ]);
});
