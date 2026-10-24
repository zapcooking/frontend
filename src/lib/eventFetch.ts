import type NDK from '@nostr-dev-kit/ndk';
import { NDKRelaySet, type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';

/**
 * Single-event fetch with an explicit relay set.
 *
 * Why not plain `ndk.fetchEvent(filter)`: with the outbox model enabled,
 * NDK routes author-filtered REQs through the outbox tracker. When the
 * author's write relays are unknown (first time seeing this author) the
 * tracker falls back to connected pool relays — and during a cold
 * deep-link that set is empty, so the computed relay set is EMPTY: the
 * REQ is never sent, no EOSE ever arrives beyond the first-connecting
 * relay (which often doesn't have the event), and fetchEvent resolves
 * null after its 10s timeout. The page then shows "not found" for
 * content that relays actually hold.
 *
 * Passing an explicit relay set bypasses that computation entirely:
 * NDKSubscription.startWithRelays sends the filters to every relay in
 * the set, and each relay-level subscription waits for its relay to
 * finish connecting before issuing the REQ.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export interface FetchEventOptions {
  /** Extra relay URLs (e.g. bech32 relay hints) merged into the set. */
  hintRelayUrls?: string[];
  /** Overall timeout; resolves null when exceeded. Default 10s. */
  timeoutMs?: number;
}

export function buildPoolRelaySet(ndk: NDK, hintRelayUrls: string[] = []): NDKRelaySet | undefined {
  const urls = new Set<string>();

  for (const url of ndk.explicitRelayUrls ?? []) urls.add(normalizeRelayUrl(url));
  // Include pool relays still mid-connect so their REQs queue up rather
  // than race the connection. `relays` is a Map on NDKRelayPool; guard
  // for API shape differences across NDK versions.
  const poolUrls = ndk.pool?.relays?.keys?.() ?? [];
  for (const url of poolUrls) urls.add(normalizeRelayUrl(url));

  for (const url of hintRelayUrls) {
    if (typeof url === 'string' && url.startsWith('wss://')) {
      urls.add(normalizeRelayUrl(url));
    }
  }

  if (urls.size === 0) return undefined;
  // addConnectedRelays=true would re-add the connected pool relays; the
  // set already carries the full pool, so keep it exact.
  return NDKRelaySet.fromRelayUrls([...urls], ndk, false);
}

export async function fetchEventWithRelayHints(
  ndk: NDK,
  filter: NDKFilter,
  options: FetchEventOptions = {}
): Promise<NDKEvent | null> {
  const relaySet = buildPoolRelaySet(ndk, options.hintRelayUrls);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fetchPromise = ndk.fetchEvent(filter, {}, relaySet);
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}
