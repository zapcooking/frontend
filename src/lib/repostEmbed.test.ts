import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchEventViaRepostEmbed, REPOST_EMBED_TIMEOUT_MS } from './repostEmbed';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

vi.mock('$app/environment', () => ({ browser: true }));

const EVENT_ID = 'a'.repeat(64);

function embeddedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    pubkey: 'b'.repeat(64),
    kind: 1,
    created_at: 1690000000,
    tags: [['e', 'c'.repeat(64), '', 'root']],
    content: 'A year-old recipe photo',
    sig: 'd'.repeat(128),
    ...overrides
  };
}

function repostOf(inner: unknown) {
  return { content: JSON.stringify(inner), kind: 6 } as NDKEvent;
}

function ndkReturning(reposts: NDKEvent[]): NDK {
  return { fetchEvents: vi.fn(async () => reposts) } as unknown as NDK;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchEventViaRepostEmbed', () => {
  it('reconstructs the original event from an exact-id embed', async () => {
    const ndk = ndkReturning([repostOf(embeddedEvent())]);

    const result = await fetchEventViaRepostEmbed(ndk, EVENT_ID, 1000);

    expect(result).toBeInstanceOf(NDKEvent);
    expect(result!.id).toBe(EVENT_ID);
    expect(result!.pubkey).toBe('b'.repeat(64));
    expect(result!.content).toBe('A year-old recipe photo');
  });

  it('skips embeds of a different event and finds the matching one later', async () => {
    const other = embeddedEvent({ id: 'e'.repeat(64) });
    const ndk = ndkReturning([repostOf(other), repostOf(embeddedEvent())]);

    const result = await fetchEventViaRepostEmbed(ndk, EVENT_ID, 1000);

    expect(result?.id).toBe(EVENT_ID);
  });

  it('skips reposts whose embed is not valid JSON', async () => {
    const ndk = ndkReturning([
      { content: 'not json at all', kind: 6 } as NDKEvent,
      repostOf(embeddedEvent())
    ]);

    const result = await fetchEventViaRepostEmbed(ndk, EVENT_ID, 1000);

    expect(result?.id).toBe(EVENT_ID);
  });

  it('returns null when no repost exists', async () => {
    const ndk = ndkReturning([]);

    const result = await fetchEventViaRepostEmbed(ndk, EVENT_ID, 1000);

    expect(result).toBeNull();
  });

  it('returns null when the relay fetch rejects', async () => {
    const ndk = {
      fetchEvents: vi.fn(async () => {
        throw new Error('relays down');
      })
    } as unknown as NDK;

    const result = await fetchEventViaRepostEmbed(ndk, EVENT_ID, 1000);

    expect(result).toBeNull();
  });

  it('returns null when the relay fetch hangs past the timeout', async () => {
    vi.useFakeTimers();
    const ndk = { fetchEvents: vi.fn(() => new Promise(() => {})) } as unknown as NDK;

    const pending = fetchEventViaRepostEmbed(ndk, EVENT_ID);
    vi.advanceTimersByTime(REPOST_EMBED_TIMEOUT_MS + 1);

    expect(await pending).toBeNull();
  });

  it('answers null without a relay pool or an id', async () => {
    expect(await fetchEventViaRepostEmbed(null as unknown as NDK, EVENT_ID)).toBeNull();
    expect(await fetchEventViaRepostEmbed(ndkReturning([]), '')).toBeNull();
  });
});
