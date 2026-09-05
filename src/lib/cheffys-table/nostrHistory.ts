import { get } from 'svelte/store';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { ndk, ndkReady, userPublickey } from '$lib/nostr';
import { encrypt, decrypt } from '$lib/encryptionService';
import { getOutboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';
import { HISTORY_LIMIT, parseRun, type HistoryTransport } from './history';

const APP = 'cheffys-table-v1';
const KIND = 30078;
async function account(owner: string) {
  const client = get(ndk);
  const signer = client?.signer;
  if (!owner || get(userPublickey) !== owner || !signer || (await signer.user()).pubkey !== owner)
    throw new Error('Sign in with this Nostr identity to sync.');
  if (get(userPublickey) !== owner || client.signer !== signer) throw new Error('Account changed.');
  return client;
}
export const nostrHistory: HistoryTransport = {
  owner: () => get(userPublickey) || '',
  async publish(owner, run) {
    await ndkReady;
    const client = await account(owner);
    const encrypted = await encrypt(owner, JSON.stringify(run), 'nip44');
    await account(owner);
    const event = new NDKEvent(client);
    event.kind = KIND;
    event.pubkey = owner;
    event.content = encrypted.ciphertext;
    event.tags = [
      ['d', `${APP}:${run.id}`],
      ['t', APP],
      ['encryption', encrypted.method!],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];
    // Deterministic replaceable address makes retries idempotent without overwriting other runs.
    await event.sign();
    await account(owner);
    if (event.pubkey !== owner) throw new Error('Signer identity changed.');
    const relays = await getOutboxRelays(owner);
    await account(owner);
    const acknowledged = await event.publish(
      relays.length ? NDKRelaySet.fromRelayUrls(relays, client) : undefined,
      10000
    );
    if (!acknowledged.size) throw new Error('No relay acknowledged the service.');
  },
  async load(owner) {
    await ndkReady;
    const client = await account(owner);
    const relays = await getOutboxRelays(owner);
    await account(owner);
    // Explicit subscription cleanup on EOSE or timeout; never leave a background listener running.
    const events = await new Promise<NDKEvent[]>((resolve, reject) => {
      const found = new Map<string, NDKEvent>();
      const subscription = client.subscribe(
        { kinds: [KIND], authors: [owner], '#t': [APP], limit: HISTORY_LIMIT },
        { closeOnEose: true, groupable: false },
        relays.length ? NDKRelaySet.fromRelayUrls(relays, client) : undefined,
        false
      );
      const finish = () => {
        clearTimeout(timer);
        subscription.stop();
        resolve([...found.values()]);
      };
      const timer = setTimeout(() => {
        subscription.stop();
        if (found.size) resolve([...found.values()]);
        else reject(new Error('History relays did not respond in time.'));
      }, 10000);
      subscription.on('event', (event) => {
        if (
          event.pubkey === owner &&
          event.kind === KIND &&
          event.content.length < 20000 &&
          found.size < HISTORY_LIMIT
        )
          found.set(event.id, event);
      });
      subscription.on('eose', finish);
      try {
        subscription.start();
      } catch (error) {
        clearTimeout(timer);
        subscription.stop();
        reject(error);
      }
    });
    const runs = [];
    for (const event of events) {
      await account(owner);
      if (!event.tags.some((t) => t[0] === 'd' && t[1]?.startsWith(`${APP}:`))) continue;
      const method = event.tags.find((t) => t[0] === 'encryption')?.[1];
      if (method !== 'nip44' && method !== 'nip04') continue;
      // Signer denial must stop the batch instead of repeatedly prompting.
      const plaintext = await decrypt(owner, event.content, method);
      await account(owner);
      let value: unknown;
      try {
        value = JSON.parse(plaintext);
      } catch {
        continue;
      }
      const run = parseRun(value);
      if (run && event.tags.some((t) => t[0] === 'd' && t[1] === `${APP}:${run.id}`))
        runs.push(run);
    }
    return runs;
  }
};
