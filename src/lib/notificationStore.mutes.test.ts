import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  return {
    mutedPubkeys: writable(new Set<string>()),
    muteListStore: { load: vi.fn().mockResolvedValue(undefined) }
  };
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

import { muteListStore, mutedPubkeys } from '$lib/muteListStore';
import { checkNotificationPermissions, sendImmediateNotification } from '$lib/native/notifications';
import {
  notifications,
  visibleNotifications,
  unreadCount,
  subscribeToNotifications,
  unsubscribeFromNotifications
} from './notificationStore';

const ME = 'a'.repeat(64);
const SENDER = 'b'.repeat(64);
const ZAPPER = 'c'.repeat(64);
let handlers: Map<string, (...args: NDKEvent[]) => void>;

function emitEvent(kind = 1, pubkey = SENDER, tags = [['p', ME]]) {
  handlers.get('event')!({
    id: `event-${kind}`,
    kind,
    pubkey,
    tags,
    content: 'hello',
    created_at: Math.floor(Date.now() / 1000)
  } as NDKEvent);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  vi.stubGlobal('document', { hidden: true });
  vi.mocked(muteListStore.load).mockReset().mockResolvedValue(undefined);
  vi.mocked(checkNotificationPermissions).mockReset().mockResolvedValue('granted');
  vi.mocked(sendImmediateNotification).mockClear();
  mutedPubkeys.set(new Set());
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

describe('muted notification senders', () => {
  it.each([1, 7, 6, 16, 1111])('suppresses system alerts for kind %s', async (kind) => {
    mutedPubkeys.set(new Set([SENDER]));
    emitEvent(kind);
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendImmediateNotification).not.toHaveBeenCalled();
    expect(get(visibleNotifications)).toEqual([]);
    expect(get(unreadCount)).toBe(0);
    expect(get(notifications)).toHaveLength(1);
  });

  it('filters zaps by the embedded sender, not the receipt service', async () => {
    mutedPubkeys.set(new Set([SENDER]));
    emitEvent(9735, ZAPPER, [
      ['p', ME],
      ['description', JSON.stringify({ pubkey: SENDER, content: 'zap' })]
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(sendImmediateNotification).not.toHaveBeenCalled();
  });

  it('waits for mutes to load before sending an alert', async () => {
    let finishLoading!: () => void;
    vi.mocked(muteListStore.load).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = resolve;
        })
    );
    emitEvent();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendImmediateNotification).not.toHaveBeenCalled();

    mutedPubkeys.set(new Set([SENDER]));
    finishLoading();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendImmediateNotification).not.toHaveBeenCalled();
  });

  it('rechecks mutes after waiting for permissions', async () => {
    let grantPermission!: (permission: 'granted') => void;
    vi.mocked(checkNotificationPermissions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grantPermission = resolve;
        })
    );
    emitEvent();
    await vi.advanceTimersByTimeAsync(0);
    mutedPubkeys.set(new Set([SENDER]));
    grantPermission('granted');
    await vi.advanceTimersByTimeAsync(0);

    expect(sendImmediateNotification).not.toHaveBeenCalled();
  });

  it('still alerts for unmuted users', async () => {
    mutedPubkeys.set(new Set([ZAPPER]));
    emitEvent();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendImmediateNotification).toHaveBeenCalledWith(
      'Zap Cooking',
      expect.stringContaining('Someone mentioned you'),
      expect.objectContaining({ notificationId: 'event-1' })
    );
  });

  it('keeps an unmuted zap sender visible even when the service is muted', async () => {
    mutedPubkeys.set(new Set([ZAPPER]));
    emitEvent(9735, ZAPPER, [
      ['p', ME],
      ['description', JSON.stringify({ pubkey: SENDER, content: 'zap' })]
    ]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendImmediateNotification).toHaveBeenCalledOnce();
    expect(get(visibleNotifications)[0].fromPubkey).toBe(SENDER);
  });

  it('updates existing notification visibility and unread count on mute changes', async () => {
    emitEvent();
    await vi.advanceTimersByTimeAsync(1000);
    expect(get(unreadCount)).toBe(1);

    mutedPubkeys.set(new Set([SENDER]));
    expect(get(visibleNotifications)).toEqual([]);
    expect(get(unreadCount)).toBe(0);

    mutedPubkeys.set(new Set());
    expect(get(visibleNotifications)).toHaveLength(1);
    expect(get(unreadCount)).toBe(1);
  });
});
