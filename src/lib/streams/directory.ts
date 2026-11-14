/**
 * Directory of known stream announcements (NIP-53 kind 30311).
 *
 * Ported from Sidecar's stream-core `Directory`: newest announcement per
 * address wins, a cap evicts the stalest entries, and the three list views
 * (live / upcoming / past) are derived on read so a late-arriving correction
 * re-sorts without any bookkeeping.
 *
 * Ported from Sidecar's stream-core `Directory`.
 */

import { parseStreamEvent } from './parse';
import { isPastNoise, isTestStream } from './noise';
import type { NostrEventLike, StreamItem } from './types';

/**
 * How old a `live` announcement may be and still count as live (seconds).
 * Streamers re-publish while broadcasting, so an older one is a stream that
 * ended without saying so. Shared with the avatar lookup, which uses it to
 * bound what it asks relays for.
 */
export const LIVE_ANNOUNCEMENT_MAX_AGE_S = 3600;

export class StreamDirectory {
  readonly events = new Map<string, StreamItem>();
  /**
   * Streaming URLs proven live by a playlist probe, with the time of the
   * proof (seconds). `isLive` trusts a fresh proof over announcement age.
   */
  readonly verified = new Map<string, number>();

  constructor(readonly limit = 300) {}

  accept(event: NostrEventLike, now = Date.now() / 1000): boolean {
    const item = parseStreamEvent(event, now);
    if (!item) return false;
    const old = this.events.get(item.key);
    if (
      old &&
      (old.updated > item.updated || (old.updated === item.updated && old.id <= item.id))
    ) {
      return false;
    }
    this.events.set(item.key, item);
    if (this.events.size > this.limit) {
      const oldest = [...this.events].sort((a, b) => a[1].updated - b[1].updated)[0][0];
      this.events.delete(oldest);
    }
    return true;
  }

  isLive(item: StreamItem, now = Date.now() / 1000): boolean {
    return (
      item?.status === 'live' &&
      !!item.url &&
      (now - item.updated < LIVE_ANNOUNCEMENT_MAX_AGE_S ||
        (this.verified.has(item.url) && now - (this.verified.get(item.url) as number) < 180))
    );
  }

  live(now = Date.now() / 1000): StreamItem[] {
    const seen = new Set<string>();
    return [...this.events.values()]
      .filter((e) => this.isLive(e, now))
      .sort((a, b) => b.updated - a.updated)
      .filter((e) => {
        if (!e.url || seen.has(e.url)) return false;
        seen.add(e.url);
        return true;
      });
  }

  upcoming(now = Date.now() / 1000): StreamItem[] {
    return [...this.events.values()]
      .filter((e) => e.status === 'planned' && (!e.starts || e.starts >= now))
      .filter((e) => !isTestStream(e))
      .sort((a, b) => (a.starts || Infinity) - (b.starts || Infinity) || b.updated - a.updated);
  }

  past(): StreamItem[] {
    return [...this.events.values()]
      .filter((e) => e.status === 'ended')
      // Test runs and empty shells would otherwise bury the real replays.
      .filter((e) => !isPastNoise(e))
      .sort((a, b) => (b.ends || b.updated) - (a.ends || a.updated));
  }
}
