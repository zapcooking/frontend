import { recipeTags, type recipeTagSimple, TAG_ALIASES } from './consts';
import { ndk } from './nostr';
import { get } from 'svelte/store';
import type { NDKFilter } from '@nostr-dev-kit/ndk';

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
    'Easy', 'Quick', 'Breakfast', 'Italian', 'Mexican', 'Chicken', 'Dessert', 'Asian'
  ];

  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      console.warn('NDK not available, using default popular tags');
      return getTagsWithCounts(defaultPopular);
    }

    // Fetch recent recipes to count tag usage
    const filter: NDKFilter = {
      limit: 1000, // Get a good sample
      kinds: [30023],
      '#t': ['nostrcooking']
    };

    const tagCounts = new Map<string, number>();
    let eventCount = 0;

    return new Promise((resolve) => {
      const subscription = ndkInstance.subscribe(filter);
      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(getPopularTagsFromCounts(tagCounts, defaultPopular, limit));
      }, 5000); // 5 second timeout

      subscription.on('event', (event) => {
        eventCount++;
        // Extract tags from the event
        const tags = event.tags.filter((t) => 
          Array.isArray(t) && t[0] === 't' && t[1]?.startsWith('nostrcooking-')
        );

        tags.forEach((tag) => {
          if (Array.isArray(tag) && tag[1]) {
            const tagName = tag[1].replace('nostrcooking-', '').replace(/-/g, ' ');
            // Convert back to title case for matching
            const normalizedTag = normalizeTag(
              tagName.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              ).join(' ')
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
    const tagObj = recipeTags.find((t) => 
      normalizeTag(t.title).toLowerCase() === normalizeTag(tag).toLowerCase()
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
  return recipeTags.find((t) => 
    normalizeTag(t.title).toLowerCase() === normalized.toLowerCase()
  );
}

