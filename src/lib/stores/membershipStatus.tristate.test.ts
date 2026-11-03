/**
 * Client membership store — tri-state + TTL.
 *
 * Before this, a negative answer lived for the whole tab (no TTL), an
 * unresolvable pubkey was written as a definite non-member, and the only way
 * out was a full reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

import {
  queueMembershipLookup,
  getMembership,
  revalidateMembership,
  membershipStatusMap,
  TTL_MS,
  UNRESOLVED_HEADER,
  __resetMembershipStatusStoreForTests
} from './membershipStatus';

const PK = '1'.repeat(64);
const PK2 = '2'.repeat(64);

function respond(body: unknown, opts: { status?: number; unresolved?: string[] } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.unresolved?.length) headers[UNRESOLVED_HEADER] = opts.unresolved.join(',');
  return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetMembershipStatusStoreForTests();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = () => vi.advanceTimersByTimeAsync(100); // 75 ms debounce

describe('unresolved answers', () => {
  it('a pubkey the server could not resolve is unknown, never a non-member', async () => {
    fetchMock.mockResolvedValueOnce(respond({}, { unresolved: [PK] }));
    queueMembershipLookup(PK);
    await flush();
    const s = get(membershipStatusMap)[PK];
    expect(s).toMatchObject({ state: 'unknown', unresolved: true, active: false });
  });

  it('is retried after the unknown TTL without a reload', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({}, { unresolved: [PK] }))
      .mockResolvedValueOnce(respond({ [PK]: { active: true, state: 'active', tier: 'member' } }));
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    queueMembershipLookup(PK); // still fresh as unknown: no request
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TTL_MS.unknown);
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(get(membershipStatusMap)[PK]).toMatchObject({ state: 'active', active: true });
  });

  it('keeps a previously confirmed member when a later answer is unresolved', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ [PK]: { active: true, state: 'active', tier: 'member' } }))
      .mockResolvedValueOnce(respond({}, { unresolved: [PK] }));
    queueMembershipLookup(PK);
    await flush();
    await vi.advanceTimersByTimeAsync(TTL_MS.active);
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(get(membershipStatusMap)[PK]).toMatchObject({ state: 'active', active: true });
  });

  it('a whole-batch HTTP failure is unknown and retried, not sticky', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ error: 'membership lookup unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(respond({ [PK]: { active: false, state: 'inactive', tier: 'member' } }));
    queueMembershipLookup(PK);
    await flush();
    expect(get(membershipStatusMap)[PK]).toMatchObject({ state: 'unknown', unresolved: true });
    await vi.advanceTimersByTimeAsync(TTL_MS.unknown);
    queueMembershipLookup(PK);
    await flush();
    expect(get(membershipStatusMap)[PK]).toMatchObject({ state: 'inactive', active: false });
    expect(get(membershipStatusMap)[PK].unresolved).toBeUndefined();
  });

  it('a pubkey missing from a 200 payload is unknown too (defensive)', async () => {
    fetchMock.mockResolvedValueOnce(respond({}));
    const r = await getMembership([PK]);
    expect(r[PK]).toMatchObject({ state: 'unknown', unresolved: true });
  });
});

describe('TTLs', () => {
  it('re-asks a "not a member" after a minute (a payment or a hiccup may have passed)', async () => {
    fetchMock.mockResolvedValue(respond({ [PK]: { active: false, state: 'inactive', tier: 'member' } }));
    queueMembershipLookup(PK);
    await flush();
    await vi.advanceTimersByTimeAsync(TTL_MS.inactive - 1000);
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('trusts a confirmed member for ten minutes', async () => {
    fetchMock.mockResolvedValue(respond({ [PK]: { active: true, state: 'active', tier: 'member' } }));
    queueMembershipLookup(PK);
    await flush();
    await vi.advanceTimersByTimeAsync(TTL_MS.inactive * 5);
    queueMembershipLookup(PK);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('revalidateMembership re-queues only stale entries', async () => {
    fetchMock.mockResolvedValue(
      respond({
        [PK]: { active: true, state: 'active', tier: 'member' },
        [PK2]: { active: false, state: 'inactive', tier: 'member' }
      })
    );
    queueMembershipLookup(PK);
    queueMembershipLookup(PK2);
    await flush();
    await vi.advanceTimersByTimeAsync(TTL_MS.inactive + 10);
    revalidateMembership();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(String(fetchMock.mock.calls[1][0]))).toContain(PK2);
    expect(decodeURIComponent(String(fetchMock.mock.calls[1][0]))).not.toContain(PK);
  });
});
