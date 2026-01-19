<script context="module" lang="ts">
  export function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);

    return {
      destroy() {
        if (node.parentNode === target) {
          target.removeChild(node);
        }
      }
    };
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    ndk,
    userPublickey,
    ensureNdkConnected,
    normalizeRelayUrl,
    getConnectedRelays,
    getCurrentRelayGeneration,
    onRelaySwitchStopSubscriptions
  } from '$lib/nostr';
  import { formatDistanceToNow } from 'date-fns';
  import CustomAvatar from './CustomAvatar.svelte';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteReactionPills from './NoteReactionPills.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import NoteRepost from './NoteRepost.svelte';
  import FeedComments from './FeedComments.svelte';
  import ZapModal from './ZapModal.svelte';
  import NoteContent from './NoteContent.svelte';
  import AuthorName from './AuthorName.svelte';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { compressedCacheManager, COMPRESSED_FEED_CACHE_CONFIG } from '$lib/compressedCache';
  import FeedErrorBoundary from './FeedErrorBoundary.svelte';
  import FeedPostSkeleton from './FeedPostSkeleton.svelte';
  import LoadingState from './LoadingState.svelte';
  import { nip19 } from 'nostr-tools';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ClientAttribution from './ClientAttribution.svelte';

  let portalTarget: HTMLElement | null = null;

  // Outbox model for efficient following feed
  import {
    fetchFollowingEvents,
    getFollowedPubkeys,
    prewarmOutboxCache,
    prefetchRelayLists,
    type OutboxFetchResult
  } from '$lib/followOutbox';

  // Reply context prefetching for better UX
  import { prefetchReplyContexts } from '$lib/replyContext';

  // IndexedDB event store for cache rehydration (instant paint)
  import { getEventStore, cacheFeedEvents } from '$lib/eventStore';

  // Batched engagement fetching for reactions/subscriptions
  import { batchFetchEngagement, getEngagementStore } from '$lib/engagementCache';

  // Garden relay dedicated cache (IndexedDB-based)
  import {
    gardenCache,
    gardenCacheStatus,
    cachedEventToNDKLike,
    type CachedGardenEvent
  } from '$lib/gardenCache';

  // Membership checking for member feed
  async function checkMembershipStatus(
    pubkey: string
  ): Promise<{ hasActiveMembership: boolean; tier?: string }> {
    try {
      const res = await fetch('/api/membership/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey })
      });

      if (!res.ok) {
        return { hasActiveMembership: false };
      }

      const data = await res.json();
      return {
        hasActiveMembership: data.isActive === true,
        tier: data.member?.tier
      };
    } catch {
      return { hasActiveMembership: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PROPS
  // ═══════════════════════════════════════════════════════════════

  export let authorPubkey: string | undefined = undefined;
  export let hideAvatar: boolean = false;
  export let hideAuthorName: boolean = false;
  export let filterMode: 'global' | 'following' | 'replies' | 'members' | 'garden' = 'global';

  // Exposed refresh function for pull-to-refresh
  export async function refresh(): Promise<void> {
    // If already refreshing, wait for it to complete
    if (isRefreshing) return;

    // If still loading, just wait for the load to complete
    // (don't show double refresh indicators)
    if (loading) {
      return;
    }

    isRefreshing = true;
    try {
      // Clear existing data for fresh load
      seenEventIds.clear();
      events = [];
      visibleNotes = new Set();
      followedPubkeysForRealtime = [];

      // Reload without cache
      await loadFoodstrFeed(false);
    } catch (err) {
      console.error('[Feed] Refresh error:', err);
      error = true;
    } finally {
      isRefreshing = false;
      // Ensure loading is also false after refresh completes
      loading = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS - Compiled once at module level
  // ═══════════════════════════════════════════════════════════════

  // Food-related hashtags for filtering - expanded for better discovery
  const FOOD_HASHTAGS = [
    'foodstr',
    'cook',
    'cookstr',
    'zapcooking',
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
    'soup',
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
    'mealprep',
    'batchcooking'
  ];

  // Pre-compiled regexes for performance (compiled once at module level)
  // ═══════════════════════════════════════════════════════════════
  // FOOD FILTERING - HARD/SOFT KEYWORD SCORING SYSTEM
  // ═══════════════════════════════════════════════════════════════
  //
  // Include logic:
  // - Has food hashtag => include
  // - Has >= 1 HARD food word => include
  // - Has >= 2 SOFT food words => include
  //
  // HARD words = very low false-positive risk (1 hit is enough)
  // SOFT words = common in metaphor/news/etc (require 2 hits)
  //
  // Removals: "dish" (Dish Network), "ate" (too many non-food uses), "cook" (Cook Islands, etc.)

  // Hashtag terms (strong signal)
  const FOOD_HASHTAG_TERMS = [
    'foodstr',
    'cookstr',
    'zapcooking',
    'recipestr',
    'soupstr',
    'drinkstr',
    'snackstr',
    'steakstr',
    'mealprep',
    'foodies',
    'carnivor',
    'carnivorediet'
  ];

  // Hard words (very low false positive risk; 1 hit is enough)
  const HARD_FOOD_WORDS = [
    // Recipes & cooking intent
    'recipe',
    'recipes',
    'recipestr',
    'cooking',
    'baking',
    'bake',
    'chef',
    'chefs',
    'kitchen',
    'ingredient',
    'ingredients',
    'seasoned',
    'seasoning',
    'marinated',
    'saute',
    'sauteed',
    'simmer',
    'braised',
    'fermented',
    'pickled',
    'smoked',
    'slow cooked',
    'air fried',

    // Meals (strong real-world food signal)
    'breakfast',
    'lunch',
    'dinner',
    'dessert',
    'mealprep',
    'meal prep',
    'homecooking',
    'home cooked',
    'fromscratch',
    'homemade',

    // Food items & dishes
    'pasta',
    'pizza',
    'sushi',
    'taco',
    'tacos',
    'burrito',
    'sandwich',
    'salad',
    'soup',
    'stew',
    'curry',
    'burger',
    'steak',
    'bbq',
    'coffee',

    // Ingredients & staples
    'garlic',
    'onion',
    'tomato',
    'cheese',
    'butter',
    'olive oil',
    'rice',
    'beans',
    'eggs',
    'flour',

    // Diets & preferences (safe as hard)
    'vegan',
    'vegetarian',
    'keto',
    'paleo',
    'glutenfree',
    'gluten free',
    'dairyfree',
    'dairy free',

    // Restaurants (strong enough on Nostr)
    'restaurant',
    'restaurants'
  ];

  // Soft words (common metaphor / news words; require 2 hits)
  const SOFT_FOOD_WORDS = [
    // ambiguous/general
    'food',
    'meal',
    'supper',
    // slang/metaphor prone
    'spicy',
    'sweet',
    'flavor',
    'healthy',
    'organic',
    // journalism-metaphor prone
    'grill',
    'grilled',
    'roast',
    'roasted',
    // cuisines (can be ambiguous - e.g., "Italian politics")
    'italian',
    'mexican',
    'thai',
    'indian',
    'mediterranean',
    'japanese',
    'korean'
  ];

  // Helper to escape special regex characters
  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Convert term to regex pattern (supports multi-word phrases)
  function termToPattern(term: string): string {
    const parts = term.trim().split(/\s+/).map(escapeRegex);
    if (parts.length === 1) return `\\b${parts[0]}\\b`;
    return `\\b${parts.join('\\s+')}\\b`;
  }

  // Build precompiled regexes
  const FOOD_HASHTAG_REGEX = new RegExp(
    `(?:^|\\s)#(${FOOD_HASHTAG_TERMS.map(escapeRegex).join('|')})\\b`,
    'i'
  );
  const HARD_FOOD_REGEX = new RegExp(HARD_FOOD_WORDS.map(termToPattern).join('|'), 'ig');
  const SOFT_FOOD_REGEX = new RegExp(SOFT_FOOD_WORDS.map(termToPattern).join('|'), 'ig');

  // Macro exclusion for economics phrases
  const MACRO_EXCLUDING_FOOD_ENERGY_REGEX = /\b(excluding|exclude)\s+food\s+and\s+energy\b/i;

  const HASHTAG_PATTERN = /(^|\s)#([^\s#]+)/g;
  const URL_REGEX = /(https?:\/\/[^\s]+)/g;
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
  const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

  const MAX_HASHTAGS = 5;
  const CACHE_KEY = 'foodstr_feed_cache';
  const BATCH_DEBOUNCE_MS = 300;
  const SUBSCRIPTION_TIMEOUT_MS = 4000;
  const PRIVATE_RELAY_TIMEOUT_MS = 15000; // Longer timeout for garden/members relays (15 seconds)
  const ONE_DAY_SECONDS = 24 * 60 * 60;
  const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

  // Relay pools by purpose - optimized based on speed test results
  // Speed test: nostr.wine (305ms) > nos.lol (342ms) > purplepag.es (356ms) > relay.damus.io (394ms) > kitchen.zap.cooking (510ms) > relay.nostr.band (514ms)
  // NOTE: All URLs are normalized (no trailing slashes) to prevent duplicate connections
  const RELAY_POOLS = {
    recipes: ['wss://kitchen.zap.cooking'],      // Curated recipe content (510ms, but worth it for relevance)
    fallback: ['wss://nos.lol', 'wss://relay.damus.io'],  // Fast general relays (nos.lol 342ms, relay.damus.io 394ms)
    discovery: ['wss://nostr.wine', 'wss://relay.primal.net', 'wss://purplepag.es'],  // Additional relays for discovery
    profiles: ['wss://purplepag.es'],             // Profile metadata (356ms, specialized for kind:0)
    members: ['wss://pantry.zap.cooking'],        // Private member relay (The Pantry)
    pro: ['wss://pro.zap.cooking'],               // Pro member relay
    garden: ['wss://garden.zap.cooking']          // Garden relay (no trailing slash!)
  };

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let events: NDKEvent[] = [];
  let loading = true;
  let error = false;
  let hasMore = true;
  let loadingMore = false;
  let isRefreshing = false;

  // Subscription management - store actual subscription references for proper cleanup
  let activeSubscriptions: NDKSubscription[] = [];
  let batchTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingEvents: NDKEvent[] = [];
  let lastEventTime: number = 0;

  // Track filter mode for reactive updates
  let lastFilterMode: 'global' | 'following' | 'replies' | 'members' | 'garden' = 'global';

  // Followed pubkeys for real-time subscriptions (populated by outbox module)
  let followedPubkeysForRealtime: string[] = [];

  // Reply context cache (parent note info)
  const replyContextCache = new Map<
    string,
    {
      authorName: string;
      authorPubkey: string;
      notePreview: string;
      noteId: string;
      loading: boolean;
      error?: string;
    }
  >();

  // Deduplication
  const seenEventIds = new Set<string>();

  // UI state
  let carouselStates: { [eventId: string]: number } = {};
  let copiedNoteId = '';
  let expandedParentNotes: { [eventId: string]: boolean } = {}; // Track expanded parent notes
  let parentNoteCache: { [eventId: string]: NDKEvent | null } = {}; // Cache full parent notes
  let foodFilterEnabled = true; // Toggle for food filtering in Following/Replies modes

  // Modals
  let zapModal = false;
  let selectedEvent: NDKEvent | null = null;
  let imageModalOpen = false;
  let selectedImageUrl = '';
  let selectedEventImages: string[] = [];
  let selectedImageIndex = 0;

  // Lazy loading for engagement components
  let visibleNotes = new Set<string>();

  function lazyLoadAction(node: HTMLElement, eventId: string) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          visibleNotes = visibleNotes.add(eventId);
          visibleNotes = visibleNotes; // trigger reactivity
          observer.disconnect();
        }
      },
      { rootMargin: '800px' } // Load engagement 800px before visible - much earlier preloading
    );

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  // Infinite scroll - automatically load more when user scrolls near bottom
  let loadMoreSentinel: HTMLElement;
  let loadMoreObserver: IntersectionObserver | null = null;

  function setupInfiniteScroll() {
    if (!loadMoreSentinel) return;

    // Clean up existing observer if any
    if (loadMoreObserver) {
      loadMoreObserver.disconnect();
      loadMoreObserver = null;
    }

    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadMore();
        }
      },
      { rootMargin: '400px' } // Trigger 400px before bottom for smooth loading
    );

    loadMoreObserver.observe(loadMoreSentinel);
  }

  function cleanupInfiniteScroll() {
    if (loadMoreObserver) {
      loadMoreObserver.disconnect();
      loadMoreObserver = null;
    }
  }

  // Setup infinite scroll when sentinel element is available and feed is ready
  $: if (loadMoreSentinel && hasMore && !loading && events.length > 0) {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      setupInfiniteScroll();
    }, 0);
  }

  // Cleanup when hasMore becomes false
  $: if (!hasMore && loadMoreObserver) {
    cleanupInfiniteScroll();
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  function sevenDaysAgo(): number {
    return Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS;
  }

  /**
   * Calculate optimal time window for queries
   * - Initial load: 24 hours (fast initial paint)
   * - Pagination: adaptive window based on oldest event
   * - Realtime: since last event
   */
  function calculateTimeWindow(mode: 'initial' | 'pagination' | 'realtime'): {
    since: number;
    until?: number;
  } {
    const now = Math.floor(Date.now() / 1000);

    switch (mode) {
      case 'initial':
        // Initial load: last 24 hours (reduced from 7 days for faster load)
        return { since: now - ONE_DAY_SECONDS };

      case 'pagination':
        // Pagination: smaller window based on oldest event
        const oldestTime = events[events.length - 1]?.created_at || now;
        return {
          since: Math.max(oldestTime - ONE_DAY_SECONDS, now - SEVEN_DAYS_SECONDS), // Max 7 days back
          until: oldestTime - 1
        };

      case 'realtime':
        // Real-time: since last event (or last hour if no events)
        return { since: lastEventTime > 0 ? lastEventTime + 1 : now - 3600 };

      default:
        return { since: now - ONE_DAY_SECONDS };
    }
  }

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function isImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  function isVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      VIDEO_EXTENSIONS.some((ext) => lower.includes(ext)) ||
      lower.includes('youtube.com') ||
      lower.includes('youtu.be') ||
      lower.includes('vimeo.com')
    );
  }

  function getImageUrls(event: NDKEvent): string[] {
    const content = event.content || '';
    const urls = content.match(URL_REGEX) || [];
    return urls.filter((url) => isImageUrl(url) || isVideoUrl(url));
  }

  function getOptimizedImageUrl(url: string): string {
    return optimizeImageUrl(url, {
      width: 640,
      quality: 85,
      format: getOptimalFormat()
    });
  }

  function deduplicateText(text: string): string {
    if (!text || text.length < 20) return text;

    const segments = text.split(/(?<=[.!?\n])(?:\s+|$)/);
    if (segments.length < 2) return text;

    const deduplicated: string[] = [];
    for (const segment of segments) {
      const current = segment.trim();
      const prev = deduplicated[deduplicated.length - 1]?.trim();
      if (current && current !== prev) {
        deduplicated.push(segment);
      }
    }

    const result = deduplicated.join(' ').trim();
    const halfLen = Math.floor(result.length / 2);
    if (halfLen > 20) {
      const firstHalf = result.substring(0, halfLen).trim();
      const secondHalf = result.substring(halfLen).trim();
      if (firstHalf === secondHalf) return firstHalf;
    }

    return result;
  }

  function getContentWithoutMedia(content: string): string {
    let cleaned = content
      .replace(URL_REGEX, (url) => {
        return isImageUrl(url) || isVideoUrl(url) ? '' : url;
      })
      .replace(/\s+/g, ' ')
      .trim();

    return deduplicateText(cleaned);
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTENT FILTERING
  // ═══════════════════════════════════════════════════════════════

  function contentContainsFoodWords(content: string): boolean {
    if (!content) return false;

    // Normalize content - replace newlines/whitespace with single spaces for better matching
    const normalizedContent = content.replace(/\s+/g, ' ').trim();

    // Exclude posts containing "root" as a standalone word (not part of other words)
    if (/\broot\b/i.test(normalizedContent)) {
      return false;
    }

    // Check for food-related hashtags first (strong signal)
    if (FOOD_HASHTAG_REGEX.test(normalizedContent)) {
      return true;
    }

    // Count hard and soft word matches
    // Reset regex lastIndex before matching (since we use 'g' flag)
    HARD_FOOD_REGEX.lastIndex = 0;
    SOFT_FOOD_REGEX.lastIndex = 0;

    const hardMatches = normalizedContent.match(HARD_FOOD_REGEX) ?? [];
    const softMatches = normalizedContent.match(SOFT_FOOD_REGEX) ?? [];
    const hardCount = hardMatches.length;
    const softCount = softMatches.length;

    // Macro exclusion: "excluding food and energy" is a common economics phrase
    if (MACRO_EXCLUDING_FOOD_ENERGY_REGEX.test(normalizedContent)) {
      // Only allow if there's a strong signal beyond just the word "food"
      if (hardCount === 0 && softCount < 2) {
        return false;
      }
    }

    // Include if at least 1 hard match
    if (hardCount >= 1) {
      return true;
    }

    // Include if at least 2 soft matches
    if (softCount >= 2) {
      return true;
    }

    // Not enough food signals
    return false;
  }

  function countContentHashtags(content: string): number {
    if (!content) return 0;
    const matches = content.match(HASHTAG_PATTERN);
    return matches ? matches.length : 0;
  }

  function getHashtagCount(event: NDKEvent): number {
    const contentHashtags = countContentHashtags(event.content || '');
    const tagHashtags = Array.isArray(event.tags)
      ? event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 't').length
      : 0;
    return Math.max(contentHashtags, tagHashtags);
  }

  function getMutedUsers(): string[] {
    if (!$userPublickey) return [];
    try {
      const storedMutes = localStorage.getItem('mutedUsers');
      return storedMutes ? JSON.parse(storedMutes) : [];
    } catch {
      return [];
    }
  }

  function shouldIncludeEvent(event: NDKEvent): boolean {
    // Check muted users
    if ($userPublickey) {
      const mutedUsers = getMutedUsers();
      const authorKey = event.author?.hexpubkey || event.pubkey;
      if (authorKey && mutedUsers.includes(authorKey)) return false;
    }

    // Client-side filtered results: notes without hashtags that contain food words
    // These are discovered through client-side filtering
    if ((event as any)._fromNip50Search) {
      // Only check hashtag spam, not content (content already validated by client-side filter)
      const hashtagCount = getHashtagCount(event);
      if (hashtagCount > MAX_HASHTAGS) {
        return false;
      }
      return true;
    }

    // Regular events: check for food content or hashtags
    const content = event.content || '';
    const contentHasFood = contentContainsFoodWords(content);
    const hasFoodHashtag = event.tags.some(
      (tag) =>
        Array.isArray(tag) && tag[0] === 't' && FOOD_HASHTAGS.includes(tag[1]?.toLowerCase() || '')
    );

    if (!contentHasFood && !hasFoodHashtag) {
      return false;
    }

    // Check hashtag spam
    const hashtagCount = getHashtagCount(event);
    if (hashtagCount > MAX_HASHTAGS) {
      return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // CACHING
  // ═══════════════════════════════════════════════════════════════

  async function cacheEvents() {
    if (typeof window === 'undefined' || events.length === 0) return;

    try {
      // Store in IndexedDB for better performance and capacity
      const eventStore = getEventStore();
      await eventStore.storeEvents(events.slice(0, 100), 10 * 60 * 1000); // 10 min TTL

      // Also keep compressed cache for quick state restore (legacy support)
      const cacheData = {
        events: events.slice(0, 100).map((e) => ({
          id: e.id,
          pubkey: e.pubkey,
          content: e.content,
          created_at: e.created_at,
          tags: e.tags,
          author: e.author
            ? {
                hexpubkey: e.author.hexpubkey,
                profile: e.author.profile
              }
            : null
        })),
        timestamp: Date.now(),
        lastEventTime
      };

      await compressedCacheManager.set(
        {
          ...COMPRESSED_FEED_CACHE_CONFIG,
          key: CACHE_KEY
        },
        cacheData
      );
    } catch {
      // Cache write failed - non-critical
    }
  }

  async function loadCachedEvents(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    try {
      const cacheData: any = await compressedCacheManager.get({
        ...COMPRESSED_FEED_CACHE_CONFIG,
        key: CACHE_KEY
      });

      if (
        !cacheData ||
        !cacheData.events ||
        !Array.isArray(cacheData.events) ||
        cacheData.events.length === 0
      ) {
        return false;
      }

      const cachedEvents = cacheData.events
        .map((e: any) => ({
          ...e,
          author: e.author
            ? {
                hexpubkey: e.author.hexpubkey,
                profile: e.author.profile
              }
            : null
        }))
        .filter(shouldIncludeEvent);

      if (cachedEvents.length === 0) return false;

      // Add to seen set
      cachedEvents.forEach((e: NDKEvent) => seenEventIds.add(e.id));

      events = cachedEvents;
      lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
      return true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RELAY FETCHING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fetch events from relays.
   *
   * @param filter - NDK filter for the query
   * @param relayUrls - Relay URLs to fetch from
   * @param timeoutMs - Timeout in milliseconds
   * @param skipCache - Skip NDK cache (important for garden/members feeds)
   * @param useTemporaryRelaySet - If true, creates temporary relay connections (use for private/discovery relays not in default pool)
   */
  async function fetchFromRelays(
    filter: any,
    relayUrls: string[],
    timeoutMs: number = SUBSCRIPTION_TIMEOUT_MS,
    skipCache: boolean = false,
    useTemporaryRelaySet: boolean = false
  ): Promise<NDKEvent[]> {
    const normalizedUrls = relayUrls.map(normalizeRelayUrl);
    console.log(
      `[fetchFromRelays] Starting fetch from ${normalizedUrls.join(', ')} (timeout: ${timeoutMs}ms, skipCache: ${skipCache}, temporary: ${useTemporaryRelaySet})`
    );

    try {
      // Ensure NDK is connected before fetching
      await ensureNdkConnected();

      const timeoutPromise = new Promise<NDKEvent[]>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      );

      // Build fetch options - skip cache if requested (important for garden/members feeds)
      const fetchOpts = skipCache
        ? { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
        : undefined;

      const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');

      // Create relay set - third parameter controls temporary connections:
      // true = create temporary connections if relay not in pool (for private/discovery relays)
      // false = only use relays already connected in pool (no WebSocket errors)
      const relaySet = NDKRelaySet.fromRelayUrls(normalizedUrls, $ndk, useTemporaryRelaySet);

      // Log relay set details
      console.log(`[fetchFromRelays] RelaySet created with ${relaySet.relays?.size || 0} relays`);

      const eventsPromise = $ndk.fetchEvents(filter, fetchOpts, relaySet);

      // Race between fetchEvents and timeout
      const events = await Promise.race([eventsPromise, timeoutPromise]);
      const eventArray = Array.from(events);
      console.log(`[fetchFromRelays] fetchEvents returned ${eventArray.length} events`);
      return eventArray;
    } catch (err: any) {
      console.warn(`[fetchFromRelays] fetchEvents failed:`, err.message);

      if (err.message === 'Timeout') {
        console.warn(`[fetchFromRelays] Request timed out after ${timeoutMs}ms`);
        return [];
      }

      // Fallback to subscription if fetchEvents fails
      console.log(`[fetchFromRelays] Falling back to subscription approach...`);
      const { NDKRelaySet: NDKRelaySetFallback } = await import('@nostr-dev-kit/ndk');
      const relaySetFallback = NDKRelaySetFallback.fromRelayUrls(
        normalizedUrls,
        $ndk,
        useTemporaryRelaySet
      );

      return new Promise((resolve) => {
        const fetchedEvents: NDKEvent[] = [];
        const seenIds = new Set<string>();
        let resolved = false;

        // Skip cache in fallback subscription too if requested
        const sub = $ndk.subscribe(
          filter,
          {
            closeOnEose: true,
            ...(skipCache && { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY })
          },
          relaySetFallback
        );

        sub.on('event', (event: NDKEvent) => {
          console.log(`[fetchFromRelays] Subscription received event: ${event.id}`);
          if (event.id && !seenIds.has(event.id)) {
            seenIds.add(event.id);
            fetchedEvents.push(event);
          }
        });

        sub.on('eose', () => {
          console.log(
            `[fetchFromRelays] Subscription EOSE received, ${fetchedEvents.length} events collected`
          );
          if (!resolved) {
            resolved = true;
            sub.stop();
            resolve(fetchedEvents);
          }
        });

        setTimeout(() => {
          if (!resolved) {
            console.warn(
              `[fetchFromRelays] Subscription timeout after ${timeoutMs}ms, ${fetchedEvents.length} events collected`
            );
            resolved = true;
            sub.stop();
            resolve(fetchedEvents);
          }
        }, timeoutMs);
      });
    }
  }

  // Fetch recent notes and filter client-side for notes without hashtags
  // This is a discovery function that benefits from temporary relay connections
  async function fetchNotesWithoutHashtags(sinceTimestamp: number): Promise<NDKEvent[]> {
    const filter = {
      kinds: [1],
      limit: 300, // Increased limit for better discovery
      since: sinceTimestamp
    };

    try {
      // Ensure NDK is connected before fetching
      await ensureNdkConnected();

      const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
      // Query from multiple relay pools in parallel for maximum discovery
      // Use temporary relay set for discovery (this is the only place we need it)
      const allRelays = [...RELAY_POOLS.fallback, ...RELAY_POOLS.discovery].map(normalizeRelayUrl);
      const relaySet = NDKRelaySet.fromRelayUrls(
        allRelays,
        $ndk,
        true // Create temporary connections for discovery
      );

      const timeoutPromise = new Promise<NDKEvent[]>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 10000)
      );

      const eventsPromise = $ndk.fetchEvents(filter, undefined, relaySet);
      const events = await Promise.race([eventsPromise, timeoutPromise]);
      const eventArray = Array.from(events);

      // Filter for notes without food hashtags that contain food words
      // We want maximum discovery, but still need to filter for food-related content
      const notesWithoutHashtags = eventArray.filter((event: NDKEvent) => {
        // Exclude notes with food hashtags (already covered by hashtag filter)
        const hasFoodHashtag = event.tags.some(
          (tag) =>
            Array.isArray(tag) &&
            tag[0] === 't' &&
            FOOD_HASHTAGS.includes(tag[1]?.toLowerCase() || '')
        );

        if (hasFoodHashtag) return false;

        // Include notes that contain food words (client-side filtering for food-related content)
        const content = event.content || '';
        return contentContainsFoodWords(content);
      });

      // Mark as from client-side filtering
      notesWithoutHashtags.forEach((event) => {
        (event as any)._fromNip50Search = true;
      });

      return notesWithoutHashtags;
    } catch {
      return [];
    }
  }

  function dedupeAndSort(eventList: NDKEvent[]): NDKEvent[] {
    const unique: NDKEvent[] = [];

    for (const event of eventList) {
      if (!event.id || seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      unique.push(event);
    }

    return unique.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN LOAD FUNCTION
  // ═══════════════════════════════════════════════════════════════

  // Track if a load is in progress to prevent race conditions
  let loadInProgress = false;

  /**
   * Check if results are stale (relay generation changed during async operation).
   * If stale, results should be discarded to avoid mixing data from different relay sets.
   */
  function isStaleResult(capturedGeneration: number): boolean {
    const currentGen = getCurrentRelayGeneration();
    if (currentGen !== capturedGeneration) {
      console.log(
        `[Feed] Stale result detected: captured gen=${capturedGeneration}, current gen=${currentGen}`
      );
      return true;
    }
    return false;
  }

  async function loadFoodstrFeed(useCache = true) {
    // Capture relay generation at start - used to detect stale results
    const loadGeneration = getCurrentRelayGeneration();

    // Prevent concurrent loads that can cause race conditions with seenEventIds
    if (loadInProgress) {
      console.log('[Feed] Load already in progress, skipping duplicate call');
      return;
    }
    loadInProgress = true;

    try {
      // For garden/members mode, never use cache to ensure only target relay content
      if (filterMode === 'garden' || filterMode === 'members') {
        useCache = false;
        console.log(
          `[Feed] ${filterMode} mode: Cache disabled to ensure only ${filterMode} relay content`
        );
      }

      // Step 1: Try IndexedDB cache rehydration for instant paint
      if (useCache) {
        const eventStore = getEventStore();
        const timeWindow = calculateTimeWindow('initial');

        // Build filter for cache lookup
        const cacheFilter: any = {
          kinds: [1],
          since: timeWindow.since,
          limit: 50
        };

        // Add mode-specific filters
        if (filterMode !== 'global' && followedPubkeysForRealtime.length > 0) {
          cacheFilter.authors = followedPubkeysForRealtime;
        }
        if (filterMode === 'global' || followedPubkeysForRealtime.length === 0) {
          cacheFilter.hashtags = FOOD_HASHTAGS;
        }

        const cachedEvents = await eventStore.loadEvents(cacheFilter);

        // Check for stale results after async operation
        if (isStaleResult(loadGeneration)) {
          console.log('[Feed] Discarding stale cache results');
          return;
        }

        if (cachedEvents.length > 0) {
          // Filter cached events the same way we filter fresh events
          const validCached = cachedEvents.filter((event) => {
            if (filterMode === 'following' && isReply(event)) return false;
            return shouldIncludeEvent(event);
          });

          if (validCached.length > 0) {
            console.log(`[Feed] Cache hit: ${validCached.length} events (instant paint)`);
            validCached.forEach((e) => seenEventIds.add(e.id));
            events = validCached;
            lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
            loading = false;
            error = false;

            // Fetch fresh data in background
            setTimeout(() => fetchFreshData(), 100);

            // Start real-time subscription
            try {
              startRealtimeSubscription();
            } catch {
              // Non-critical
            }
            return;
          }
        }
      }

      // Check for stale results before proceeding
      if (isStaleResult(loadGeneration)) {
        console.log('[Feed] Discarding stale results (before relay fetch)');
        return;
      }

      // Fallback: Try compressed cache (legacy) - skip for garden/members mode
      if (
        useCache &&
        filterMode !== 'garden' &&
        filterMode !== 'members' &&
        (await loadCachedEvents())
      ) {
        // Check for stale results after async operation
        if (isStaleResult(loadGeneration)) {
          console.log('[Feed] Discarding stale compressed cache results');
          return;
        }
        loading = false;
        error = false;
        setTimeout(() => fetchFreshData(), 100);
        return;
      }

      loading = true;
      error = false;
      events = [];
      seenEventIds.clear();

      if (!$ndk) {
        console.error('[Feed] NDK not initialized');
        loading = false;
        error = true;
        return;
      }

      // Wait for NDK to be connected (don't call connect() directly - it causes WebSocket errors)
      try {
        await ensureNdkConnected();
      } catch (err) {
        console.error('[Feed] Failed to ensure NDK connection:', err);
        loading = false;
        error = true;
        return;
      }

      // Check for stale results after waiting for connection
      if (isStaleResult(loadGeneration)) {
        console.log('[Feed] Discarding stale results (after connection wait)');
        return;
      }

      const timeWindow = calculateTimeWindow('initial');

      // Handle different filter modes
      if (filterMode === 'following') {
        // Following mode: only show notes (not replies) from followed users
        // Uses outbox model for efficient fetching from correct relays
        if (!$userPublickey) {
          loading = false;
          error = false;
          events = [];
          return;
        }

        // Use outbox model for optimized fetching
        // Add '#t' filter to fetch ONLY food-tagged posts from relays (not all posts)
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since: timeWindow.since,
          kinds: [1],
          limit: 50, // Reduced since we're getting targeted results
          timeoutMs: 5000,
          maxRelays: 10, // Top 10 relays by coverage
          additionalFilter: {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          }
        });

        console.log('[Feed] Raw events from outbox:', result.events.length);

        console.log(
          `[Feed] Outbox fetch (food-filtered): ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`
        );

        if (result.failedRelays.length > 0) {
          console.warn(`[Feed] Failed relays:`, result.failedRelays);
        }

        // Cache followed pubkeys for real-time subscription
        followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);

        // Filter for food-related content AND exclude replies (only top-level notes)
        const beforeFilter = result.events.length;
        const validEvents = result.events.filter((event) => {
          // Exclude replies - only show top-level notes in Following
          if (isReply(event)) return false;

          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) return false;
          }

          // Apply food filter only if enabled
          if (foodFilterEnabled) {
            return shouldIncludeEvent(event);
          }

          return true;
        });

        console.log('[Feed] After food filter:', validEvents.length, '/', beforeFilter);

        // Show what's being filtered out (sample)
        const rejected = result.events
          .filter((e) => {
            return isReply(e) || !shouldIncludeEvent(e);
          })
          .slice(0, 5);
        console.log(
          '[Feed] Sample rejected:',
          rejected.map((e) => ({
            content: e.content?.slice(0, 100),
            tags: e.tags.filter((t) => t[0] === 't').map((t) => t[1])
          }))
        );

        // Check for stale results before applying events
        if (isStaleResult(loadGeneration)) {
          console.log('[Feed] Discarding stale following results');
          return;
        }

        events = dedupeAndSort(validEvents);
        loading = false;
        error = false;

        if (events.length > 0) {
          lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
          await cacheEvents();
        }

        try {
          startRealtimeSubscription();
        } catch {
          // Subscription setup failed - non-critical, events already loaded
        }
        return;
      }

      if (filterMode === 'replies') {
        // Notes & Replies mode: show ALL food-related content from followed users (both notes and replies)
        // Uses outbox model for efficient fetching from correct relays
        if (!$userPublickey) {
          loading = false;
          error = false;
          events = [];
          return;
        }

        // Use outbox model - same fetch with food hashtag filter
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since: timeWindow.since,
          kinds: [1],
          limit: 50, // Reduced since we're getting targeted results
          timeoutMs: 5000,
          maxRelays: 10, // Top 10 relays by coverage
          additionalFilter: {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          }
        });

        console.log('[Feed] Raw events from outbox:', result.events.length);

        console.log(
          `[Feed] Outbox fetch (food-filtered replies): ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`
        );

        // Cache followed pubkeys for real-time subscription
        followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);

        // Filter for food-related content (both notes AND replies)
        const beforeFilter = result.events.length;
        const foodEvents = result.events.filter((event) => {
          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) return false;
          }

          // Apply food filter only if enabled
          if (foodFilterEnabled) {
            return shouldIncludeEvent(event);
          }

          return true;
        });

        console.log('[Feed] After food filter:', foodEvents.length, '/', beforeFilter);

        // Show what's being filtered out (sample)
        const rejected = result.events.filter((e) => !shouldIncludeEvent(e)).slice(0, 5);
        console.log(
          '[Feed] Sample rejected:',
          rejected.map((e) => ({
            content: e.content?.slice(0, 100),
            tags: e.tags.filter((t) => t[0] === 't').map((t) => t[1])
          }))
        );

        events = dedupeAndSort(foodEvents);
        loading = false;
        error = false;

        if (events.length > 0) {
          lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
          await cacheEvents();
        }

        // Prefetch reply contexts for better UX (batch fetch parent notes)
        prefetchReplyContexts($ndk, events.slice(0, 20)).catch(() => {
          // Non-critical - individual contexts will be fetched as needed
        });

        // Prefetch relay lists for all visible authors (non-blocking)
        // This improves outbox model performance for subsequent fetches
        const authorPubkeys = [...new Set(events.slice(0, 50).map((e) => e.pubkey))];
        prefetchRelayLists(authorPubkeys);

        try {
          startRealtimeSubscription();
        } catch {
          // Subscription setup failed - non-critical, events already loaded
        }
        return;
      }

      if (filterMode === 'members') {
        // Members feed: show content from private member relays
        if (!$userPublickey) {
          loading = false;
          error = false;
          events = [];
          return;
        }

        // Check if user has active membership
        const membershipStatus = await checkMembershipStatus($userPublickey);
        if (!membershipStatus.hasActiveMembership) {
          loading = false;
          error = false;
          events = [];
          console.warn('[Feed] User does not have active membership');
          return;
        }

        // Use only members relay (not pro relay) - normalize URL
        const memberRelays: string[] = [normalizeRelayUrl(RELAY_POOLS.members[0])];
        const memberRelayUrl = memberRelays[0];

        // Ensure NDK is connected first
        await ensureNdkConnected();
        console.log('[Feed] Fetching member feed from relay:', memberRelayUrl);

        // Fetch from member relay - show ALL content (not just food-tagged)
        // Members feed should show everything from the members relay
        // NOTE: Members relay is private, so we use temporary relay set
        const memberFilter: any = {
          kinds: [1],
          since: timeWindow.since,
          limit: 50
        };

        // CRITICAL: Skip NDK cache to prevent events from other relays leaking in
        // Use longer timeout for private relays which may be slower to connect
        // Use temporary relay set since members relay may not be in default pool
        const memberEvents = await fetchFromRelays(
          memberFilter,
          memberRelays,
          PRIVATE_RELAY_TIMEOUT_MS,
          true,
          true
        );

        console.log(`[Feed] Member feed: ${memberEvents.length} events`);

        // Filter events for members feed
        // Note: Members feed shows ALL content from members relay (not just food-related)
        const validMemberEvents = memberEvents.filter((event) => {
          // Exclude replies - only show top-level notes in Members feed
          if (isReply(event)) {
            console.log('[Feed] Members: Filtered out reply event:', event.id);
            return false;
          }

          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) {
              console.log('[Feed] Members: Filtered out muted user event:', event.id);
              return false;
            }
          }

          // For members feed, show ALL content (don't apply food filter)
          // The relay filter already ensures we only get members relay content
          return true;
        });

        console.log(
          `[Feed] Members feed: ${validMemberEvents.length} valid events after filtering (from ${memberEvents.length} total)`
        );

        // Check for stale results before applying events
        if (isStaleResult(loadGeneration)) {
          console.log('[Feed] Discarding stale members results');
          return;
        }

        events = dedupeAndSort(validMemberEvents);
        loading = false;
        error = false;

        if (events.length > 0) {
          lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
          await cacheEvents();
        }

        try {
          startRealtimeSubscription();
        } catch {
          // Subscription setup failed - non-critical, events already loaded
        }
        return;
      }

      if (filterMode === 'garden') {
        // Garden feed: show content from garden relay ONLY
        // Uses dedicated IndexedDB cache for instant paint + background refresh
        events = [];
        seenEventIds.clear();

        const gardenRelayUrl = normalizeRelayUrl(RELAY_POOLS.garden[0]);
        console.log('[Feed] Using garden relay:', gardenRelayUrl);

        // STEP 1: Load from cache immediately (instant paint)
        gardenCacheStatus.update((s) => ({ ...s, isLoading: true }));

        try {
          const cachedEvents = await gardenCache.getCachedEvents();
          const cacheStats = await gardenCache.getStats();

          if (cachedEvents.length > 0) {
            console.log(
              `[Feed] Garden: Loaded ${cachedEvents.length} events from cache (age: ${cacheStats.cacheAge ? Math.round(cacheStats.cacheAge / 1000) + 's' : 'unknown'})`
            );

            // Convert cached events to NDK-like format and display immediately
            const cachedNDKEvents = cachedEvents.map((e) => cachedEventToNDKLike(e));
            events = cachedNDKEvents;
            loading = false; // Show cached data immediately

            // Check for stale results
            if (isStaleResult(loadGeneration)) {
              console.log('[Feed] Discarding stale garden cache results');
              return;
            }

            // If cache is fresh, we're done - skip the relay fetch
            if (cacheStats.isFresh) {
              console.log('[Feed] Garden: Cache is fresh, skipping relay fetch');
              gardenCacheStatus.update((s) => ({ ...s, isLoading: false }));

              if (events.length > 0) {
                lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
              }

              // Still start realtime subscription for new events
              try {
                startRealtimeSubscription();
              } catch {
                // Non-critical
              }
              return;
            }

            console.log('[Feed] Garden: Cache is stale, fetching fresh data in background...');
          } else {
            console.log('[Feed] Garden: No cached events, fetching from relay...');
          }
        } catch (cacheErr) {
          console.warn('[Feed] Garden: Cache read failed:', cacheErr);
        }

        // STEP 2: Fetch fresh data from relay (if relay is connected)
        await ensureNdkConnected();

        const connectedRelays = getConnectedRelays().map((r) => normalizeRelayUrl(r));
        const normalizedGardenUrl = normalizeRelayUrl(RELAY_POOLS.garden[0]);
        const isGardenConnected = connectedRelays.includes(normalizedGardenUrl);

        console.log(
          `[Feed] Garden relay connection status: ${isGardenConnected ? 'connected' : 'not connected'}`
        );

        // If relay not connected and we have cached data, skip fetch
        if (!isGardenConnected && events.length > 0) {
          console.log('[Feed] Garden: Relay not connected, using cached data');
          gardenCacheStatus.update((s) => ({ ...s, isLoading: false }));
          try {
            startRealtimeSubscription();
          } catch {
            // Non-critical
          }
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const gardenFilter: any = {
          kinds: [1],
          since: now - SEVEN_DAYS_SECONDS, // 7 days for garden relay
          limit: 100
        };

        console.log('[Feed] Garden filter:', gardenFilter);

        // If we have cached data, use shorter timeout (5s) since we're just doing a background refresh
        // If no cache, use longer timeout (15s) to give relay more time
        const fetchTimeout = events.length > 0 ? 5000 : PRIVATE_RELAY_TIMEOUT_MS;
        console.log(
          `[Feed] Garden relay fetching (timeout: ${fetchTimeout}ms, have cache: ${events.length > 0})...`
        );

        // Use existing pool connection (useTemporaryRelaySet = false) to avoid creating new WebSocket
        const gardenEvents = await fetchFromRelays(
          gardenFilter,
          RELAY_POOLS.garden,
          fetchTimeout,
          true,
          false
        );

        console.log(`[Feed] Garden feed: ${gardenEvents.length} events from relay`);

        // Check for stale results
        if (isStaleResult(loadGeneration)) {
          console.log('[Feed] Discarding stale garden relay results');
          gardenCacheStatus.update((s) => ({ ...s, isLoading: false }));
          return;
        }

        // STEP 3: Update display and cache
        // Remember how many cached events we had before the fetch
        const hadCachedEvents = events.length;

        if (gardenEvents.length > 0) {
          // Got fresh events from relay - update display and cache
          events = dedupeAndSort(gardenEvents);
          console.log(`[Feed] Garden: Got ${events.length} fresh events from relay`);

          // Save to dedicated Garden cache
          try {
            await gardenCache.saveEvents(gardenEvents);
            await gardenCache.pruneCache(); // Keep cache size manageable
            console.log('[Feed] Garden: Events saved to dedicated cache');
          } catch (cacheErr) {
            console.warn('[Feed] Garden: Failed to save to cache:', cacheErr);
          }

          lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
          await cacheEvents(); // Also save to general cache
        } else if (hadCachedEvents > 0) {
          // Relay returned 0 events but we have cached data - KEEP SHOWING CACHED DATA
          console.log(
            `[Feed] Garden: Relay unavailable/timeout, keeping ${hadCachedEvents} cached events`
          );
          // events already has cached data, don't modify it
        } else {
          // No events from relay AND no cached events
          console.log('[Feed] Garden: No events available (relay empty/unavailable, no cache)');
        }

        loading = false;
        error = false;
        gardenCacheStatus.update((s) => ({ ...s, isLoading: false }));

        try {
          startRealtimeSubscription();
        } catch {
          // Subscription setup failed - non-critical, events already loaded
        }
        return;
      }

      // Global mode (default) - existing logic
      // Build filters
      const hashtagFilter: any = {
        kinds: [1],
        '#t': FOOD_HASHTAGS,
        limit: 50,
        since: timeWindow.since
      };

      if (authorPubkey) {
        hashtagFilter.authors = [authorPubkey];
      }

      // Parallel fetch strategy:
      // 1. Primary: hashtag filter (fast, reliable) - your relay + fast fallback
      // 2. Secondary: Client-side content filter (catches notes with food words but no hashtags) - only for community feed
      const fetchPromises: Promise<NDKEvent[]>[] = [
        // Primary: Your relay + fast fallback with hashtag filter
        fetchFromRelays(hashtagFilter, [...RELAY_POOLS.recipes, ...RELAY_POOLS.fallback])
      ];

      // Add client-side filtering for notes without hashtags (only for community feed)
      // This discovers notes without food hashtags that contain food words
      if (!authorPubkey) {
        fetchPromises.push(fetchNotesWithoutHashtags(timeWindow.since));
      }

      const results = await Promise.allSettled(fetchPromises);

      // Collect all events from successful fetches
      const allFetchedEvents: NDKEvent[] = [];

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          allFetchedEvents.push(...result.value);
        }
      });

      // Get followed users to exclude from Global feed (if logged in)
      let followedSet = new Set<string>();
      if ($userPublickey && !authorPubkey) {
        // Use the outbox module's function for consistent follow list
        const followed = await getFollowedPubkeys($ndk, $userPublickey);
        followedSet = new Set(followed);
        followedPubkeysForRealtime = followed; // Cache for real-time subscription
      }

      // Filter, dedupe, and sort - exclude followed users from Global feed
      const validEvents = allFetchedEvents.filter((event) => {
        // Check muted users first
        if ($userPublickey) {
          const mutedUsers = getMutedUsers();
          const authorKey = event.author?.hexpubkey || event.pubkey;
          if (authorKey && mutedUsers.includes(authorKey)) return false;
        }

        // Global feed: exclude replies (only show top-level notes)
        if (!authorPubkey && isReply(event)) {
          return false;
        }

        // Apply food filter based on context
        if (authorPubkey) {
          // Profile view: respect the toggle
          if (foodFilterEnabled && !shouldIncludeEvent(event)) return false;
        } else {
          // Global feed: always apply food filter
          if (!shouldIncludeEvent(event)) return false;

          // Also exclude posts from followed users
          if (followedSet.size > 0) {
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && followedSet.has(authorKey)) {
              return false; // Exclude - this belongs in Following/Notes & Replies
            }
          }
        }

        return true;
      });

      // Check for stale results before applying events
      if (isStaleResult(loadGeneration)) {
        console.log('[Feed] Discarding stale global results');
        return;
      }

      events = dedupeAndSort(validEvents);

      // Always set loading to false, even if no events
      loading = false;
      error = false;

      if (events.length > 0) {
        lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
        try {
          await cacheEvents();
        } catch {
          // Cache write failed - non-critical
        }
      }

      // Start real-time subscription
      try {
        startRealtimeSubscription();
      } catch {
        // Subscription setup failed - non-critical, events already loaded
      }
    } catch {
      loading = false;
      error = true;
      events = [];
    } finally {
      loadInProgress = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REAL-TIME SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════

  async function startRealtimeSubscription() {
    // Clean up any existing subscriptions
    stopSubscriptions();

    const timeWindow = calculateTimeWindow('realtime');
    const since = timeWindow.since;

    // Handle different filter modes for real-time subscriptions
    if (filterMode === 'following' || filterMode === 'replies') {
      if (!$userPublickey) return;

      // Get followed pubkeys for subscription (may already be cached)
      if (followedPubkeysForRealtime.length === 0) {
        followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);
      }

      if (followedPubkeysForRealtime.length === 0) return;

      // Subscribe in batches of 100 (Nostr relay limit)
      for (let i = 0; i < followedPubkeysForRealtime.length; i += 100) {
        const batch = followedPubkeysForRealtime.slice(i, i + 100);

        const filter: any = {
          kinds: [1],
          authors: batch,
          since
        };

        const sub = $ndk.subscribe(filter, { closeOnEose: false });

        sub.on('event', (event: NDKEvent) => {
          // For Following mode, exclude replies
          if (filterMode === 'following' && isReply(event)) {
            return;
          }

          if (shouldIncludeEvent(event)) {
            handleRealtimeEvent(event);
          }
        });

        activeSubscriptions.push(sub);
      }

      return;
    }

    if (filterMode === 'members') {
      if (!$userPublickey) return;

      // Check membership status for real-time subscription
      const membershipStatus = await checkMembershipStatus($userPublickey);
      if (!membershipStatus.hasActiveMembership) return;

      // Use only members relay (not pro relay) - normalize URL
      const memberRelays: string[] = [normalizeRelayUrl(RELAY_POOLS.members[0])];

      // Subscribe to member relay - show ALL content (not just food-tagged)
      const memberFilter: any = {
        kinds: [1],
        since
      };

      // Create subscription to member relays using NDKRelaySet
      // IMPORTANT: Skip NDK cache entirely to prevent events from other relays leaking in
      // NOTE: Members relay requires temporary connection since it's a private relay
      try {
        const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
        const relaySet = NDKRelaySet.fromRelayUrls(memberRelays, $ndk, true);

        const sub = $ndk.subscribe(
          memberFilter,
          {
            closeOnEose: false,
            cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
          },
          relaySet
        );

        sub.on('event', (event: NDKEvent) => {
          // Exclude replies
          if (isReply(event)) return;

          // For members feed, show ALL content (no food filter)
          handleRealtimeEvent(event);
        });

        activeSubscriptions.push(sub);
      } catch (err) {
        console.warn(`[Feed] Failed to subscribe to member relays:`, err);
      }

      return;
    }

    if (filterMode === 'garden') {
      // Subscribe to garden relay - show ALL content (not just food-tagged)
      const gardenFilter: any = {
        kinds: [1],
        since
      };

      try {
        await ensureNdkConnected();

        const normalizedGardenRelays = RELAY_POOLS.garden.map(normalizeRelayUrl);
        const connectedRelays = getConnectedRelays().map(normalizeRelayUrl);

        // Check if garden relay is actually connected in the pool
        const isGardenConnected = normalizedGardenRelays.some((url) =>
          connectedRelays.includes(url)
        );

        if (!isGardenConnected) {
          // Garden relay not connected - skip realtime subscription
          // We have cached data, so this is non-critical
          console.log(
            '[Feed] Garden realtime: Relay not connected, skipping subscription (cached data available)'
          );
          return;
        }

        console.log('[Feed] Garden realtime: Using existing pool connection');

        const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
        // Use false - use existing connection from the pool instead of creating new temporary connection
        // This avoids WebSocket connection errors when the relay is flaky
        const relaySet = NDKRelaySet.fromRelayUrls(normalizedGardenRelays, $ndk, false);

        const sub = $ndk.subscribe(
          gardenFilter,
          {
            closeOnEose: false,
            cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
          },
          relaySet
        );

        sub.on('event', (event: NDKEvent) => {
          console.log(`[Feed] Garden realtime: Received event ${event.id?.substring(0, 8)}`);
          handleRealtimeEvent(event);

          // Also save to dedicated Garden cache for persistence
          gardenCache.mergeEvents([event]).catch((err) => {
            console.warn('[Feed] Garden realtime: Failed to cache event:', err);
          });
        });

        activeSubscriptions.push(sub);
        console.log('[Feed] Garden realtime subscription started');
      } catch (err) {
        console.warn(`[Feed] Failed to subscribe to garden relay (cached data available):`, err);
      }

      return;
    }

    // Global mode - default subscription
    // Single subscription for hashtag-tagged content
    const hashtagFilter: any = {
      kinds: [1],
      '#t': FOOD_HASHTAGS,
      since
    };

    if (authorPubkey) {
      hashtagFilter.authors = [authorPubkey];
    }

    // Subscribe without relay targeting for now (NDK will use connected relays)
    const hashtagSub = $ndk.subscribe(hashtagFilter, {
      closeOnEose: false
    });
    hashtagSub.on('event', (event: NDKEvent) => {
      // Global feed: exclude replies (only show top-level notes)
      if (!authorPubkey && isReply(event)) {
        return;
      }

      // For Global feed, exclude posts from followed users
      if (!authorPubkey && followedPubkeysForRealtime.length > 0) {
        const authorKey = event.author?.hexpubkey || event.pubkey;
        if (authorKey && followedPubkeysForRealtime.includes(authorKey)) {
          return; // Skip - belongs in Following/Notes & Replies
        }
      }
      handleRealtimeEvent(event);
    });

    activeSubscriptions.push(hashtagSub);
  }

  function handleRealtimeEvent(event: NDKEvent) {
    // Skip if already seen
    if (seenEventIds.has(event.id)) return;

    // Validate content - skip food filter for garden/members feeds
    if (filterMode !== 'garden' && filterMode !== 'members') {
      if (!shouldIncludeEvent(event)) return;
    }

    // Mark as seen and queue for batch processing
    seenEventIds.add(event.id);
    pendingEvents.push(event);

    debouncedBatchProcess();
  }

  function debouncedBatchProcess() {
    if (batchTimeout) clearTimeout(batchTimeout);
    batchTimeout = setTimeout(processBatch, BATCH_DEBOUNCE_MS);
  }

  // RAF throttling flag for smooth UI updates
  let rafScheduled = false;

  async function processBatch() {
    if (pendingEvents.length === 0) return;

    const batch = [...pendingEvents];
    pendingEvents = [];

    // Throttle UI updates using requestAnimationFrame for smoother performance
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        // Sort and merge with existing events
        const sortedBatch = batch.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        events = [...sortedBatch, ...events].sort(
          (a, b) => (b.created_at || 0) - (a.created_at || 0)
        );

        // Update last event time
        const maxTime = Math.max(...batch.map((e) => e.created_at || 0));
        if (maxTime > lastEventTime) lastEventTime = maxTime;

        rafScheduled = false;

        // Cache in background (don't block UI)
        cacheEvents().catch(() => {
          // Cache write failed - non-critical
        });
      });
    } else {
      // If RAF already scheduled, re-queue events for next batch
      pendingEvents.push(...batch);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BACKGROUND REFRESH
  // ═══════════════════════════════════════════════════════════════

  async function fetchFreshData() {
    try {
      // Only refresh for global mode (Following/Replies use real-time subscriptions)
      if (filterMode !== 'global') return;

      const timeWindow = calculateTimeWindow('initial');
      const filter: any = {
        kinds: [1],
        '#t': FOOD_HASHTAGS,
        limit: 50,
        since: timeWindow.since
      };

      if (authorPubkey) {
        filter.authors = [authorPubkey];
      }

      const freshEvents = await fetchFromRelays(filter, [
        ...RELAY_POOLS.recipes,
        ...RELAY_POOLS.fallback
      ]);

      // For Global feed, exclude posts from followed users
      const followedSet = new Set(followedPubkeysForRealtime);

      const validNew = freshEvents.filter((e) => {
        if (seenEventIds.has(e.id)) return false;

        // Global feed: exclude replies
        if (!authorPubkey && isReply(e)) {
          return false;
        }

        // Check muted users
        if ($userPublickey) {
          const mutedUsers = getMutedUsers();
          const authorKey = e.author?.hexpubkey || e.pubkey;
          if (authorKey && mutedUsers.includes(authorKey)) return false;
        }

        // Apply food filter
        if (!shouldIncludeEvent(e)) return false;

        // Exclude followed users from Global feed
        if (followedSet.size > 0) {
          const authorKey = e.author?.hexpubkey || e.pubkey;
          if (authorKey && followedSet.has(authorKey)) {
            return false;
          }
        }

        return true;
      });

      if (validNew.length > 0) {
        validNew.forEach((e) => seenEventIds.add(e.id));
        events = [...validNew, ...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        lastEventTime = Math.max(lastEventTime, ...validNew.map((e) => e.created_at || 0));
        await cacheEvents();
      }
    } catch {
      // Background refresh failed - non-critical
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOAD MORE (PAGINATION)
  // ═══════════════════════════════════════════════════════════════

  async function loadMore() {
    if (loadingMore || !hasMore) return;

    try {
      loadingMore = true;

      const oldestEvent = events[events.length - 1];
      if (!oldestEvent?.created_at) {
        hasMore = false;
        return;
      }

      // Use adaptive timeboxing for pagination
      const paginationWindow = calculateTimeWindow('pagination');
      let olderEvents: NDKEvent[] = [];

      // Handle different filter modes
      if (filterMode === 'following' || filterMode === 'replies') {
        if (!$userPublickey) {
          hasMore = false;
          return;
        }

        // Use outbox model for Following/Replies mode with food filter
        const result = await fetchFollowingEvents($ndk, $userPublickey, {
          since: paginationWindow.since,
          until: paginationWindow.until,
          kinds: [1],
          limit: 20,
          timeoutMs: 5000,
          maxRelays: 10,
          additionalFilter: {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          }
        });

        olderEvents = result.events;
      } else if (filterMode === 'members') {
        if (!$userPublickey) {
          hasMore = false;
          return;
        }

        // Check membership status
        const membershipStatus = await checkMembershipStatus($userPublickey);
        if (!membershipStatus.hasActiveMembership) {
          hasMore = false;
          return;
        }

        // Use only members relay (not pro relay) - normalize URL for consistency
        const memberRelays: string[] = [normalizeRelayUrl(RELAY_POOLS.members[0])]; // Only pantry.zap.cooking

        // Fetch older events from member relay (all content, not just food-tagged)
        const memberFilter: any = {
          kinds: [1],
          since: paginationWindow.since,
          until: paginationWindow.until,
          limit: 20
        };

        // CRITICAL: Skip NDK cache to prevent events from other relays leaking in
        // Use longer timeout for private relays
        // Use temporary relay set since members relay may not be in default pool
        olderEvents = await fetchFromRelays(
          memberFilter,
          memberRelays,
          PRIVATE_RELAY_TIMEOUT_MS,
          true,
          true
        );
      } else if (filterMode === 'garden') {
        // Garden mode - fetch from garden relay only (all content, not just food-tagged)
        // Check if relay is connected first
        const gardenConnectedRelays = getConnectedRelays().map((r) => normalizeRelayUrl(r));
        const normalizedGardenUrl = normalizeRelayUrl(RELAY_POOLS.garden[0]);

        if (!gardenConnectedRelays.includes(normalizedGardenUrl)) {
          console.log('[Feed] Garden loadMore: Relay not connected, no more events available');
          hasMore = false;
          loadingMore = false;
          return;
        }

        const gardenFilter: any = {
          kinds: [1],
          since: paginationWindow.since,
          until: paginationWindow.until,
          limit: 20
        };

        // Use existing pool connection (useTemporaryRelaySet = false) to avoid WebSocket errors
        olderEvents = await fetchFromRelays(
          gardenFilter,
          RELAY_POOLS.garden,
          PRIVATE_RELAY_TIMEOUT_MS,
          true,
          false
        );
      } else {
        // Global mode - use hashtag filter with timeboxing
        const filter: any = {
          kinds: [1],
          '#t': FOOD_HASHTAGS,
          since: paginationWindow.since,
          until: paginationWindow.until,
          limit: 20
        };

        if (authorPubkey) {
          filter.authors = [authorPubkey];
        }

        olderEvents = await fetchFromRelays(filter, [
          ...RELAY_POOLS.recipes,
          ...RELAY_POOLS.fallback
        ]);
      }

      // For Global feed, exclude posts from followed users
      const followedSet = new Set(followedPubkeysForRealtime);

      const validOlder = olderEvents.filter((e) => {
        if (seenEventIds.has(e.id)) return false;

        // Garden mode: NO FILTERING - show ALL content from garden relay
        if (filterMode === 'garden') {
          return true;
        }

        // Check muted users (not for garden)
        if ($userPublickey) {
          const mutedUsers = getMutedUsers();
          const authorKey = e.author?.hexpubkey || e.pubkey;
          if (authorKey && mutedUsers.includes(authorKey)) return false;
        }

        // Filter replies based on mode
        if (filterMode === 'following' && isReply(e)) {
          return false; // Following mode: exclude replies
        }

        if (filterMode === 'members' && isReply(e)) {
          return false; // Members mode: exclude replies
        }

        if (!authorPubkey && filterMode === 'global' && isReply(e)) {
          return false; // Global mode: exclude replies
        }

        // Apply food filter based on context (not for garden)
        if (authorPubkey) {
          // Profile view: respect the toggle
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
        } else {
          // Global feed: always apply food filter
          if (!shouldIncludeEvent(e)) return false;

          // Exclude followed users from Global feed
          if (followedSet.size > 0 && filterMode === 'global') {
            const authorKey = e.author?.hexpubkey || e.pubkey;
            if (authorKey && followedSet.has(authorKey)) {
              return false;
            }
          }
        }

        return true;
      });

      if (validOlder.length > 0) {
        validOlder.forEach((e) => seenEventIds.add(e.id));
        events = [...events, ...validOlder];
        hasMore = olderEvents.length === 20;
        await cacheEvents();
      } else {
        hasMore = olderEvents.length === 20;
      }
    } catch {
      // Load more failed
    } finally {
      loadingMore = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RETRY LOGIC
  // ═══════════════════════════════════════════════════════════════

  async function retryWithDelay(attempts = 3, delay = 2000) {
    for (let i = 0; i < attempts; i++) {
      try {
        await loadFoodstrFeed(i === 0);
        if (!error) return;
      } catch {
        // Retry failed
      }

      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    error = true;
    loading = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════

  function stopSubscriptions() {
    // Stop all active subscriptions properly
    for (const sub of activeSubscriptions) {
      try {
        sub.stop();
      } catch {
        // Subscription already stopped - ignore
      }
    }
    activeSubscriptions = [];
  }

  async function cleanup() {
    stopSubscriptions();

    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }

    if (pendingEvents.length > 0) {
      await processBatch();
    }

    compressedCacheManager.invalidateStale();
  }

  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  // REPLY CONTEXT RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  function getParentNoteId(event: NDKEvent): string | null {
    // Get all e tags
    const eTags = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 'e');

    if (eTags.length === 0) return null;

    // Priority 1: Look for explicit 'reply' marker
    const replyTag = eTags.find((tag) => tag[3] === 'reply');
    if (replyTag) return replyTag[1] as string;

    // Priority 2: If there's a 'root' tag and other e tags, the non-root one is the reply target
    const rootTag = eTags.find((tag) => tag[3] === 'root');
    if (rootTag && eTags.length > 1) {
      // Find an e tag that's not the root
      const nonRootTag = eTags.find((tag) => tag[1] !== rootTag[1]);
      if (nonRootTag) return nonRootTag[1] as string;
    }

    // Priority 3: If only a root tag exists, this is a direct reply to root
    if (rootTag) return rootTag[1] as string;

    // Priority 4: Old style - any e tag indicates a reply (use the last one as it's typically the immediate parent)
    if (eTags.length > 0) {
      // Use the last e tag (typically the immediate parent in old convention)
      return eTags[eTags.length - 1][1] as string;
    }

    return null;
  }

  function isReply(event: NDKEvent): boolean {
    if (event.kind !== 1) return false;

    const eTags = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 'e' && tag[1]);

    if (eTags.length === 0) return false; // No e tags = top-level

    // Check if any e tag indicates a reply (not just a mention)
    return eTags.some((tag) => {
      const marker = tag[3]?.toLowerCase();

      // Explicit reply marker
      if (marker === 'reply') return true;

      // Root marker (indicates thread participation)
      if (marker === 'root') return true;

      // Old-style: e tag without marker (assumed to be reply)
      if (!marker) return true;

      // Mention marker - NOT a reply
      if (marker === 'mention') return false;

      // Unknown marker - treat as reply to be safe
      return true;
    });
  }

  // Resolve reply context (parent note author and preview)
  // Returns a promise that resolves with context info
  function resolveReplyContext(eventId: string): Promise<{
    authorName: string;
    authorPubkey: string;
    notePreview: string;
    noteId: string;
    error?: string;
  }> {
    // Check cache first
    const cached = replyContextCache.get(eventId);
    if (cached && !cached.loading) {
      return Promise.resolve({
        authorName: cached.authorName,
        authorPubkey: cached.authorPubkey,
        notePreview: cached.notePreview,
        noteId: cached.noteId,
        error: cached.error
      });
    }

    // If already loading, return a promise that waits
    if (cached?.loading) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updated = replyContextCache.get(eventId);
          if (updated && !updated.loading) {
            clearInterval(checkInterval);
            resolve({
              authorName: updated.authorName,
              authorPubkey: updated.authorPubkey,
              notePreview: updated.notePreview,
              noteId: updated.noteId,
              error: updated.error
            });
          }
        }, 100);
      });
    }

    // Mark as loading
    replyContextCache.set(eventId, {
      authorName: '',
      authorPubkey: '',
      notePreview: '',
      noteId: eventId,
      loading: true
    });

    // Return async operation
    return (async () => {
      try {
        // Fetch parent note
        const parentNote = await $ndk.fetchEvent({
          kinds: [1],
          ids: [eventId]
        });

        if (!parentNote) {
          const error = 'deleted';
          replyContextCache.set(eventId, {
            authorName: 'a deleted note',
            authorPubkey: '',
            notePreview: '',
            noteId: eventId,
            loading: false,
            error
          });
          return {
            authorName: 'a deleted note',
            authorPubkey: '',
            notePreview: '',
            noteId: eventId,
            error
          };
        }

        const authorPubkey = parentNote.pubkey || parentNote.author?.hexpubkey;
        if (!authorPubkey) {
          throw new Error('No author pubkey found');
        }

        // Fetch author profile
        const author = $ndk.getUser({ hexpubkey: authorPubkey });
        await author.fetchProfile();

        // Get author name with proper fallback to bech32 npub
        let authorName: string;
        if (author.profile?.displayName) {
          authorName = author.profile.displayName;
        } else if (author.profile?.name) {
          authorName = author.profile.name;
        } else {
          // Fallback to bech32 npub format (not hex)
          const npub = nip19.npubEncode(authorPubkey);
          authorName = npub; // Use full npub, not truncated
        }

        // Get note preview (50-80 characters, prefer 70)
        const content = parentNote.content || '';
        // Remove URLs and media tags for cleaner preview
        const cleanContent = content
          .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
          .replace(/nostr:[^\s]+/g, '') // Remove nostr: links
          .replace(/\s+/g, ' ')
          .trim();
        const previewLength = Math.min(70, Math.max(50, cleanContent.length));
        const notePreview =
          cleanContent.length > previewLength
            ? cleanContent.substring(0, previewLength) + '...'
            : cleanContent;

        const result = {
          authorName,
          authorPubkey,
          notePreview,
          noteId: eventId
        };

        // Cache result
        replyContextCache.set(eventId, {
          ...result,
          loading: false
        });

        return result;
      } catch {
        const error = 'Failed to load';
        replyContextCache.set(eventId, {
          authorName: 'a note',
          authorPubkey: '',
          notePreview: '',
          noteId: eventId,
          loading: false,
          error
        });
        return {
          authorName: 'a note',
          authorPubkey: '',
          notePreview: '',
          noteId: eventId,
          error: 'Failed to load'
        };
      }
    })();
  }

  function handleMediaError(e: Event) {
    const target = e.target as HTMLElement;
    if (target) target.style.display = 'none';
  }

  async function copyNoteId(event: NDKEvent) {
    const noteId = nip19.noteEncode(event.id);
    await navigator.clipboard.writeText(noteId);
    copiedNoteId = event.id;
    setTimeout(() => (copiedNoteId = ''), 2000);
  }

  // Carousel navigation
  function getCurrentSlide(eventId: string): number {
    return carouselStates[eventId] || 0;
  }

  function getCarouselContainer(eventId: string): HTMLElement | null {
    return document.querySelector(`[data-carousel-id="${eventId}"]`) as HTMLElement | null;
  }

  function scrollCarouselTo(eventId: string, index: number) {
    const container = getCarouselContainer(eventId);
    if (container) {
      const slideWidth = container.offsetWidth;
      container.scrollTo({ left: slideWidth * index, behavior: 'smooth' });
    }
  }

  function scrollCarouselPrev(eventId: string) {
    const container = getCarouselContainer(eventId);
    if (container) {
      const slideWidth = container.offsetWidth;
      container.scrollTo({ left: container.scrollLeft - slideWidth, behavior: 'smooth' });
    }
  }

  function scrollCarouselNext(eventId: string) {
    const container = getCarouselContainer(eventId);
    if (container) {
      const slideWidth = container.offsetWidth;
      container.scrollTo({ left: container.scrollLeft + slideWidth, behavior: 'smooth' });
    }
  }

  function handleCarouselScroll(e: Event, eventId: string) {
    const container = e.currentTarget as HTMLElement;
    if (!container) return;
    const slideWidth = container.offsetWidth;
    if (slideWidth === 0) return;
    const newIndex = Math.round(container.scrollLeft / slideWidth);
    if (carouselStates[eventId] !== newIndex) {
      carouselStates[eventId] = newIndex;
      carouselStates = { ...carouselStates };
    }
  }

  function nextSlide(eventId: string, totalSlides: number) {
    carouselStates[eventId] = ((carouselStates[eventId] || 0) + 1) % totalSlides;
    carouselStates = { ...carouselStates };
  }

  function prevSlide(eventId: string, totalSlides: number) {
    const current = carouselStates[eventId] || 0;
    carouselStates[eventId] = current === 0 ? totalSlides - 1 : current - 1;
    carouselStates = { ...carouselStates };
  }

  // Zap modal
  function openZapModal(event: NDKEvent) {
    selectedEvent = event;
    // Use setTimeout to allow component to mount before opening
    setTimeout(() => {
      zapModal = true;
    }, 0);
  }

  // Image modal
  function openImageModal(imageUrl: string, allImages: string[], index: number) {
    selectedImageUrl = imageUrl;
    selectedEventImages = allImages;
    selectedImageIndex = index;
    imageModalOpen = true;
  }

  function closeImageModal() {
    imageModalOpen = false;
    selectedImageUrl = '';
    selectedEventImages = [];
    selectedImageIndex = 0;
  }

  function nextModalImage() {
    selectedImageIndex = (selectedImageIndex + 1) % selectedEventImages.length;
    selectedImageUrl = selectedEventImages[selectedImageIndex];
  }

  function prevModalImage() {
    selectedImageIndex =
      selectedImageIndex === 0 ? selectedEventImages.length - 1 : selectedImageIndex - 1;
    selectedImageUrl = selectedEventImages[selectedImageIndex];
  }

  function handleImageModalKeydown(e: KeyboardEvent) {
    if (!imageModalOpen) return;
    if (e.key === 'Escape') closeImageModal();
    else if (e.key === 'ArrowLeft') prevModalImage();
    else if (e.key === 'ArrowRight') nextModalImage();
  }

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  // Reactive statement: Handle filter mode changes
  // Especially important for garden mode to ensure only garden relay content
  // Skip initial trigger (when lastFilterMode is still 'global' on first mount)
  let isInitialized = false;
  let filterModeChangeInProgress = false;
  $: if (
    typeof window !== 'undefined' &&
    filterMode !== lastFilterMode &&
    isInitialized &&
    !filterModeChangeInProgress
  ) {
    (async () => {
      try {
        filterModeChangeInProgress = true;
        const previousMode = lastFilterMode;
        lastFilterMode = filterMode;

        // If switching to garden or members mode, force a complete refresh to ensure only target relay content
        if (filterMode === 'garden' || filterMode === 'members') {
          // Stop all subscriptions immediately
          stopSubscriptions();

          // DON'T clear events here - loadFoodstrFeed handles clearing internally
          // Clearing here would wipe out cached data that loadFoodstrFeed loads
          // Just clear auxiliary state
          visibleNotes = new Set();
          followedPubkeysForRealtime = [];

          // Force reload without cache to ensure fresh data from target relay only
          try {
            await loadFoodstrFeed(false);
          } catch (err) {
            console.error(`[Feed] Failed to load ${filterMode} feed:`, err);
            error = true;
            loading = false;
            // Don't throw - errors are handled gracefully
          }
        } else if (previousMode === 'garden' || previousMode === 'members') {
          // When leaving garden mode, clear state to prevent garden content showing in other feeds
          stopSubscriptions();

          // DON'T clear events here - let loadFoodstrFeed handle it
          visibleNotes = new Set();

          try {
            await loadFoodstrFeed(false);
          } catch (err) {
            console.error('[Feed] Failed to load feed after garden mode:', err);
            error = true;
            loading = false;
            // Don't throw - errors are handled gracefully
          }
        }
      } catch (err) {
        // Catch any unexpected errors in the reactive statement itself
        console.error('[Feed] Unexpected error during filter mode change:', err);
        error = true;
        loading = false;
      } finally {
        filterModeChangeInProgress = false;
      }
    })();
  }

  // Unregister function for relay switch callback
  let unregisterRelaySwitchCallback: (() => void) | null = null;

  onMount(async () => {
    portalTarget = document.body;
    // Mark as initialized after onMount runs to allow reactive statement to work
    // This prevents the reactive statement from triggering on initial mount
    isInitialized = true;
    lastFilterMode = filterMode;

    // Register callback to stop subscriptions when relays are switched
    // This prevents stale subscriptions from the old relay set
    unregisterRelaySwitchCallback = onRelaySwitchStopSubscriptions(() => {
      console.log('[Feed] Relay switch detected - stopping subscriptions');
      stopSubscriptions();
      // Clear events to prevent showing stale data during switch
      events = [];
      seenEventIds.clear();
      loading = true;
    });

    // For garden/members mode, load directly (reactive statement won't trigger on initial mount)
    // DON'T clear events here - loadFoodstrFeed handles clearing internally and loads from cache first
    if (filterMode === 'garden' || filterMode === 'members') {
      visibleNotes = new Set();
      try {
        await loadFoodstrFeed(false);
      } catch (err) {
        console.error(`[Feed] Failed to load ${filterMode} feed:`, err);
        error = true;
        loading = false;
      }
      return;
    }

    // Prewarm outbox cache in background (non-blocking)
    // This fetches relay configs for all follows, making subsequent loads faster
    // Note: garden/members mode already returned early above, so no need to check here
    if ($userPublickey) {
      prewarmOutboxCache($ndk, $userPublickey).catch(() => {
        // Ignore prewarm errors - it's just an optimization
      });
    }

    try {
      await retryWithDelay();
    } catch {
      loading = false;
      error = true;
    }
  });

  onDestroy(async () => {
    // Unregister relay switch callback
    if (unregisterRelaySwitchCallback) {
      unregisterRelaySwitchCallback();
      unregisterRelaySwitchCallback = null;
    }

    if (engagementBatchTimeout) {
      clearTimeout(engagementBatchTimeout);
    }
    if (engagementPreloadTimeout) {
      clearTimeout(engagementPreloadTimeout);
    }
    cleanupInfiniteScroll();
    await cleanup();
  });

  // Batched engagement fetching - preload ALL events immediately, then update on visibility
  let engagementBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastBatchedIds = new Set<string>();
  let engagementPreloadTimeout: ReturnType<typeof setTimeout> | null = null;

  // IMMEDIATE PRELOAD: When events are loaded, preload engagement for ALL events right away
  $: if (typeof window !== 'undefined' && $ndk && $userPublickey && events.length > 0 && !loading) {
    // Clear any pending preload
    if (engagementPreloadTimeout) {
      clearTimeout(engagementPreloadTimeout);
    }

    // Preload engagement for all events immediately (not just visible ones)
    engagementPreloadTimeout = setTimeout(async () => {
      const allEventIds = events.map((e) => e.id).filter(Boolean) as string[];

      // Filter to only fetch events that aren't already fresh
      // Cached data loads instantly via getEngagementStore, so only preload if missing/stale
      const toPreload = allEventIds
        .filter((id) => {
          const store = getEngagementStore(id);
          const data = get(store);
          // Only preload if we don't have fresh cached data (cache is 24h, but check if less than 5 min = very fresh)
          return !(
            data.loading === false &&
            data.lastFetched &&
            Date.now() - data.lastFetched < 5 * 60 * 1000
          );
        })
        .filter((id) => !lastBatchedIds.has(id));

      if (toPreload.length > 0) {
        try {
          // Preload in batches of 20 for better performance
          for (let i = 0; i < toPreload.length; i += 20) {
            const batch = toPreload.slice(i, i + 20);
            await batchFetchEngagement($ndk, batch, $userPublickey);
            batch.forEach((id) => lastBatchedIds.add(id));
            // Small delay between batches to avoid overwhelming
            if (i + 20 < toPreload.length) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          }
        } catch (err) {
          console.error('[Feed] Engagement preload error:', err);
        }
      }
    }, 200); // Small delay to let cached data load first
  }

  // VISIBILITY UPDATE: When items become visible, ensure they're fresh
  $: if (
    typeof window !== 'undefined' &&
    $ndk &&
    $userPublickey &&
    visibleNotes.size > 0 &&
    events.length > 0
  ) {
    // Debounce batch fetching to avoid too many calls
    if (engagementBatchTimeout) {
      clearTimeout(engagementBatchTimeout);
    }

    engagementBatchTimeout = setTimeout(async () => {
      // Extract event IDs that are visible and haven't been batched yet
      const eventIds = events
        .filter((e) => e.id && visibleNotes.has(e.id) && !lastBatchedIds.has(e.id))
        .map((e) => e.id)
        .filter(Boolean) as string[];

      if (eventIds.length > 0) {
        try {
          await batchFetchEngagement($ndk, eventIds, $userPublickey);
          // Track what we've batched
          eventIds.forEach((id) => lastBatchedIds.add(id));
        } catch (err) {
          console.error('[Feed] Batch engagement fetch error:', err);
        }
      }
    }, 100); // 100ms debounce
  }

  // Reactive statement to handle filter mode changes
  // Note: Filter mode changes are handled by the reactive statement above (around line 2257)
  // This ensures garden mode properly refreshes and only shows garden relay content
