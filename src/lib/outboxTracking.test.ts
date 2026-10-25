import { describe, it, expect, vi } from 'vitest';
import { NDKUser } from '@nostr-dev-kit/ndk';
import { limitOutboxTracking, OUTBOX_LOOKUP_BOUND_MS } from './outboxTracking';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function fakeNdk(active: string | undefined) {
  const trackUsers = vi.fn(async () => [undefined]);
  const ndk = {
    outboxTracker: { trackUsers } as unknown as NonNullable<
      Parameters<typeof limitOutboxTracking>[0]['outboxTracker']
    >,
    activeUser: active ? ({ pubkey: active } as NDKUser) : undefined
  };
  return { ndk, trackUsers };
}

describe('limitOutboxTracking', () => {
  it('drops the authors of a subscription: no kind-3/10002 fan-out for them', async () => {
    const { ndk, trackUsers } = fakeNdk(ME);
    limitOutboxTracking(ndk);
    await ndk.outboxTracker!.trackUsers([OTHER, 'c'.repeat(64)]);
    expect(trackUsers).not.toHaveBeenCalled();
  });

  it('keeps the active user (publishing needs their write relays), as a pubkey or an NDKUser', async () => {
    const { ndk, trackUsers } = fakeNdk(ME);
    limitOutboxTracking(ndk);
    await ndk.outboxTracker!.trackUsers([OTHER, ME], true);
    expect(trackUsers).toHaveBeenCalledTimes(1);
    expect(trackUsers).toHaveBeenCalledWith([ME], true);
    const user = new NDKUser({ pubkey: ME });
    await ndk.outboxTracker!.trackUsers([user]);
    expect(trackUsers).toHaveBeenCalledTimes(2);
    expect(trackUsers.mock.calls[1][0]).toEqual([user]);
  });

  it('tracks nobody while signed out', async () => {
    const { ndk, trackUsers } = fakeNdk(undefined);
    limitOutboxTracking(ndk);
    await ndk.outboxTracker!.trackUsers([OTHER]);
    expect(trackUsers).not.toHaveBeenCalled();
  });

  it('restores the original, and is a no-op without a tracker (outbox model off)', async () => {
    const { ndk, trackUsers } = fakeNdk(ME);
    const restore = limitOutboxTracking(ndk);
    restore();
    await ndk.outboxTracker!.trackUsers([OTHER]);
    expect(trackUsers).toHaveBeenCalledWith([OTHER]);
    expect(() =>
      limitOutboxTracking({ outboxTracker: undefined, activeUser: undefined })()
    ).not.toThrow();
  });

  it("bounds the active user's lookup: a relay-list fetch that never answers can't hold a publish", async () => {
    vi.useFakeTimers();
    try {
      const { ndk, trackUsers } = fakeNdk(ME);
      trackUsers.mockImplementation(() => new Promise(() => {})); // EOSE never comes
      limitOutboxTracking(ndk);
      let settled = false;
      const p = ndk.outboxTracker!.trackUsers([ME]).then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(OUTBOX_LOOKUP_BOUND_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lookup that answers in time resolves with its result', async () => {
    const { ndk } = fakeNdk(ME);
    limitOutboxTracking(ndk);
    await expect(ndk.outboxTracker!.trackUsers([ME])).resolves.toEqual([undefined]);
  });
});
