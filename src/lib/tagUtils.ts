import {
  recipeTags,
  type recipeTagSimple,
  TAG_ALIASES,
  RECIPE_TAGS,
  RECIPE_TAG_PREFIX_NEW,
  RECIPE_TAG_PREFIX_LEGACY
} from './consts';
import { ndk } from './nostr';
import { get } from 'svelte/store';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { markOnce } from './perf/explorePerf';

/**
 * Normalize a tag name using aliases
 */
export function normalizeTag(tag: string): string {
  const normalized = tag.trim();
  // Check if there's an alias for this tag
  if (TAG_ALIASES[normalized]) {
    return TAG_ALIASES[normalized];
  }
  return normalized;
}

/**
 * Filter tags based on a search query
 */
export function filterTags(query: string, tags: recipeTagSimple[] = recipeTags): recipeTagSimple[] {
  if (!query || query.trim() === '') {
    return tags;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return tags.filter((tag) => {
    const normalizedTitle = normalizeTag(tag.title).toLowerCase();
    return normalizedTitle.includes(normalizedQuery);
  });
}

/**
 * Get tag with count (for display purposes)
 */
export type TagWithCount = recipeTagSimple & {
  count?: number;
};

/**
 * Compute popular tags (top 8) based on recipe usage
 * Falls back to a default list if usage data isn't available
 */
export async function computePopularTags(limit: number = 8): Promise<TagWithCount[]> {
  // Default popular tags as fallback
  const defaultPopular: string[] = [
    'Easy',
    'Quick',
    'Breakfast',
    'Italian',
    'Mexican',
    'Chicken',
    'Dessert',
    'Asian'
  ];

  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      console.warn('NDK not available, using default popular tags');
      return getTagsWithCounts(defaultPopular);
    }

    // Fetch recent recipes to count tag usage (support both legacy and new tags)
    const filter: NDKFilter = {
      limit: 1000, // Get a good sample
      kinds: [30023],
      '#t': RECIPE_TAGS
    };

    const tagCounts = new Map<string, number>();
    let eventCount = 0;

    return new Promise((resolve) => {
      const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });
      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(getPopularTagsFromCounts(tagCounts, defaultPopular, limit));
      }, 5000); // 5 second timeout

      subscription.on('event', (event) => {
        // t3_explore_first_live_event_received: When the Explore page receives the first Nostr event
        if (eventCount === 0) {
          markOnce('t3_explore_first_live_event_received');
        }
        eventCount++;
        // Extract tags from the event (support both legacy and new prefixes)
        const tags = event.tags.filter(
          (t) =>
            Array.isArray(t) &&
            t[0] === 't' &&
            (t[1]?.startsWith(`${RECIPE_TAG_PREFIX_LEGACY}-`) ||
              t[1]?.startsWith(`${RECIPE_TAG_PREFIX_NEW}-`))
        );

        tags.forEach((tag) => {
          if (Array.isArray(tag) && tag[1]) {
            // Remove either prefix
            const tagName = tag[1]
              .replace(`${RECIPE_TAG_PREFIX_NEW}-`, '')
              .replace(`${RECIPE_TAG_PREFIX_LEGACY}-`, '')
              .replace(/-/g, ' ');
            // Convert back to title case for matching
            const normalizedTag = normalizeTag(
              tagName
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ')
            );

            if (normalizedTag) {
              tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
            }
          }
        });
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        subscription.stop();
        resolve(getPopularTagsFromCounts(tagCounts, defaultPopular, limit));
      });
    });
  } catch (error) {
    console.error('Error computing popular tags:', error);
    return getTagsWithCounts(defaultPopular);
  }
}

/**
 * Get popular tags from counts map
 */
function getPopularTagsFromCounts(
  tagCounts: Map<string, number>,
  fallback: string[],
  limit: number
): TagWithCount[] {
  if (tagCounts.size === 0) {
    return getTagsWithCounts(fallback.slice(0, limit));
  }

  // Sort by count and get top tags
  const sorted = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));

  // Get tag objects with counts
  const result: TagWithCount[] = [];
  for (const { tag, count } of sorted) {
    const tagObj = recipeTags.find(
      (t) => normalizeTag(t.title).toLowerCase() === normalizeTag(tag).toLowerCase()
    );
    if (tagObj) {
      result.push({ ...tagObj, count });
    }
  }

  // Fill remaining slots with fallback if needed
  if (result.length < limit) {
    const usedTags = new Set(result.map((t) => t.title));
    for (const fallbackTag of fallback) {
      if (result.length >= limit) break;
      if (!usedTags.has(fallbackTag)) {
        const tagObj = recipeTags.find((t) => t.title === fallbackTag);
        if (tagObj) {
          result.push(tagObj);
        }
      }
    }
  }

  return result.slice(0, limit);
}

/**
 * Get tag objects with optional counts from tag names
 */
function getTagsWithCounts(tagNames: string[]): TagWithCount[] {
  return tagNames
    .map((name) => recipeTags.find((t) => t.title === name))
    .filter((tag): tag is recipeTagSimple => tag !== undefined)
    .map((tag) => ({ ...tag }));
}

/**
 * Get tag object by name
 */
export function getTagByName(name: string): recipeTagSimple | undefined {
  const normalized = normalizeTag(name);
  return recipeTags.find((t) => normalizeTag(t.title).toLowerCase() === normalized.toLowerCase());
}

