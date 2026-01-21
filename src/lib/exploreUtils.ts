import { ndk } from './nostr';
import { get } from 'svelte/store';
import type { NDKEvent, NDKFilter, NDKUser } from '@nostr-dev-kit/ndk';
import { validateMarkdownTemplate } from './parser';
import { profileCacheManager } from './profileCache';
import { logger } from './logger';
import { markOnce } from './perf/explorePerf';
import { RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY } from './consts';

export type Collection = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  tag?: string; // Tag to filter by
};

// Static collections with pre-defined images (no network fetch needed)
export const STATIC_COLLECTIONS: Collection[] = [
  {
    id: 'breakfast',
    title: 'Breakfast Favorites',
    subtitle: '12 recipes',
    tag: 'Breakfast',
    imageUrl: '/tags/breakfast.webp'
  },
  {
    id: 'dessert',
    title: 'Sweet Treats',
    subtitle: '24 recipes',
    tag: 'Dessert',
    imageUrl: '/tags/dessert.webp'
  },
  {
    id: 'quick',
    title: 'Quick & Easy',
    subtitle: '18 recipes',
    tag: 'Quick',
    imageUrl: '/tags/easy.webp'
  },
  {
    id: 'italian',
    title: 'Italian Classics',
    subtitle: '15 recipes',
    tag: 'Italian',
    imageUrl: '/tags/italian.webp'
  },
  {
    id: 'mexican',
    title: 'Mexican Flavors',
    subtitle: '20 recipes',
    tag: 'Mexican',
    imageUrl: '/tags/mexican.webp'
  }
];

export type PopularCook = {
  pubkey: string;
  recipeCount?: number;
};

// Cache for popular cooks
const POPULAR_COOKS_CACHE_KEY = 'zc_popular_cooks_v1';
const POPULAR_COOKS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface PopularCooksCache {
  cooks: PopularCook[];
  timestamp: number;
}

function getCachedPopularCooks(): PopularCook[] | null {
  try {
    const cached = localStorage.getItem(POPULAR_COOKS_CACHE_KEY);
    if (cached) {
      const data: PopularCooksCache = JSON.parse(cached);
      if (Date.now() - data.timestamp < POPULAR_COOKS_CACHE_TTL) {
        return data.cooks;
      }
    }
  } catch {}
  return null;
}

