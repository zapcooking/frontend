/**
 * Server half of theme unlocks ($lib/themeUnlocks): find the user's zap
 * receipts to the Zap Cooking profile on public relays, resolve the LNURL
 * provider that must have signed them, and remember verified unlocks.
 *
 * Verified unlocks are written to KV so an unlock stays permanent even if the
 * profile later moves to a different lightning address (whose provider would
 * not have signed the old receipts) or a relay drops old receipts.
 */
import { standardRelays } from '$lib/consts';
import { ORG_PUBKEY } from '$lib/landing/curation';
import { themesUnlockedByReceipts } from '$lib/themeUnlocks';
import { nip19 } from 'nostr-tools';

type Filter = Record<string, unknown>;
type RawEvent = { id: string; kind: number; pubkey: string; tags: string[][]; content: string; created_at: number; sig: string };

export type UnlockKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

/** Collect events for one filter from one relay until EOSE or the timeout. */
function queryRelay(url: string, filter: Filter, timeoutMs = 5000): Promise<RawEvent[]> {
  return new Promise((resolve) => {
    const events: RawEvent[] = [];
    const sub = `thm_${Math.random().toString(36).slice(2, 10)}`;
    let ws: WebSocket | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      ws = new WebSocket(url);
      ws.addEventListener('open', () => ws?.send(JSON.stringify(['REQ', sub, filter])));
      ws.addEventListener('message', (msg) => {
        try {
          const data = JSON.parse(String(msg.data));
          if (data[1] !== sub) return;
          if (data[0] === 'EVENT' && data[2]) events.push(data[2]);
          else if (data[0] === 'EOSE' || data[0] === 'CLOSED') finish();
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.addEventListener('error', finish);
      ws.addEventListener('close', finish);
    } catch {
      finish();
    }
  });
}

/** Query several relays in parallel and merge the results by id. */
async function queryRelays(filter: Filter, relays: readonly string[] = standardRelays): Promise<RawEvent[]> {
  const batches = await Promise.all(relays.map((url) => queryRelay(url, filter)));
  const byId = new Map<string, RawEvent>();
  for (const event of batches.flat()) if (event?.id) byId.set(event.id, event);
  return [...byId.values()];
}

let providerCache: { pubkey: string; at: number } | null = null;
const PROVIDER_TTL_MS = 10 * 60 * 1000;

/**
 * `nostrPubkey` of the LNURL provider behind the Zap Cooking profile's current
 * lightning address. Read from the profile itself, so only that profile can
 * change where unlock zaps go.
 */
export async function resolveProviderPubkey(fetcher: typeof fetch = fetch): Promise<string | null> {
  if (providerCache && Date.now() - providerCache.at < PROVIDER_TTL_MS) return providerCache.pubkey;
  const profiles = await queryRelays({ kinds: [0], authors: [ORG_PUBKEY], limit: 1 });
  const latest = profiles.sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest) return null;
  let lud16: string | undefined;
  try {
    lud16 = JSON.parse(latest.content)?.lud16;
  } catch {
    return null;
  }
  const match = typeof lud16 === 'string' ? lud16.trim().match(/^([^@\s]+)@([a-z0-9.-]+)$/i) : null;
  if (!match) return null;
  const res = await fetcher(`https://${match[2]}/.well-known/lnurlp/${encodeURIComponent(match[1])}`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { allowsNostr?: boolean; nostrPubkey?: string };
  const pubkey = body?.allowsNostr && typeof body.nostrPubkey === 'string' ? body.nostrPubkey : null;
  if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) {
    providerCache = { pubkey, at: Date.now() };
    return pubkey;
  }
  return null;
}

const kvKey = (pubkey: string) => `theme_unlocks:${pubkey}`;

/**
 * Local-only founder allowlist: `THEME_UNLOCK_LOCAL_ADMINS` holds comma-
 * separated npubs (or plain hex) that get every theme without the pantry
 * check. The caller only consults this in dev, so it can never apply in
 * production; malformed tokens are skipped rather than fatal.
 */
export function localAllowlistPubkeys(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const token of raw.split(',')) {
    const value = token.trim();
    if (!value) continue;
    if (/^[0-9a-fA-F]{64}$/.test(value)) {
      out.add(value.toLowerCase());
      continue;
    }
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === 'npub' && /^[0-9a-f]{64}$/.test(decoded.data)) out.add(decoded.data);
    } catch {
      // Not an npub either — skip it and keep parsing the rest.
    }
  }
  return out;
}

/** Unlocks already verified and saved for the pubkey. */
export async function readSavedUnlocks(kv: UnlockKV | undefined, pubkey: string): Promise<string[]> {
  if (!kv) return [];
  try {
    const saved = await kv.get(kvKey(pubkey), 'json');
    return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Merge newly verified unlocks into the saved set; returns the merged set. */
export async function saveUnlocks(
  kv: UnlockKV | undefined,
  pubkey: string,
  saved: string[],
  verified: string[]
): Promise<string[]> {
  const merged = [...new Set([...saved, ...verified])];
  if (kv && merged.length > saved.length) {
    try {
      await kv.put(kvKey(pubkey), JSON.stringify(merged));
    } catch (err) {
      console.warn('[theme-unlocks] could not save unlocks', err);
    }
  }
  return merged;
}

/**
 * Verify receipts: either the ones passed in (found by the client on its own
 * relays right after paying) or the user's receipts on the public relays.
 */
export async function verifiedUnlocks(
  pubkey: string,
  provided?: readonly unknown[]
): Promise<string[]> {
  const providerPubkey = await resolveProviderPubkey();
  if (!providerPubkey) return [];
  const receipts =
    provided ??
    (await queryRelays({ kinds: [9735], '#p': [ORG_PUBKEY], '#P': [pubkey], limit: 500 }));
  return themesUnlockedByReceipts(receipts, { userPubkey: pubkey, orgPubkey: ORG_PUBKEY, providerPubkey });
}
