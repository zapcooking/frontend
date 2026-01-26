<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, getCurrentRelayGeneration } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import ArticleFeed from './ArticleFeed.svelte';
  import { RECIPE_TAGS } from '$lib/consts';
  import { validateMarkdownTemplate } from '$lib/parser';

  // Expanded food-related hashtags including farming, homesteading, and related topics
  // Note: 'zapcooking' and 'nostrcooking' are excluded as those are recipe tags
  const FOOD_LONGFORM_HASHTAGS = [
    // Original food tags
    'foodstr',
    'cook',
    'cookstr',
    'cooking',
    'drinkstr',
    'foodies',
    'carnivor',
    'carnivorediet',
    'soup',
    'soupstr',
    'drink',
    'eat',
    'burger',
    'steak',
    'steakstr',
    'dine',
    'dinner',
    'lunch',
    'breakfast',
    'supper',
    'yum',
    'snack',
    'snackstr',
    'dessert',
    'beef',
    'chicken',
    'bbq',
    'coffee',
    'mealprep',
    'meal',
    'recipe',
    'recipestr',
    'recipes',
    'food',
    'foodie',
    'foodporn',
    'instafood',
    'foodstagram',
    'foodblogger',
    'homecooking',
    'fromscratch',
    'baking',
    'baker',
    'pastry',
    'chef',
    'chefs',
    'cuisine',
    'gourmet',
    'restaurant',
    'restaurants',
    'pasta',
    'pizza',
    'sushi',
    'tacos',
    'taco',
    'burrito',
    'sandwich',
    'salad',
    'stew',
    'curry',
    'stirfry',
    'grill',
    'grilled',
    'roast',
    'roasted',
    'fried',
    'baked',
    'smoked',
    'fermented',
    'pickled',
    'preserved',
    'homemade',
    'vegan',
    'vegetarian',
    'keto',
    'paleo',
    'glutenfree',
    'dairyfree',
    'healthy',
    'nutrition',
    'nutritionist',
    'dietitian',
    'mealplan',
    'batchcooking',
    // Farming and agriculture
    'farming',
    'farm',
    'farmer',
    'farmers',
    'agriculture',
    'ag',
    'agrarian',
    'sustainablefarming',
    'organicfarming',
    'regenerative',
    'regenerativeagriculture',
    'permaculture',
    'biodynamic',
    'crops',
    'harvest',
    'harvesting',
    'growing',
    'growyourown',
    'growfood',
    'foodproduction',
    'foodsystem',
    'foodsystems',
    // Homesteading
    'homesteading',
    'homestead',
    'homesteader',
    'homesteaders',
    'selfsufficient',
    'selfsufficiency',
    'offgrid',
    'ruralliving',
    'countryliving',
    'simpleliving',
    'backyardfarming',
    'urbanfarming',
    'urbanhomestead',
    'urbanhomesteading',
    // Gardening
    'gardening',
    'garden',
    'gardener',
    'growyourownfood',
    'vegetablegarden',
    'herbgarden',
    'kitchengarden',
    'raisedbeds',
    'containergardening',
    'composting',
    'compost',
    'soilhealth',
    // Livestock and animals
    'livestock',
    'chickens',
    'chickenkeeping',
    'goats',
    'goatkeeping',
    'beekeeping',
    'bees',
    'honey',
    'eggs',
    'dairy',
    'milking',
    // Food preservation
    'canning',
    'preserving',
    'fermentation',
    'fermenting',
    'dehydrating',
    'dehydration',
    'freezing',
    'curing',
    'smoking',
    'cheesemaking',
    'cheese',
    // Food sourcing and sustainability
    'localfood',
    'locavore',
    'farmtotable',
    'farmtofork',
    'seasonal',
    'seasonaleating',
    'sustainable',
    'sustainability',
    'foodsecurity',
    'foodsovereignty',
    'foodjustice',
    // Traditional foodways
    'traditional',
    'traditionalfood',
    'foodculture',
    'culinaryheritage',
    'foodhistory',
    'foodtraditions'
  ];

  let events: NDKEvent[] = [];
  let loading = true;
  let subscription: NDKSubscription | null = null;
  let seenEventIds = new Set<string>();

  // Image extensions
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
  const IMAGE_URL_REGEX = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^\s]*)?)/gi;

  // Extract image from content (featured image → first content image)
  function extractImage(event: NDKEvent): string | null {
    const content = event.content || '';
    
    // Check for featured image tag
    const imageTag = event.tags.find((t) => t[0] === 'image' || t[0] === 'picture');
    if (imageTag && imageTag[1]) {
      return imageTag[1];
    }

    // Extract first image URL from content
    const imageMatches = content.match(IMAGE_URL_REGEX);
    if (imageMatches && imageMatches.length > 0) {
      return imageMatches[0];
    }

    // Check for nostr.news format (may have image in metadata)
    const nostrNewsMatch = content.match(/https?:\/\/nostr\.news\/[^\s]+/);
    if (nostrNewsMatch) {
      // nostr.news articles might have images, but we'll handle them separately
      return null;
    }

    return null;
  }

  // Calculate read time (average reading speed: 200 words per minute)
  function calculateReadTime(content: string): number {
    // Remove markdown syntax for word count
    const text = content
      .replace(/#+\s+/g, '') // Remove headers
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert links to text
      .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
      .replace(/`[^`]+`/g, '') // Remove code blocks
      .replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold
      .replace(/\*([^\*]+)\*/g, '$1') // Remove italic
      .trim();

    const words = text.split(/\s+/).filter((word) => word.length > 0);
    const minutes = Math.ceil(words.length / 200);
    return Math.max(1, minutes); // Minimum 1 minute
  }

  // Clean content for preview (remove URLs, markdown, etc.)
  function cleanPreview(content: string): string {
    let cleaned = content;

    // Handle nostr.news format - extract the actual article content
    const nostrNewsMatch = cleaned.match(/https?:\/\/nostr\.news\/[^\s]+/);
    if (nostrNewsMatch) {
      // Remove the nostr.news URL and any metadata before it
      cleaned = cleaned.replace(/.*https?:\/\/nostr\.news\/[^\s]+\s*/i, '');
    }

    // Remove URLs
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');

    // Remove markdown images
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

    // Remove markdown links but keep text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // Remove markdown headers
    cleaned = cleaned.replace(/^#+\s+/gm, '');

    // Remove markdown formatting
    cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1');
    cleaned = cleaned.replace(/`[^`]+`/g, '');

    // Get first paragraph (non-empty lines)
    const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) {
      const preview = lines[0].trim();
      // Limit to ~150 characters (2-3 lines)
      return preview.length > 150 ? preview.substring(0, 150).trim() + '...' : preview;
    }

    return cleaned.trim().substring(0, 150);
  }

  function getNoteUrl(event: NDKEvent): string | null {
    if (!event) return null;
    
    // For kind 30023 (longform), use naddr
    if (event.kind === 30023) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag && event.author?.hexpubkey) {
        try {
          const naddr = nip19.naddrEncode({
            identifier: dTag,
            kind: 30023,
            pubkey: event.author.hexpubkey
          });
          return `/recipe/${naddr}`;
        } catch (e) {
          console.warn('Failed to encode naddr:', e);
        }
      }
    }
    
    return null;
  }

  function getTitle(event: NDKEvent): string {
    // Try to get title from tags first
    const titleTag = event.tags.find((t) => t[0] === 'title');
    if (titleTag && titleTag[1]) {
      return titleTag[1];
    }
    
    // Fallback: extract from content (first line or first heading)
    const content = event.content || '';
    const lines = content.split('\n').filter((line) => line.trim());
    if (lines.length > 0) {
      // Check if first line is a heading
      const firstLine = lines[0].trim();
      if (firstLine.startsWith('# ')) {
        return firstLine.substring(2).trim();
      }
      // Return first line if it's short enough
      if (firstLine.length < 100) {
        return firstLine;
      }
    }
    
    return 'Untitled Article';
  }

  function getTags(event: NDKEvent): string[] {
    return event.tags
      .filter((t) => t[0] === 't' && t[1])
      .map((t) => t[1])
      .filter((tag) => FOOD_LONGFORM_HASHTAGS.includes(tag.toLowerCase()));
  }

  // Format articles for ArticleFeed
  function formatArticles(events: NDKEvent[]) {
    return events.map((event) => {
      const imageUrl = extractImage(event);
      const title = getTitle(event);
      const preview = cleanPreview(event.content || '');
      const readTime = calculateReadTime(event.content || '');
      const tags = getTags(event);
      const articleUrl = getNoteUrl(event) || '#';

      return {
        event,
        imageUrl,
        title,
        preview,
        readTime,
        tags,
        articleUrl
      };
    });
  }

  function shouldIncludeEvent(event: NDKEvent): boolean {
    // Check muted users
    if ($userPublickey) {
      // You can add muted user check here if needed
    }

    // Exclude recipes: check if event has zapcooking or nostrcooking tags
    const hasRecipeTag = event.tags.some(
      (tag) =>
        Array.isArray(tag) &&
        tag[0] === 't' &&
        RECIPE_TAGS.includes(tag[1]?.toLowerCase() || '')
    );

    if (hasRecipeTag) {
      return false; // Exclude recipes
    }

    // Exclude events that match recipe format (have Ingredients/Directions sections)
    const content = event.content || '';
    const recipeValidation = validateMarkdownTemplate(content);
    // If validateMarkdownTemplate returns a MarkdownTemplate object (not a string error),
    // it means it's a valid recipe format - exclude it
    if (typeof recipeValidation !== 'string') {
      // It's a valid recipe format (has ingredients and directions sections)
      return false; // Exclude recipe format content
    }

    // Check for food-related hashtags
    const hasFoodHashtag = event.tags.some(
      (tag) =>
        Array.isArray(tag) && tag[0] === 't' && FOOD_LONGFORM_HASHTAGS.includes(tag[1]?.toLowerCase() || '')
    );

    return hasFoodHashtag;
  }

  async function loadLongformArticles() {
    const startGeneration = getCurrentRelayGeneration();
    
    if (!$ndk) {
      console.warn('NDK not available');
      loading = false;
      return;
    }

    // Stop existing subscription
    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    loading = true;
    events = [];
    seenEventIds.clear();

    try {
      // Query for kind 30023 (longform) with food-related hashtags
      const filter: NDKFilter = {
        kinds: [30023],
        '#t': FOOD_LONGFORM_HASHTAGS,
        limit: 20
      };

      subscription = $ndk.subscribe(filter, { closeOnEose: true });
      const fetchedEvents: NDKEvent[] = [];

      subscription.on('event', (event: NDKEvent) => {
        // Ignore events from old relay generation
        if (getCurrentRelayGeneration() !== startGeneration) {
          return;
        }

        // Skip duplicates
        if (seenEventIds.has(event.id)) {
          return;
        }
        seenEventIds.add(event.id);

        // Filter for food-related content
        if (shouldIncludeEvent(event)) {
          fetchedEvents.push(event);
          // Sort by created_at descending
          events = [...fetchedEvents].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        }
      });

      subscription.on('eose', () => {
        loading = false;
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (loading) {
          loading = false;
          if (subscription) {
            subscription.stop();
            subscription = null;
          }
        }
      }, 10000);
    } catch (error) {
      console.error('Error loading longform articles:', error);
      loading = false;
    }
  }

  onMount(() => {
    loadLongformArticles();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<div class="flex flex-col gap-4">
  {#if loading}
    <div class="article-feed-horizontal">
      {#each Array(6) as _}
        <div class="article-card-skeleton-wrapper">
          <div class="article-card-skeleton rounded-lg overflow-hidden animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
            <div class="w-full h-48 bg-gray-200 dark:bg-gray-700"></div>
            <div class="p-5">
              <div class="h-6 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-3"></div>
              <div class="flex items-center gap-2 mb-3">
                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                <div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
              </div>
              <div class="h-4 w-full rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
              <div class="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if events.length > 0}
    {@const formattedArticles = formatArticles(events)}
    <ArticleFeed articles={formattedArticles} />
  {:else}
    <div class="text-center py-8 text-caption">
      <p>No longform articles found yet.</p>
      <p class="text-sm mt-2">Check back later for food-related articles, farming tips, and homesteading stories!</p>
    </div>
  {/if}
</div>

<style>
  .article-feed-horizontal {
    display: flex;
    gap: 24px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar {
    height: 8px;
  }

  .article-feed-horizontal::-webkit-scrollbar-track {
    background: transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb {
    background-color: var(--color-input-border);
    border-radius: 4px;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-text-secondary);
  }

  .article-card-skeleton-wrapper {
    flex: 0 0 auto;
    width: 320px;
    height: 520px;
    display: flex;
  }

  .article-card-skeleton {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  @media (min-width: 768px) {
    .article-card-skeleton-wrapper {
      width: 360px;
      height: 540px;
    }
  }

  @media (min-width: 1200px) {
    .article-card-skeleton-wrapper {
      width: 380px;
      height: 560px;
    }
  }
</style>