function setCachedPopularCooks(cooks: PopularCook[]) {
  try {
    const data: PopularCooksCache = {
      cooks,
      timestamp: Date.now()
    };
    localStorage.setItem(POPULAR_COOKS_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * Check if a profile image is valid (not empty, looks like a real image URL)
 * Checks both 'image' and 'picture' since Nostr profiles use 'picture'
 */
function hasValidProfileImage(user: any): boolean {
  // Check both 'image' and 'picture' - Nostr standard uses 'picture'
  const image = user?.profile?.image || user?.profile?.picture;
  if (!image || typeof image !== 'string') {
    return false;
  }
  
  // Trim whitespace and check it's not empty
  const trimmed = image.trim();
  if (trimmed.length === 0) {
    return false;
  }
  
  // Check if it looks like a URL (starts with http:// or https://)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  
  // URL must be reasonably long (minimum viable image URL is ~20 chars)
  if (trimmed.length < 20) {
    return false;
  }
  
  // Filter out known placeholder/default avatar patterns
  const lowerUrl = trimmed.toLowerCase();
  const invalidPatterns = [
    'placeholder',
    'default',
    'avatar-default',
    'no-image',
    'noimage',
    'blank',
    'empty',
    'null',
    'undefined',
    // Common default avatar services (robohash, identicon, etc. are generated, not real photos)
    'robohash.org',
    'gravatar.com/avatar/0', // Default gravatar
    'ui-avatars.com',
    'dicebear.com',
    'boring-avatars',
    'jazzicon',
    'blockies'
  ];
  
  for (const pattern of invalidPatterns) {
    if (lowerUrl.includes(pattern)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Fetch popular cooks (users who have published recipes)
 * Only returns users with profile pictures
 * Uses caching for instant loading on repeat visits
 */
export async function fetchPopularCooks(limit: number = 12): Promise<PopularCook[]> {
  // Return cached data immediately if available
  const cached = getCachedPopularCooks();
  if (cached && cached.length >= limit) {
    logger.debug('Returning cached popular cooks', 'fetchPopularCooks');
    // Refresh cache in background
    refreshPopularCooksCache(limit);
    return cached.slice(0, limit);
  }

  // No cache, fetch fresh data
  return fetchPopularCooksFresh(limit);
}

/**
 * Refresh the popular cooks cache in the background
 */
async function refreshPopularCooksCache(limit: number) {
  try {
    const fresh = await fetchPopularCooksFresh(limit);
    if (fresh.length > 0) {
      setCachedPopularCooks(fresh);
    }
  } catch (error) {
    logger.debug('Background cache refresh failed', 'fetchPopularCooks');
  }
}

/**
 * Fetch fresh popular cooks data from relays
 */
async function fetchPopularCooksFresh(limit: number): Promise<PopularCook[]> {
  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      logger.warn('NDK not available', 'fetchPopularCooks');
      return [];
    }

    // Fetch recent recipes to find active authors (support both legacy and new tags)
    const filter: NDKFilter = {
      limit: 150, // Reduced from 200 for faster response
      kinds: [30023],
      '#t': RECIPE_TAGS
    };

    const authorCounts = new Map<string, number>();
    const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });

    return new Promise(async (resolve) => {
      let resolved = false;
      
      const finalize = async () => {
        if (resolved) return;
        resolved = true;
        subscription.stop();
        const cooks = await processAuthorsWithProfilesFast(authorCounts, limit, ndkInstance);
        // Cache the results
        if (cooks.length > 0) {
          setCachedPopularCooks(cooks);
        }
        resolve(cooks);
      };

      // Reduced timeout from 5s to 3s
      const timeout = setTimeout(finalize, 3000);

      let eventCount = 0;
      subscription.on('event', (event: NDKEvent) => {
        if (eventCount === 0) {
          markOnce('t3_explore_first_live_event_received');
        }
        eventCount++;
        if (typeof validateMarkdownTemplate(event.content) !== 'string' && event.author?.pubkey) {
          const count = authorCounts.get(event.author.pubkey) || 0;
          authorCounts.set(event.author.pubkey, count + 1);
        }
        
        // Early resolve: once we have enough unique authors, start processing
        if (authorCounts.size >= limit * 3 && eventCount >= 50) {
          clearTimeout(timeout);
          finalize();
        }
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        finalize();
      });
    });
  } catch (error) {
    logger.error('Error fetching popular cooks', 'fetchPopularCooks', error);
    return [];
  }
}

/**
 * Faster version of processAuthorsWithProfiles - processes in larger batches
 */
async function processAuthorsWithProfilesFast(
  authorCounts: Map<string, number>,
  limit: number,
  ndkInstance: any
): Promise<PopularCook[]> {
  // Sort authors by recipe count
  const sortedAuthors = Array.from(authorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pubkey]) => pubkey);

  const cooksWithPics: PopularCook[] = [];
  // Check up to 3x the limit (reduced from 5x)
  const maxToCheck = Math.min(sortedAuthors.length, limit * 3);

  // Larger batch size for faster processing
  const batchSize = 15;
  for (let i = 0; i < maxToCheck && cooksWithPics.length < limit; i += batchSize) {
    const batch = sortedAuthors.slice(i, i + batchSize);
    
    // Fetch profiles in parallel with shorter timeout
    const profileChecks = await Promise.race([
      Promise.all(
        batch.map(async (pubkey) => {
          try {
            const user = await profileCacheManager.getProfile(pubkey);
            return {
              pubkey,
              recipeCount: authorCounts.get(pubkey),
              hasPic: hasValidProfileImage(user)
            };
          } catch {
            return { pubkey, recipeCount: authorCounts.get(pubkey), hasPic: false };
          }
        })
      ),
      // Timeout for batch after 1.5s
      new Promise<Array<{pubkey: string; recipeCount: number | undefined; hasPic: boolean}>>((resolve) => 
        setTimeout(() => resolve(batch.map(pubkey => ({ pubkey, recipeCount: authorCounts.get(pubkey), hasPic: false }))), 1500)
      )
    ]);

    // Add users with valid profile pictures
    for (const check of profileChecks) {
      if (check.hasPic && cooksWithPics.length < limit) {
        cooksWithPics.push({
          pubkey: check.pubkey,
          recipeCount: check.recipeCount
        });
      }
    }
  }

  logger.debug(`Found ${cooksWithPics.length} popular cooks with valid profile pictures`, 'Popular Cooks');
  return cooksWithPics;
}

/**
 * Fetch a sample recipe image for a given tag
 */