</script>

<FeedErrorBoundary>
  <div class="max-w-2xl mx-auto">
    <!-- Note: Refresh indicator is handled by PullToRefresh component on the page -->

    {#if filterMode === 'following' || filterMode === 'replies' || authorPubkey}
      <div class="flex items-center justify-end gap-2 px-2 sm:px-0 mb-4">
        {#if foodFilterEnabled}
          <span class="text-sm">
            🍳 <span class="text-caption">Only</span><span
              class="font-bold"
              style="color: var(--color-text-primary)">Food</span
            >
          </span>
        {:else}
          <span class="text-sm text-caption">All posts</span>
        {/if}
        <button
          on:click={() => {
            foodFilterEnabled = !foodFilterEnabled;
            seenEventIds.clear();
            events = [];
            loadFoodstrFeed(false);
          }}
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {foodFilterEnabled
            ? 'bg-primary'
            : 'bg-accent-gray'}"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {foodFilterEnabled
              ? 'translate-x-6'
              : 'translate-x-1'}"
          />
        </button>
      </div>
    {/if}

    {#if (filterMode === 'following' || filterMode === 'replies') && $userPublickey === ''}
      <div
        class="mb-4 p-4 bg-accent-gray rounded-lg"
        style="border: 1px solid var(--color-input-border)"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see {filterMode ===
          'following'
            ? 'posts from people you follow'
            : 'replies from people you follow'}.
        </p>
      </div>
    {/if}

    {#if loading}
      <div class="space-y-6">
        {#each Array(3) as _}
          <FeedPostSkeleton />
        {/each}
      </div>
    {:else if error}
      <div class="py-12 text-center">
        <div class="max-w-sm mx-auto space-y-6">
          <div style="color: var(--color-caption)">
            <svg
              class="h-12 w-12 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <p class="text-lg font-medium">Unable to load cooking posts</p>
            <p class="text-sm">Please check your connection and try again.</p>
          </div>
          <button
            on:click={() => retryWithDelay()}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    {:else if events.length === 0}
      <div class="py-12 text-center">
        <div class="max-w-sm mx-auto space-y-6">
          <div style="color: var(--color-caption)">
            <svg
              class="h-12 w-12 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <p class="text-lg font-medium">No cooking posts found</p>
            <p class="text-sm">
              Try posting with cooking tags like #foodstr, #cook, #cooking, etc.
            </p>
          </div>
          <button
            on:click={() => retryWithDelay()}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Refresh Feed
          </button>
        </div>
      </div>
    {:else}
      <div class="space-y-0">
        {#each events as event (event.id)}
          <article
            class="border-b py-4 sm:py-6 first:pt-0"
            style="border-color: var(--color-input-border)"
          >
            <div class="flex space-x-3 px-2 sm:px-0">
              {#if !hideAvatar}
                <a
                  href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
                  class="flex-shrink-0"
                >
                  <CustomAvatar
                    className="cursor-pointer"
                    pubkey={event.author?.hexpubkey || event.pubkey}
                    size={40}
                  />
                </a>
              {/if}

              <div class="flex-1 min-w-0">
                {#if isReply(event)}
                  {@const parentNoteId = getParentNoteId(event)}
                  {#if parentNoteId}
                    {#await resolveReplyContext(parentNoteId)}
                      <!-- Loading state -->
                      <div class="parent-quote-embed mb-3">
                        <div class="parent-quote-loading">
                          <div class="w-4 h-4 bg-accent-gray rounded-full animate-pulse"></div>
                          <div class="h-3 bg-accent-gray rounded w-20 animate-pulse"></div>
                        </div>
                      </div>
                    {:then context}
                      <!-- Always-visible embedded parent quote -->
                      <a
                        href="/{nip19.noteEncode(parentNoteId)}"
                        class="parent-quote-embed mb-3 block hover:opacity-90 transition-opacity"
                        on:click|stopPropagation
                      >
                        <div class="parent-quote-header">
                          {#if context.authorPubkey}
                            <CustomAvatar pubkey={context.authorPubkey} size={16} />
                          {/if}
                          <span class="parent-quote-author">
                            {#if context.error === 'deleted'}
                              <span class="italic">deleted note</span>
                            {:else if context.error === 'Failed to load'}
                              a note
                            {:else}
                              {context.authorName.startsWith('npub')
                                ? context.authorName.substring(0, 12) + '...'
                                : context.authorName}
                            {/if}
                          </span>
                        </div>
                        {#if context.notePreview && !context.error}
                          <p class="parent-quote-content">{context.notePreview}</p>
                        {/if}
                        <span class="parent-quote-link"> View full thread → </span>
                      </a>
                    {:catch}
                      <!-- Fallback - simple link -->
                      <a
                        href="/{nip19.noteEncode(parentNoteId)}"
                        class="parent-quote-embed mb-3 block"
                      >
                        <div class="parent-quote-header">
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                            />
                          </svg>
                          <span class="parent-quote-author">Replying to a note</span>
                        </div>
                      </a>
                    {/await}
                  {/if}
                {/if}

                <div class="flex items-center space-x-2 mb-2 flex-wrap">
                  {#if !hideAuthorName}
                    <AuthorName {event} />
                    <span class="text-sm" style="color: var(--color-caption)">·</span>
                  {/if}
                  <span class="text-sm" style="color: var(--color-caption)">
                    {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                  </span>
                  <ClientAttribution tags={event.tags} enableEnrichment={false} />
                </div>

                {#if getContentWithoutMedia(event.content)}
                  {@const cleanContent = getContentWithoutMedia(event.content)}
                  <div
                    class="text-sm leading-relaxed mb-3"
                    style="color: var(--color-text-primary)"
                  >
                    <NoteContent content={cleanContent} />
                  </div>
                {/if}

                {#if getImageUrls(event).length > 0}
                  {@const mediaUrls = getImageUrls(event)}

                  <div class="mb-3 -mx-2 sm:mx-0">
                    <div
                      class="relative rounded-none sm:rounded-lg border-0 sm:border bg-input"
                      style="border-color: var(--color-input-border)"
                    >
                      <!-- Swipeable carousel container -->
                      <div
                        class="carousel-container flex overflow-x-auto snap-x snap-mandatory"
                        style="touch-action: pan-y pan-x; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; background-color: #1f2937;"
                        data-carousel-id={event.id}
                        on:scroll={(e) => handleCarouselScroll(e, event.id)}
                      >
                        {#each mediaUrls as imageUrl, index}
                          <div
                            class="carousel-slide flex-shrink-0 w-full snap-center flex items-center justify-center"
                            style="background-color: #1f2937; min-height: 200px;"
                          >
                            {#if isImageUrl(imageUrl)}
                              <button
                                class="w-full flex items-center justify-center"
                                style="touch-action: pan-y pan-x; -webkit-tap-highlight-color: transparent; background-color: #1f2937;"
                                on:click={() => openImageModal(imageUrl, mediaUrls, index)}
                              >
                                <img
                                  src={getOptimizedImageUrl(imageUrl)}
                                  alt="Preview"
                                  class="carousel-image cursor-pointer hover:opacity-95 transition-opacity select-none"
                                  style="-webkit-user-drag: none; user-drag: none; -webkit-touch-callout: none; pointer-events: auto;"
                                  loading="lazy"
                                  decoding="async"
                                  draggable="false"
                                  on:error={handleMediaError}
                                />
                              </button>
                            {:else if isVideoUrl(imageUrl)}
                              <video
                                src={imageUrl}
                                controls
                                class="carousel-image select-none"
                                style="touch-action: pan-y pan-x; -webkit-touch-callout: none; background-color: #1f2937;"
                                preload="metadata"
                                draggable="false"
                                on:error={handleMediaError}
                              >
                                <track kind="captions" src="" srclang="en" label="English" />
                              </video>
                            {/if}
                          </div>
                        {/each}
                      </div>

                      {#if mediaUrls.length > 1}
                        <!-- Arrow buttons (hidden on mobile, visible on larger screens) -->
                        <button
                          on:click={() => scrollCarouselPrev(event.id)}
                          class="hidden sm:block absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M15 19l-7-7 7-7"
                            />
                          </svg>
                        </button>

                        <button
                          on:click={() => scrollCarouselNext(event.id)}
                          class="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </button>

                        <!-- Slide counter -->
                        <div
                          class="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded z-10"
                        >
                          {getCurrentSlide(event.id) + 1} / {mediaUrls.length}
                        </div>

                        <!-- Dot indicators -->
                        {#if mediaUrls.length <= 5}
                          <div
                            class="absolute bottom-2 left-1/2 -translate-x-1/2 flex space-x-1.5 z-10"
                          >
                            {#each mediaUrls as _, index}
                              <button
                                on:click={() => scrollCarouselTo(event.id, index)}
                                class="w-2 h-2 rounded-full transition-all {index ===
                                getCurrentSlide(event.id)
                                  ? 'bg-white'
                                  : 'bg-white/50'}"
                              />
                            {/each}
                          </div>
                        {/if}
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Reaction pills row -->
                {#if visibleNotes.has(event.id)}
                  <div class="px-2 sm:px-0">
                    <NoteReactionPills {event} />
                  </div>
                {/if}

                <div
                  class="flex items-center justify-between px-2 sm:px-0 py-1"
                  use:lazyLoadAction={event.id}
                >
                  <div class="flex items-center space-x-1">
                    {#if visibleNotes.has(event.id)}
                      <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
                        <NoteTotalLikes {event} />
                      </div>

                      <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
                        <NoteTotalComments {event} />
                      </div>

                      <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
                        <NoteRepost {event} />
                      </div>

                      <button
                        class="flex items-center hover:bg-amber-50 rounded-full p-1.5 transition-colors cursor-pointer"
                        on:click|stopPropagation={() => openZapModal(event)}
                      >
                        <NoteTotalZaps {event} />
                      </button>
                    {:else}
                      <span class="text-caption p-1.5">♡ –</span>
                      <span class="text-caption p-1.5">💬 –</span>
                      <span class="text-caption p-1.5">🔁 –</span>
                      <span class="text-caption p-1.5">⚡ –</span>
                    {/if}
                  </div>

                  <div class="flex items-center space-x-1">
                    <button
                      class="flex items-center text-caption hover:opacity-80 hover:bg-accent-gray rounded-full p-1.5 transition-colors"
                      on:click={() => copyNoteId(event)}
                      title="Copy note ID"
                    >
                      {#if copiedNoteId === event.id}
                        <CheckIcon size={16} weight="bold" class="text-green-500" />
                      {:else}
                        <CopyIcon size={16} />
                      {/if}
                    </button>
                  </div>
                </div>

                <div class="px-2 sm:px-0">
                  {#if visibleNotes.has(event.id)}
                    <FeedComments {event} />
                  {/if}
                </div>
              </div>
            </div>
          </article>
        {/each}

        <!-- Infinite scroll sentinel - triggers automatic loading -->
        {#if hasMore}
          <div bind:this={loadMoreSentinel} class="py-4 text-center">
            {#if loadingMore}
              <LoadingState type="spinner" size="lg" text="Loading more posts..." showText={true} />
            {:else}
              <!-- Show button as fallback, but infinite scroll will auto-trigger -->
              <button
                on:click={loadMore}
                class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
                style="color: var(--color-text-primary)"
              >
                Load More
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</FeedErrorBoundary>

{#if selectedEvent}
  <ZapModal bind:open={zapModal} event={selectedEvent} />
{/if}

<svelte:window on:keydown={handleImageModalKeydown} />

{#if imageModalOpen && portalTarget}
  <div use:portal={portalTarget}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
      on:click={closeImageModal}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="relative bg-input rounded-lg shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden"
        on:click|stopPropagation
      >
        <button
          class="absolute top-2 right-2 bg-input hover:bg-accent-gray rounded-full p-2 shadow-md transition z-10"
          style="color: var(--color-text-primary)"
          on:click={closeImageModal}
          aria-label="Close image"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {#if selectedEventImages.length > 1}
          <div
            class="absolute top-2 left-2 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full z-10"
          >
            {selectedImageIndex + 1} / {selectedEventImages.length}
          </div>

          <button
            on:click|stopPropagation={prevModalImage}
            class="absolute left-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
            style="color: var(--color-text-primary)"
            aria-label="Previous image"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <button
            on:click|stopPropagation={nextModalImage}
            class="absolute right-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
            style="color: var(--color-text-primary)"
            aria-label="Next image"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        {/if}

        <img
          src={selectedImageUrl}
          alt="Full size preview"
          class="w-full h-auto max-h-[90vh] object-contain"
        />
      </div>
    </div>
  </div>
{/if}

<style>
  /* Carousel touch behavior - allow both vertical (feed) and horizontal (carousel) scrolling */
  .carousel-container {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge */
    touch-action: pan-y pan-x !important; /* Allow both vertical feed scroll and horizontal carousel swipe */
    will-change: scroll-position; /* Optimize scrolling performance */
    scroll-snap-type: x mandatory;
  }

  .carousel-container::-webkit-scrollbar {
    display: none; /* Chrome/Safari/Opera */
  }

  .carousel-slide {
    touch-action: pan-y pan-x !important; /* Allow both scroll directions - browser detects gesture direction */
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }

  .carousel-slide img,
  .carousel-slide video,
  .carousel-slide button {
    -webkit-touch-callout: none; /* Disable iOS callout */
    -webkit-user-select: none; /* Prevent text selection */
    user-select: none;
    -webkit-user-drag: none; /* Prevent dragging */
    user-drag: none;
  }

  /* Allow vertical scrolling to pass through to feed */
  .carousel-slide button {
    touch-action: pan-y pan-x !important;
  }

  /* Dynamic height carousel images - adapt to aspect ratio */
  .carousel-image {
    width: 100%;
    height: auto;
    max-height: 70vh;
    object-fit: contain;
  }

  /* Parent quote embed - always visible */
  .parent-quote-embed {
    padding: 0.5rem 0.75rem;
    background: var(--color-input);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
  }

  .parent-quote-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .parent-quote-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .parent-quote-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin: 0 0 0.375rem 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .parent-quote-link {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-primary, #3b82f6);
  }

  .parent-quote-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Swipeable carousel styles */
  .carousel-container {
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge */
  }

  .carousel-container::-webkit-scrollbar {
    display: none; /* Chrome/Safari */
  }

  .carousel-slide {
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }
</style>
