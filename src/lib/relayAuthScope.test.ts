import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isAuthAllowed,
  shouldAutoAuth,
  ownRelayUrls,
  ownRelayLists,
  resetOwnRelayLists,
  relayKey,
  NDK_BLOCKED_RELAYS,
  PANTRY_AUTH_RELAY
} from './relayAuthScope';

/**
 * The app logs in (NIP-42) on its own only to relays the reader chose:
 * pantry, the app's relay list, and the reader's own relay / DM inbox lists.
 */

const CONFIGURED = ['wss://nos.lol', 'wss://relay.primal.net/', 'wss://nostr.wine'];
const none = async () => [] as string[];

beforeEach(() => resetOwnRelayLists());

describe('isAuthAllowed', () => {
  it('always allows pantry, in any URL form', () => {
    for (const u of [PANTRY_AUTH_RELAY, 'wss://pantry.zap.cooking/', 'WSS://Pantry.Zap.Cooking'])
      expect(isAuthAllowed(u, [])).toBe(true);
  });

  it('allows the configured relays, ignoring case and trailing slashes', () => {
    expect(isAuthAllowed('wss://nos.lol/', CONFIGURED)).toBe(true);
    expect(isAuthAllowed('wss://relay.primal.net', CONFIGURED)).toBe(true);
  });

  it('refuses relays the reader never chose', () => {
    expect(isAuthAllowed('wss://random.example', CONFIGURED)).toBe(false);
    expect(isAuthAllowed('', CONFIGURED)).toBe(false);
  });

  it('never logs in to filter.nostr.wine, even if listed', () => {
    expect(
      isAuthAllowed('wss://filter.nostr.wine/', [...CONFIGURED, 'wss://filter.nostr.wine'])
    ).toBe(false);
    // nostr.wine itself is a different relay and stays allowed when configured.
    expect(isAuthAllowed('wss://nostr.wine/', CONFIGURED)).toBe(true);
  });
});

describe('shouldAutoAuth', () => {
  it('answers pantry and configured relays without fetching the own lists', async () => {
    const own = vi.fn(none);
    expect(await shouldAutoAuth('wss://pantry.zap.cooking/', CONFIGURED, own)).toBe(true);
    expect(await shouldAutoAuth('wss://nos.lol/', CONFIGURED, own)).toBe(true);
    expect(own).not.toHaveBeenCalled();
  });

  it("allows the reader's own NIP-65 / DM inbox relays (DMs on AUTH-only inboxes)", async () => {
    const own = async () => ['wss://inbox.nostr.wine', 'wss://auth.nostr1.com'];
    expect(await shouldAutoAuth('wss://auth.nostr1.com/', CONFIGURED, own)).toBe(true);
  });

  it("refuses a relay from someone else's outbox list", async () => {
    expect(await shouldAutoAuth('wss://someones.relay/', CONFIGURED, none)).toBe(false);
  });

  it('refuses filter.nostr.wine without even looking it up', async () => {
    const own = vi.fn(async () => ['wss://filter.nostr.wine']);
    expect(await shouldAutoAuth('wss://filter.nostr.wine/', CONFIGURED, own)).toBe(false);
    expect(own).not.toHaveBeenCalled();
  });
});

describe('own relay lists', () => {
  it('reads 10002 r tags (any marker) and 10050 relay tags only', () => {
    expect(
      ownRelayUrls([
        {
          kind: 10002,
          tags: [
            ['r', 'wss://a'],
            ['r', 'wss://b', 'read'],
            ['p', 'x']
          ]
        },
        {
          kind: 10050,
          tags: [
            ['relay', 'wss://dm'],
            ['r', 'wss://not-this']
          ]
        },
        { kind: 3, tags: [['r', 'wss://nope']] }
      ])
    ).toEqual(['wss://a', 'wss://b', 'wss://dm']);
  });

  it('uses the newest event of each kind and caches per account', async () => {
    const fetchEvents = vi.fn(
      async () =>
        new Set([
          { kind: 10002, created_at: 1, tags: [['r', 'wss://old']] },
          { kind: 10002, created_at: 2, tags: [['r', 'wss://new']] }
        ])
    );
    expect(await ownRelayLists(fetchEvents, 'me')).toEqual(['wss://new']);
    await ownRelayLists(fetchEvents, 'me');
    expect(fetchEvents).toHaveBeenCalledTimes(1);
    await ownRelayLists(fetchEvents, 'someone-else');
    expect(fetchEvents).toHaveBeenCalledTimes(2);
  });

  it('allows nothing extra when signed out or the fetch fails', async () => {
    expect(await ownRelayLists(vi.fn(), '')).toEqual([]);
    expect(await ownRelayLists(async () => Promise.reject(new Error('x')), 'me')).toEqual([]);
  });
});

describe('NDK blocklist', () => {
  it("keeps NDK's defaults and adds filter.nostr.wine, in NDK's URL form", () => {
    for (const u of ['wss://brb.io/', 'wss://nostr.mutinywallet.com/', 'wss://filter.nostr.wine/'])
      expect(NDK_BLOCKED_RELAYS).toContain(u);
    for (const u of NDK_BLOCKED_RELAYS) expect(u.endsWith('/')).toBe(true);
    expect(relayKey('wss://X.y/')).toBe('wss://x.y');
  });
});