export async function fetchCollectionImage(tag: string): Promise<string | undefined> {
  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      return undefined;
    }

    const tagSlug = tag.toLowerCase().replaceAll(' ', '-');
    // Support both legacy and new tag formats for backward compatibility
    const filter: NDKFilter = {
      limit: 5, // Get a few recipes to find one with an image
      kinds: [30023],
      '#t': [`${RECIPE_TAG_PREFIX_LEGACY}-${tagSlug}`, `${RECIPE_TAG_PREFIX_NEW}-${tagSlug}`]
    };

    let imageUrl: string | undefined = undefined;
    const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(imageUrl);
      }, 3000); // Shorter timeout for collection images

      subscription.on('event', (event: NDKEvent) => {
        if (typeof validateMarkdownTemplate(event.content) !== 'string' && !imageUrl) {
          // Find first image tag
          const imageTag = event.tags.find((t) => Array.isArray(t) && t[0] === 'image');
          if (imageTag && Array.isArray(imageTag) && imageTag[1]) {
            imageUrl = imageTag[1];
            subscription.stop();
            clearTimeout(timeout);
            resolve(imageUrl);
          }
        }
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        subscription.stop();
        resolve(imageUrl);
      });
    });
  } catch (error) {
    logger.error('Error fetching collection image', 'fetchCollectionImage', error);
    return undefined;
  }
}

/**
 * Get collections with images (uses static pre-defined images, no network fetch)
 */
export async function fetchCollectionsWithImages(): Promise<Collection[]> {
  // Return static collections immediately - images are pre-defined
  return [...STATIC_COLLECTIONS];
}

/**
 * Get reaction count (likes) for a recipe
 */
async function getRecipeLikes(recipe: NDKEvent, ndkInstance: any): Promise<number> {
  try {
    const dTag = recipe.tags.find((tag) => Array.isArray(tag) && tag[0] === 'd')?.[1];
    if (!dTag || !recipe.author?.pubkey) return 0;

    const aTag = `${recipe.kind}:${recipe.author.pubkey}:${dTag}`;
    let likeCount = 0;
    const processedEvents = new Set<string>();

    return new Promise((resolve) => {
      const subscription = ndkInstance.subscribe({
        kinds: [7],
        '#a': [aTag]
      }, { closeOnEose: true });

      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(likeCount);
      }, 3000); // Longer timeout for reactions

      subscription.on('event', (reaction: NDKEvent) => {
        const reactionId = reaction.id || reaction.sig || '';
        if (reactionId && !processedEvents.has(reactionId)) {
          processedEvents.add(reactionId);
          likeCount++;
        }
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        subscription.stop();
        resolve(likeCount);
      });
    });
  } catch (error) {
    logger.warn('Error fetching likes for recipe', 'getRecipeLikes', error);
    return 0;
  }
}

/**
 * Get zap count for a recipe
 */
async function getRecipeZaps(recipe: NDKEvent, ndkInstance: any): Promise<number> {
  try {
    const dTag = recipe.tags.find((tag) => Array.isArray(tag) && tag[0] === 'd')?.[1];
    if (!dTag || !recipe.author?.pubkey) return 0;

    const aTag = `${recipe.kind}:${recipe.author.pubkey}:${dTag}`;
    let zapCount = 0;
    const processedEvents = new Set<string>();

    return new Promise((resolve) => {
      const subscription = ndkInstance.subscribe({
        kinds: [9735],
        '#a': [aTag]
      }, { closeOnEose: true });

      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(zapCount);
      }, 3000); // Longer timeout for zaps

      subscription.on('event', (zap: NDKEvent) => {
        const zapId = zap.sig || zap.id || '';
        if (zapId && !processedEvents.has(zapId)) {
          processedEvents.add(zapId);
          zapCount++;
        }
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        subscription.stop();
        resolve(zapCount);
      });
    });
  } catch (error) {
    logger.warn('Error fetching zaps for recipe', 'getRecipeZaps', error);
    return 0;
  }
}

/**
 * Fetch trending recipes sorted by likes and zaps
 */
