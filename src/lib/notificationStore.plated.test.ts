import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  const state = writable({ muteList: null });
  return {
    mutedPubkeys: writable(new Set<string>()),
    muteListStore: { subscribe: state.subscribe, set: state.set, load: async () => {} }
  };
});
vi.mock('$lib/reads/moderationClient', async () => {
  const { writable } = await import('svelte/store');
  const blocked = new Set<string>();
  return {
    readsModerationVersion: writable(0),
    isBlockedReadsPointerClient: (p: { eventId: string; pubkey: string }) =>
      blocked.has(p.eventId) || blocked.has(p.pubkey),
    __blocked: blocked
  };
});
vi.mock('$lib/relayListCache', () => ({ getInboxRelays: async () => [] }));
vi.mock('$lib/hellthreadFilterSettings', async () => {
  const { readable } = await import('svelte/store');
  return { hellthreadThreshold: readable(100) };
});
vi.mock('$lib/native/notifications', () => ({
  checkNotificationPermissions: async () => 'denied',
  sendImmediateNotification: async () => true
}));

import { muteListStore } from '$lib/muteListStore';
import * as moderationClient from '$lib/reads/moderationClient';
import { platedRecipeLookups, resetPlatedRecipeLookups } from '$lib/plated/notification';
import {
  notifications,
  visibleNotifications,
  unreadCount,
  subscribeToNotifications,
  unsubscribeFromNotifications,
  type Notification
} from './notificationStore';

const muteState = muteListStore as unknown as Writable<{ muteList: unknown }>;
const { readsModerationVersion } = moderationClient as unknown as { readsModerationVersion: Writable<number> };
const blocked = (moderationClient as unknown as { __blocked: Set<string> }).__blocked;

const ME = 'a'.repeat(64);
const COOK = '1'.repeat(64);
const ADDRESS = `30023:${ME}:sourdough-waffles`;
const IMG = 'https://image.nostr.build/waffles.jpg';
const PLATE_ID = 'd'.repeat(64);
const NOW = 1_800_000_000;

let handlers: Map<string, (...args: NDKEvent[]) => void>;
let storage: Map<string, string>;

function plateEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PLATE_ID,
    kind: 1111,
    pubkey: COOK,
    created_at: NOW,
    content: `Crispy and golden\n\n${IMG}`,
    tags: [
      ['A', ADDRESS, ''],
      ['K', '30023'],
      ['P', ME, ''],
      ['a', ADDRESS, ''],
      ['k', '30023'],
      ['p', ME, ''],
      ['e', 'f'.repeat(64), '', ME],
      ['t', 'cooked']
    ],
    ...overrides
  } as unknown as NDKEvent;
}

async function start() {
  handlers = new Map();
  const subscription = {
    on: (name: string, handler: (...args: NDKEvent[]) => void) => handlers.set(name, handler),
    stop: vi.fn()
  };
  const ndk = { fetchEvents: async () => new Set(), subscribe: () => subscription } as unknown as NDK;
  await subscribeToNotifications(ndk, ME);
}

async function deliver(...events: NDKEvent[]) {
  for (const e of events) handlers.get('event')!(e);
  handlers.get('eose')!();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k)
  });
  vi.stubGlobal('document', { hidden: false });
  muteState.set({ muteList: null });
  blocked.clear();
  resetPlatedRecipeLookups();
  notifications.clear();
});

