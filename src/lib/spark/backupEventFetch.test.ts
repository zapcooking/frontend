import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { fetchSparkBackupEvents } from './backupEventFetch';

type EventHandler = (event: NDKEvent) => void;

function createSubscriptionHarness() {
  let eventHandler: EventHandler | undefined;
  const subscription = {
    on: vi.fn((eventName: string, handler: EventHandler) => {
      if (eventName === 'event') eventHandler = handler;
      return subscription;
    }),
    start: vi.fn(async () => {}),
    stop: vi.fn()
  };
  const ndk = {
    subscribe: vi.fn(() => subscription)
  };

  return {
    ndk,
    subscription,
    emit: (event: Partial<NDKEvent>) => eventHandler?.(event as NDKEvent)
  };
}

const filter = { kinds: [30078], authors: ['pubkey'] } as NDKFilter;
const relaySet = {} as NDKRelaySet;

describe('fetchSparkBackupEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the subscription live and returns shortly after an event arrives', async () => {
    const harness = createSubscriptionHarness();
    const resultPromise = fetchSparkBackupEvents(
      harness.ndk as never,
      filter,
      relaySet,
      7000,
      1000
    );

    expect(harness.ndk.subscribe).toHaveBeenCalledWith(
      filter,
      { closeOnEose: false, groupable: false },
      relaySet,
      false
    );
    expect(harness.subscription.start).toHaveBeenCalledOnce();

    const backup = { id: 'backup-1' } as NDKEvent;
    harness.emit(backup);
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.subscription.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual(new Set([backup]));
    expect(harness.subscription.stop).toHaveBeenCalledOnce();
  });

  it('resets the settle window when another backup arrives', async () => {
    const harness = createSubscriptionHarness();
    const resultPromise = fetchSparkBackupEvents(
      harness.ndk as never,
      filter,
      relaySet,
      7000,
      1000
    );
    const first = { id: 'backup-1' } as NDKEvent;
    const second = { id: 'backup-2' } as NDKEvent;

    harness.emit(first);
    await vi.advanceTimersByTimeAsync(750);
    harness.emit(second);
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.subscription.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual(new Set([first, second]));
  });

  it('stops and returns an empty set at the hard deadline', async () => {
    const harness = createSubscriptionHarness();
    const resultPromise = fetchSparkBackupEvents(
      harness.ndk as never,
      filter,
      relaySet,
      7000,
      1000
    );

    await vi.advanceTimersByTimeAsync(7000);
    await expect(resultPromise).resolves.toEqual(new Set());
    expect(harness.subscription.stop).toHaveBeenCalledOnce();
  });

  it('rejects if starting the subscription fails', async () => {
    const harness = createSubscriptionHarness();
    harness.subscription.start.mockRejectedValueOnce(new Error('relay failure'));

    await expect(
      fetchSparkBackupEvents(harness.ndk as never, filter, relaySet, 7000, 1000)
    ).rejects.toThrow('relay failure');
    expect(harness.subscription.stop).toHaveBeenCalledOnce();
  });

  it('rejects if creating the subscription throws', async () => {
    const harness = createSubscriptionHarness();
    harness.ndk.subscribe.mockImplementationOnce(() => {
      throw new Error('subscribe failed');
    });

    await expect(
      fetchSparkBackupEvents(harness.ndk as never, filter, relaySet, 7000, 1000)
    ).rejects.toThrow('subscribe failed');
  });
});