export async function fetchTrendingRecipes(limit: number = 12): Promise<NDKEvent[]> {
  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      logger.warn('NDK not available', 'fetchTrendingRecipes');
      return [];
    }

    // Fetch a larger set of recent recipes (support both legacy and new tags)
    const filter: NDKFilter = {
      limit: 100, // Fetch more to find the most popular ones
      kinds: [30023],
      '#t': RECIPE_TAGS,
      since: Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60) // Last 30 days
    };

    const recipes: NDKEvent[] = [];
    const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });

    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        subscription.stop();
        await sortAndResolveRecipes(recipes, limit, ndkInstance, resolve);
      }, 5000); // 5 second timeout for faster UX

      subscription.on('event', (event: NDKEvent) => {
        if (typeof validateMarkdownTemplate(event.content) !== 'string' && event.author?.pubkey) {
          recipes.push(event);
        }
      });

      subscription.on('eose', async () => {
        clearTimeout(timeout);
        subscription.stop();
        await sortAndResolveRecipes(recipes, limit, ndkInstance, resolve);
      });
    });
  } catch (error) {
    logger.error('Error fetching trending recipes', 'fetchTrendingRecipes', error);
    return [];
  }
}

/**
 * Sort recipes by likes and zaps, then resolve
 */
async function sortAndResolveRecipes(
  recipes: NDKEvent[],
  limit: number,
  ndkInstance: any,
  resolve: (recipes: NDKEvent[]) => void
) {
  if (recipes.length === 0) {
    resolve([]);
    return;
  }

  // Check all recipes for engagement (up to 50 for performance)
  const recipesToCheck = recipes.slice(0, Math.min(50, recipes.length));
  
  // Get likes and zaps for each recipe in parallel
  const recipeScores = await Promise.all(
    recipesToCheck.map(async (recipe) => {
      const [likes, zaps] = await Promise.all([
        getRecipeLikes(recipe, ndkInstance),
        getRecipeZaps(recipe, ndkInstance)
      ]);
      // Combined score: zaps weighted more heavily (x3) + likes
      const score = zaps * 3 + likes;
      return { recipe, score, likes, zaps };
    })
  );

  // Sort by score (highest first), then by created_at as tiebreaker
  recipeScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // If scores are equal, prefer newer recipes
    return (b.recipe.created_at || 0) - (a.recipe.created_at || 0);
  });

  // Return top recipes - only those with some engagement (score > 0) or top by date if all have 0
  const topRecipes = recipeScores
    .filter(item => item.score > 0 || recipesToCheck.length < 10) // Include all if we have few recipes
    .slice(0, limit)
    .map(item => item.recipe);
  
  // If we don't have enough with engagement, fill with highest scored ones
  if (topRecipes.length < limit && recipeScores.length > 0) {
    const remaining = limit - topRecipes.length;
    const additional = recipeScores
      .filter(item => !topRecipes.includes(item.recipe))
      .slice(0, remaining)
      .map(item => item.recipe);
    topRecipes.push(...additional);
  }
  
  resolve(topRecipes);
}

/**
 * Configuration for discover recipes sampling
 */
const DISCOVER_CONFIG = {
  MAX_AGE_DAYS: 100, // ~3.3 months
  MIN_RECIPES_TO_SAMPLE: 8,
  MAX_RECIPES_TO_SAMPLE: 12,
  MAX_RECIPES_PER_AUTHOR: 2
};

/**
 * Check if a recipe has at least one image
 */
function hasImage(recipe: NDKEvent): boolean {
  if (!recipe.tags) return false;
  return recipe.tags.some((tag) => Array.isArray(tag) && tag[0] === 'image' && tag[1]);
}

/**
 * Calculate quality score for a recipe
 * baseScore + log(zapCount + 1) + log(likeCount + 1)
 */
async function calculateRecipeScore(
  recipe: NDKEvent,
  ndkInstance: any
): Promise<number> {
  const baseScore = 1; // Base score for all valid recipes
  const [likes, zaps] = await Promise.all([
    getRecipeLikes(recipe, ndkInstance),
    getRecipeZaps(recipe, ndkInstance)
  ]);
  
  // Use logarithmic scaling to prevent very popular recipes from dominating
  const zapScore = Math.log(zaps + 1);
  const likeScore = Math.log(likes + 1);
  
  return baseScore + zapScore + likeScore;
}

/**
 * Sample recipes with quality-weighted random selection
 * Optimized to avoid recalculating probabilities on each iteration
 */
