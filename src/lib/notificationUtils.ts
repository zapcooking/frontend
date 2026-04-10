/**
 * Shared notification utilities.
 *
 * Consolidates helpers that were previously duplicated across
 * notificationStore.ts and notifications/+page.svelte.
 */

import { get } from 'svelte/store';
import { hellthreadThreshold } from '$lib/hellthreadFilterSettings';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Check if an event is a hellthread based on number of 'p' tags.
 * Used by both the notification subscription (store) and the page-level context fetcher.
 */
export function isHellthread(event: NDKEvent): boolean {
  const threshold = get(hellthreadThreshold);
  if (threshold === 0) return false; // Disabled

  if (!event.tags || !Array.isArray(event.tags)) return false;

  const mentionCount = event.tags.filter(
    (tag: string[]) => Array.isArray(tag) && tag[0] === 'p'
  ).length;
  return mentionCount >= threshold;
}

// --- Content cleaning ---

const MEDIA_URL_PATTERN =
  /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif|mp4|webm|mov|ogg)(?:\?[^\s]*)?/gi;

const MEDIA_HOST_PATTERN =
  /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth|v\.nostr\.build)[^\s]*/gi;

const BARE_BECH32_PATTERN =
  /\b(?:note1|nevent1|naddr1|npub1|nprofile1)[023456789ac-hj-np-z]{20,}\b/gi;

/**
 * Strip media URLs, image-host URLs, and bare bech32 identifiers from text.
 * Preserves nostr: URIs (they are handled by the display layer).
 */
export function stripMediaAndBech32(text: string): string {
  if (!text) return '';
  return text
    .replace(MEDIA_URL_PATTERN, '')
    .replace(MEDIA_HOST_PATTERN, '')
    .replace(BARE_BECH32_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compact formatting for the dropdown panel — replaces nostr: references
 * with human-readable placeholders. No async resolution.
 */
export function formatContentForPanel(content: string): string {
  if (!content) return '';
  return content
    .replace(/nostr:(npub1|nprofile1)[a-z0-9]+/gi, '@someone')
    .replace(/nostr:(nevent1|note1)[a-z0-9]+/gi, 'a post')
    .replace(/nostr:(naddr1)[a-z0-9]+/gi, 'a recipe')
    .replace(/\b(npub1|nprofile1)[a-z0-9]+\b/gi, '@someone')
    .replace(/\b(nevent1|note1)[a-z0-9]+\b/gi, 'a post')
    .replace(/\b(naddr1)[a-z0-9]+\b/gi, 'a recipe')
    .replace(/\s+/g, ' ')
    .trim();
}
