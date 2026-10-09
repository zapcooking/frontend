import { outboxRelaySet } from '$lib/outboxPublish';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKSubscriptionCacheUsage, type NDKRelaySet } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { buildPoolRelaySet } from '$lib/eventFetch';
import { decrypt, detectEncryptionMethod, encrypt } from '$lib/encryptionService';
import { muteListStore } from '$lib/muteListStore';
import { addPubkeyMute, removePubkeyMute, type MuteListContent } from '$lib/muteListEdit';

/**
 * Mute / unmute one pubkey from a profile surface (ProfileSheet, /user/[slug])
 * without touching the rest of the member's NIP-51 mute list.
 *
 * The edit starts from the latest relay copy — never from the in-memory
 * store, which merges legacy localStorage mutes and decrypted private
 * mutes — and only publishes when the relay copy was either found or
 * confirmed absent. A fetch that can't tell (no relays, timeout with no
 * EOSE) aborts: publishing then would overwrite the real list.
 */

export type MuteListFetch =
  | { status: 'found'; event: NDKEvent }
  | { status: 'absent' }
  | { status: 'unavailable' };

const FETCH_TIMEOUT_MS = 8_000;
/**
 * NDK reports EOSE once about half the pool has answered (plus up to a
 * second), and with closeOnEose the subscription is gone before a slower
 * relay sends the list. An empty EOSE therefore waits this long for a late
 * copy before it counts as "absent" — the store caches an absence for
 * minutes, and a reader's mutes were silently missing when purplepag.es and
 * nostr.wine (no copy) answered before nos.lol and primal (the copy).
 */
export const EOSE_GRACE_MS = 1_500;

/**
 * Fetch the newest kind 10000 for `pubkey`, distinguishing a confirmed
 * absence (a relay sent EOSE with nothing) from an unavailable result.
 * Uses the explicit pool relay set (outbox routing can send an
 * author-filtered REQ nowhere — see $lib/eventFetch) and skips the
 * local cache so a stale copy can't end the query early.
 */
export function fetchMuteListStrict(
  ndkInstance: NDK,
  pubkey: string,
  opts: { relaySet?: NDKRelaySet; timeoutMs?: number; graceMs?: number } = {}
): Promise<MuteListFetch> {
  const relaySet = opts.relaySet ?? buildPoolRelaySet(ndkInstance);
  if (!relaySet) return Promise.resolve({ status: 'unavailable' });

  return new Promise((resolve) => {
    let newest: NDKEvent | null = null;
    let settled = false;
    const sub = ndkInstance.subscribe(
      { kinds: [10000], authors: [pubkey] },
      // Not closeOnEose: `finish` stops it, after the grace below.
      { closeOnEose: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY },
      relaySet
    );
    const finish = (result: MuteListFetch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.stop();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish(newest ? { status: 'found', event: newest } : { status: 'unavailable' }),
      opts.timeoutMs ?? FETCH_TIMEOUT_MS
    );
    sub.on('event', (event: NDKEvent) => {
      if (event.pubkey !== pubkey || event.kind !== 10000) return;
      if (!newest || (event.created_at ?? 0) > (newest.created_at ?? 0)) newest = event;
    });
    // NDK only emits eose after at least one relay actually sent EOSE.
    sub.on('eose', () => {
      if (newest) return finish({ status: 'found', event: newest });
      setTimeout(
        () => finish(newest ? { status: 'found', event: newest } : { status: 'absent' }),
        opts.graceMs ?? EOSE_GRACE_MS
      );
    });
  });
}

/**
 * Compute the list to publish for a single-pubkey mute change, or null when
 * nothing changes. Throws when the relay copy is unavailable.
 */
export async function planPubkeyMute(
  fetched: MuteListFetch,
  hex: string,
  mute: boolean,
  crypto: Parameters<typeof removePubkeyMute>[2]
): Promise<MuteListContent | null> {
  if (fetched.status === 'unavailable') {
    throw new Error('Mute list not reachable on relays; not overwriting it');
  }
  const existing =
    fetched.status === 'found'
      ? { tags: fetched.event.tags, content: fetched.event.content ?? '' }
      : null;
  return mute ? addPubkeyMute(existing, hex) : removePubkeyMute(existing, hex, crypto);
}

function readLocalMutes(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem('mutedUsers') || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

/** Mute or unmute `hex` for `me`. Throws (without publishing) on failure. */
export async function setPubkeyMuted(me: string, hex: string, mute: boolean): Promise<void> {
  const ndkInstance = get(ndk);
  const fetched = await fetchMuteListStrict(ndkInstance, me);
  const edited = await planPubkeyMute(fetched, hex, mute, {
    decrypt: (ciphertext) => decrypt(me, ciphertext, detectEncryptionMethod(ciphertext)),
    encrypt: async (plaintext) => (await encrypt(me, plaintext)).ciphertext
  });

  if (edited) {
    const muteEvent = new NDKEvent(ndkInstance);
    muteEvent.kind = 10000;
    muteEvent.content = edited.content;
    muteEvent.tags = edited.tags;
    await muteEvent.publish(await outboxRelaySet(muteEvent, 'list'));
  }

  try {
    const stored = readLocalMutes();
    const next = mute ? [...new Set([...stored, hex])] : stored.filter((pk) => pk !== hex);
    localStorage.setItem('mutedUsers', JSON.stringify(next));
  } catch {
    // Private mode or a full quota — the relay copy still stands.
  }
  muteListStore.invalidate();
  await muteListStore.load(true);
}
