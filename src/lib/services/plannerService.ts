/**
 * Meal Planner Service
 *
 * Encrypted meal-plan storage on kind 30078 (NIP-78) with NIP-44
 * self-encryption, mirroring groceryService's skeleton with two
 * deliberate deviations per docs/mealplan-contract.md:
 *
 * - d-tags are deterministic (`mealplan-{isoWeek}`), so reads use exact
 *   multi-value `#d` filters instead of grocery's fetch-all-and-filter.
 * - NO plaintext recipe `a` tags on the event — coordinates live only
 *   inside the encrypted payload (privacy posture: a plaintext
 *   coordinate plus a week-stamped d-tag leaks what you're cooking).
 *
 * Decrypt failures are surfaced as distinguishable results, never as
 * "no plan" — the UI must be able to render "couldn't unlock this
 * week" (signer denials trip the shared decrypt circuit breaker).
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
import { dTagForWeek, weekIdFromDTag } from '$lib/mealplan/week';
import {
  serializeMealPlan,
  validateMealPlanPayload,
  type MealPlan
} from '$lib/mealplan/schema';

const MEALPLAN_KIND = 30078;
const FETCH_TIMEOUT_MS = 10000;

export type MealPlanFetchResult =
  | {
      status: 'ok';
      weekId: string;
      plan: MealPlan;
      /** schemaVersion > 1: render, never write back (contract rule 1). */
      readOnly: boolean;
      event: NDKEvent;
      encryptionMethod: EncryptionMethod;
    }
  | {
      status: 'decrypt-failed';
      weekId: string;
      event: NDKEvent;
      error: string;
    };

/**
 * Fetch and decrypt meal plans for a set of week ids.
 *
 * Returns a Map keyed by weekId. An absent key means no plan exists for
 * that week; a present key is either a decrypted plan or an explicit
 * decrypt failure.
 */
export async function fetchMealPlans(weekIds: string[]): Promise<Map<string, MealPlanFetchResult>> {
  const results = new Map<string, MealPlanFetchResult>();

  if (!browser || weekIds.length === 0) {
    return results;
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey || !ndkInstance) {
    console.warn('[PlannerService] Not logged in or NDK not available');
    return results;
  }

  await ndkReady;

  // Deterministic d-tags let us do exact multi-value #d matching —
  // no fetch-all-and-filter (relays can't prefix-match d-tags).
  const filter: NDKFilter = {
    kinds: [MEALPLAN_KIND],
    authors: [pubkey],
    '#d': weekIds.map(dTagForWeek)
  };

  try {
    const fetchPromise = ndkInstance.fetchEvents(filter, { closeOnEose: true });
    const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
      setTimeout(() => {
        console.log('[PlannerService] Fetch timed out, returning empty set');
        resolve(new Set());
      }, FETCH_TIMEOUT_MS);
    });

    const events = await Promise.race([fetchPromise, timeoutPromise]);

    // Replaceable events: relays can still hand back multiple versions
    // of the same d-tag — keep the newest per week.
    const newestByWeek = new Map<string, NDKEvent>();
    for (const event of events) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      const weekId = dTag ? weekIdFromDTag(dTag) : null;
      if (!weekId) continue;
      const existing = newestByWeek.get(weekId);
      if (existing && (existing.created_at || 0) >= (event.created_at || 0)) continue;
      newestByWeek.set(weekId, event);
    }

    for (const [weekId, event] of newestByWeek) {
      results.set(weekId, await decryptMealPlanEvent(weekId, event, pubkey));
    }

    return results;
  } catch (error) {
    console.error('[PlannerService] Failed to fetch meal plans:', error);
    throw error;
  }
}

/** Fetch a single week's plan. Null = no plan exists for that week. */
export async function fetchMealPlan(weekId: string): Promise<MealPlanFetchResult | null> {
  const results = await fetchMealPlans([weekId]);
  return results.get(weekId) || null;
}

async function decryptMealPlanEvent(
  weekId: string,
  event: NDKEvent,
  pubkey: string
): Promise<MealPlanFetchResult> {
  if (!event.content) {
    return { status: 'decrypt-failed', weekId, event, error: 'Event missing content' };
  }

  try {
    const method = detectEncryptionMethod(event.content);
    const plaintext = await decrypt(pubkey, event.content, method);
    const payload = JSON.parse(plaintext);

    const validated = validateMealPlanPayload(payload, weekId);
    if (!validated) {
      return { status: 'decrypt-failed', weekId, event, error: 'Malformed meal plan payload' };
    }

    return {
      status: 'ok',
      weekId,
      plan: validated.plan,
      readOnly: validated.readOnly,
      event,
      encryptionMethod: method
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PlannerService] Failed to decrypt/parse meal plan:', {
      message,
      weekId,
      hasContent: !!event.content,
      contentLength: event.content?.length || 0
    });
    return { status: 'decrypt-failed', weekId, event, error: message };
  }
}

/**
 * Save (create or replace) a week's meal plan.
 *
 * NIP-46 durability caveat applies (contract doc): remote signers may
 * produce ciphertext a later session cannot decrypt; matching grocery,
 * we write anyway.
 */
export async function saveMealPlan(plan: MealPlan): Promise<NDKEvent> {
  if (!browser) {
    throw new Error('Cannot save meal plan on server');
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
  const planToSave: MealPlan = {
    ...plan,
    updatedAt: now,
    createdAt: plan.createdAt || now
  };

  try {
    const { ciphertext } = await encrypt(pubkey, serializeMealPlan(planToSave), 'nip44');

    const event = new NDKEvent(ndkInstance);
    event.kind = MEALPLAN_KIND;
    event.content = ciphertext;
    // Contract: d + client tags ONLY — recipe coordinates stay inside
    // the encrypted payload.
    event.tags = [
      ['d', dTagForWeek(planToSave.week)],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];

    await event.sign();

    const writeRelays = await getOutboxRelays(pubkey);

    console.log(
      '[PlannerService] Publishing meal plan...',
      writeRelays.length > 0 ? `(${writeRelays.length} outbox relays)` : '(default relays)'
    );

    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await event.publish(relaySet);
    } else {
      await event.publish();
    }

    console.log('[PlannerService] Meal plan saved successfully');
    return event;
  } catch (error) {
    console.error('[PlannerService] Failed to save meal plan:', error);
    throw error;
  }
}

/** Delete a week's plan via NIP-09 (kind 5). */
export async function deleteMealPlan(weekId: string, eventId?: string): Promise<NDKEvent | null> {
  if (!browser) {
    return null;
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey || !ndkInstance?.signer) {
    throw new Error('Not logged in or no signer available');
  }

  await ndkReady;

  try {
    const deleteEvent = new NDKEvent(ndkInstance);
    deleteEvent.kind = 5;
    deleteEvent.content = 'Deleted meal plan';
    deleteEvent.tags = [['a', `${MEALPLAN_KIND}:${pubkey}:${dTagForWeek(weekId)}`]];
    if (eventId) {
      deleteEvent.tags.push(['e', eventId]);
    }

    await deleteEvent.sign();

    const writeRelays = await getOutboxRelays(pubkey);
    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await deleteEvent.publish(relaySet);
    } else {
      await deleteEvent.publish();
    }

    console.log('[PlannerService] Meal plan deleted:', weekId);
    return deleteEvent;
  } catch (error) {
    console.error('[PlannerService] Failed to delete meal plan:', error);
    throw error;
  }
}

export { createEmptyMealPlan } from '$lib/mealplan/schema';
export type { MealPlan } from '$lib/mealplan/schema';
