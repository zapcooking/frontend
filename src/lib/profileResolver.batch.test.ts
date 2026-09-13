import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';

vi.mock('./nostr', () => ({ ndk: {} }));

// buildProfileRelaySet dynamically imports NDKRelaySet from the real
// package, whose module graph (websocket polyfills etc.) doesn't load
// cleanly under vitest's node environment — stub the class.
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: class NDKRelaySet {
    constructor(public relays: Set<unknown>, _ndk: unknown) {}
  }
}));

const fetchEventsMock = vi.fn();

function makeNdk(): NDK {
  return {
    pool: {
      relays: new Map([['wss://relay.test', {}]]),
      getRelay: vi.fn(() => ({}))
    },
    fetchEvents: fetchEventsMock
  } as unknown as NDK;
}

function kind0(pubkey: string, name: string, created_at = 100) {
  return {
    pubkey,
    created_at,
    content: JSON.stringify({ name, display_name: name.toUpperCase() })
  };
}

describe('profileResolver batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchEventsMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces concurrent resolves into one authors[] fetch', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');

    const pubkeys = ['aa', 'bb', 'cc', 'dd', 'ee'];
    fetchEventsMock.mockImplementation(async (filter: { authors: string[] }) => {
      const events = filter.authors.map((pk) =>
        kind0(pk, `name-${pk}`)
      );
      return new Set(events);
    });

    const ndk = makeNdk();
    const pending = pubkeys.map((pk) => resolveProfileByPubkey(pk, ndk));

    // Nothing fires until the collection window closes.
    expect(fetchEventsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    const results = await Promise.all(pending);
    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
    expect(fetchEventsMock.mock.calls[0][0].authors).toEqual(pubkeys);
    expect(fetchEventsMock.mock.calls[0][0].kinds).toEqual([0]);
    for (const profile of results) {
      expect(profile?.name).toBe(`name-${profile?.pubkey}`);
    }
  });

  it('single-flights duplicate resolves for the same pubkey', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');

    fetchEventsMock.mockImplementation(async (filter: { authors: string[] }) =>
      new Set(filter.authors.map((pk) => kind0(pk, `name-${pk}`)))
    );

    const ndk = makeNdk();
    const a = resolveProfileByPubkey('dupe', ndk);
    const b = resolveProfileByPubkey('dupe', ndk);
    await vi.advanceTimersByTimeAsync(200);
    const [first, second] = await Promise.all([a, b]);

    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
    expect(fetchEventsMock.mock.calls[0][0].authors).toEqual(['dupe']);
    expect(first?.name).toBe('name-dupe');
    expect(second?.name).toBe('name-dupe');
  });

  it('resolves null for pubkeys the relays do not know', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');

    fetchEventsMock.mockImplementation(async () => new Set());

    const ndk = makeNdk();
    const pending = resolveProfileByPubkey('unknown', ndk);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBeNull();
  });

  it('keeps the newest kind:0 when a pubkey has several events', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');

    fetchEventsMock.mockImplementation(async () =>
      new Set([kind0('pk', 'old', 100), kind0('pk', 'new', 200)])
    );

    const ndk = makeNdk();
    const pending = resolveProfileByPubkey('pk', ndk);
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending)?.name).toBe('new');
  });
});