function sampleRecipesWithWeights(
  recipes: Array<{ recipe: NDKEvent; score: number }>,
  limit: number,
  maxPerAuthor: number = DISCOVER_CONFIG.MAX_RECIPES_PER_AUTHOR
): NDKEvent[] {
  if (recipes.length === 0) return [];
  if (recipes.length <= limit) {
    return recipes.map((r) => r.recipe);
  }

  const selected: NDKEvent[] = [];
  const authorCounts = new Map<string, number>();
  // Use indices instead of copying arrays for better performance
  const availableIndices = new Set(recipes.map((_, i) => i));
  let totalScore = recipes.reduce((sum, r) => sum + r.score, 0);

  while (selected.length < limit && availableIndices.size > 0) {
    // Weighted random selection using cumulative distribution
    const random = Math.random() * totalScore;
    let cumulative = 0;
    let selectedIndex = -1;

    // Find the selected index
    for (const idx of availableIndices) {
      cumulative += recipes[idx].score;
      if (random <= cumulative) {
        selectedIndex = idx;
        break;
      }
    }

    // Fallback to last available item if rounding issues
    if (selectedIndex === -1) {
      selectedIndex = Array.from(availableIndices)[availableIndices.size - 1];
    }

    const selectedItem = recipes[selectedIndex];
    const authorPubkey = selectedItem.recipe.author?.pubkey || '';

    // Check author limit
    const authorCount = authorCounts.get(authorPubkey) || 0;
    if (authorCount < maxPerAuthor) {
      selected.push(selectedItem.recipe);
      authorCounts.set(authorPubkey, authorCount + 1);
      // Update total score by removing this item's score
      totalScore -= selectedItem.score;
    }

    // Remove selected index from available pool
    availableIndices.delete(selectedIndex);
  }

  return selected;
}

/**
 * Fetch and sample discover recipes
 */
export async function fetchDiscoverRecipes(
  limit: number = DISCOVER_CONFIG.MAX_RECIPES_TO_SAMPLE
): Promise<NDKEvent[]> {
  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      logger.warn('NDK not available', 'fetchDiscoverRecipes');
      return [];
    }

    const threeMonthsAgo = Math.floor(Date.now() / 1000) - (DISCOVER_CONFIG.MAX_AGE_DAYS * 24 * 60 * 60);
    logger.debug(`Fetching recipes since: ${new Date(threeMonthsAgo * 1000).toISOString()}`, 'fetchDiscoverRecipes');

    // Fetch recipes from the last 6 months (support both legacy and new tags)
    const filter: NDKFilter = {
      limit: 200, // Fetch a larger pool for better sampling
      kinds: [30023],
      '#t': RECIPE_TAGS,
      since: threeMonthsAgo
    };

    const allRecipes: NDKEvent[] = [];
    let eventCount = 0;
    let validCount = 0;
    let noImageCount = 0;
    let invalidMarkdownCount = 0;
    let noAuthorCount = 0;

    const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });

    return new Promise((resolve) => {
      // Early-resolve support: prevent double resolve
      let resolved = false;

      // First paint threshold: resolve early once we have enough for initial render
      const FIRST_PAINT_MIN = Math.min(6, limit); // Reduced from 8 for faster first paint

      const timeout = setTimeout(async () => {
        if (resolved) return;
        subscription.stop();
        logger.debug(`Timeout reached. Events: ${eventCount}, Valid: ${validCount}, No image: ${noImageCount}, Invalid markdown: ${invalidMarkdownCount}, No author: ${noAuthorCount}`, 'fetchDiscoverRecipes');
        await processAndSampleRecipes(allRecipes, limit, ndkInstance, resolve);
      }, 5000); // 5 second timeout (reduced from 8s)

      // Helper to stop subscription and resolve early
      const stopAndResolve = (recipes: NDKEvent[]) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        // Use .stop() to halt the subscription
        // Note: NDK may log "No filters to merge" warnings when new relays connect
        // after early resolve - this is expected and doesn't affect functionality
        subscription.stop();
        resolve(recipes);
      };

      // Quick pick: prefer recipes with images, then randomize and slice
      const quickPick = (recipes: NDKEvent[], count: number): NDKEvent[] => {
        const withImages = recipes.filter(hasImage);
        const withoutImages = recipes.filter(r => !hasImage(r));
        // Shuffle each group for variety
        const shuffledWith = [...withImages].sort(() => Math.random() - 0.5);
        const shuffledWithout = [...withoutImages].sort(() => Math.random() - 0.5);
        return [...shuffledWith, ...shuffledWithout].slice(0, count);
      };

      subscription.on('event', (event: NDKEvent) => {
        // t3_explore_first_live_event_received: When the Explore page receives the first Nostr event
        if (eventCount === 0) {
          markOnce('t3_explore_first_live_event_received');
        }
        eventCount++;
        
        // Check each condition separately for debugging
        const hasValidMarkdown = typeof validateMarkdownTemplate(event.content) !== 'string';
        const hasAuthor = !!event.author?.pubkey;
        const hasImg = hasImage(event);

        if (!hasAuthor) {
          noAuthorCount++;
        } else if (!hasValidMarkdown) {
          invalidMarkdownCount++;
        } else if (!hasImg) {
          noImageCount++;
        }

        // Filter: must have valid markdown and author (image is preferred but not required if we don't have enough)
        if (hasValidMarkdown && hasAuthor) {
          validCount++;
          allRecipes.push(event);

          // Early resolve: trigger once we have enough for first paint (not waiting for full limit)
          if (!resolved && allRecipes.length >= FIRST_PAINT_MIN) {
            logger.debug(`Early resolve triggered with ${allRecipes.length} recipes`, 'fetchDiscoverRecipes');
            stopAndResolve(quickPick(allRecipes, Math.min(allRecipes.length, limit)));
            return;
          }
        }
      });

      subscription.on('eose', async () => {
        if (resolved) return;
        clearTimeout(timeout);
        subscription.stop();
        logger.debug(`EOSE reached. Events: ${eventCount}, Valid: ${validCount}, No image: ${noImageCount}, Invalid markdown: ${invalidMarkdownCount}, No author: ${noAuthorCount}`, 'fetchDiscoverRecipes');
        await processAndSampleRecipes(allRecipes, limit, ndkInstance, resolve);
      });
    });
  } catch (error) {
    logger.error('Error fetching discover recipes', 'fetchDiscoverRecipes', error);
    return [];
  }
}

