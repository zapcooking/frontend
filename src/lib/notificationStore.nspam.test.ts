import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

// Shared state for the module mocks, which are hoisted above these imports.
const h = vi.hoisted(() => ({ me: 'a'.repeat(64) }));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({}), userPublickey: writable(h.me) };
});
vi.mock('$lib/followListCache', async () => {
  const { writable } = await import('svelte/store');
  return {
    followListReady: writable(false),
    followPubkeysReady: writable(false),
    followListSize: writable(0),
    getFollowedPubkeys: () => new Set<string>(),
    loadFollowListProfiles: async () => new Map()
  };
});
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  const state = writable({ muteList: null });
  return {
    mutedPubkeys: writable(new Set<string>()),
    muteListStore: { subscribe: state.subscribe, load: vi.fn().mockResolvedValue(undefined) }
  };
});
vi.mock('$lib/reads/moderationClient', async () => {
  const { writable } = await import('svelte/store');
  return { readsModerationVersion: writable(0), isBlockedReadsPointerClient: () => false };
});
vi.mock('$lib/relayListCache', () => ({ getInboxRelays: async () => [] }));
vi.mock('$lib/hellthreadFilterSettings', async () => {
  const { readable } = await import('svelte/store');
  return { hellthreadThreshold: readable(100) };
});
vi.mock('$lib/native/notifications', () => ({
  checkNotificationPermissions: vi.fn().mockResolvedValue('granted'),
  sendImmediateNotification: vi.fn().mockResolvedValue(true)
}));

import { followPubkeysReady } from '$lib/followListCache';
import {
  notifications,
  visibleNotifications,
  unreadCount,
  subscribeToNotifications,
  unsubscribeFromNotifications
} from './notificationStore';

const ME = h.me;
const ROOT = resolve(__dirname, '../..');
const bin = readFileSync(resolve(ROOT, 'static/models/nspam.bin'));

// Two reference bundles from the model repository: a confirmed bot and a person,
// every note carrying an e tag so the judge scores the whole bundle.
const fixtures: {
  label: number;
  pubkey: string;
  notes: { id: string; content: string; tags: string[][]; created_at: number }[];
}[] = readFileSync(resolve(ROOT, 'src/test/fixtures/nspam/parity_fixtures.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const hasETag = (n: { tags: string[][] }) => n.tags.some((t) => t && t[0] === 'e');
const bot = fixtures.find((c) => c.label === 1 && c.notes.length >= 3 && c.notes.every(hasETag))!;
const person = fixtures.find(
  (c) => c.label === 0 && c.notes.length >= 3 && c.notes.every(hasETag)
)!;

let handlers: Map<string, (...args: NDKEvent[]) => void>;

function emitBundle(c: {
  pubkey: string;
  notes: { id: string; content: string; tags: string[][]; created_at: number }[];
}) {
  for (const n of c.notes) {
    handlers.get('event')!({
      id: n.id,
      kind: 1,
      pubkey: c.pubkey,
      tags: [...n.tags, ['p', ME]],
      content: n.content,
      created_at: n.created_at
    } as NDKEvent);
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  vi.stubGlobal('document', { hidden: true });
  // The model the judge fetches is the bundled file itself.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(bin)))
  );
  followPubkeysReady.set(true);
  notifications.clear();
  handlers = new Map();
  const subscription = {
    on: (name: string, handler: (...args: NDKEvent[]) => void) => handlers.set(name, handler),
    stop: vi.fn()
  };
  const ndk = {
    fetchEvents: async () => new Set(),
    subscribe: () => subscription
  } as unknown as NDK;
  await subscribeToNotifications(ndk, ME);
  handlers.get('eose')!();
});

afterEach(() => {
  unsubscribeFromNotifications();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notifications from known spammers (nspam)', () => {
  it('hides a spammer\u2019s notifications once their reply bundle is judged, keeps the event stored', async () => {
    emitBundle(person);
    emitBundle(bot);
    // The realtime buffer flushes after 1 s; the model loads alongside, and the
    // verdict — whenever it lands — re-sorts the visible list reactively.
    await vi.advanceTimersByTimeAsync(1000);
    expect(get(notifications).length).toBeGreaterThanOrEqual(6);
    expect(get(notifications).some((n) => n.fromPubkey === bot.pubkey)).toBe(true);
    await vi.waitFor(
      () => expect(get(visibleNotifications).every((n) => n.fromPubkey !== bot.pubkey)).toBe(true),
      { timeout: 5000 }
    );
    expect(get(visibleNotifications).some((n) => n.fromPubkey === person.pubkey)).toBe(true);
  });

  it('hiding needs no mute: a judged spammer\u2019s events are kept but never shown', async () => {
    emitBundle(bot);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(get(visibleNotifications)).toEqual([]), { timeout: 5000 });
    expect(get(notifications).length).toBe(bot.notes.length);
    expect(get(unreadCount)).toBe(0);
  });
});
