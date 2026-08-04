import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter, NDKRelaySet, NDKSubscription } from '@nostr-dev-kit/ndk';

export const SPARK_BACKUP_SEARCH_TIMEOUT_MS = 7000;
export const SPARK_BACKUP_SETTLE_MS = 1000;

type SubscribableNdk = Pick<NDK, 'subscribe'>;

/**
 * Collect backup events from a live subscription with a hard deadline.
 *
 * Keeping the subscription open lets NDK send the request to relays that
 * finish connecting after the search starts. Once events arrive, a short
 * quiet period leaves time for the other relays to return additional wallet
 * backups without making the restore screen wait for the full deadline.
 *
 * Subscription create/start failures reject so callers can distinguish them
 * from a legitimate empty restore result.
 */
export function fetchSparkBackupEvents(
  ndk: SubscribableNdk,
  filter: NDKFilter,
  relaySet: NDKRelaySet,
  timeoutMs = SPARK_BACKUP_SEARCH_TIMEOUT_MS,
  settleMs = SPARK_BACKUP_SETTLE_MS
): Promise<Set<NDKEvent>> {
  return new Promise((resolve, reject) => {
    const events = new Set<NDKEvent>();
    let finished = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let subscription: NDKSubscription | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (settleTimer) clearTimeout(settleTimer);
      subscription?.stop();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(events);
    };

    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    timeoutTimer = setTimeout(finish, timeoutMs);
    try {
      subscription = ndk.subscribe(
        filter,
        { closeOnEose: false, groupable: false },
        relaySet,
        false
      );
      subscription.on('event', (event) => {
        events.add(event);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, settleMs);
      });
      void subscription.start().catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
