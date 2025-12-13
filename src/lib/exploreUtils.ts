import { ndk } from './nostr';
import { get } from 'svelte/store';
import type { NDKEvent, NDKFilter, NDKUser } from '@nostr-dev-kit/ndk';
import { validateMarkdownTemplate } from './pharser';

export type Collection = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  tag?: string; // Tag to filter by
};

// Static collections for now (can be made dynamic later)
export const STATIC_COLLECTIONS: Collection[] = [
  {
    id: 'breakfast',
    title: 'Breakfast Favorites',
    subtitle: '12 recipes',
    tag: 'Breakfast'
  },
  {
    id: 'dessert',
    title: 'Sweet Treats',
    subtitle: '24 recipes',
    tag: 'Dessert'
  },
  {
    id: 'quick',
    title: 'Quick & Easy',
    subtitle: '18 recipes',
    tag: 'Quick'
  },
  {
    id: 'italian',
    title: 'Italian Classics',
    subtitle: '15 recipes',
    tag: 'Italian'
  },
  {
    id: 'healthy',
    title: 'Healthy Choices',
    subtitle: '20 recipes',
    tag: 'Healthy'
  }
];

export type PopularCook = {
  pubkey: string;
  recipeCount?: number;
};

/**
 * Fetch popular cooks (users who have published recipes)
 */
export async function fetchPopularCooks(limit: number = 12): Promise<PopularCook[]> {
  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      console.warn('NDK not available');
      return [];
    }

    // Fetch recent recipes to find active authors
    const filter: NDKFilter = {
      limit: 100,
      kinds: [30023],
      '#t': ['nostrcooking']
    };

    const authorCounts = new Map<string, number>();
    const subscription = ndkInstance.subscribe(filter);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        subscription.stop();
        const sorted = Array.from(authorCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([pubkey]) => ({ pubkey, recipeCount: authorCounts.get(pubkey) }));
        resolve(sorted);
      }, 5000);

      subscription.on('event', (event: NDKEvent) => {
        if (validateMarkdownTemplate(event.content) !== null && event.author?.pubkey) {
          const count = authorCounts.get(event.author.pubkey) || 0;
          authorCounts.set(event.author.pubkey, count + 1);
        }
      });

      subscription.on('eose', () => {
        clearTimeout(timeout);
        subscription.stop();
        const sorted = Array.from(authorCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([pubkey]) => ({ pubkey, recipeCount: authorCounts.get(pubkey) }));
        resolve(sorted);
      });
    });
  } catch (error) {
    console.error('Error fetching popular cooks:', error);
    return [];
  }
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

    const filter: NDKFilter = {
      limit: 5, // Get a few recipes to find one with an image
      kinds: [30023],
      '#t': [`nostrcooking-${tag.toLowerCase().replaceAll(' ', '-')}`]
    };

    let imageUrl: string | undefined = undefined;
    const subscription = ndkInstance.subscribe(filter);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        subscription.stop();
        resolve(imageUrl);
      }, 3000); // Shorter timeout for collection images

      subscription.on('event', (event: NDKEvent) => {
        if (validateMarkdownTemplate(event.content) !== null && !imageUrl) {
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
    console.error('Error fetching collection image:', error);
    return undefined;
  }
}

/**
 * Fetch collections with images
 */
export async function fetchCollectionsWithImages(): Promise<Collection[]> {
  const collections = [...STATIC_COLLECTIONS];
  
  // Fetch images for each collection in parallel
  const imagePromises = collections.map(async (collection) => {
    if (collection.tag) {
      const imageUrl = await fetchCollectionImage(collection.tag);
      return { ...collection, imageUrl };
    }
    return collection;
  });

  return Promise.all(imagePromises);
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
    console.warn('Error fetching likes for recipe:', error);
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
    console.warn('Error fetching zaps for recipe:', error);
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
      console.warn('NDK not available');
      return [];
    }

    // Fetch a larger set of recent recipes
    const filter: NDKFilter = {
      limit: 100, // Fetch more to find the most popular ones
      kinds: [30023],
      '#t': ['nostrcooking'],
      since: Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60) // Last 30 days
    };

    const recipes: NDKEvent[] = [];
    const subscription = ndkInstance.subscribe(filter);

    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        subscription.stop();
        await sortAndResolveRecipes(recipes, limit, ndkInstance, resolve);
      }, 8000); // Longer timeout to get more recipes

      subscription.on('event', (event: NDKEvent) => {
        if (validateMarkdownTemplate(event.content) !== null && event.author?.pubkey) {
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
    console.error('Error fetching trending recipes:', error);
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

