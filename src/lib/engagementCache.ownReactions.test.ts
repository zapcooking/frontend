import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

/**
 * After a fresh sign-in the resumed reaction must see the account's own
 * existing reactions before it publishes — fetchEngagement can't provide
 * them (30 s freshness skip, reused subscriptions bound to the signed-out
 * pubkey), so loadOwnReactions looks them up directly and waits.
 */

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('@nostr-dev-kit/ndk', () => ({
  default: class NDK {},
  NDKRelaySet: { fromRelayUrls: () => ({}) }
}));
vi.mock('./countQuery', () => ({
  getEngagementCounts: vi.fn(async () => null),
  batchFetchFromServerAPI: vi.fn(async () => new Map())
}));

import { loadOwnReactions, getEngagementStore, reactionEmoji } from './engagementCache';

const NOTE = 'a'.repeat(64);
const OTHER_NOTE = 'b'.repeat(64);
const ME = 'c'.repeat(64);

function reaction(content: string, tags: string[][] = [['e', NOTE]], pubkey = ME) {
  return { kind: 7, pubkey, content, tags };
}

function ndkReturning(events: unknown[] | Promise<never>) {
  return {
    fetchEvents: vi.fn(() =>
      events instanceof Promise ? events : Promise.resolve(new Set(events))
    )
  } as never;
}

beforeEach(() => {
  getEngagementStore(NOTE).update((s) => ({
    ...s,
    reactions: {
      count: 3,
      userReacted: false,
      groups: [{ emoji: '❤️', count: 3, userReacted: false }],
      userReactions: new Set()
    }
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reactionEmoji', () => {
  it('normalizes like the subscription does', () => {
    expect(reactionEmoji('+')).toBe('❤️');
    expect(reactionEmoji('')).toBe('❤️');
    expect(reactionEmoji('-')).toBe('👎');
    expect(reactionEmoji(' 🔥 ')).toBe('🔥');
    expect(reactionEmoji(':custom:')).toBeNull();
  });
});

describe('loadOwnReactions', () => {
  it("asks for exactly this account's reactions to this note and marks them", async () => {
    const ndk = ndkReturning([reaction('+')]);
    const mine = await loadOwnReactions(ndk, NOTE, ME);

    expect((ndk as { fetchEvents: ReturnType<typeof vi.fn> }).fetchEvents).toHaveBeenCalledWith({
      kinds: [7],
      authors: [ME],
      '#e': [NOTE]
    });
    expect([...mine]).toEqual(['❤️']);
    const s = get(getEngagementStore(NOTE));
    expect(s.reactions.userReactions.has('❤️')).toBe(true);
    expect(s.reactions.userReacted).toBe(true);
    expect(s.reactions.groups[0].userReacted).toBe(true);
  });

  it('leaves counts alone — those reactions are already counted', async () => {
    await loadOwnReactions(ndkReturning([reaction('+')]), NOTE, ME);
    const s = get(getEngagementStore(NOTE));
    expect(s.reactions.count).toBe(3);
    expect(s.reactions.groups[0].count).toBe(3);
  });

  it('ignores reactions that only mention the note in thread context', async () => {
    const threadContext = reaction('🔥', [
      ['e', NOTE, '', 'root'],
      ['e', OTHER_NOTE, '', 'reply']
    ]);
    const mine = await loadOwnReactions(ndkReturning([threadContext]), NOTE, ME);
    expect(mine.size).toBe(0);
    expect(get(getEngagementStore(NOTE)).reactions.userReacted).toBe(false);
  });

  it('ignores events from other authors', async () => {
    const mine = await loadOwnReactions(
      ndkReturning([reaction('+', [['e', NOTE]], 'd'.repeat(64))]),
      NOTE,
      ME
    );
    expect(mine.size).toBe(0);
  });

  it('gives up after the timeout without marking anything', async () => {
    vi.useFakeTimers();
    const pending = loadOwnReactions(ndkReturning(new Promise<never>(() => {})), NOTE, ME);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).size).toBe(0);
    expect(get(getEngagementStore(NOTE)).reactions.userReacted).toBe(false);
  });
});
