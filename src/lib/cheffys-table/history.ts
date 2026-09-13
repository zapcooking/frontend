import { type Service } from './service';
import {
  emptyBook,
  nextCustomer,
  saveService,
  serve,
  customers as savedCustomers
} from './legacy/serviceV1';
import {
  parseRun as parseV1,
  restoreService as restoreV1,
  historyKey as legacyHistoryKey,
  type SavedService as SavedServiceV1
} from './legacy/historyV1';
export type { SavedServiceV1 };

export const HISTORY_LIMIT = 100;
export type SavedServiceV2 = Omit<SavedServiceV1, 'version'> & {
  version: 2;
  roster: [string, string, string];
};
export type SavedService = SavedServiceV1 | SavedServiceV2;
export type HistoryEntry = { run: SavedService; synced: boolean };
// Old clients keep their v1 cache. Only upgraded clients read/write this cache.
export const historyKey = (owner: string) => `cheffys-table:history:v2:${owner || 'guest'}`;

/** v1 is frozen. Unknown versions are deliberately skipped, never scored or rewritten. */
export function parseRun(value: unknown): SavedService | null {
  if (!value || typeof value !== 'object') return null;
  const version = (value as { version?: unknown }).version;
  if (version === 1) return parseV1(value);
  if (version !== 2) return null;
  const r = value as SavedServiceV2;
  // Reuse frozen input validation and cooking rules; only the roster is new in v2.
  const base = parseV1({ ...r, version: 1 });
  if (
    !base ||
    !Array.isArray(r.roster) ||
    r.roster.length !== 3 ||
    new Set(r.roster).size !== 3 ||
    [...r.roster].some((id) => typeof id !== 'string' || !savedCustomers.some((c) => c.id === id))
  )
    return null;
  return { ...base, version: 2, roster: [...r.roster] };
}
export function restoreService(value: SavedService): Service {
  const run = parseRun(value);
  if (!run) throw new Error('Invalid saved service.');
  if (run.version === 1) return restoreV1(run);
  // Do not call today's startService: neither randomness nor a future Daily algorithm
  // may reinterpret a saved service. v2 shares v1's frozen scoring/customer definitions.
  const service: Service = {
    mode: run.mode,
    date: run.date,
    roster: run.roster.map((id) => savedCustomers.find((c) => c.id === id)!),
    reviews: [],
    status: 'building'
  };
  return run.dishes.reduce((s, dish) => nextCustomer(serve(s, dish)), service);
}
export function makeRun(
  service: Service,
  id: string = crypto.randomUUID(),
  completedAt = new Date().toISOString()
): SavedServiceV2 {
  if (service.status !== 'complete' || service.reviews.length !== 3)
    throw new Error('Finish all three guests first.');
  if (service.reviews.some((review, i) => review.customer.id !== service.roster[i]?.id))
    throw new Error('Reviews do not match the service roster.');
  const run = parseRun({
    version: 2,
    id,
    completedAt,
    mode: service.mode,
    date: service.date,
    roster: service.roster.map((customer) => customer.id),
    dishes: service.reviews.map((r) => r.dish)
  });
  if (!run || run.version !== 2) throw new Error('Invalid completed service.');
  return run;
}
export function mergeHistory(...lists: HistoryEntry[][]): HistoryEntry[] {
  const unique = new Map<string, HistoryEntry>();
  for (const entry of lists.flat()) {
    const run = parseRun(entry?.run);
    if (!run) continue;
    const previous = unique.get(run.id);
    // A run ID is immutable; an acknowledged copy marks the original as synced.
    unique.set(run.id, {
      run: previous?.run ?? run,
      synced: previous?.synced === true || entry.synced === true
    });
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        b.run.completedAt.localeCompare(a.run.completedAt) || a.run.id.localeCompare(b.run.id)
    )
    .slice(0, HISTORY_LIMIT);
}
function readCache(key: string): HistoryEntry[] {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(data) ? data.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}
export function readHistory(owner: string): HistoryEntry[] {
  // Import legacy runs without changing their source cache. Re-read it on every identity
  // load so services completed in an older tab are still found after an upgrade.
  return mergeHistory(readCache(historyKey(owner)), readCache(legacyHistoryKey(owner)));
}
export function writeHistory(owner: string, entries: HistoryEntry[]): boolean {
  try {
    localStorage.setItem(historyKey(owner), JSON.stringify(mergeHistory(entries)));
    return true;
  } catch {
    return false;
  }
}
export function historyBook(entries: HistoryEntry[]) {
  return entries.reduce((book, e) => saveService(book, restoreService(e.run)), emptyBook());
}

export interface HistoryTransport {
  owner: () => string;
  load: (owner: string) => Promise<SavedService[]>;
  publish: (owner: string, run: SavedService) => Promise<void>;
}
/** Partial success is persisted after each acknowledgement; denied/offline work remains pending. */
export async function syncHistory(
  owner: string,
  entries: HistoryEntry[],
  transport: HistoryTransport,
  update: (entries: HistoryEntry[]) => void,
  restore = true
): Promise<HistoryEntry[]> {
  const assertOwner = () => {
    if (!owner || transport.owner() !== owner) throw new Error('Account changed.');
  };
  assertOwner();
  let merged = mergeHistory(entries);
  if (restore) {
    const remote = await transport.load(owner);
    assertOwner();
    merged = mergeHistory(
      merged,
      remote.map((run) => ({ run, synced: true }))
    );
    update(merged);
  }
  for (const entry of merged.filter((e) => !e.synced)) {
    assertOwner();
    await transport.publish(owner, entry.run);
    assertOwner();
    merged = merged.map((e) => (e.run.id === entry.run.id ? { ...e, synced: true } : e));
    update(merged);
  }
  return merged;
}
