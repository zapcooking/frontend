/**
 * NIP-89 Client Tag Helper
 * 
 * Ensures all published events include a client tag identifying Zap Cooking
 * as the publishing client, allowing other Nostr clients to show "via Zap Cooking"
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { CLIENT_TAG_IDENTIFIER } from './consts';
import { ORG_PUBKEY } from './landing/curation';

/** The `d` tag of Zap Cooking's kind-31990 handler event. */
export const HANDLER_D = 'zap-cooking';

/**
 * Zap Cooking's NIP-89 handler, published once by the org account (see
 * nip89Headlight.ts). Every event we publish points here, whoever signs
 * it: the address names the app, never the author, so an anonymous post
 * carries nothing that links it to the user's account.
 */
export const ZAP_COOKING_HANDLER_ADDRESS = `31990:${ORG_PUBKEY}:${HANDLER_D}`;

/**
 * Ensures a client tag array has the correct identifier
 * @param tags - Array of tag arrays
 * @returns Tags array with client tag added/updated if needed
 */
export function ensureClientTag(tags: string[][]): string[][] {
  // Check if client tag already exists
  const clientTagIndex = tags.findIndex(tag => tag.length > 0 && tag[0] === 'client');
  
  if (clientTagIndex >= 0) {
    // Client tag exists - ensure it has a value
    const existingTag = tags[clientTagIndex];
    if (existingTag.length < 2 || !existingTag[1]) {
      // Empty or missing value - update it
      tags[clientTagIndex] = ['client', CLIENT_TAG_IDENTIFIER];
    }
    // If it already has a value, leave it as-is (don't override)
  } else {
    // No client tag exists - append it at the end
    tags.push(['client', CLIENT_TAG_IDENTIFIER]);
  }
  
  return tags;
}

/**
 * Adds or ensures the client tag is present on an NDKEvent
 * @param event - The NDKEvent to add the client tag to
 * @returns The same event with client tag ensured
 */
export function addClientTagToEvent(event: NDKEvent): NDKEvent {
  const currentTags = event.tags || [];

  const idx = currentTags.findIndex((tag) => tag.length > 0 && tag[0] === 'client');
  let clientTag: string[];
  if (idx >= 0) {
    clientTag = [...currentTags[idx]];
    if (clientTag.length < 2 || !clientTag[1]) clientTag[1] = CLIENT_TAG_IDENTIFIER;
  } else {
    clientTag = ['client', CLIENT_TAG_IDENTIFIER];
  }
  // Full NIP-89 form: attach our handler address so clients can resolve the
  // kind-31990 headlight (logo, name, open-in action) and brand the embed.
  // Only on our own tag: another client's tag (kept as-is, e.g. a list
  // republished from elsewhere) must not point at our handler.
  if (clientTag[1] === CLIENT_TAG_IDENTIFIER && clientTag.length < 3) clientTag.push(ZAP_COOKING_HANDLER_ADDRESS);

  const next = [...currentTags];
  if (idx >= 0) next[idx] = clientTag;
  else next.push(clientTag);

  event.tags = next;
  return event;
}

