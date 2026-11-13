/**
 * Zap provider resolution for a stream host.
 *
 * Ported from Sidecar's stream-core `zapProvider`. A zap receipt counts
 * toward a stream's verified total only when the host's own Lightning
 * provider signed it, which means resolving: host profile (kind 0) →
 * `lud16` → the LNURL-pay document → its `nostrPubkey`.
 */

import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { NostrEventLike } from './types';

export interface ZapProviderMeta {
  nostrPubkey: string;
  allowsNostr: boolean;
  callback?: string;
  metadata?: string;
  minSendable?: number;
  maxSendable?: number;
}

const PROFILE_MAX_WAIT_MS = 5000;
const PROVIDER_FETCH_TIMEOUT_MS = 8000;

function newestEvent(events: NostrEventLike[], kind: number, host: string): NostrEventLike | null {
  return (
    events
      .filter((e) => e.kind === kind && e.pubkey === host)
      .sort((a, b) => b.created_at - a.created_at || String(a.id).localeCompare(String(b.id)))[0] ||
    null
  );
}

/** Relay URLs a kind:10002 list declares as read relays. */
export function declaredReadRelays(event: NostrEventLike | null): string[] {
  return (event?.tags || [])
    .filter((t) => t[0] === 'r' && typeof t[1] === 'string' && t[1].startsWith('wss://'))
    .map((t) => t[1])
    .slice(0, 6);
}

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal,
  request: typeof fetch
): Promise<Response> {
  const fetchAbort = new AbortController();
  const cancel = () => fetchAbort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, PROVIDER_FETCH_TIMEOUT_MS);
  try {
    return await request(url, {
      signal: fetchAbort.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    } as RequestInit);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Resolve the host's zap provider. Throws `No zap provider` when the host
 * has no zappable lightning address and `Provider unavailable` /
 * `Invalid zap provider` when the LNURL document is unreachable or does not
 * allow Nostr zaps — callers show those as "cannot zap this host".
 */
export async function resolveZapProvider(
  pool: SimplePool,
  sources: string[],
  host: string,
  signal: AbortSignal,
  request: typeof fetch = fetch
): Promise<ZapProviderMeta> {
  const newest = async (kind: number, urls: string[]) => {
    const events = (await pool.querySync(
      urls,
      {
        kinds: [kind],
        authors: [host]
      } as Filter,
      { maxWait: PROFILE_MAX_WAIT_MS }
    )) as unknown as NostrEventLike[];
    return newestEvent(events, kind, host);
  };

  const sources_ = [...sources];
  const [profile, relayList] = await Promise.all([newest(0, sources_), newest(10002, sources_)]);
  if (signal.aborted) throw new Error('Aborted');
  const declared = declaredReadRelays(relayList);
  for (const url of declared) if (!sources_.includes(url)) sources_.push(url);
  let currentProfile = profile;
  if (!currentProfile && declared.length) currentProfile = await newest(0, declared);
  if (signal.aborted) throw new Error('Aborted');

  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(currentProfile?.content || '{}');
  } catch {
    content = {};
  }
  const lud16 = typeof content.lud16 === 'string' ? content.lud16 : '';
  const parts = typeof lud16 === 'string' ? lud16.split('@') : [];
  if (!parts || parts.length !== 2 || !parts[0] || !/^[a-z0-9.-]+$/i.test(parts[1])) {
    throw new Error('No zap provider');
  }

  const response = await fetchWithTimeout(
    `https://${parts[1]}/.well-known/lnurlp/${encodeURIComponent(parts[0])}`,
    signal,
    request
  );
  if (!response.ok) throw new Error('Provider unavailable');
  const meta = (await response.json()) as Record<string, unknown>;
  if (
    !meta.allowsNostr ||
    typeof meta.nostrPubkey !== 'string' ||
    !/^[a-f0-9]{64}$/.test(meta.nostrPubkey)
  ) {
    throw new Error('Invalid zap provider');
  }
  return {
    nostrPubkey: meta.nostrPubkey,
    allowsNostr: true,
    callback: typeof meta.callback === 'string' ? meta.callback : undefined,
    metadata: typeof meta.metadata === 'string' ? meta.metadata : undefined,
    minSendable: typeof meta.minSendable === 'number' ? meta.minSendable : undefined,
    maxSendable: typeof meta.maxSendable === 'number' ? meta.maxSendable : undefined
  };
}
