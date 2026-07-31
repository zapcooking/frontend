import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

/**
 * `browser` is mocked true because every path in this store is a no-op on the
 * server — without it `refreshMembership` returns null before it ever fetches
 * and the tests would assert nothing.
 */
vi.mock('$app/environment', () => ({ browser: true }));

import {
  refreshMembership,
  queueMembershipLookup,
  getMembership,
  membershipStatusMap,
  __resetMembershipStatusStoreForTests
} from './membershipStatus';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function statusPayload(pubkey: string, active: boolean, tier = 'cook_plus') {
  return { [pubkey]: { active, tier } };
}

/** Reads the pubkeys a recorded fetch call asked for. */
function requestedPubkeys(call: unknown[]): string[] {
  const url = String(call[0]);
  const raw = decodeURIComponent(url.split('pubkeys=')[1] ?? '');
  return raw ? raw.split(',') : [];
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetMembershipStatusStoreForTests();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function respondWith(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('refreshMembership', () => {
  it('bypasses a cached inactive result and returns the fresh one', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, false, 'member')));
    queueMembershipLookup(PK_A);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(membershipStatusMap)[PK_A]).toEqual({
      active: false,
      tier: 'member',
      expiresAt: undefined
    });

    // A second queued lookup must NOT refetch — this is the defect's mechanism.
    queueMembershipLookup(PK_A);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'cook_plus')));
    const result = await refreshMembership(PK_A);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ active: true, tier: 'cook_plus', expiresAt: undefined });
  });

  it('publishes the fresh status to membershipStatusMap for every consumer', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, false, 'member')));
    await getMembership([PK_A]);
    expect(get(membershipStatusMap)[PK_A].active).toBe(false);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'pro_kitchen')));
    await refreshMembership(PK_A);

    expect(get(membershipStatusMap)[PK_A]).toEqual({
      active: true,
      tier: 'pro_kitchen',
      expiresAt: undefined
    });
  });

  it('requests with cache: no-store so an HTTP-cached answer cannot be reused', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true)));
    await refreshMembership(PK_A);

    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });

  it('leaves the batch path uninstrumented — queued lookups send no init', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, false)));
    queueMembershipLookup(PK_A);
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('normalizes the pubkey and accepts mixed case', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true)));
    const result = await refreshMembership(PK_A.toUpperCase());

    expect(requestedPubkeys(fetchMock.mock.calls[0])).toEqual([PK_A]);
    expect(result?.active).toBe(true);
  });

  it('returns null without fetching for a malformed pubkey', async () => {
    expect(await refreshMembership('not-a-pubkey')).toBeNull();
    expect(await refreshMembership(null)).toBeNull();
    expect(await refreshMembership(undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the previous value rather than throwing when the lookup fails', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true)));
    await refreshMembership(PK_A);

    fetchMock.mockReturnValueOnce(Promise.resolve({ ok: false, status: 503 }));
    const result = await refreshMembership(PK_A);

    expect(result).toEqual({ active: true, tier: 'cook_plus', expiresAt: undefined });
  });
});

describe('refreshMembership vs. the debounced batch', () => {
  it('is not overwritten by a batch that was already in flight', async () => {
    // The batch resolves only when we release it — this is the ordering that
    // produced the bug: stale answer lands last.
    let releaseBatch: (value: unknown) => void = () => {};
    const batchResponse = new Promise((resolve) => {
      releaseBatch = resolve;
    });
    fetchMock.mockReturnValueOnce(
      batchResponse.then(() => ({ ok: true, json: () => Promise.resolve(statusPayload(PK_A, false, 'member')) }))
    );

    queueMembershipLookup(PK_A);
    await vi.advanceTimersByTimeAsync(100);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'cook_plus')));
    await refreshMembership(PK_A);
    expect(get(membershipStatusMap)[PK_A].active).toBe(true);

    releaseBatch(null);
    await vi.advanceTimersByTimeAsync(10);

    expect(get(membershipStatusMap)[PK_A]).toEqual({
      active: true,
      tier: 'cook_plus',
      expiresAt: undefined
    });
  });

  // Enforced by the existing `!statusCache.has` check on the failure path, not
  // by the epoch guard — verified by mutation: removing the epoch check leaves
  // this green, removing the cache check does not.
  it('is not overwritten by an in-flight batch that fails', async () => {
    let failBatch: (reason: unknown) => void = () => {};
    const batchResponse = new Promise((_resolve, reject) => {
      failBatch = reject;
    });
    fetchMock.mockReturnValueOnce(batchResponse);

    queueMembershipLookup(PK_A);
    await vi.advanceTimersByTimeAsync(100);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true)));
    await refreshMembership(PK_A);

    failBatch(new Error('network down'));
    await vi.advanceTimersByTimeAsync(10);

    expect(get(membershipStatusMap)[PK_A].active).toBe(true);
  });

  it('does not suppress other pubkeys in the same superseded batch', async () => {
    let releaseBatch: (value: unknown) => void = () => {};
    const batchResponse = new Promise((resolve) => {
      releaseBatch = resolve;
    });
    fetchMock.mockReturnValueOnce(
      batchResponse.then(() => ({
        ok: true,
        json: () =>
          Promise.resolve({
            ...statusPayload(PK_A, false, 'member'),
            ...statusPayload(PK_B, true, 'founders')
          })
      }))
    );

    queueMembershipLookup(PK_A);
    queueMembershipLookup(PK_B);
    await vi.advanceTimersByTimeAsync(100);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'cook_plus')));
    await refreshMembership(PK_A);

    releaseBatch(null);
    await vi.advanceTimersByTimeAsync(10);

    expect(get(membershipStatusMap)[PK_A].active).toBe(true);
    expect(get(membershipStatusMap)[PK_B]).toEqual({
      active: true,
      tier: 'founders',
      expiresAt: undefined
    });
  });

  it('drops a queued-but-unflushed lookup for the same pubkey', async () => {
    queueMembershipLookup(PK_A);
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true)));
    await refreshMembership(PK_A);
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets the later of two concurrent refreshes win', async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    const firstResponse = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    fetchMock.mockReturnValueOnce(
      firstResponse.then(() => ({ ok: true, json: () => Promise.resolve(statusPayload(PK_A, false, 'member')) }))
    );
    const first = refreshMembership(PK_A);

    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'cook_plus')));
    await refreshMembership(PK_A);

    releaseFirst(null);
    await first;

    expect(get(membershipStatusMap)[PK_A].active).toBe(true);
  });
});

describe('existing batching behaviour is unchanged', () => {
  it('still coalesces queued lookups into one request per debounce window', async () => {
    fetchMock.mockReturnValueOnce(
      respondWith({ ...statusPayload(PK_A, false), ...statusPayload(PK_B, true) })
    );

    queueMembershipLookup(PK_A);
    queueMembershipLookup(PK_B);
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedPubkeys(fetchMock.mock.calls[0]).sort()).toEqual([PK_A, PK_B].sort());
  });

  it('still serves getMembership from the cache after a refresh', async () => {
    fetchMock.mockReturnValueOnce(respondWith(statusPayload(PK_A, true, 'founders')));
    await refreshMembership(PK_A);

    const result = await getMembership([PK_A]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result[PK_A]).toEqual({ active: true, tier: 'founders', expiresAt: undefined });
  });
});
