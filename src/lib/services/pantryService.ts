/**
 * Pantry Service
 *
 * Encrypted pantry storage on kind 30078 (NIP-78) with NIP-44
 * self-encryption. Independent of grocery lists and the frozen meal-plan
 * schema. One replaceable event per user (`d` = `pantry`).
 *
 * Ingredient names live only inside the encrypted payload — never as
 * plaintext tags.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { ndk, userPublickey, ndkReady } from '$lib/nostr';
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import {
  encrypt,
  decrypt,
  detectEncryptionMethod,
  type EncryptionMethod
} from '$lib/encryptionService';
import { getOutboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';
import {
  PANTRY_D_TAG,
  PANTRY_KIND,
  createEmptyPantry,
  serializePantry,
  validatePantryPayload,
  type Pantry
} from '$lib/pantry/schema';

const FETCH_TIMEOUT_MS = 10000;

export type PantryFetchResult =
  | {
      status: 'ok';
      pantry: Pantry;
      readOnly: boolean;
      event: NDKEvent;
      encryptionMethod: EncryptionMethod;
    }
  | {
      status: 'decrypt-failed';
      event: NDKEvent;
      error: string;
    }
  | {
      status: 'empty';
    };

export async function fetchPantry(): Promise<PantryFetchResult> {
  if (!browser) {
    return { status: 'empty' };
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey || !ndkInstance) {
    console.warn('[PantryService] Not logged in or NDK not available');
    return { status: 'empty' };
  }

  await ndkReady;

  const filter: NDKFilter = {
    kinds: [PANTRY_KIND],
    authors: [pubkey],
    '#d': [PANTRY_D_TAG]
  };

  try {
    const fetchPromise = ndkInstance.fetchEvents(filter, { closeOnEose: true });
    const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
      setTimeout(() => {
        console.log('[PantryService] Fetch timed out, returning empty set');
        resolve(new Set());
      }, FETCH_TIMEOUT_MS);
    });

    const events = await Promise.race([fetchPromise, timeoutPromise]);
    if (events.size === 0) return { status: 'empty' };

    let newest: NDKEvent | null = null;
    for (const event of events) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag !== PANTRY_D_TAG) continue;
      if (!newest || (event.created_at || 0) > (newest.created_at || 0)) {
        newest = event;
      }
    }

    if (!newest) return { status: 'empty' };
    return decryptPantryEvent(newest, pubkey);
  } catch (error) {
    console.error('[PantryService] Failed to fetch pantry:', error);
    throw error;
  }
}

async function decryptPantryEvent(event: NDKEvent, pubkey: string): Promise<PantryFetchResult> {
  if (!event.content) {
    return { status: 'decrypt-failed', event, error: 'Event missing content' };
  }

  try {
    const method = detectEncryptionMethod(event.content);
    const plaintext = await decrypt(pubkey, event.content, method);
    const payload = JSON.parse(plaintext);
    const validated = validatePantryPayload(payload);
    if (!validated) {
      return { status: 'decrypt-failed', event, error: 'Malformed pantry payload' };
    }
    return {
      status: 'ok',
      pantry: validated.pantry,
      readOnly: validated.readOnly,
      event,
      encryptionMethod: method
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PantryService] Failed to decrypt/parse pantry:', {
      message,
      hasContent: !!event.content,
      contentLength: event.content?.length || 0
    });
    return { status: 'decrypt-failed', event, error: message };
  }
}

export async function savePantry(pantry: Pantry): Promise<NDKEvent> {
  if (!browser) {
    throw new Error('Cannot save pantry on server');
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey) {
    throw new Error('Not logged in');
  }
  if (!ndkInstance?.signer) {
    throw new Error('No signer available. Please log in again.');
  }

  await ndkReady;

  const now = Math.floor(Date.now() / 1000);
  const pantryToSave: Pantry = {
    ...pantry,
    updatedAt: now,
    createdAt: pantry.createdAt || now
  };

  try {
    const { ciphertext } = await encrypt(pubkey, serializePantry(pantryToSave), 'nip44');
    const event = new NDKEvent(ndkInstance);
    event.kind = PANTRY_KIND;
    event.content = ciphertext;
    event.tags = [
      ['d', PANTRY_D_TAG],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];

    await event.sign();

    const writeRelays = await getOutboxRelays(pubkey);
    console.log(
      '[PantryService] Publishing pantry...',
      writeRelays.length > 0 ? `(${writeRelays.length} outbox relays)` : '(default relays)'
    );

    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await event.publish(relaySet);
    } else {
      await event.publish();
    }

    console.log('[PantryService] Pantry saved successfully');
    return event;
  } catch (error) {
    console.error('[PantryService] Failed to save pantry:', error);
    throw error;
  }
}

export { createEmptyPantry };
export type { Pantry };
