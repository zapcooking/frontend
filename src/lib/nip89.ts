/**
 * NIP-89 Client Tag Helper
 * 
 * Ensures all published events include a client tag identifying Zap Cooking
 * as the publishing client, allowing other Nostr clients to show "via Zap Cooking"
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { CLIENT_TAG_IDENTIFIER } from './consts';

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
  // Get current tags (may be empty array initially)
  const currentTags = event.tags || [];
  
  // Ensure client tag is present
  event.tags = ensureClientTag([...currentTags]);
  
  return event;
}

