import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
});

const {
  savePendingKind0,
  pendingKind0For,
  clearPendingKind0,
  retryPendingKind0,
  retryDelay,
  KIND0_RETRY_DELAYS_MS
} = await import('./pendingKind0');

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const kind0 = (pubkey = ME) => ({
  id: 'e'.repeat(64),
  pubkey,
  created_at: 1,
  kind: 0,
  tags: [],
  content: '{"name":"Cook"}',
  sig: 'f'.repeat(128)
});

beforeEach(() => store.clear());

describe('pending profile storage', () => {
  it('keeps one signed kind 0, readable only for its own account', () => {
    savePendingKind0(kind0());
    expect(pendingKind0For(ME)?.content).toBe('{"name":"Cook"}');
    expect(pendingKind0For(OTHER)).toBeNull();
  });

  it("clearing for another account leaves this one's", () => {
    savePendingKind0(kind0());
    clearPendingKind0(OTHER);
    expect(pendingKind0For(ME)).not.toBeNull();
    clearPendingKind0(ME);
    expect(pendingKind0For(ME)).toBeNull();
  });
});

describe('retry schedule', () => {
  it('backs off 5 s, 15 s, 45 s, 2 min, then every 5 min', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([
      5_000, 15_000, 45_000, 120_000, 300_000, 300_000, 300_000
    ]);
    expect(KIND0_RETRY_DELAYS_MS[0]).toBe(5_000);
  });
});

describe('retryPendingKind0', () => {
  const sleeps: number[] = [];
  const deps = (results: number[], current = () => true) => ({
    publish: vi.fn(async () => {
      const r = results.shift();
      if (r === undefined) throw new Error('relay error');
      return r;
    }),
    sleep: async (ms: number) => void sleeps.push(ms),
    isCurrent: current
  });
  beforeEach(() => (sleeps.length = 0));

  it('republishes until a relay accepts it, then clears it', async () => {
    savePendingKind0(kind0());
    const d = deps([0, 0, 2]);
    expect(await retryPendingKind0(ME, d)).toBe('published');
    expect(d.publish).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([5_000, 15_000, 45_000]);
    expect(pendingKind0For(ME)).toBeNull();
  });

  it('a thrown publish counts as not accepted and keeps going', async () => {
    savePendingKind0(kind0());
    const d = deps([]); // first call throws
    d.publish.mockImplementationOnce(async () => {
      throw new Error('timeout');
    });
    d.publish.mockImplementationOnce(async () => 1);
    expect(await retryPendingKind0(ME, d)).toBe('published');
  });

  it('stops when the session moved on (signed out / another account)', async () => {
    savePendingKind0(kind0());
    const d = deps([0, 0], () => false);
    expect(await retryPendingKind0(ME, d)).toBe('stopped');
    expect(d.publish).not.toHaveBeenCalled();
    expect(pendingKind0For(ME)).not.toBeNull(); // resumes on the next sign-in
  });

  it('stops when a newer profile superseded it (pending cleared elsewhere)', async () => {
    savePendingKind0(kind0());
    const d = deps([0]);
    d.publish.mockImplementationOnce(async () => {
      clearPendingKind0(ME); // e.g. updateOwnKind0 landed meanwhile
      return 0;
    });
    expect(await retryPendingKind0(ME, d)).toBe('superseded');
  });
});
