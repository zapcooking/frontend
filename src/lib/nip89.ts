/**
 * NIP-89 Client Tag Helper
 * 
 * Ensures all published events include a client tag identifying Zap Cooking
 * as the publishing client, allowing other Nostr clients to show "via Zap Cooking"
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { CLIENT_TAG_IDENTIFIER } from './consts';

/**
 * The logged-in user's pubkey, read straight from localStorage so this
 * module stays importable from non-browser bundles. The handler address in
 * the client tag points at the headlight the SAME user publishes at login
 * (see nip89Headlight.ts) — self-consistent per author.
 */
function loggedInPubkey(): string | null {
  try {
    return localStorage.getItem('nostrcooking_loggedInPublicKey');
  } catch {
    return null;
  }
}

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
  const pubkey = event.pubkey || loggedInPubkey() || '';
  const handlerAddress = pubkey ? `31990:${pubkey}:zap-cooking` : '';

  const idx = currentTags.findIndex((tag) => tag.length > 0 && tag[0] === 'client');
  let clientTag: string[];
  if (idx >= 0) {
    clientTag = [...currentTags[idx]];
    if (clientTag.length < 2 || !clientTag[1]) clientTag[1] = CLIENT_TAG_IDENTIFIER;
  } else {
    clientTag = ['client', CLIENT_TAG_IDENTIFIER];
  }
  // Full NIP-89 form: attach the handler address so clients can resolve our
  // kind-31990 headlight (logo, name, web action) and brand the embed.
  if (handlerAddress && clientTag.length < 3) clientTag.push(handlerAddress);

  const next = [...currentTags];
  if (idx >= 0) next[idx] = clientTag;
  else next.push(clientTag);

  event.tags = next;
  return event;
}

