import {
  emptyBook,
  nextCustomer,
  saveService,
  serve,
  startService,
  validateDish,
  type Dish,
  type Service
} from './service';

export const HISTORY_LIMIT = 100;
export type SavedService = {
  version: 1;
  id: string;
  completedAt: string;
  mode: Service['mode'];
  date: string;
  dishes: Dish[];
};
export type HistoryEntry = { run: SavedService; synced: boolean };
export const historyKey = (owner: string) => `cheffys-table:history:v1:${owner || 'guest'}`;

/** Store choices, then recompute reviews with the versioned game rules. Never trust supplied scores. */
export function parseRun(value: unknown): SavedService | null {
  try {
    const r = value as SavedService;
    if (
      r?.version !== 1 ||
      typeof r.id !== 'string' ||
      !/^[a-zA-Z0-9-]{8,64}$/.test(r.id) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(r.completedAt) ||
      !Number.isFinite(Date.parse(r.completedAt)) ||
      !['service', 'daily'].includes(r.mode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
      !Number.isFinite(Date.parse(r.date)) ||
      !Array.isArray(r.dishes) ||
      r.dishes.length !== 3
    )
      return null;
    const dishes = r.dishes.map((d) => ({
      ingredients: [...d.ingredients],
      cook: d.cook,
      time: d.time,
      style: d.style,
      garnish: d.garnish,
      finish: d.finish
    }));
    if (dishes.some((d) => validateDish(d))) return null;
    return { version: 1, id: r.id, completedAt: r.completedAt, mode: r.mode, date: r.date, dishes };
  } catch {
    return null;
  }
}
export function restoreService(run: SavedService): Service {
  return run.dishes.reduce((s, d) => nextCustomer(serve(s, d)), startService(run.mode, run.date));
}
export function makeRun(
  service: Service,
  id: string = crypto.randomUUID(),
  completedAt = new Date().toISOString()
): SavedService {
  if (service.status !== 'complete' || service.reviews.length !== 3)
    throw new Error('Finish all three guests first.');
  const run = parseRun({
    version: 1,
    id,
    completedAt,
    mode: service.mode,
    date: service.date,
    dishes: service.reviews.map((r) => r.dish)
  });
  if (!run) throw new Error('Invalid completed service.');
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
export function readHistory(owner: string): HistoryEntry[] {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey(owner)) || '[]');
    return Array.isArray(data) ? mergeHistory(data.slice(0, HISTORY_LIMIT)) : [];
  } catch {
    return [];
  }
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
