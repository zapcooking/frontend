<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { formatDistanceToNow } from 'date-fns';
  import CustomAvatar from './CustomAvatar.svelte';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
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

  // Outbox model for efficient following feed
  import { 
    fetchFollowingEvents, 
    getFollowedPubkeys,
    prewarmOutboxCache,
    type OutboxFetchResult 
  } from '$lib/followOutbox';
  
  // Reply context prefetching for better UX
  import { prefetchReplyContexts } from '$lib/replyContext';

  // ═══════════════════════════════════════════════════════════════
  // PROPS
  // ═══════════════════════════════════════════════════════════════
  
  export let authorPubkey: string | undefined = undefined;
  export let hideAvatar: boolean = false;
  export let hideAuthorName: boolean = false;
  export let filterMode: 'global' | 'following' | 'replies' = 'global';

  // Exposed refresh function for pull-to-refresh
  export async function refresh(): Promise<void> {
    if (loading || isRefreshing) return;
    
    isRefreshing = true;
    try {
      // Clear existing data for fresh load
      seenEventIds.clear();
      events = [];
      visibleNotes = new Set();
      followedPubkeysForRealtime = [];
      
      // Reload without cache
      await loadFoodstrFeed(false);
    } finally {
      isRefreshing = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS - Compiled once at module level
  // ═══════════════════════════════════════════════════════════════

  // Food-related hashtags for filtering - expanded for better discovery
  const FOOD_HASHTAGS = [
    'foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 
    'carnivor', 'carnivorediet', 'soup', 'soupstr', 'drink', 'eat', 'burger', 
    'steak', 'steakstr', 'dine', 'dinner', 'lunch', 'breakfast', 'supper', 'yum', 
    'snack', 'snackstr', 'dessert', 'beef', 'chicken', 'bbq', 'coffee', 'mealprep', 
    'meal', 'recipe', 'recipestr', 'recipes', 'food', 'foodie', 'foodporn', 'instafood',
    'foodstagram', 'foodblogger', 'homecooking', 'fromscratch', 'baking', 'baker',
    'pastry', 'chef', 'chefs', 'cuisine', 'gourmet', 'restaurant', 'restaurants',
    'pasta', 'pizza', 'sushi', 'tacos', 'taco', 'burrito', 'sandwich', 'salad',
    'soup', 'stew', 'curry', 'stirfry', 'grill', 'grilled', 'roast', 'roasted',
    'fried', 'baked', 'smoked', 'fermented', 'pickled', 'preserved', 'homemade',
    'vegan', 'vegetarian', 'keto', 'paleo', 'glutenfree', 'dairyfree', 'healthy',
    'nutrition', 'nutritionist', 'dietitian', 'mealplan', 'mealprep', 'batchcooking'
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
    'foodstr','cookstr','zapcooking','recipestr','soupstr','drinkstr','snackstr','steakstr','mealprep',
    'foodies','carnivor','carnivorediet'
  ];

  // Hard words (very low false positive risk; 1 hit is enough)
  const HARD_FOOD_WORDS = [
    // Recipes & cooking intent
    'recipe','recipes','recipestr',
    'cooking','baking','bake',
    'chef','chefs','kitchen',
    'ingredient','ingredients',
    'seasoned','seasoning','marinated','saute','sauteed','simmer','braised',
    'fermented','pickled','smoked','slow cooked','air fried',

    // Meals (strong real-world food signal)
    'breakfast','lunch','dinner','dessert',
    'mealprep','meal prep',
    'homecooking','home cooked','fromscratch','homemade',

    // Food items & dishes
    'pasta','pizza','sushi','taco','tacos','burrito','sandwich','salad',
    'soup','stew','curry','burger','steak','bbq',
    'coffee',

    // Ingredients & staples
    'garlic','onion','tomato','cheese','butter','olive oil',
    'rice','beans','eggs','flour',

    // Diets & preferences (safe as hard)
    'vegan','vegetarian','keto','paleo',
    'glutenfree','gluten free',
    'dairyfree','dairy free',

    // Restaurants (strong enough on Nostr)
    'restaurant','restaurants'
  ];

  // Soft words (common metaphor / news words; require 2 hits)
  const SOFT_FOOD_WORDS = [
    // ambiguous/general
    'food','meal','supper',
    // slang/metaphor prone
    'spicy','sweet','flavor','healthy','organic',
    // journalism-metaphor prone
    'grill','grilled','roast','roasted',
    // cuisines (can be ambiguous - e.g., "Italian politics")
    'italian','mexican','thai','indian','mediterranean','japanese','korean'
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
  const FOOD_HASHTAG_REGEX = new RegExp(`(?:^|\\s)#(${FOOD_HASHTAG_TERMS.map(escapeRegex).join('|')})\\b`, 'i');
  const HARD_FOOD_REGEX = new RegExp(HARD_FOOD_WORDS.map(termToPattern).join('|'), 'ig');
  const SOFT_FOOD_REGEX = new RegExp(SOFT_FOOD_WORDS.map(termToPattern).join('|'), 'ig');

  // Macro exclusion for economics phrases
  const MACRO_EXCLUDING_FOOD_ENERGY_REGEX = /\b(excluding|exclude)\s+food\s+and\s+energy\b/i;

  // Debug flag (set to true to log filter decisions)
  const DEBUG_FOOD_FILTER = false;

  const HASHTAG_PATTERN = /(^|\s)#([^\s#]+)/g;
  const URL_REGEX = /(https?:\/\/[^\s]+)/g;
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
  const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

  const MAX_HASHTAGS = 5;
  const CACHE_KEY = 'foodstr_feed_cache';
  const BATCH_DEBOUNCE_MS = 300;
  const SUBSCRIPTION_TIMEOUT_MS = 4000;
  const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

  // Relay pools by purpose - optimized based on speed test results
  // Speed test: nostr.wine (305ms) > nos.lol (342ms) > purplepag.es (356ms) > relay.damus.io (394ms) > kitchen.zap.cooking (510ms) > relay.nostr.band (514ms)
  const RELAY_POOLS = {
    recipes: ['wss://kitchen.zap.cooking'],      // Curated recipe content (510ms, but worth it for relevance)
    fallback: ['wss://nos.lol', 'wss://relay.damus.io'],  // Fast general relays (nos.lol 342ms, relay.damus.io 394ms)
    discovery: ['wss://nostr.wine', 'wss://relay.primal.net', 'wss://purplepag.es'],  // Additional relays for discovery
    profiles: ['wss://purplepag.es']             // Profile metadata (356ms, specialized for kind:0)
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
  let lastFilterMode: 'global' | 'following' | 'replies' = 'global';
  
  // Followed pubkeys for real-time subscriptions (populated by outbox module)
  let followedPubkeysForRealtime: string[] = [];
  
  // Reply context cache (parent note info)
  const replyContextCache = new Map<string, {
    authorName: string;
    authorPubkey: string;
    notePreview: string;
    noteId: string;
    loading: boolean;
    error?: string;
  }>();
  
  
  // Deduplication
  const seenEventIds = new Set<string>();
  
  // UI state
  let carouselStates: { [eventId: string]: number } = {};
  let expandedPosts: { [eventId: string]: boolean } = {};
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
      { rootMargin: '100px' }
    );
    
    observer.observe(node);
    
    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  function sevenDaysAgo(): number {
    return Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS;
  }

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function isImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lower.includes(ext));
  }

  function isVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lower.includes(ext)) ||
           lower.includes('youtube.com') || 
           lower.includes('youtu.be') ||
           lower.includes('vimeo.com');
  }

  function getImageUrls(event: NDKEvent): string[] {
    const content = event.content || '';
    const urls = content.match(URL_REGEX) || [];
    return urls.filter(url => isImageUrl(url) || isVideoUrl(url));
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
    let cleaned = content.replace(URL_REGEX, (url) => {
      return (isImageUrl(url) || isVideoUrl(url)) ? '' : url;
    }).replace(/\s+/g, ' ').trim();
    
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
      if (DEBUG_FOOD_FILTER) console.log('[FoodFilter] PASS: hashtag match');
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
        if (DEBUG_FOOD_FILTER) console.log('[FoodFilter] REJECT: macro phrase, no other signals');
        return false;
      }
    }
    
    // Include if at least 1 hard match
    if (hardCount >= 1) {
      if (DEBUG_FOOD_FILTER) console.log('[FoodFilter] PASS: hard matches:', hardMatches.slice(0, 2));
      return true;
    }
    
    // Include if at least 2 soft matches
    if (softCount >= 2) {
      if (DEBUG_FOOD_FILTER) console.log('[FoodFilter] PASS: soft matches:', softMatches.slice(0, 2));
      return true;
    }
    
    // Not enough food signals
    if (DEBUG_FOOD_FILTER && (hardCount > 0 || softCount > 0)) {
      console.log('[FoodFilter] REJECT: insufficient signals - hard:', hardCount, 'soft:', softCount);
    }
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
      ? event.tags.filter(tag => Array.isArray(tag) && tag[0] === 't').length
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
    const hasFoodHashtag = event.tags.some(tag => 
      Array.isArray(tag) && 
      tag[0] === 't' && 
      FOOD_HASHTAGS.includes(tag[1]?.toLowerCase() || '')
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
      const cacheData = {
        events: events.slice(0, 100).map(e => ({
          id: e.id,
          pubkey: e.pubkey,
          content: e.content,
          created_at: e.created_at,
          tags: e.tags,
          author: e.author ? {
            hexpubkey: e.author.hexpubkey,
            profile: e.author.profile
          } : null
        })),
        timestamp: Date.now(),
        lastEventTime
      };
      
      await compressedCacheManager.set({
        ...COMPRESSED_FEED_CACHE_CONFIG,
        key: CACHE_KEY
      }, cacheData);
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
      
      if (!cacheData || !cacheData.events || !Array.isArray(cacheData.events) || cacheData.events.length === 0) {
        return false;
      }
      
      const cachedEvents = cacheData.events
        .map((e: any) => ({
          ...e,
          author: e.author ? {
            hexpubkey: e.author.hexpubkey,
            profile: e.author.profile
          } : null
        }))
        .filter(shouldIncludeEvent);
      
      if (cachedEvents.length === 0) return false;
      
      // Add to seen set
      cachedEvents.forEach((e: NDKEvent) => seenEventIds.add(e.id));
      
      events = cachedEvents;
      lastEventTime = Math.max(...events.map(e => e.created_at || 0));
      return true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RELAY FETCHING
  // ═══════════════════════════════════════════════════════════════

  async function fetchFromRelays(
    filter: any, 
    relayUrls: string[], 
    timeoutMs: number = SUBSCRIPTION_TIMEOUT_MS
  ): Promise<NDKEvent[]> {
    try {
      // Use fetchEvents with relay set for targeted querying
      // This ensures we query the specific relays the user posted to
      // Note: WebSocket connection errors from NDK are expected when relays are down
      // and are handled gracefully by the connection manager's circuit breaker
      const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
      const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, $ndk, true);
      
      const timeoutPromise = new Promise<NDKEvent[]>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      );
      
      const eventsPromise = $ndk.fetchEvents(filter, undefined, relaySet);
      
      // Race between fetchEvents and timeout
      const events = await Promise.race([eventsPromise, timeoutPromise]);
      return Array.from(events);
    } catch (err: any) {
      if (err.message === 'Timeout') {
        return [];
      }
      
      // Fallback to subscription if fetchEvents fails
      return new Promise((resolve) => {
        const fetchedEvents: NDKEvent[] = [];
        const seenIds = new Set<string>();
        let resolved = false;
        
        const sub = $ndk.subscribe(filter, { 
          closeOnEose: true
        });
        
        sub.on('event', (event: NDKEvent) => {
          if (event.id && !seenIds.has(event.id)) {
            seenIds.add(event.id);
            fetchedEvents.push(event);
          }
        });
        
        sub.on('eose', () => {
          if (!resolved) {
            resolved = true;
            sub.stop();
            resolve(fetchedEvents);
          }
        });
        
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            sub.stop();
            resolve(fetchedEvents);
          }
        }, timeoutMs);
      });
    }
  }

  // Fetch recent notes and filter client-side for notes without hashtags
  async function fetchNotesWithoutHashtags(since: number): Promise<NDKEvent[]> {
    
    const filter = {
      kinds: [1],
      limit: 300, // Increased limit for better discovery
      since
    };
    
    try {
      const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
      // Query from multiple relay pools in parallel for maximum discovery
      const allRelays = [...RELAY_POOLS.fallback, ...RELAY_POOLS.discovery];
      const relaySet = NDKRelaySet.fromRelayUrls(
        allRelays, 
        $ndk, 
        true
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
        const hasFoodHashtag = event.tags.some(tag => 
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
      notesWithoutHashtags.forEach(event => {
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

  async function loadFoodstrFeed(useCache = true) {
    try {
      // Try cache first
      if (useCache && await loadCachedEvents()) {
        loading = false;
        error = false;
        setTimeout(() => fetchFreshData(), 100);
        return;
      }
      
      loading = true;
      error = false;
      events = [];
      seenEventIds.clear();
      
      if (!$ndk) throw new Error('NDK not initialized');
      
      try {
        await $ndk.connect();
      } catch {
        // Connection warning - continue anyway
      }

      const since = sevenDaysAgo();
      
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
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since,
          kinds: [1],
          limit: 100,
          timeoutMs: 8000
        });
        
        console.log('[Feed] Raw events from outbox:', result.events.length);
        
        console.log(`[Feed] Outbox fetch: ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`);
        
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
        const rejected = result.events.filter(e => {
          return isReply(e) || !shouldIncludeEvent(e);
        }).slice(0, 5);
        console.log('[Feed] Sample rejected:', rejected.map(e => ({
          content: e.content?.slice(0, 100),
          tags: e.tags.filter(t => t[0] === 't').map(t => t[1])
        })));
        
        events = dedupeAndSort(validEvents);
        loading = false;
        error = false;
        
        if (events.length > 0) {
          lastEventTime = Math.max(...events.map(e => e.created_at || 0));
          await cacheEvents();
        }
        
        startRealtimeSubscription();
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
        
        // Use outbox model - same fetch, different filtering
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since,
          kinds: [1],
          limit: 100,
          timeoutMs: 8000
        });
        
        console.log('[Feed] Raw events from outbox:', result.events.length);
        
        console.log(`[Feed] Outbox fetch (replies): ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`);
        
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
        const rejected = result.events.filter(e => !shouldIncludeEvent(e)).slice(0, 5);
        console.log('[Feed] Sample rejected:', rejected.map(e => ({
          content: e.content?.slice(0, 100),
          tags: e.tags.filter(t => t[0] === 't').map(t => t[1])
        })));
        
        events = dedupeAndSort(foodEvents);
        loading = false;
        error = false;
        
        if (events.length > 0) {
          lastEventTime = Math.max(...events.map(e => e.created_at || 0));
          await cacheEvents();
        }
        
        // Prefetch reply contexts for better UX (batch fetch parent notes)
        prefetchReplyContexts($ndk, events.slice(0, 20)).catch(() => {
          // Non-critical - individual contexts will be fetched as needed
        });
        
        startRealtimeSubscription();
        return;
      }
      
      // Global mode (default) - existing logic
      // Build filters
      const hashtagFilter: any = {
        kinds: [1],
        '#t': FOOD_HASHTAGS,
        limit: 50,
        since
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
        fetchPromises.push(fetchNotesWithoutHashtags(since));
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
      const validEvents = allFetchedEvents.filter(event => {
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
      events = dedupeAndSort(validEvents);
      
      // Always set loading to false, even if no events
      loading = false;
      error = false;
      
      if (events.length > 0) {
        lastEventTime = Math.max(...events.map(e => e.created_at || 0));
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
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REAL-TIME SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════

  async function startRealtimeSubscription() {
    // Clean up any existing subscriptions
    stopSubscriptions();
    
    const since = lastEventTime > 0 ? lastEventTime + 1 : Math.floor(Date.now() / 1000);
    
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
    
    // Validate content
    if (!shouldIncludeEvent(event)) return;
    
    // Mark as seen and queue for batch processing
    seenEventIds.add(event.id);
    pendingEvents.push(event);
    
    debouncedBatchProcess();
  }

  function debouncedBatchProcess() {
    if (batchTimeout) clearTimeout(batchTimeout);
    batchTimeout = setTimeout(processBatch, BATCH_DEBOUNCE_MS);
  }

  async function processBatch() {
    if (pendingEvents.length === 0) return;
    
    const batch = [...pendingEvents];
    pendingEvents = [];
    
    // Sort and merge with existing events
    const sortedBatch = batch.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    events = [...sortedBatch, ...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    
    // Update last event time
    const maxTime = Math.max(...batch.map(e => e.created_at || 0));
    if (maxTime > lastEventTime) lastEventTime = maxTime;
    
    await cacheEvents();
  }

  // ═══════════════════════════════════════════════════════════════
  // BACKGROUND REFRESH
  // ═══════════════════════════════════════════════════════════════

  async function fetchFreshData() {
    try {
      // Only refresh for global mode (Following/Replies use real-time subscriptions)
      if (filterMode !== 'global') return;
      
      const filter: any = {
        kinds: [1],
        '#t': FOOD_HASHTAGS,
        limit: 50,
        since: sevenDaysAgo()
      };
      
      if (authorPubkey) {
        filter.authors = [authorPubkey];
      }
      
      const freshEvents = await fetchFromRelays(
        filter, 
        [...RELAY_POOLS.recipes, ...RELAY_POOLS.fallback]
      );
      
      // For Global feed, exclude posts from followed users
      const followedSet = new Set(followedPubkeysForRealtime);
      
      const validNew = freshEvents.filter(e => {
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
        validNew.forEach(e => seenEventIds.add(e.id));
        events = [...validNew, ...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        lastEventTime = Math.max(lastEventTime, ...validNew.map(e => e.created_at || 0));
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
      
      let olderEvents: NDKEvent[] = [];
      
      // Handle different filter modes
      if (filterMode === 'following' || filterMode === 'replies') {
        if (!$userPublickey) {
          hasMore = false;
          return;
        }
        
        // Use outbox model for Following/Replies mode
        const result = await fetchFollowingEvents($ndk, $userPublickey, {
          since: 0, // Get all history
          until: oldestEvent.created_at - 1,
          kinds: [1],
          limit: 20,
          timeoutMs: 8000
        });
        
        olderEvents = result.events;
      } else {
        // Global mode - use hashtag filter
        const filter: any = {
          kinds: [1],
          '#t': FOOD_HASHTAGS,
          until: oldestEvent.created_at - 1,
          limit: 20
        };
        
        if (authorPubkey) {
          filter.authors = [authorPubkey];
        }

        olderEvents = await fetchFromRelays(
          filter, 
          [...RELAY_POOLS.recipes, ...RELAY_POOLS.fallback]
        );
      }
      
      // For Global feed, exclude posts from followed users
      const followedSet = new Set(followedPubkeysForRealtime);
      
      const validOlder = olderEvents.filter(e => {
        if (seenEventIds.has(e.id)) return false;
        
        // Check muted users
        if ($userPublickey) {
          const mutedUsers = getMutedUsers();
          const authorKey = e.author?.hexpubkey || e.pubkey;
          if (authorKey && mutedUsers.includes(authorKey)) return false;
        }
        
        // Filter replies based on mode
        if (filterMode === 'following' && isReply(e)) {
          return false; // Following mode: exclude replies
        }
        
        if (!authorPubkey && filterMode === 'global' && isReply(e)) {
          return false; // Global mode: exclude replies
        }
        
        // Apply food filter based on context
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
        validOlder.forEach(e => seenEventIds.add(e.id));
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
        await new Promise(resolve => setTimeout(resolve, delay));
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
    const eTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'e');
    
    if (eTags.length === 0) return null;
    
    // Priority 1: Look for explicit 'reply' marker
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) return replyTag[1] as string;
    
    // Priority 2: If there's a 'root' tag and other e tags, the non-root one is the reply target
    const rootTag = eTags.find(tag => tag[3] === 'root');
    if (rootTag && eTags.length > 1) {
      // Find an e tag that's not the root
      const nonRootTag = eTags.find(tag => tag[1] !== rootTag[1]);
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
    
    const eTags = event.tags.filter(tag => 
      Array.isArray(tag) && tag[0] === 'e' && tag[1]
    );
    
    if (eTags.length === 0) return false; // No e tags = top-level
    
    // Check if any e tag indicates a reply (not just a mention)
    return eTags.some(tag => {
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
        const notePreview = cleanContent.length > previewLength 
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
    setTimeout(() => copiedNoteId = '', 2000);
  }

  function toggleExpanded(eventId: string) {
    expandedPosts[eventId] = !expandedPosts[eventId];
    expandedPosts = { ...expandedPosts };
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
    zapModal = true;
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
    selectedImageIndex = selectedImageIndex === 0 
      ? selectedEventImages.length - 1 
      : selectedImageIndex - 1;
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

  onMount(async () => {
    lastFilterMode = filterMode;
    
    // Prewarm outbox cache in background (non-blocking)
    // This fetches relay configs for all follows, making subsequent loads faster
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
    await cleanup();
  });
  
  // Reactive statement to handle filter mode changes
  $: if (typeof window !== 'undefined' && filterMode !== lastFilterMode && !loading) {
    lastFilterMode = filterMode;
    seenEventIds.clear();
    events = [];
    followedPubkeysForRealtime = []; // Reset for new subscription
    visibleNotes = new Set(); // Reset lazy loading state
    loadFoodstrFeed(false);
  }
</script>

<FeedErrorBoundary>
  <div class="max-w-2xl mx-auto">
  
  {#if isRefreshing}
    <div class="mb-4">
      <LoadingState 
        type="spinner" 
        size="sm" 
        text="Refreshing feed..." 
        showText={true}
      />
    </div>
  {/if}

  {#if filterMode === 'following' || filterMode === 'replies' || authorPubkey}
    <div class="flex items-center justify-end gap-2 px-2 sm:px-0 mb-4">
      {#if foodFilterEnabled}
        <span class="text-sm">
          🍳 <span class="text-caption">Only</span><span class="font-bold" style="color: var(--color-text-primary)">Food</span>
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
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {foodFilterEnabled ? 'bg-primary' : 'bg-accent-gray'}"
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {foodFilterEnabled ? 'translate-x-6' : 'translate-x-1'}"
        />
      </button>
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
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
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
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">No cooking posts found</p>
          <p class="text-sm">Try posting with cooking tags like #foodstr, #cook, #cooking, etc.</p>
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
        <article class="border-b py-4 sm:py-6 first:pt-0" style="border-color: var(--color-input-border)">
          <div class="flex space-x-3 px-2 sm:px-0">
            {#if !hideAvatar}
              <a href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}" class="flex-shrink-0">
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
                            {context.authorName.startsWith('npub') ? context.authorName.substring(0, 12) + '...' : context.authorName}
                          {/if}
                        </span>
                      </div>
                      {#if context.notePreview && !context.error}
                        <p class="parent-quote-content">{context.notePreview}</p>
                      {/if}
                      <span class="parent-quote-link">
                        View full thread →
                      </span>
                    </a>
                  {:catch}
                    <!-- Fallback - simple link -->
                    <a
                      href="/{nip19.noteEncode(parentNoteId)}"
                      class="parent-quote-embed mb-3 block"
                    >
                      <div class="parent-quote-header">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
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
                <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
                  <div
                    class="overflow-hidden transition-all duration-200"
                    class:line-clamp-3={!expandedPosts[event.id]}
                  >
                    <NoteContent content={cleanContent} />
                  </div>
                  {#if cleanContent.length > 100}
                    <button
                      on:click={() => toggleExpanded(event.id)}
                      class="text-caption hover:opacity-80 text-xs mt-1 transition-colors"
                    >
                      {expandedPosts[event.id] ? 'Show less' : 'Read more'}
                    </button>
                  {/if}
                </div>
              {/if}

              {#if getImageUrls(event).length > 0}
                {@const mediaUrls = getImageUrls(event)}
                
                <div class="mb-3 -mx-2 sm:mx-0">
                  <div class="relative rounded-none sm:rounded-lg border-0 sm:border bg-input" style="border-color: var(--color-input-border)">
                    <!-- Swipeable carousel container -->
                    <div 
                      class="carousel-container flex overflow-x-auto snap-x snap-mandatory"
                      style="touch-action: pan-y pan-x; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; background-color: #1f2937;"
                      data-carousel-id={event.id}
                      on:scroll={(e) => handleCarouselScroll(e, event.id)}
                    >
                      {#each mediaUrls as imageUrl, index}
                        <div class="carousel-slide flex-shrink-0 w-full snap-center flex items-center justify-center" style="background-color: #1f2937; min-height: 200px;">
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
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      <button
                        on:click={() => scrollCarouselNext(event.id)}
                        class="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      
                      <!-- Slide counter -->
                      <div class="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded z-10">
                        {getCurrentSlide(event.id) + 1} / {mediaUrls.length}
                      </div>
                      
                      <!-- Dot indicators -->
                      {#if mediaUrls.length <= 5}
                        <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex space-x-1.5 z-10">
                          {#each mediaUrls as _, index}
                            <button
                              on:click={() => scrollCarouselTo(event.id, index)}
                              class="w-2 h-2 rounded-full transition-all {index === getCurrentSlide(event.id) ? 'bg-white' : 'bg-white/50'}"
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

              <div class="flex items-center justify-between px-2 sm:px-0 py-1" use:lazyLoadAction={event.id}>
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
                      on:click={() => openZapModal(event)}
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

      {#if hasMore}
        <div class="py-4 text-center">
          {#if loadingMore}
            <LoadingState 
              type="spinner" 
              size="lg" 
              text="Loading more posts..." 
              showText={true}
            />
          {:else}
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

{#if zapModal && selectedEvent}
  <ZapModal
    bind:open={zapModal}
    event={selectedEvent}
  />
{/if}

<svelte:window on:keydown={handleImageModalKeydown} />

{#if imageModalOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
    on:click={closeImageModal}
    role="dialog"
    aria-modal="true"
  >
    <div class="relative bg-input rounded-lg shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden" on:click|stopPropagation>
      <button
        class="absolute top-2 right-2 bg-input hover:bg-accent-gray rounded-full p-2 shadow-md transition z-10"
        style="color: var(--color-text-primary)"
        on:click={closeImageModal}
        aria-label="Close image"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {#if selectedEventImages.length > 1}
        <div class="absolute top-2 left-2 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full z-10">
          {selectedImageIndex + 1} / {selectedEventImages.length}
        </div>

        <button
          on:click|stopPropagation={prevModalImage}
          class="absolute left-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
          style="color: var(--color-text-primary)"
          aria-label="Previous image"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          on:click|stopPropagation={nextModalImage}
          class="absolute right-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
          style="color: var(--color-text-primary)"
          aria-label="Next image"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
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

  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
