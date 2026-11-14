/**
 * The host's "Hide" on a comment in their stream's chat.
 *
 * 1. Adds the author to the host's PUBLIC live-chat hidden list, which
 *    every viewer reads (see ./chatHidden). Refuses rather than publish
 *    over a list it could not read.
 * 2. Mutes them in the host's own (private) mute list, as a mute anywhere
 *    else in the app would. Best effort: the public list is what viewers
 *    need.
 */
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type { SimplePool } from 'nostr-tools/pool';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { outboxRelaySet } from '$lib/outboxPublish';
import { setPubkeyMuted } from '$lib/muteToggle';
import { addClientTagToEvent } from '$lib/nip89';
import { addHiddenTags, fetchLiveHiddenListStrict, LIVE_HIDDEN_KIND } from './chatHidden';

export async function hideFromLiveChat(opts: {
  host: string;
  pubkey: string;
  pool: SimplePool;
  relays: string[];
}): Promise<void> {
  const { host, pubkey, pool, relays } = opts;
  const ndkInstance = get(ndk);
  if (!ndkInstance) throw new Error('not ready');

  const current = await fetchLiveHiddenListStrict(pool, relays, host);
  if (current === 'unavailable') throw new Error('Hidden list not reachable; not overwriting it');
  const tags = addHiddenTags(current?.tags ?? null, pubkey);
  if (tags) {
    const event = new NDKEvent(ndkInstance);
    event.kind = LIVE_HIDDEN_KIND;
    event.content = current?.content ?? '';
    event.tags = tags;
    addClientTagToEvent(event);
    await event.sign();
    const outbox = await outboxRelaySet(event, 'list');
    const urls = [...new Set([...(outbox ? [...outbox.relayUrls] : []), ...relays])];
    await event.publish(NDKRelaySet.fromRelayUrls(urls, ndkInstance, true));
  }

  try {
    await setPubkeyMuted(host, pubkey, true);
  } catch {
    // Private mute failed (relays): the public hidden list already hides
    // them from every viewer of the stream.
  }
}
