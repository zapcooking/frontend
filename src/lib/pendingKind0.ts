/**
 * A new account's first profile (kind 0) that no relay has accepted yet.
 *
 * Signup never blocks on it: the member is signed in, the profile is in
 * the local cache (their name shows), and the signed event is kept here and
 * republished in the background with backoff until at least one relay
 * accepts it. It survives a reload (the layout resumes it on sign-in) and
 * stops when the member signs out or switches account, or when a newer
 * profile edit reached a relay first (updateOwnKind0 clears it — an older
 * signup profile must never be republished over a newer one).
 */
import { browser } from '$app/environment';

export const PENDING_KIND0_KEY = 'zapcooking_pending_kind0';

/** 5 s, 15 s, 45 s, 2 min, then every 5 min. */
export const KIND0_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export interface SignedKind0 {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function retryDelay(attempt: number): number {
  const delays = KIND0_RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)];
}

function storage(): Storage | null {
  if (!browser) return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function savePendingKind0(event: SignedKind0): void {
  try {
    storage()?.setItem(PENDING_KIND0_KEY, JSON.stringify(event));
  } catch {
    // Storage full or blocked: the in-session retry still runs.
  }
}

export function pendingKind0For(pubkey: string): SignedKind0 | null {
  try {
    const raw = storage()?.getItem(PENDING_KIND0_KEY);
    if (!raw) return null;
    const event = JSON.parse(raw) as SignedKind0;
    return event?.kind === 0 && event.pubkey === pubkey && typeof event.sig === 'string'
      ? event
      : null;
  } catch {
    return null;
  }
}

/** Drop the pending profile (only this account's, when a pubkey is given). */
export function clearPendingKind0(pubkey?: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (pubkey && !pendingKind0For(pubkey)) return;
    s.removeItem(PENDING_KIND0_KEY);
  } catch {
    // ignore
  }
}

export interface RetryDeps {
  /** Republish the signed event; how many relays accepted it (0 on failure). */
  publish: (event: SignedKind0) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  /** Still the signed-in account this profile belongs to. */
  isCurrent: () => boolean;
}

export type RetryOutcome = 'published' | 'superseded' | 'stopped';

/** Republish with backoff until a relay accepts it, it's superseded, or the session moves on. */
export async function retryPendingKind0(pubkey: string, deps: RetryDeps): Promise<RetryOutcome> {
  for (let attempt = 0; ; attempt++) {
    await deps.sleep(retryDelay(attempt));
    if (!deps.isCurrent()) return 'stopped';
    const pending = pendingKind0For(pubkey);
    if (!pending) return 'superseded';
    let accepted = 0;
    try {
      accepted = await deps.publish(pending);
    } catch {
      accepted = 0;
    }
    if (accepted > 0) {
      clearPendingKind0(pubkey);
      return 'published';
    }
  }
}

/**
 * Show a still-pending profile locally: it isn't on any relay yet, and the
 * profile cache is in memory, so after a reload nothing else would know
 * the member's name. Called on load, before any session settles (the
 * locked-vault "Continue as" chip reads it too).
 */
export async function seedPendingKind0Locally(): Promise<void> {
  let event: SignedKind0 | null = null;
  try {
    const raw = storage()?.getItem(PENDING_KIND0_KEY);
    event = raw ? (JSON.parse(raw) as SignedKind0) : null;
  } catch {
    event = null;
  }
  if (!event || event.kind !== 0 || typeof event.pubkey !== 'string') return;
  const [{ NDKEvent }, { ingestProfileEvent }] = await Promise.all([
    import('@nostr-dev-kit/ndk'),
    import('$lib/profileResolver')
  ]);
  ingestProfileEvent(event.pubkey, new NDKEvent(undefined, event));
}

const running = new Set<string>();

/**
 * Start (once per account per page) the background retry for a pending
 * profile, if there is one. Safe to call on every sign-in.
 */
export function startPendingKind0Retry(pubkey: string): void {
  if (!browser || !pubkey || running.has(pubkey) || !pendingKind0For(pubkey)) return;
  running.add(pubkey);
  void (async () => {
    try {
      const [{ ndk, userPublickey, getCurrentRelays }, { get }, { NDKEvent }, { publishSignedKind0 }] =
        await Promise.all([
          import('$lib/nostr'),
          import('svelte/store'),
          import('@nostr-dev-kit/ndk'),
          import('$lib/ownKind0')
        ]);
      const outcome = await retryPendingKind0(pubkey, {
        publish: async (event) => {
          const instance = get(ndk);
          if (!instance) return 0;
          return publishSignedKind0(instance, new NDKEvent(instance, event), getCurrentRelays());
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        isCurrent: () => get(userPublickey) === pubkey
      });
      console.log('[pendingKind0] profile retry ended:', outcome);
    } catch (error) {
      console.warn('[pendingKind0] profile retry failed to start:', error);
    } finally {
      running.delete(pubkey);
    }
  })();
}
