/**
 * Single-relay page query with a real EOSE-vs-timeout distinction.
 *
 * Ported from Sidecar's stream-core `relayPage`. NDK's pool cannot say
 * whether one relay answered or merely timed out, and the zap-total quorum
 * math depends on that signal — so archive scans and chat history run on a
 * dedicated nostr-tools pool, one relay per query, with hard deadlines that
 * expire before the library's synthetic EOSE timeout could fire.
 */

import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { verifyEvent } from 'nostr-tools/pure';
import type { NostrEventLike } from './types';

export interface RelayPageResult<T extends NostrEventLike = NostrEventLike> {
  events: T[];
  /** True when the relay actually sent EOSE; false on timeout or close. */
  complete: boolean;
}

/**
 * Query one relay until EOSE or `timeout`. Resolves (never rejects); a pool
 * connection failure resolves `{events: [], complete: false}`. `onEvent`
 * fires as events arrive, so callers can paint early.
 */
export function relayPage<T extends NostrEventLike = NostrEventLike>(
  pool: SimplePool,
  url: string,
  filter: Filter,
  signal?: AbortSignal,
  timeout = 6500,
  onEvent?: (event: T) => void
): Promise<RelayPageResult<T>> {
  return new Promise((resolve) => {
    const events: T[] = [];
    let sub: { close: () => void } | null = null;
    let done = false;
    const finish = (complete: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      sub?.close();
      resolve({ events, complete });
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, timeout);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    pool
      // The deadline is ours: expire before the library's synthetic EOSE
      // timeout can fire its own completion path.
      .ensureRelay(url, { connectionTimeout: timeout })
      .then((relay) => {
        if (done) return;
        sub = relay.subscribe([filter], {
          eoseTimeout: timeout + 1000,
          onevent: (event: unknown) => {
            if (done) return;
            const e = event as T;
            events.push(e);
            onEvent?.(e);
          },
          oneose: () => finish(true),
          onclose: () => finish(false)
        } as never);
        if (done) sub?.close();
      })
      .catch(abort);
  });
}

/** A nostr-tools pool that verifies signatures, for scans and discovery. */
export function createStreamPool(): SimplePool {
  return new SimplePool({ verifyEvent } as never);
}