afterEach(() => {
  unsubscribeFromNotifications();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('plated notifications in the store', () => {
  it('stores a plate as one comment notification with Plated data', async () => {
    await start();
    await deliver(plateEvent());
    const [n] = get(visibleNotifications);
    expect(get(visibleNotifications)).toHaveLength(1);
    expect(n.type).toBe('comment');
    expect(n.plated).toEqual({
      recipeAddress: ADDRESS,
      image: IMG,
      note: 'Crispy and golden',
      hashtags: ['cooked']
    });
  });

  it('never duplicates a plate (both #P and #p routes, the refetch, a re-delivery)', async () => {
    await start();
    await deliver(plateEvent(), plateEvent());
    handlers.get('event')!(plateEvent());
    await vi.advanceTimersByTimeAsync(1000);
    expect(get(notifications)).toHaveLength(1);
  });

  it('keeps a reply, a self-plate and another author recipe out of Plated', async () => {
    const replyTags = (plateEvent().tags as string[][]).map((t) => (t[0] === 'k' ? ['k', '1111'] : t));
    const otherRecipe = `30023:${'b'.repeat(64)}:waffles`;
    const otherTags = (plateEvent().tags as string[][]).map((t) =>
      t[0] === 'A' || t[0] === 'a' ? [t[0], otherRecipe, ''] : t
    );
    await start();
    await deliver(
      plateEvent({ id: '2'.repeat(64), tags: replyTags }),
      plateEvent({ id: '3'.repeat(64), pubkey: ME }),
      plateEvent({ id: '4'.repeat(64), tags: otherTags })
    );
    const list = get(notifications);
    expect(list).toHaveLength(2); // own events never notify
    expect(list.every((n) => n.type === 'comment' && !n.plated)).toBe(true);
  });

  it('upgrades a cached comment to its Plated version, keeping read flag, time and position', async () => {
    const older: Notification = {
      id: 'e'.repeat(64),
      type: 'reaction',
      fromPubkey: COOK,
      createdAt: NOW - 100,
      read: false
    };
    const cached: Notification = {
      id: PLATE_ID,
      type: 'comment',
      fromPubkey: COOK,
      eventId: PLATE_ID,
      content: 'Crispy and golden',
      createdAt: NOW - 50,
      read: true
    };
    notifications.addBulk([cached, older]);
    expect(get(notifications)[0].plated).toBeUndefined();

    await start();
    await deliver(plateEvent({ created_at: NOW - 50 }));

    const list = get(notifications);
    expect(list.map((n) => n.id)).toEqual([PLATE_ID, older.id]);
    expect(list[0].read).toBe(true);
    expect(list[0].createdAt).toBe(NOW - 50);
    expect(list[0].plated?.recipeAddress).toBe(ADDRESS);
    const saved = JSON.parse(storage.get('zc_notifications_v7')!) as Notification[];
    expect(saved.find((n) => n.id === PLATE_ID)?.plated?.image).toBe(IMG);
  });

  it('keeps older notifications without Plated data working', () => {
    storage.set(
      'zc_notifications_v7',
      JSON.stringify([{ id: 'x', type: 'comment', fromPubkey: COOK, createdAt: NOW, read: false }])
    );
    // A fresh read of the cache path: addBulk of the stored shape is a no-op.
    notifications.addBulk([{ id: 'x', type: 'comment', fromPubkey: COOK, createdAt: NOW, read: false }]);
    expect(get(visibleNotifications)).toHaveLength(1);
    expect(get(unreadCount)).toBe(1);
  });

  it('hides a muted plate from the list and the counts (author, tag, word)', async () => {
    await start();
    await deliver(plateEvent());
    expect(get(unreadCount)).toBe(1);

    for (const muteList of [
      { pubkeys: [{ type: 'pubkey', value: COOK }], words: [], tags: [], threads: [] },
      { pubkeys: [], words: [], tags: [{ type: 'tag', value: 'cooked' }], threads: [] },
      { pubkeys: [], words: [{ type: 'word', value: 'crispy' }], tags: [], threads: [] }
    ]) {
      muteState.set({ muteList });
      expect(get(visibleNotifications)).toEqual([]);
      expect(get(unreadCount)).toBe(0);
    }
    muteState.set({ muteList: null });
    expect(get(unreadCount)).toBe(1);
  });

  it('does not apply word or tag mutes to ordinary comments', async () => {
    await start();
    await deliver(plateEvent({ tags: [['P', ME], ['p', ME], ['k', '30023']], content: 'crispy!' }));
    muteState.set({ muteList: { pubkeys: [], words: [{ type: 'word', value: 'crispy' }], tags: [], threads: [] } });
    expect(get(visibleNotifications)).toHaveLength(1);
  });

  it('hides a plate blocked by event id or author once the lists change', async () => {
    await start();
    await deliver(plateEvent());
    blocked.add(PLATE_ID);
    readsModerationVersion.update((v) => v + 1);
    expect(get(visibleNotifications)).toEqual([]);
    expect(get(unreadCount)).toBe(0);

    blocked.clear();
    blocked.add(COOK);
    readsModerationVersion.update((v) => v + 1);
    expect(get(visibleNotifications)).toEqual([]);
  });

  it('shows a plate on an article as a normal comment, without the plate-only checks', async () => {
    await start();
    await deliver(plateEvent());
    blocked.add(PLATE_ID);
    platedRecipeLookups.set(new Map([[ADDRESS, { status: 'not-recipe' }]]));
    readsModerationVersion.update((v) => v + 1);
    expect(get(visibleNotifications)).toHaveLength(1);
  });

  it('keeps a kind-35000 address a normal comment', async () => {
    const gated = `35000:${ME}:sourdough-waffles`;
    const tags = (plateEvent().tags as string[][]).map((t) =>
      t[0] === 'A' || t[0] === 'a' ? [t[0], gated, ''] : t[0] === 'K' || t[0] === 'k' ? [t[0], '35000'] : t
    );
    await start();
    await deliver(plateEvent({ tags }));
    expect(get(notifications)[0].plated).toBeUndefined();
  });
});