/**
 * Generate NIP-22 compliant tags for commenting on longform content (kind 30023)
 * Returns an array of tags following the NIP-22 structure with both root and parent scope.
 *
 * @param event - The longform event (kind 30023) being commented on
 * @param parentEvent - Optional parent comment if this is a nested reply
 * @returns Array of tag tuples ready to be assigned to an NDKEvent
 */
export function buildNip22CommentTags(
  event: { kind: number; pubkey: string; id: string; tags: string[][] },
  parentEvent?: { id: string; pubkey: string; tags: string[][] }
): string[][] {
  // Only apply NIP-22 structure for longform content (kind 30023)
  if (event.kind !== 30023) {
    // For non-longform content, use standard NIP-10 structure
    if (parentEvent) {
      // Reply to a comment
      return [
        ['e', event.id, '', 'root'],
        ['e', parentEvent.id, '', 'reply'],
        ['p', parentEvent.pubkey]
      ];
    } else {
      // Direct reply to the event
      return [
        ['e', event.id, '', 'root'],
        ['p', event.pubkey]
      ];
    }
  }

  // NIP-22 structure for longform comments
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];

  if (!dTag) {
    // Fallback if no d tag - use simple structure
    if (parentEvent) {
      return [
        ['e', event.id, '', event.pubkey],
        ['e', parentEvent.id, '', parentEvent.pubkey],
        ['p', event.pubkey],
        ['p', parentEvent.pubkey]
      ];
    } else {
      return [
        ['e', event.id, '', event.pubkey],
        ['p', event.pubkey]
      ];
    }
  }

  const addressTag = `${event.kind}:${event.pubkey}:${dTag}`;
  const relayHint = event.tags.find((t) => t[0] === 'relay')?.[1] || '';

  function getRootEventIdFromTags(tags?: string[][]): string | undefined {
    if (!tags) return undefined;
    for (const tag of tags) {
      if (tag[0] !== 'e' || !tag[1]) continue;
      const marker = tag[3] || (tag[2] === 'root' ? tag[2] : undefined);
      if (marker === 'root') {
        return tag[1];
      }
    }
    return undefined;
  }

  function appendUniqueTag(tags: string[][], tag: string[]) {
    const exists = tags.some(
      (existing) =>
        existing.length === tag.length && existing.every((value, index) => value === tag[index])
    );
    if (!exists) {
      tags.push(tag);
    }
  }

  function addNip10ReplyTags(tags: string[][]) {
    const rootId = event.id || getRootEventIdFromTags(parentEvent?.tags);
    if (rootId) {
      appendUniqueTag(tags, ['e', rootId, relayHint, 'root']);
    }
    if (parentEvent?.id) {
      appendUniqueTag(tags, ['e', parentEvent.id, relayHint, 'reply']);
    }

    if (event.pubkey) {
      appendUniqueTag(tags, ['p', event.pubkey]);
    }
    if (parentEvent?.pubkey && parentEvent.pubkey !== event.pubkey) {
      appendUniqueTag(tags, ['p', parentEvent.pubkey]);
    }
  }

  if (parentEvent) {
    // Nested reply to a comment - preserve root scope, update parent scope
    // Try to get root scope from parent comment (if it exists)
    const parentATag = parentEvent.tags.find((t) => t[0] === 'A' || t[0] === 'a');
    const parentKTag = parentEvent.tags.find((t) => t[0] === 'K');
    const parentPTag = parentEvent.tags.find((t) => t[0] === 'P');

    if (parentATag && parentKTag && parentPTag) {
      // Parent has proper NIP-22 structure, inherit root scope
      const tags = [
        // Root scope (uppercase) - inherited from parent
        ['A', parentATag[1], relayHint, parentPTag[1]],
        ['K', parentKTag[1]],
        ['P', parentPTag[1]],
        // Parent scope (lowercase) - points to the comment being replied to
        ['a', parentATag[1], relayHint, parentPTag[1]],
        ['e', parentEvent.id, relayHint, parentEvent.pubkey],
        ['k', '1111'], // Parent is a comment
        ['p', parentEvent.pubkey]
      ];
      addNip10ReplyTags(tags);
      return tags;
    } else {
      // Parent doesn't have proper structure, build from scratch
      const tags = [
        // Root scope (uppercase)
        ['A', addressTag, relayHint, event.pubkey],
        ['K', String(event.kind)],
        ['P', event.pubkey],
        // Parent scope (lowercase) - points to the comment being replied to
        ['a', addressTag, relayHint, event.pubkey],
        ['e', parentEvent.id, relayHint, parentEvent.pubkey],
        ['k', '1111'], // Parent is a comment
        ['p', parentEvent.pubkey]
      ];
      addNip10ReplyTags(tags);
      return tags;
    }
  } else {
    // Top-level comment - root and parent scope are the same
    const tags = [
      // Root scope (uppercase)
      ['A', addressTag, relayHint, event.pubkey],
      ['K', String(event.kind)],
      ['P', event.pubkey],
      // Parent scope (lowercase) - same as root for top-level comment
      ['a', addressTag, relayHint, event.pubkey],
      ['e', event.id, relayHint, event.pubkey],
      ['k', String(event.kind)],
      ['p', event.pubkey]
    ];
    addNip10ReplyTags(tags);
    return tags;
  }
}