/**
 * Process recipes and sample them
 */
async function processAndSampleRecipes(
  recipes: NDKEvent[],
  limit: number,
  ndkInstance: any,
  resolve: (recipes: NDKEvent[]) => void
) {
  logger.debug(`Processing ${recipes.length} recipes, target limit: ${limit}`, 'processAndSampleRecipes');
  
  if (recipes.length === 0) {
    logger.warn('No recipes found matching criteria', 'processAndSampleRecipes');
    resolve([]);
    return;
  }

  // If we don't have enough recipes, use simple random selection
  if (recipes.length < DISCOVER_CONFIG.MIN_RECIPES_TO_SAMPLE) {
    logger.debug(`Only ${recipes.length} recipes found, using simple random selection`, 'processAndSampleRecipes');
    // Shuffle and return what we have
    const shuffled = [...recipes].sort(() => Math.random() - 0.5);
    const result = shuffled.slice(0, limit);
    logger.debug(`Returning ${result.length} recipes`, 'processAndSampleRecipes');
    resolve(result);
    return;
  }

  // Prioritize recipes with images, but include some without if needed
  const recipesWithImages = recipes.filter(r => hasImage(r));
  const recipesWithoutImages = recipes.filter(r => !hasImage(r));
  
  logger.debug(`Recipes with images: ${recipesWithImages.length}, without: ${recipesWithoutImages.length}`, 'processAndSampleRecipes');
  
  // Prefer recipes with images, but mix in some without if we need more
  const mixedRecipes = [
    ...recipesWithImages.sort(() => Math.random() - 0.5),
    ...recipesWithoutImages.sort(() => Math.random() - 0.5).slice(0, Math.max(0, limit - recipesWithImages.length))
  ];

  // Calculate scores for a sample of recipes (for performance)
  const sampleSize = Math.min(100, mixedRecipes.length);
  const recipesToScore = mixedRecipes.slice(0, sampleSize);

  // Calculate scores in parallel (with timeout per recipe)
  const recipesWithScores = await Promise.all(
    recipesToScore.map(async (recipe) => {
      try {
        const score = await Promise.race([
          calculateRecipeScore(recipe, ndkInstance),
          new Promise<number>((resolve) => setTimeout(() => resolve(1), 2000)) // 2s timeout per recipe
        ]);
        return { recipe, score };
      } catch (error) {
        logger.warn('Error calculating score for recipe', 'processAndSampleRecipes', error);
        return { recipe, score: 1 }; // Fallback score
      }
    })
  );

  // Sample with quality-weighted random selection
  const sampled = sampleRecipesWithWeights(recipesWithScores, limit);
  logger.debug(`Sampled ${sampled.length} recipes from ${recipesWithScores.length} scored recipes`, 'processAndSampleRecipes');
  resolve(sampled);
}

