import { describe, it, expect, vi, beforeEach } from 'vitest';
/**
 * A pantry subscription the relay refuses (signed out: auth-required; not a
 * member: restricted) is stopped instead of living on in NDK for the tab.
 * Before this, a signed-out visit to /feed left a live kind-9 subscription
 * open per mount.
 */
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(null), userPublickey: writable(''), getCurrentRelays: () => [] };
});
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {},
  NDKRelaySet: { fromRelayUrls: () => ({ relays: new Set() }) },
  NDKPrivateKeySigner: class {}
}));
import { stopWhenRefused } from './nip29';

function fakeSub() {
  const handlers: Record<string, ((relay: unknown, reason: string) => void)[]> = {};
  const sub = {
    on: vi.fn((event: 'closed', cb: (relay: unknown, reason: string) => void) => {
      (handlers[event] ??= []).push(cb);
    }),
    stop: vi.fn(),
    closed: (reason: string) => handlers.closed?.forEach((cb) => cb({ url: 'wss://pantry.zap.cooking' }, reason))
  };
  return sub;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('stopWhenRefused', () => {
  it('stops a subscription the relay closed with auth-required or restricted', () => {
    for (const reason of ['auth-required: please authenticate', 'restricted: members only']) {
      const sub = fakeSub();
      stopWhenRefused(sub);
      sub.closed(reason);
      expect(sub.stop).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves any other close (a dropped socket) alone, for the reconnect handler', () => {
    const sub = fakeSub();
    stopWhenRefused(sub);
    sub.closed('');
    sub.closed('error: relay going away');
    expect(sub.stop).not.toHaveBeenCalled();
  });
});
