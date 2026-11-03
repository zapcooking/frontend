import { PAGE_SIZE, type FreshClient, type PageResult, type RelayEvent } from './relay';

/**
 * Fresh's first page, started as early as possible: /feed calls
 * prefetchFirstPage() as soon as its script runs when Fresh is the landing
 * tab, before the feed component mounts, so the socket and the request
 * overlap the rest of the app starting up. The feed then takes it over with
 * takeFirstPage(), getting the events that already arrived plus the rest as
 * they stream in. Used once; refreshes and later visits request normally.
 */

type Listener = (e: RelayEvent) => void;

interface Prefetch {
  client: FreshClient;
  promise: Promise<PageResult>;
  arrived: RelayEvent[];
  listeners: Set<Listener>;
}

let pending: Prefetch | null = null;

export function prefetchFirstPage(client: FreshClient): void {
  if (pending) return;
  // A fresh start for this client (it may hold an earlier visit's posts).
  client.reset();
  const arrived: RelayEvent[] = [];
  const listeners = new Set<Listener>();
  const promise = client.page(undefined, PAGE_SIZE, (e) => {
    arrived.push(e);
    for (const l of listeners) l(e);
  });
  pending = { client, promise, arrived, listeners };
}

/**
 * The first page for `client`: the prefetched one if there is one (its
 * arrived events replayed to `onEvent`, the rest streamed), else a normal
 * request (after resetting the client, as a fresh first page needs).
 * `prefetched` says which.
 */
export function takeFirstPage(
  client: FreshClient,
  onEvent: Listener
): { result: Promise<PageResult>; prefetched: boolean } {
  const p = pending;
  if (p && p.client === client) {
    pending = null;
    for (const e of p.arrived) onEvent(e);
    p.listeners.add(onEvent);
    return {
      result: p.promise.finally(() => p.listeners.delete(onEvent)),
      prefetched: true
    };
  }
  // A normal first page starts this client afresh (the prefetch already did).
  client.reset();
  return { result: client.page(undefined, PAGE_SIZE, onEvent), prefetched: false };
}

/** Tests only. */
export function resetFirstPageForTests(): void {
  pending = null;
}
