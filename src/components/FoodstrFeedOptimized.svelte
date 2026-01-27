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
  import { browser } from '$app/environment';
  import {
    ndk,
    userPublickey,
    ensureNdkConnected,
    normalizeRelayUrl,
    getConnectedRelays,
    getCurrentRelayGeneration,
    onRelaySwitchStopSubscriptions
  } from '$lib/nostr';
  import { hellthreadThreshold } from '$lib/hellthreadFilterSettings';
  import { muteListStore, mutedPubkeys } from '$lib/muteListStore';
  import {
    isPubkeyMuted,
    containsMutedWord,
    hasMutedTag,
    isThreadMuted
  } from '$lib/mutableIntegration';
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
  import ShareModal from './ShareModal.svelte';
  import PostActionsMenu from './PostActionsMenu.svelte';
  import NoteContent from './NoteContent.svelte';
  import VideoPreview from './VideoPreview.svelte';
  import AuthorName from './AuthorName.svelte';
  import {
    generateNoteImage,
    generateImageFilename,
    extractNostrReferences,
    decodeNostrReference,
    type EngagementData as ShareEngagementData,
    type ReferencedNote
  } from '$lib/shareNoteImage';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { compressedCacheManager, COMPRESSED_FEED_CACHE_CONFIG } from '$lib/compressedCache';
  import FeedErrorBoundary from './FeedErrorBoundary.svelte';
  import FeedPostSkeleton from './FeedPostSkeleton.svelte';
  import LoadingState from './LoadingState.svelte';
  import { nip19 } from 'nostr-tools';
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
  import {
    batchFetchEngagement,
    getEngagementStore,
    fetchEngagement,
    type EngagementData
  } from '$lib/engagementCache';

  // Garden relay dedicated cache (IndexedDB-based)
  import {
    gardenCache,
    gardenCacheStatus,
    cachedEventToNDKLike,
    type CachedGardenEvent
  } from '$lib/gardenCache';

  // Primal cache for fast feed fetching (aggregates from 100+ relays)
  import {
    fetchFeedFromPrimal,
    fetchGlobalFromPrimal,
    fetchContactListFromPrimal
  } from '$lib/primalCache';

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
      hasMore = true;
      loadingMore = false;
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
    recipes: ['wss://kitchen.zap.cooking'], // Curated recipe content (510ms, but worth it for relevance)
    fallback: ['wss://nos.lol', 'wss://relay.damus.io'], // Fast general relays (nos.lol 342ms, relay.damus.io 394ms)
    discovery: ['wss://nostr.wine', 'wss://relay.primal.net', 'wss://purplepag.es'], // Additional relays for discovery
    profiles: ['wss://purplepag.es'], // Profile metadata (356ms, specialized for kind:0)
    members: ['wss://pantry.zap.cooking'], // Private member relay (The Pantry)
    garden: ['wss://garden.zap.cooking'] // Garden relay (no trailing slash!)
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
  // Share modal state
  let shareModalOpen = false;
  let shareUrl = '';
  let shareTitle = '';
  let shareImageUrl = '';
  let shareImageBlob: Blob | null = null;
  let shareImageName = 'zap-cooking-note.png';
  let shareModalEvent: NDKEvent | null = null;
  let isGeneratingShareImage = false;

  // Share as image state (direct share)
  let isGeneratingImage = false;
  let imageGenerationError: string | null = null;
  let expandedParentNotes: { [eventId: string]: boolean } = {}; // Track expanded parent notes
  let parentNoteCache: { [eventId: string]: NDKEvent | null } = {}; // Cache full parent notes
  // Toggle for food filtering - defaults to OFF for profile view (show all posts), ON for other modes
  let foodFilterEnabled = !authorPubkey;

  // Modals
  let zapModal = false;
  let selectedEvent: NDKEvent | null = null;
  let imageModalOpen = false;
  let selectedImageUrl = '';
  let selectedEventImages: string[] = [];
  let selectedImageIndex = 0;

  // Lazy loading for engagement components
  let visibleNotes = new Set<string>();

  // ═══════════════════════════════════════════════════════════════
  // STALE-WHILE-REVALIDATE STATE
  // ═══════════════════════════════════════════════════════════════
  // Show cached content instantly, then fetch fresh in background
  let backgroundLoading = false;
  let pendingNewEvents: NDKEvent[] = [];
  let showNewPostsButton = false;
  let isScrolledToTop = true;

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
        // Initial load: last 7 days for better content discovery
        return { since: now - SEVEN_DAYS_SECONDS };

      case 'pagination':
        // Pagination: larger window based on oldest event
        const oldestTime = events[events.length - 1]?.created_at || now;
        // Extend to 30 days max for deeper pagination
        const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
        return {
          since: Math.max(oldestTime - SEVEN_DAYS_SECONDS, now - THIRTY_DAYS_SECONDS), // Max 30 days back
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
    if (!text || text.length < 40) return text;

    // Check if the entire text is duplicated (first half equals second half)
    const trimmed = text.trim();
    const halfLen = Math.floor(trimmed.length / 2);
    if (halfLen > 20) {
      const firstHalf = trimmed.substring(0, halfLen).trim();
      const secondHalf = trimmed.substring(halfLen).trim();
      if (firstHalf === secondHalf) return firstHalf;
    }

    return text;
  }

  function getContentWithoutMedia(content: string): string {
    let cleaned = content
      .replace(URL_REGEX, (url) => {
        return isImageUrl(url) || isVideoUrl(url) ? '' : url;
      })
      .trim();

    return deduplicateText(cleaned);
  }

  const HEX_RE = /^[0-9a-f]+$/i;
  function normalizeEventIdHex(input: string): string | null {
    let s = (input || '').trim();
    if (!s) return null;
    if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
    if (!HEX_RE.test(s)) return null;
    if (s.length > 64) return null;

    s = s.toLowerCase();

    // Ensure even length (hexToBytes expects pairs)
    if (s.length % 2 === 1) s = `0${s}`;

    // Some clients can drop leading zeros; pad back to 32 bytes (64 hex chars)
    if (s.length < 64) s = s.padStart(64, '0');

    return s.length === 64 ? s : null;
  }

  function decodeToEventIdHex(input: string): string | null {
    const raw = (input || '').trim();
    if (!raw) return null;

    const s = raw.startsWith('nostr:') ? raw.slice('nostr:'.length) : raw;

    if (s.startsWith('note1') || s.startsWith('nevent1')) {
      try {
        const decoded = nip19.decode(s);
        if (decoded.type === 'note') return normalizeEventIdHex(decoded.data as string);
        if (decoded.type === 'nevent')
          return normalizeEventIdHex((decoded.data as any).id as string);
      } catch {
        // Fall through to hex normalization
      }
    }

    return normalizeEventIdHex(s);
  }

  function noteHrefFromEventId(input: string | null | undefined): string | null {
    if (!input) return null;
    const id = normalizeEventIdHex(input);
    if (!id) return null;
    try {
      return `/${nip19.noteEncode(id)}`;
    } catch {
      return null;
    }
  }

  // Extract the first quoted note ID from content (for quote reposts)
  function getQuotedNoteId(event: NDKEvent): string | null {
    try {
      if (!event) return null;

      // First check for q tag (NIP-18 style quote repost)
      if (Array.isArray(event.tags)) {
        const qTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === 'q');
        const qRef = qTag?.[1] ? String(qTag[1]) : '';
        const qId = qRef ? decodeToEventIdHex(qRef) : null;
        if (qId) return qId;
      }
      if (!event.content) return null;

      // Then check for nostr:nevent1 or nostr:note1 in content
      // Use a fresh regex each time to avoid lastIndex issues
      const regex =
        /nostr:(nevent1[023456789acdefghjklmnpqrstuvwxyz]+|note1[023456789acdefghjklmnpqrstuvwxyz]+)/;
      const match = event.content.match(regex);
      if (match && match[1]) {
        const id = decodeToEventIdHex(match[1]);
        if (id) return id;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Check if an event has a quoted note (but is not a reply)
  function hasQuotedNote(event: NDKEvent): boolean {
    try {
      // Don't show quote embed if it's already a reply (to avoid double embeds)
      if (isReply(event)) return false;
      return getQuotedNoteId(event) !== null;
    } catch {
      return false;
    }
  }

  // Get content without the quoted note reference (so it doesn't render as inline embed)
  function getContentWithoutQuote(content: string): string {
    try {
      if (!content) return '';
      return content
        .replace(
          /nostr:(nevent1[023456789acdefghjklmnpqrstuvwxyz]+|note1[023456789acdefghjklmnpqrstuvwxyz]+)/g,
          ''
        )
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      return content || '';
    }
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

  // Cache muted users to avoid repeated localStorage parsing
  let cachedMutedUsers: string[] | null = null;
  let cachedMutedUsersKey: string | null = null;

  function getMutedUsers(): string[] {
    if (!$userPublickey) return [];

    // Return cached value if user hasn't changed
    if (cachedMutedUsersKey === $userPublickey && cachedMutedUsers !== null) {
      return cachedMutedUsers;
    }

    try {
      const storedMutes = localStorage.getItem('mutedUsers');
      const parsed: string[] = storedMutes ? JSON.parse(storedMutes) : [];
      cachedMutedUsers = parsed;
      cachedMutedUsersKey = $userPublickey;
      return parsed;
    } catch {
      cachedMutedUsers = [];
      cachedMutedUsersKey = $userPublickey;
      return [];
    }
  }

  // Invalidate muted users cache when needed (call after mute/unmute actions)
  export function invalidateMutedUsersCache() {
    cachedMutedUsers = null;
    cachedMutedUsersKey = null;
  }

  /**
   * Detect if an event is a hellthread based on number of 'p' tags (mentions)
   * @param event - NDKEvent to check
   * @param threshold - Number of mentions that constitutes a hellthread (0 = disabled)
   * @returns true if event should be hidden as a hellthread
   */
  function isHellthread(event: NDKEvent, threshold: number): boolean {
    if (threshold === 0) return false; // Disabled

    if (!event.tags || !Array.isArray(event.tags)) return false;

    // Count 'p' tags (person mentions)
    const mentionCount = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 'p').length;

    return mentionCount >= threshold;
  }

  function shouldIncludeEvent(event: NDKEvent): boolean {
    // Check muted users (both public and private lists)
    if ($userPublickey && $muteListStore.muteList) {
      const authorKey = event.author?.hexpubkey || event.pubkey;

      // Check pubkey mute
      if (authorKey && isPubkeyMuted($muteListStore.muteList, authorKey)) {
        return false;
      }

      // Check word mutes
      if (containsMutedWord($muteListStore.muteList, event.content)) {
        return false;
      }

      // Check tag mutes
      if (hasMutedTag($muteListStore.muteList, event.tags)) {
        return false;
      }

      // Check thread mutes
      if (isThreadMuted($muteListStore.muteList, event.id)) {
        return false;
      }
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

    // Check hellthread threshold
    const threshold = get(hellthreadThreshold);
    if (isHellthread(event, threshold)) {
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
  // INSTANT CACHE (Stale-While-Revalidate)
  // ═══════════════════════════════════════════════════════════════
  // localStorage-based cache keyed by filterMode and user for instant UI paint

  const INSTANT_CACHE_PREFIX = 'foodstr_instant_';
  const INSTANT_CACHE_MAX_EVENTS = 100;
  const INSTANT_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cache key for current mode and user
   */
  function getInstantCacheKey(mode: string): string {
    const userKey = $userPublickey || 'anon';
    return `${INSTANT_CACHE_PREFIX}${mode}_${userKey}`;
  }

  /**
   * Load events from instant cache (synchronous for immediate UI)
   */
  function loadFromInstantCache(mode: string): { events: any[]; timestamp: number } | null {
    if (typeof window === 'undefined') return null;

    try {
      const key = getInstantCacheKey(mode);
      const stored = localStorage.getItem(key);
      if (!stored) return null;

      const { events: rawEvents, timestamp } = JSON.parse(stored);
      if (typeof timestamp !== 'number') return null;

      // Expire old caches
      if (Date.now() - timestamp > INSTANT_CACHE_MAX_AGE_MS) {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
        return null;
      }

      if (!rawEvents || !Array.isArray(rawEvents) || rawEvents.length === 0) {
        return null;
      }

      return { events: rawEvents, timestamp };
    } catch {
      return null;
    }
  }

  /**
   * Save events to instant cache
   * Handles localStorage quota errors by clearing old caches
   */
  function saveToInstantCache(mode: string, eventsToCache: NDKEvent[]) {
    if (typeof window === 'undefined' || eventsToCache.length === 0) return;

    try {
      const key = getInstantCacheKey(mode);
      // Store only essential event data (not full NDKEvent instances)
      const rawEvents = eventsToCache.slice(0, INSTANT_CACHE_MAX_EVENTS).map((e) => ({
        id: e.id,
        pubkey: e.pubkey,
        content: e.content,
        created_at: e.created_at,
        kind: e.kind,
        tags: e.tags,
        sig: e.sig,
        author: e.author
          ? {
              hexpubkey: e.author.hexpubkey,
              profile: e.author.profile
            }
          : null
      }));

      const data = JSON.stringify({
        events: rawEvents,
        timestamp: Date.now()
      });

      try {
        localStorage.setItem(key, data);
      } catch (quotaError) {
        // localStorage might be full - try to clear old instant caches
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(INSTANT_CACHE_PREFIX) && k !== key) {
              keysToRemove.push(k);
            }
          }
          // Remove other instant caches to make room
          for (const k of keysToRemove) {
            localStorage.removeItem(k);
          }
          // Retry
          localStorage.setItem(key, data);
        } catch {
          // Still failed - give up silently
        }
      }
    } catch {
      // localStorage unavailable - silent fail
    }
  }

  /**
   * Convert raw cached event to NDKEvent-like object
   */
  function hydrateFromCache(rawEvent: any): any {
    // Return a minimal event object that works with our display code
    return {
      ...rawEvent,
      author: rawEvent.author
        ? {
            hexpubkey: rawEvent.author.hexpubkey,
            profile: rawEvent.author.profile
          }
        : null
    };
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
      hasMore = true;
      loadingMore = false;

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
        // Try Primal first (fast path - 200-400ms vs 5-10s)
        if (!$userPublickey) {
          loading = false;
          error = false;
          events = [];
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIMAL FAST PATH - Try Primal cache first for Following feed
        // ═══════════════════════════════════════════════════════════════
        let usedPrimal = false;
        try {
          const primalStartTime = performance.now();

          // Get follows from Primal (much faster than fetching kind:3)
          const primalFollows = await fetchContactListFromPrimal($userPublickey);

          if (primalFollows.length > 0) {
            console.log(
              `[Feed] Primal: Got ${primalFollows.length} follows in ${(performance.now() - primalStartTime).toFixed(0)}ms`
            );

            // Cache followed pubkeys for real-time subscription
            followedPubkeysForRealtime = primalFollows;

            const { events: primalEvents } = await fetchFeedFromPrimal($ndk, primalFollows, {
              limit: 300, // Increased from 100 for better initial load
              since: sevenDaysAgo(),
              includeReplies: false
            });

            console.log(
              `[Feed] Primal: ${primalEvents.length} events in ${(performance.now() - primalStartTime).toFixed(0)}ms`
            );

            // Apply existing food filter and exclude replies
            const beforeFilter = primalEvents.length;
            const foodEvents = primalEvents.filter((event) => {
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

            console.log(`[Feed] Primal: After food filter: ${foodEvents.length} / ${beforeFilter}`);

            if (foodEvents.length >= 10) {
              // Check for stale results
              if (isStaleResult(loadGeneration)) {
                console.log('[Feed] Discarding stale Primal results');
                return;
              }

              // Success - use Primal results
              events = dedupeAndSort(foodEvents);
              loading = false;
              error = false;
              usedPrimal = true;

              if (events.length > 0) {
                lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
                await cacheEvents();
              }

              // Start realtime subscription
              try {
                startRealtimeSubscription();
              } catch {
                // Non-critical
              }

              // Supplement with outbox in background (non-blocking)
              supplementWithOutbox('following');

              console.log(`[Feed] Primal SUCCESS: ${events.length} events displayed`);
              return;
            } else {
              console.log('[Feed] Primal: Not enough food events, falling back to outbox');
            }
          }
        } catch (err) {
          console.log('[Feed] Primal unavailable, falling back to outbox model:', err);
        }

        // ═══════════════════════════════════════════════════════════════
        // OUTBOX MODEL FALLBACK - Use when Primal fails or returns too few
        // ═══════════════════════════════════════════════════════════════
        const outboxOptions: any = {
          since: timeWindow.since,
          kinds: [1],
          limit: foodFilterEnabled ? 200 : 300, // Fetch more when showing all posts
          timeoutMs: 5000,
          maxRelays: 10 // Top 10 relays by coverage
        };

        // Only add food hashtag filter when food filter is enabled
        if (foodFilterEnabled) {
          outboxOptions.additionalFilter = {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          };
        }

        const result: OutboxFetchResult = await fetchFollowingEvents(
          $ndk,
          $userPublickey,
          outboxOptions
        );

        console.log('[Feed] Raw events from outbox:', result.events.length);

        console.log(
          `[Feed] Outbox fetch (${foodFilterEnabled ? 'food-filtered' : 'all posts'}): ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`
        );

        if (result.failedRelays.length > 0) {
          console.warn(`[Feed] Failed relays:`, result.failedRelays);
        }

        // Cache followed pubkeys for real-time subscription (if not already from Primal)
        if (followedPubkeysForRealtime.length === 0) {
          followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);
        }

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
        // Try Primal first (fast path - 200-400ms vs 5-10s)
        if (!$userPublickey) {
          loading = false;
          error = false;
          events = [];
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIMAL FAST PATH - Try Primal cache first for Replies feed
        // ═══════════════════════════════════════════════════════════════
        try {
          const primalStartTime = performance.now();

          // Get follows from Primal (much faster than fetching kind:3)
          const primalFollows = await fetchContactListFromPrimal($userPublickey);

          if (primalFollows.length > 0) {
            console.log(
              `[Feed] Primal (replies): Got ${primalFollows.length} follows in ${(performance.now() - primalStartTime).toFixed(0)}ms`
            );

            // Cache followed pubkeys for real-time subscription
            followedPubkeysForRealtime = primalFollows;

            const { events: primalEvents } = await fetchFeedFromPrimal($ndk, primalFollows, {
              limit: 300, // Increased from 100 for better initial load
              since: sevenDaysAgo(),
              includeReplies: true // Include replies for this mode
            });

            console.log(
              `[Feed] Primal (replies): ${primalEvents.length} events in ${(performance.now() - primalStartTime).toFixed(0)}ms`
            );

            // Apply existing food filter (both notes AND replies allowed)
            const beforeFilter = primalEvents.length;
            const foodEvents = primalEvents.filter((event) => {
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

            console.log(
              `[Feed] Primal (replies): After food filter: ${foodEvents.length} / ${beforeFilter}`
            );

            if (foodEvents.length >= 10) {
              // Check for stale results
              if (isStaleResult(loadGeneration)) {
                console.log('[Feed] Discarding stale Primal replies results');
                return;
              }

              // Success - use Primal results
              events = dedupeAndSort(foodEvents);
              loading = false;
              error = false;

              if (events.length > 0) {
                lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
                await cacheEvents();
              }

              // Prefetch reply contexts for better UX
              prefetchReplyContexts($ndk, events.slice(0, 20)).catch(() => {});

              // Start realtime subscription
              try {
                startRealtimeSubscription();
              } catch {
                // Non-critical
              }

              // Supplement with outbox in background (non-blocking)
              supplementWithOutbox('replies');

              console.log(`[Feed] Primal (replies) SUCCESS: ${events.length} events displayed`);
              return;
            } else {
              console.log(
                '[Feed] Primal (replies): Not enough food events, falling back to outbox'
              );
            }
          }
        } catch (err) {
          console.log('[Feed] Primal (replies) unavailable, falling back to outbox model:', err);
        }

        // ═══════════════════════════════════════════════════════════════
        // OUTBOX MODEL FALLBACK - Use when Primal fails or returns too few
        // ═══════════════════════════════════════════════════════════════
        const repliesOutboxOptions: any = {
          since: timeWindow.since,
          kinds: [1],
          limit: foodFilterEnabled ? 200 : 300, // Fetch more when showing all posts
          timeoutMs: 5000,
          maxRelays: 10 // Top 10 relays by coverage
        };

        // Only add food hashtag filter when food filter is enabled
        if (foodFilterEnabled) {
          repliesOutboxOptions.additionalFilter = {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          };
        }

        const result: OutboxFetchResult = await fetchFollowingEvents(
          $ndk,
          $userPublickey,
          repliesOutboxOptions
        );

        console.log('[Feed] Raw events from outbox:', result.events.length);

        console.log(
          `[Feed] Outbox fetch (${foodFilterEnabled ? 'food-filtered' : 'all'} replies): ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`
        );

        // Cache followed pubkeys for real-time subscription (if not already from Primal)
        if (followedPubkeysForRealtime.length === 0) {
          followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);
        }

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

            // Apply food filter if enabled
            const beforeFilter = cachedNDKEvents.length;
            const filteredCachedEvents = foodFilterEnabled
              ? cachedNDKEvents.filter((e) => shouldIncludeEvent(e))
              : cachedNDKEvents;

            if (foodFilterEnabled && beforeFilter !== filteredCachedEvents.length) {
              console.log(
                `[Feed] Garden: Filtered cached events: ${filteredCachedEvents.length} / ${beforeFilter}`
              );
            }

            events = filteredCachedEvents;
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
          // Apply food filter if enabled
          const beforeFilter = gardenEvents.length;
          const filteredGardenEvents = foodFilterEnabled
            ? gardenEvents.filter((e) => shouldIncludeEvent(e))
            : gardenEvents;

          if (foodFilterEnabled && beforeFilter !== filteredGardenEvents.length) {
            console.log(
              `[Feed] Garden: Filtered relay events: ${filteredGardenEvents.length} / ${beforeFilter}`
            );
          }

          // Got fresh events from relay - update display and cache
          events = dedupeAndSort(filteredGardenEvents);
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
      // ═══════════════════════════════════════════════════════════════
      // PRIMAL FAST PATH - Try Primal cache first for Global feed
      // ═══════════════════════════════════════════════════════════════
      if (!authorPubkey) {
        // Only use Primal for community global feed (not profile views)
        try {
          const primalStartTime = performance.now();
          const { events: primalEvents } = await fetchGlobalFromPrimal($ndk, {
            limit: 200,
            since: sevenDaysAgo()
          });

          console.log(
            `[Feed] Primal global: ${primalEvents.length} events in ${(performance.now() - primalStartTime).toFixed(0)}ms`
          );

          // Get followed users to exclude from Global feed (if logged in)
          let followedSet = new Set<string>();
          if ($userPublickey) {
            try {
              const primalFollows = await fetchContactListFromPrimal($userPublickey);
              followedSet = new Set(primalFollows);
              followedPubkeysForRealtime = primalFollows;
            } catch {
              // Fall back to NDK method
              const followed = await getFollowedPubkeys($ndk, $userPublickey);
              followedSet = new Set(followed);
              followedPubkeysForRealtime = followed;
            }
          }

          // Apply food content filter
          const beforeFilter = primalEvents.length;
          const foodEvents = primalEvents.filter((event) => {
            // Check muted users
            if ($userPublickey) {
              const mutedUsers = getMutedUsers();
              const authorKey = event.author?.hexpubkey || event.pubkey;
              if (authorKey && mutedUsers.includes(authorKey)) return false;
            }

            // Exclude replies
            if (isReply(event)) return false;

            // Apply food filter
            if (!shouldIncludeEvent(event)) return false;

            // Exclude posts from followed users (they go in Following feed)
            if (followedSet.size > 0) {
              const authorKey = event.author?.hexpubkey || event.pubkey;
              if (authorKey && followedSet.has(authorKey)) return false;
            }

            return true;
          });

          console.log(
            `[Feed] Primal global: After food filter: ${foodEvents.length} / ${beforeFilter}`
          );

          if (foodEvents.length >= 15) {
            // Check for stale results
            if (isStaleResult(loadGeneration)) {
              console.log('[Feed] Discarding stale Primal global results');
              return;
            }

            // Success - use Primal results
            events = dedupeAndSort(foodEvents);
            loading = false;
            error = false;

            if (events.length > 0) {
              lastEventTime = Math.max(...events.map((e) => e.created_at || 0));
              await cacheEvents();
            }

            // Start realtime subscription
            try {
              startRealtimeSubscription();
            } catch {
              // Non-critical
            }

            console.log(`[Feed] Primal global SUCCESS: ${events.length} events displayed`);
            return;
          } else {
            console.log(
              '[Feed] Primal global: Not enough food events, supplementing with relay pools'
            );
            // Continue to relay pools fetch to supplement
          }
        } catch (err) {
          console.log('[Feed] Primal global failed, using relay pools:', err);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // RELAY POOLS FALLBACK - Use when Primal fails or returns too few
      // ═══════════════════════════════════════════════════════════════

      // Build filters
      const hashtagFilter: any = {
        kinds: [1],
        limit: authorPubkey && !foodFilterEnabled ? 100 : 50, // Fetch more for profile view when showing all posts
        since: timeWindow.since
      };

      // Only add food hashtag filter when needed
      // For profile view: respect the toggle
      // For global feed: always filter for food content
      if (!authorPubkey || foodFilterEnabled) {
        hashtagFilter['#t'] = FOOD_HASHTAGS;
      }

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
        if (followedPubkeysForRealtime.length > 0) {
          followedSet = new Set(followedPubkeysForRealtime);
        } else {
          const followed = await getFollowedPubkeys($ndk, $userPublickey);
          followedSet = new Set(followed);
          followedPubkeysForRealtime = followed; // Cache for real-time subscription
        }
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

          // Apply food filter only when enabled (for following/replies modes)
          if (foodFilterEnabled && !shouldIncludeEvent(event)) {
            return;
          }

          handleRealtimeEvent(event);
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
      // Subscribe to garden relay - content filtering controlled by foodFilterEnabled toggle
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

    // Global mode / Profile view - default subscription
    // Single subscription for content (food-filtered or all posts based on context)
    const hashtagFilter: any = {
      kinds: [1],
      since
    };

    // Only add food hashtag filter when needed
    // For profile view: respect the toggle
    // For global feed: always filter for food content
    if (!authorPubkey || foodFilterEnabled) {
      hashtagFilter['#t'] = FOOD_HASHTAGS;
    }

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

      // For profile view with food filter disabled, apply client-side filter
      if (authorPubkey && foodFilterEnabled && !shouldIncludeEvent(event)) {
        return;
      }
      handleRealtimeEvent(event);
    });

    activeSubscriptions.push(hashtagSub);
  }

  function handleRealtimeEvent(event: NDKEvent) {
    // Skip if already seen
    if (seenEventIds.has(event.id)) return;

    // Validate content - apply food filter based on mode and toggle
    if (filterMode === 'garden' || filterMode === 'following' || filterMode === 'replies') {
      // Garden/Following/Replies: respect foodFilterEnabled toggle
      if (foodFilterEnabled && !shouldIncludeEvent(event)) return;
    } else if (filterMode !== 'members') {
      // Global mode (and profile view): always apply food filter
      if (!shouldIncludeEvent(event)) return;
    }
    // Members mode: no food filter

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

  /**
   * Supplement Primal results with outbox model fetch (non-blocking)
   * This catches any events Primal might have missed
   */
  async function supplementWithOutbox(mode: 'following' | 'replies') {
    if (!$userPublickey) return;

    // Run in background after short delay to not compete with initial render
    setTimeout(async () => {
      try {
        const supplementStartTime = performance.now();

        // Build options - only include food filter when enabled
        const supplementOptions: any = {
          since: sevenDaysAgo(),
          kinds: [1],
          limit: foodFilterEnabled ? 50 : 100, // Fetch more when showing all posts
          timeoutMs: 5000,
          maxRelays: 10
        };

        if (foodFilterEnabled) {
          supplementOptions.additionalFilter = {
            '#t': FOOD_HASHTAGS
          };
        }

        const result = await fetchFollowingEvents($ndk, $userPublickey, supplementOptions);

        // Filter based on mode
        const newEvents = result.events.filter((e) => {
          // Skip already seen
          if (seenEventIds.has(e.id)) return false;

          // For Following mode, exclude replies
          if (mode === 'following' && isReply(e)) return false;

          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = e.author?.hexpubkey || e.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) return false;
          }

          // Apply food filter
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;

          return true;
        });

        if (newEvents.length > 0) {
          console.log(
            `[Feed] Outbox supplement: +${newEvents.length} events in ${(performance.now() - supplementStartTime).toFixed(0)}ms`
          );

          // Add to seen set
          for (const e of newEvents) {
            seenEventIds.add(e.id);
          }

          // Merge with existing events
          events = dedupeAndSort([...events, ...newEvents]);

          // Update last event time
          const maxTime = Math.max(...newEvents.map((e) => e.created_at || 0));
          if (maxTime > lastEventTime) {
            lastEventTime = maxTime;
          }

          // Cache updated events
          await cacheEvents();
        } else {
          console.log(`[Feed] Outbox supplement: No new events found`);
        }
      } catch (err) {
        // Silent fail - this is just supplemental
        console.log('[Feed] Outbox supplement failed:', err);
      }
    }, 500); // 500ms delay to let UI settle first
  }

  // ═══════════════════════════════════════════════════════════════
  // BACKGROUND FETCH AND MERGE (Stale-While-Revalidate)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fetch fresh content from Primal in background and merge with displayed events
   * Called after instant cache paint to get latest content
   */
  async function fetchFreshAndMerge() {
    // Don't run for garden/members (private relays not in Primal)
    if (filterMode === 'garden' || filterMode === 'members') {
      return;
    }

    // Capture current mode to detect stale results after async operations
    const startMode = filterMode;

    try {
      const startTime = performance.now();
      let freshEvents: NDKEvent[] = [];

      if (startMode === 'following' || startMode === 'replies') {
        if (!$userPublickey) return;

        // Get follows from Primal (fast)
        const follows = await fetchContactListFromPrimal($userPublickey);

        // Check if user switched tabs during fetch
        if (filterMode !== startMode) return;

        if (follows.length === 0) return;

        // Cache for realtime subscription
        followedPubkeysForRealtime = follows;

        const { events: primalEvents } = await fetchFeedFromPrimal($ndk, follows, {
          limit: 100,
          since: sevenDaysAgo(),
          includeReplies: startMode === 'replies'
        });

        // Check again after async fetch
        if (filterMode !== startMode) return;

        // Apply food filter
        freshEvents = primalEvents.filter((event) => {
          // For Following mode, exclude replies
          if (startMode === 'following' && isReply(event)) return false;

          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) return false;
          }

          // Apply food filter only if enabled
          if (foodFilterEnabled && !shouldIncludeEvent(event)) return false;

          return true;
        });
      } else if (startMode === 'global') {
        // Get followed users to exclude (if logged in)
        let followedSet = new Set<string>();
        if ($userPublickey) {
          try {
            const follows = await fetchContactListFromPrimal($userPublickey);
            followedSet = new Set(follows);
            followedPubkeysForRealtime = follows;
          } catch {
            // Fall back to NDK
            const follows = await getFollowedPubkeys($ndk, $userPublickey);
            followedSet = new Set(follows);
            followedPubkeysForRealtime = follows;
          }
        }

        // Check if user switched tabs
        if (filterMode !== startMode) return;

        const { events: primalEvents } = await fetchGlobalFromPrimal($ndk, {
          limit: 200,
          since: sevenDaysAgo()
        });

        // Check again after async fetch
        if (filterMode !== startMode) return;

        // Apply food filter and exclude followed users
        freshEvents = primalEvents.filter((event) => {
          // Check muted users
          if ($userPublickey) {
            const mutedUsers = getMutedUsers();
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && mutedUsers.includes(authorKey)) return false;
          }

          // Exclude replies
          if (isReply(event)) return false;

          // Apply food filter
          if (!shouldIncludeEvent(event)) return false;

          // Exclude posts from followed users (they go in Following feed)
          if (followedSet.size > 0) {
            const authorKey = event.author?.hexpubkey || event.pubkey;
            if (authorKey && followedSet.has(authorKey)) return false;
          }

          return true;
        });
      }

      // Final stale check before applying results
      if (filterMode !== startMode) return;

      console.log(
        `[Feed] Background refresh: ${freshEvents.length} events in ${(performance.now() - startTime).toFixed(0)}ms`
      );

      // Find events we don't already have
      const existingIds = new Set(events.map((e) => e.id));
      const newEvents = freshEvents.filter((e) => !existingIds.has(e.id));

      if (newEvents.length > 0) {
        console.log(`[Feed] ${newEvents.length} new posts found`);

        // Add to seen set
        for (const e of newEvents) {
          seenEventIds.add(e.id);
        }

        if (isScrolledToTop) {
          // User is at top - auto-prepend smoothly
          events = dedupeAndSort([...newEvents, ...events]);
        } else {
          // User is scrolled down - show "new posts" button
          pendingNewEvents = newEvents;
          showNewPostsButton = true;
        }

        // Update last event time
        const maxTime = Math.max(...newEvents.map((e) => e.created_at || 0));
        if (maxTime > lastEventTime) {
          lastEventTime = maxTime;
        }
      }

      // Update cache for next session (merge fresh + existing)
      const allEvents = dedupeAndSort([...freshEvents, ...events]);
      saveToInstantCache(startMode, allEvents);
      await cacheEvents();

      // Start realtime subscription if not already running
      try {
        startRealtimeSubscription();
      } catch {
        // Non-critical
      }
    } catch (err) {
      // Only log if it's not a tab-switch scenario
      if (filterMode === startMode) {
        console.warn('[Feed] Background fetch failed:', err);
      }
      // Silent fail - we already have cached content showing
    }
  }

  /**
   * Load pending new posts into the feed
   */
  function loadPendingPosts() {
    if (pendingNewEvents.length === 0) return;

    events = dedupeAndSort([...pendingNewEvents, ...events]);
    pendingNewEvents = [];
    showNewPostsButton = false;

    // Scroll to top smoothly
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Handle scroll position tracking for "new posts" button behavior
   * Throttled to prevent performance issues
   */
  let scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  function handleFeedScroll() {
    if (typeof window === 'undefined') return;

    // Throttle scroll handling to max once per 100ms
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = setTimeout(() => {
      scrollThrottleTimer = null;
    }, 100);

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const wasAtTop = isScrolledToTop;
    isScrolledToTop = scrollTop < 100;

    // If user scrolled to top and there are pending posts, auto-load them
    if (isScrolledToTop && !wasAtTop && pendingNewEvents.length > 0) {
      loadPendingPosts();
    }
  }

  async function fetchFreshData() {
    try {
      // Only refresh for global mode (Following/Replies use real-time subscriptions)
      if (filterMode !== 'global') return;

      const timeWindow = calculateTimeWindow('initial');
      const filter: any = {
        kinds: [1],
        limit: authorPubkey && !foodFilterEnabled ? 100 : 50, // Fetch more for profile view when showing all posts
        since: timeWindow.since
      };

      // Only add food hashtag filter when needed
      // For profile view: respect the toggle
      // For global feed: always filter for food content
      if (!authorPubkey || foodFilterEnabled) {
        filter['#t'] = FOOD_HASHTAGS;
      }

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

        // Apply food filter based on context
        // For profile view: respect the toggle
        // For global feed: always filter for food content
        if (authorPubkey) {
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
        } else {
          if (!shouldIncludeEvent(e)) return false;
        }

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

        // Build options for outbox model - conditionally include food filter
        const loadMoreOptions: any = {
          since: paginationWindow.since,
          until: paginationWindow.until,
          kinds: [1],
          limit: foodFilterEnabled ? 100 : 150, // Fetch more when showing all posts
          timeoutMs: 5000,
          maxRelays: 10
        };

        // Only add food hashtag filter when food filter is enabled
        if (foodFilterEnabled) {
          loadMoreOptions.additionalFilter = {
            '#t': FOOD_HASHTAGS // Server-side food filtering!
          };
        }

        const result = await fetchFollowingEvents($ndk, $userPublickey, loadMoreOptions);

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
          limit: 100 // Increased from 20 for deeper pagination
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
          limit: 100 // Increased from 20 for deeper pagination
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
        // Global mode / Profile view - use hashtag filter with timeboxing
        const filter: any = {
          kinds: [1],
          since: paginationWindow.since,
          until: paginationWindow.until,
          limit: authorPubkey && !foodFilterEnabled ? 150 : 100 // Fetch more for profile view when showing all posts
        };

        // Only add food hashtag filter when needed
        // For profile view: respect the toggle
        // For global feed: always filter for food content
        if (!authorPubkey || foodFilterEnabled) {
          filter['#t'] = FOOD_HASHTAGS;
        }

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

        // Garden mode: apply food filter based on toggle
        if (filterMode === 'garden') {
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
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
        } else if (filterMode === 'following' || filterMode === 'replies') {
          // Following/Replies: respect the toggle
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
        } else if (filterMode === 'global') {
          // Global feed: always apply food filter
          if (!shouldIncludeEvent(e)) return false;

          // Exclude followed users from Global feed
          if (followedSet.size > 0) {
            const authorKey = e.author?.hexpubkey || e.pubkey;
            if (authorKey && followedSet.has(authorKey)) {
              return false;
            }
          }
        } else if (filterMode !== 'members') {
          // Other modes: apply food filter based on toggle
          if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
        }

        return true;
      });

      if (validOlder.length > 0) {
        validOlder.forEach((e) => seenEventIds.add(e.id));
        events = [...events, ...validOlder];
        // Continue fetching if we got events and we're still within time window
        // Check if we've reached the time limit (30 days back)
        const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
        const now = Math.floor(Date.now() / 1000);
        const oldestEventTime = events[events.length - 1]?.created_at || now;
        const timeLimit = now - THIRTY_DAYS_SECONDS;

        // Continue if we got a good batch (>= 50) or if we're still within time window
        hasMore = olderEvents.length >= 50 || oldestEventTime > timeLimit;
        await cacheEvents();
      } else {
        // No valid events - check if we've exhausted the time window
        const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
        const now = Math.floor(Date.now() / 1000);
        const oldestEventTime = events[events.length - 1]?.created_at || now;
        const timeLimit = now - THIRTY_DAYS_SECONDS;

        // Stop if we've gone back 30 days or got no events
        hasMore = oldestEventTime > timeLimit && olderEvents.length > 0;
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
    if (replyTag?.[1]) return normalizeEventIdHex(String(replyTag[1]));

    // Priority 2: If there's a 'root' tag and other e tags, the non-root one is the reply target
    const rootTag = eTags.find((tag) => tag[3] === 'root');
    if (rootTag && eTags.length > 1) {
      // Find an e tag that's not the root
      const nonRootTag = eTags.find((tag) => tag[1] !== rootTag[1]);
      if (nonRootTag?.[1]) return normalizeEventIdHex(String(nonRootTag[1]));
    }

    // Priority 3: If only a root tag exists, this is a direct reply to root
    if (rootTag?.[1]) return normalizeEventIdHex(String(rootTag[1]));

    // Priority 4: Old style - any e tag indicates a reply (use the last one as it's typically the immediate parent)
    if (eTags.length > 0) {
      // Use the last e tag (typically the immediate parent in old convention)
      const last = eTags[eTags.length - 1]?.[1];
      if (last) return normalizeEventIdHex(String(last));
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

  function handlePostCopy(event: CustomEvent<{ noteId: string }>) {
    // Copy handled by PostActionsMenu component
    console.log('Note ID copied:', event.detail.noteId);
  }

  function handlePostShare(event: CustomEvent<{ url: string }>, noteEvent?: NDKEvent) {
    shareUrl = event.detail.url;
    shareTitle = 'Check out this post on Zap Cooking';
    shareImageUrl = '';
    shareImageBlob = null;
    shareModalEvent = noteEvent || null;
    isGeneratingShareImage = false;
    shareModalOpen = true;
  }

  async function generateShareModalImage() {
    if (!shareModalEvent || !browser) return;

    isGeneratingShareImage = true;

    try {
      const { resolveProfileByPubkey, formatDisplayName } = await import('$lib/profileResolver');

      // Get author info
      let authorName: string | undefined;
      let authorPicture: string | undefined;
      try {
        const profile = await resolveProfileByPubkey(
          shareModalEvent.author?.hexpubkey || shareModalEvent.pubkey,
          $ndk
        );
        if (profile) {
          authorName = formatDisplayName(profile);
          authorPicture = profile.picture;
        }
      } catch (err) {
        console.warn('Failed to fetch author profile:', err);
      }

      // Check for referenced notes
      let referencedNote: ReferencedNote | undefined;
      try {
        const nostrRefs = extractNostrReferences(shareModalEvent.content || '');
        if (nostrRefs.length > 0) {
          const refEventId = decodeNostrReference(nostrRefs[0]);
          if (refEventId) {
            const refEvent = await $ndk.fetchEvent(refEventId);
            if (refEvent) {
              let refAuthorName: string | undefined;
              let refAuthorPicture: string | undefined;
              try {
                const refProfile = await resolveProfileByPubkey(
                  refEvent.author?.hexpubkey || refEvent.pubkey,
                  $ndk
                );
                if (refProfile) {
                  refAuthorName = formatDisplayName(refProfile);
                  refAuthorPicture = refProfile.picture;
                }
              } catch {
                // Continue without ref author info
              }

              referencedNote = {
                id: refEvent.id,
                content: refEvent.content,
                authorName: refAuthorName,
                authorPicture: refAuthorPicture,
                authorPubkey: refEvent.author?.hexpubkey || refEvent.pubkey,
                timestamp: refEvent.created_at
              };
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch referenced note:', err);
      }

      // Get engagement data
      const engagementStore = getEngagementStore(shareModalEvent.id);
      const engagementValue = get(engagementStore);
      const engagement: ShareEngagementData = {
        zaps: { totalAmount: engagementValue.zaps.totalAmount, count: engagementValue.zaps.count },
        reactions: { count: engagementValue.reactions.count },
        comments: { count: engagementValue.comments.count }
      };

      // Generate image
      const blob = await generateNoteImage(
        shareModalEvent,
        engagement,
        'square',
        false,
        authorName,
        authorPicture,
        referencedNote
      );

      if (blob) {
        shareImageBlob = blob;
        shareImageName = generateImageFilename(shareModalEvent);
      } else {
        // Show error to user
        imageGenerationError = 'Failed to generate image. Please try again.';
      }
    } catch (err) {
      console.error('Failed to generate share image:', err);
      imageGenerationError =
        err instanceof Error ? err.message : 'Failed to generate image. Please try again.';
    } finally {
      isGeneratingShareImage = false;
    }
  }

  async function handleDownloadImage(
    event: CustomEvent<{ event: NDKEvent; engagementData: ShareEngagementData }>
  ) {
    if (!browser) return;

    const noteEvent = event.detail.event;
    const engagement = event.detail.engagementData;

    isGeneratingImage = true;
    imageGenerationError = null;

    try {
      // Try to get author name and picture from profile cache
      let authorName: string | undefined;
      let authorPicture: string | undefined;
      const { resolveProfileByPubkey, formatDisplayName } = await import('$lib/profileResolver');

      try {
        const profile = await resolveProfileByPubkey(
          noteEvent.author?.hexpubkey || noteEvent.pubkey,
          $ndk
        );
        if (profile) {
          authorName = formatDisplayName(profile);
          authorPicture = profile.picture;
        }
      } catch (err) {
        console.warn('Failed to fetch author profile for image:', err);
      }

      // Check for referenced notes (nostr:nevent or nostr:note)
      let referencedNote: ReferencedNote | undefined;
      try {
        const nostrRefs = extractNostrReferences(noteEvent.content || '');
        if (nostrRefs.length > 0) {
          const refEventId = decodeNostrReference(nostrRefs[0]);
          if (refEventId) {
            // Fetch the referenced event
            const refEvent = await $ndk.fetchEvent(refEventId);
            if (refEvent) {
              // Get the referenced note author's profile
              let refAuthorName: string | undefined;
              let refAuthorPicture: string | undefined;
              try {
                const refProfile = await resolveProfileByPubkey(
                  refEvent.author?.hexpubkey || refEvent.pubkey,
                  $ndk
                );
                if (refProfile) {
                  refAuthorName = formatDisplayName(refProfile);
                  refAuthorPicture = refProfile.picture;
                }
              } catch {
                // Continue without ref author info
              }

              referencedNote = {
                id: refEvent.id,
                content: refEvent.content,
                authorName: refAuthorName,
                authorPicture: refAuthorPicture,
                authorPubkey: refEvent.author?.hexpubkey || refEvent.pubkey,
                timestamp: refEvent.created_at
              };
              console.log('[DownloadImage] Referenced note found:', referencedNote);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch referenced note:', err);
        // Continue without referenced note
      }

      // Generate image (default to square format)
      const blob = await generateNoteImage(
        noteEvent,
        engagement,
        'square',
        false,
        authorName,
        authorPicture,
        referencedNote
      );

      if (!blob) {
        throw new Error('Failed to generate image');
      }

      // Download the image directly
      const filename = generateImageFilename(noteEvent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

      if (isSafari) {
        // For Safari on iOS/macOS, try native share which lets user save to Photos
        if (navigator.share && navigator.canShare) {
          try {
            const file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file]
              });
              // Share completed (or cancelled) - don't do anything else
              return;
            }
          } catch (e) {
            // User cancelled or share failed - that's ok, just exit
            return;
          }
        }

        // Fallback for older Safari without share API: use data URL download
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 100);
        };
        reader.readAsDataURL(blob);
      } else {
        // Non-Safari: use blob URL
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      }
    } catch (error) {
      console.error('Download image failed:', error);
      imageGenerationError = error instanceof Error ? error.message : 'Failed to generate image';
    } finally {
      isGeneratingImage = false;
    }
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

  // Consolidated engagement info for rendering - avoids multiple store lookups
  interface EngagementRenderInfo {
    isZapPopular: boolean;
    zapGlowTier: 'none' | 'soft' | 'medium' | 'bright';
    totalSats: number;
    zapCount: number;
  }

  // Constants for tier calculation - defined once, reused everywhere
  const GLOW_TIERS = ['none', 'soft', 'medium', 'bright'] as const;
  type GlowTier = (typeof GLOW_TIERS)[number];

  // Thresholds: [soft, medium, bright]
  const COUNT_THRESHOLDS = [3, 6, 9];
  const AMOUNT_THRESHOLDS = [500, 1000, 2000];
  const ESTIMATED_SATS_PER_ZAP = 200;

  // Reactive engagement cache - stores computed glow info per event
  let engagementGlowCache = new Map<string, EngagementRenderInfo>();
  let engagementSubscriptions = new Map<string, () => void>();
  let pendingCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Fast tier calculation - returns index 0-3 (none, soft, medium, bright)
  function getTierIndex(value: number, thresholds: number[]): number {
    if (value >= thresholds[2]) return 3; // bright
    if (value >= thresholds[1]) return 2; // medium
    if (value >= thresholds[0]) return 1; // soft
    return 0; // none
  }

  // Calculate glow tier from engagement data - optimized for speed
  function calculateEngagementInfo(data: EngagementData): EngagementRenderInfo {
    const zapCount = data.zaps?.count || 0;
    const uniqueZapperCount = data.zaps?.topZappers?.length || 0;
    const totalReactionCount = data.reactions?.count || 0;
    const totalSats = (data.zaps?.totalAmount || 0) / 1000; // Convert millisats to sats

    // Zap-popular: only for garden posts with more zappers than reactions
    const isZapPopular =
      filterMode === 'garden' && uniqueZapperCount > 0 && uniqueZapperCount > totalReactionCount;

    // Get tier from count (3/6/9 thresholds)
    const countTierIdx = getTierIndex(zapCount, COUNT_THRESHOLDS);

    // Get tier from amount (500/1000/2000 thresholds)
    // If no amount data yet, estimate from count
    const effectiveSats = totalSats > 0 ? totalSats : zapCount * ESTIMATED_SATS_PER_ZAP;
    const amountTierIdx = getTierIndex(effectiveSats, AMOUNT_THRESHOLDS);

    // Use whichever tier is higher
    const zapGlowTier = GLOW_TIERS[Math.max(countTierIdx, amountTierIdx)];

    return { isZapPopular, zapGlowTier, totalSats, zapCount };
  }

  // Subscribe to an engagement store and update cache reactively
  function subscribeToEngagement(eventId: string): void {
    if (engagementSubscriptions.has(eventId)) return;

    // Cancel any pending cleanup for this eventId
    const pendingCleanup = pendingCleanupTimers.get(eventId);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      pendingCleanupTimers.delete(eventId);
    }

    const store = getEngagementStore(eventId);

    // Immediately read cached data (this loads from localStorage instantly)
    const initialData = get(store);
    const initialInfo = calculateEngagementInfo(initialData);
    engagementGlowCache.set(eventId, initialInfo);

    // Subscribe to future updates from relays
    const unsubscribe = store.subscribe((data) => {
      const newInfo = calculateEngagementInfo(data);
      const currentInfo = engagementGlowCache.get(eventId);

      // Only update if glow tier changed or sats increased (never decrease glow from cache)
      if (
        !currentInfo ||
        newInfo.zapGlowTier !== currentInfo.zapGlowTier ||
        newInfo.totalSats > currentInfo.totalSats
      ) {
        engagementGlowCache.set(eventId, newInfo);
        // Trigger Svelte reactivity - assignment to self
        engagementGlowCache = engagementGlowCache;
      }
    });

    engagementSubscriptions.set(eventId, unsubscribe);
  }

  // Unsubscribe from engagement updates
  function unsubscribeFromEngagement(eventId: string): void {
    const unsub = engagementSubscriptions.get(eventId);
    if (unsub) {
      unsub();
      engagementSubscriptions.delete(eventId);
    }
  }

  // Default engagement info - cached to avoid object allocation
  const DEFAULT_ENGAGEMENT_INFO: EngagementRenderInfo = Object.freeze({
    isZapPopular: false,
    zapGlowTier: 'none' as const,
    totalSats: 0,
    zapCount: 0
  });

  // Get engagement info - reads from reactive cache
  // Optimized: single code path, minimal allocations
  function getEngagementRenderInfo(
    eventId: string,
    shouldSubscribe: boolean = true
  ): EngagementRenderInfo {
    // Set up subscription if needed (this also populates cache)
    if (shouldSubscribe && !engagementSubscriptions.has(eventId)) {
      subscribeToEngagement(eventId);
      // subscribeToEngagement populates the cache, so check it
      return engagementGlowCache.get(eventId) || DEFAULT_ENGAGEMENT_INFO;
    }

    // Return cached info or default
    return engagementGlowCache.get(eventId) || DEFAULT_ENGAGEMENT_INFO;
  }

  // Reload mute list when user changes
  $: if ($userPublickey) {
    muteListStore.load();
  }

  // Cleanup subscriptions when events leave view
  // Uses tracked timers to avoid duplicate cleanup attempts
  $: {
    // When visibleNotes changes, schedule cleanup for notes no longer visible
    const visibleIds = new Set(events.map((e) => e.id).filter((id) => visibleNotes.has(id)));
    for (const eventId of engagementSubscriptions.keys()) {
      if (!visibleIds.has(eventId) && !pendingCleanupTimers.has(eventId)) {
        // Schedule cleanup with grace period (in case user scrolls back)
        const timer = setTimeout(() => {
          pendingCleanupTimers.delete(eventId);
          // Double-check still not visible before cleanup
          if (!visibleNotes.has(eventId)) {
            unsubscribeFromEngagement(eventId);
            engagementGlowCache.delete(eventId);
          }
        }, 30000); // 30 second grace period
        pendingCleanupTimers.set(eventId, timer);
      }
    }
  }

  // Zap animation state
  let zapAnimatingNotes = new Set<string>();
  let zapAnimationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  function handleZapComplete(eventId: string) {
    // Clear any existing timeout for this note
    const existingTimeout = zapAnimationTimeouts.get(eventId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Add to animating set
    zapAnimatingNotes.add(eventId);
    zapAnimatingNotes = zapAnimatingNotes;

    // Remove after animation completes (2 seconds)
    const timeout = setTimeout(() => {
      zapAnimatingNotes.delete(eventId);
      zapAnimatingNotes = zapAnimatingNotes;
      zapAnimationTimeouts.delete(eventId);
    }, 2000);

    zapAnimationTimeouts.set(eventId, timeout);

    // Refresh engagement data to show new zap
    if ($userPublickey) {
      fetchEngagement($ndk, eventId, $userPublickey);
    }
  }

  // Cleanup function for zap animation timeouts
  function cleanupZapAnimationTimeouts() {
    zapAnimationTimeouts.forEach((timeout) => clearTimeout(timeout));
    zapAnimationTimeouts.clear();
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

        // Clear pending posts state when switching tabs
        pendingNewEvents = [];
        showNewPostsButton = false;

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
          // When leaving garden/members mode, use cache-first approach
          stopSubscriptions();
          visibleNotes = new Set();

          // Try instant cache first
          const cached = loadFromInstantCache(filterMode);
          if (cached && cached.events.length > 0) {
            const hydratedEvents = cached.events.map(hydrateFromCache).filter(shouldIncludeEvent);

            if (hydratedEvents.length > 0) {
              seenEventIds.clear();
              hydratedEvents.forEach((e: any) => seenEventIds.add(e.id));
              events = hydratedEvents;
              loading = false;
              error = false;
              hasMore = true;
              loadingMore = false;

              console.log(`[Feed] Tab switch: Rendered ${events.length} cached events instantly`);

              // Background refresh
              backgroundLoading = true;
              fetchFreshAndMerge().finally(() => (backgroundLoading = false));
              return;
            }
          }

          // No cache - full load
          try {
            await loadFoodstrFeed(false);
            if (events.length > 0) {
              saveToInstantCache(filterMode, events);
            }
          } catch (err) {
            console.error('[Feed] Failed to load feed after garden mode:', err);
            error = true;
            loading = false;
            // Don't throw - errors are handled gracefully
          }
        } else {
          // Switching between global/following/replies - use cache-first approach
          stopSubscriptions();
          visibleNotes = new Set();

          // Try instant cache first
          const cached = loadFromInstantCache(filterMode);
          if (cached && cached.events.length > 0) {
            const hydratedEvents = cached.events.map(hydrateFromCache).filter(shouldIncludeEvent);

            if (hydratedEvents.length > 0) {
              seenEventIds.clear();
              hydratedEvents.forEach((e: any) => seenEventIds.add(e.id));
              events = hydratedEvents;
              loading = false;
              error = false;
              hasMore = true;
              loadingMore = false;

              console.log(`[Feed] Tab switch: Rendered ${events.length} cached events instantly`);

              // Background refresh
              backgroundLoading = true;
              fetchFreshAndMerge().finally(() => (backgroundLoading = false));
              return;
            }
          }

          // No cache for this tab - do full load
          seenEventIds.clear();
          events = [];
          try {
            await loadFoodstrFeed(false);
            if (events.length > 0) {
              saveToInstantCache(filterMode, events);
            }
          } catch (err) {
            console.error('[Feed] Failed to load feed on tab switch:', err);
            error = true;
            loading = false;
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

    // Load mute list if user is logged in
    if ($userPublickey) {
      muteListStore.load();
    }

    // Add scroll listener for "new posts" button behavior
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', handleFeedScroll, { passive: true });
    }

    // Register callback to stop subscriptions when relays are switched
    // This prevents stale subscriptions from the old relay set
    unregisterRelaySwitchCallback = onRelaySwitchStopSubscriptions(() => {
      console.log('[Feed] Relay switch detected - stopping subscriptions');
      stopSubscriptions();
      // Clear events to prevent showing stale data during switch
      events = [];
      seenEventIds.clear();
      loading = true;
      hasMore = true;
      loadingMore = false;
      pendingNewEvents = [];
      showNewPostsButton = false;
    });

    // For garden/members mode OR profile view, load directly without cache
    // Profile view needs fresh data specific to that user, not cached global feed
    if (filterMode === 'garden' || filterMode === 'members' || authorPubkey) {
      visibleNotes = new Set();
      seenEventIds.clear();
      events = [];
      loading = true;
      try {
        await loadFoodstrFeed(false);
        console.log(
          `[Feed] Profile/special mode: Loaded ${events.length} events for ${authorPubkey || filterMode}`
        );
      } catch (err) {
        console.error(`[Feed] Failed to load ${authorPubkey ? 'profile' : filterMode} feed:`, err);
        error = true;
        loading = false;
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // STALE-WHILE-REVALIDATE: Show cached content instantly, then refresh
    // ═══════════════════════════════════════════════════════════════

    // Step 1: Try to render cached content immediately (0ms perceived load)
    const cached = loadFromInstantCache(filterMode);
    if (cached && cached.events.length > 0) {
      const hydratedEvents = cached.events.map(hydrateFromCache).filter(shouldIncludeEvent);

      if (hydratedEvents.length > 0) {
        // Add to seen set
        hydratedEvents.forEach((e: any) => seenEventIds.add(e.id));

        events = hydratedEvents;
        loading = false; // No loading spinner - we have content!
        error = false;
        hasMore = true;
        loadingMore = false;
        lastEventTime = Math.max(...events.map((e) => e.created_at || 0));

        console.log(`[Feed] Rendered ${events.length} cached events instantly`);

        // Step 2: Fetch fresh content in background
        backgroundLoading = true;
        try {
          await fetchFreshAndMerge();
        } finally {
          backgroundLoading = false;
        }

        return; // Done - we showed cached content and refreshed in background
      }
    }

    // No usable cache - fall back to normal loading flow
    console.log('[Feed] No cache available, loading fresh');

    // Prewarm outbox cache in background (non-blocking)
    // This fetches relay configs for all follows, making subsequent loads faster
    if ($userPublickey) {
      prewarmOutboxCache($ndk, $userPublickey).catch(() => {
        // Ignore prewarm errors - it's just an optimization
      });
    }

    try {
      await retryWithDelay();

      // Save to instant cache for next session
      if (events.length > 0) {
        saveToInstantCache(filterMode, events);
      }
    } catch {
      loading = false;
      error = true;
    }
  });

  onDestroy(async () => {
    // Remove scroll listener and clear throttle timer
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', handleFeedScroll);
    }
    if (scrollThrottleTimer) {
      clearTimeout(scrollThrottleTimer);
      scrollThrottleTimer = null;
    }

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

    // Clean up zap animation timeouts
    cleanupZapAnimationTimeouts();

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

    <!-- Background loading indicator (subtle, centered at top) - only show if no new posts button -->
    {#if backgroundLoading && !showNewPostsButton}
      <div
        class="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg"
        style="border: 1px solid var(--color-input-border)"
      >
        <div
          class="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"
        ></div>
        <span class="text-xs" style="color: var(--color-caption)">Updating...</span>
      </div>
    {/if}

    <!-- New posts button (shown when user is scrolled down and new posts arrive) -->
    {#if showNewPostsButton && pendingNewEvents.length > 0}
      <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <button
          on:click={loadPendingPosts}
          class="py-2 px-4 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          {pendingNewEvents.length} new {pendingNewEvents.length === 1 ? 'post' : 'posts'}
        </button>
      </div>
    {/if}

    {#if filterMode === 'following' || filterMode === 'replies' || filterMode === 'garden' || authorPubkey}
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
          {#if authorPubkey && $mutedPubkeys.has(authorPubkey)}
            <!-- Muted user message -->
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
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                ></path>
              </svg>
              <p class="text-lg font-medium">This user is muted</p>
              <p class="text-sm">You won't see posts from this user in your feeds.</p>
            </div>
            <button
              on:click={() => {
                if (authorPubkey) {
                  const mutedUsers = JSON.parse(localStorage.getItem('mutedUsers') || '[]');
                  const updated = mutedUsers.filter((pk) => pk !== authorPubkey);
                  localStorage.setItem('mutedUsers', JSON.stringify(updated));
                  invalidateMutedUsersCache();
                  muteListStore.invalidate();
                  muteListStore.load(true);
                  retryWithDelay();
                }
              }}
              class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
            >
              Unmute User
            </button>
          {:else}
            <!-- No posts found message -->
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
          {/if}
        </div>
      </div>
    {:else}
      <div class="space-y-0 w-full">
        {#each events as event (event.id)}
          <!-- Get engagement info - always check cache, subscribe only when visible -->
          {@const isVisible = visibleNotes.has(event.id)}
          {@const engagementInfo = getEngagementRenderInfo(event.id, isVisible)}
          {@const isPopular = engagementInfo.isZapPopular}
          {@const isZapAnimating = zapAnimatingNotes.has(event.id)}
          {@const zapGlowTier = engagementInfo.zapGlowTier}
          {@const engagementStoreValue = get(getEngagementStore(event.id))}
          {@const engagementData = {
            zaps: {
              totalAmount: engagementStoreValue.zaps.totalAmount,
              count: engagementStoreValue.zaps.count
            },
            reactions: { count: engagementStoreValue.reactions.count },
            comments: { count: engagementStoreValue.comments.count }
          }}
          <article
            class="border-b py-4 sm:py-6 first:pt-0 w-full
                   {isPopular ? 'zap-popular-post' : ''}
                   {isZapAnimating ? 'zap-bolt-animation' : ''}
                   {zapGlowTier !== 'none' ? `zap-glow-${zapGlowTier}` : ''}"
            style="border-color: var(--color-input-border); {isPopular
              ? 'box-shadow: 0 0 20px rgba(251, 191, 36, 0.4), 0 0 40px rgba(251, 191, 36, 0.2); border-radius: 8px; border: 2px solid rgba(251, 191, 36, 0.6); padding: 1rem; margin-bottom: 1rem;'
              : ''}"
          >
            <!-- User header with avatar and name -->
            <div class="flex items-center justify-between mb-3 px-2 sm:px-0">
              <div class="flex items-center space-x-3 flex-1 min-w-0">
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

                <div class="flex items-center space-x-2 flex-wrap min-w-0">
                  {#if !hideAuthorName}
                    <AuthorName {event} />
                    <span class="text-sm" style="color: var(--color-caption)">·</span>
                  {/if}
                  <span class="text-sm" style="color: var(--color-caption)">
                    {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                  </span>
                  <ClientAttribution tags={event.tags} enableEnrichment={false} />
                </div>
              </div>

              <!-- Post actions menu (top right) -->
              <div class="flex-shrink-0 ml-2">
                <PostActionsMenu
                  {event}
                  {engagementData}
                  on:copy={(e) => {
                    selectedEvent = event;
                    handlePostCopy(e);
                  }}
                  on:share={(e) => {
                    selectedEvent = event;
                    handlePostShare(e, event);
                  }}
                  on:downloadImage={handleDownloadImage}
                />
              </div>
            </div>

            <!-- Main content area - full width below header -->
            <div class="px-2 sm:px-0">
              <!-- Reply context (orange bracket at top for replies) -->
              {#if isReply(event)}
                {@const parentNoteId = getParentNoteId(event)}
                {#if parentNoteId}
                  {@const parentHref = noteHrefFromEventId(parentNoteId)}
                  {#if parentHref}
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
                        href={parentHref}
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
                      <a href={parentHref} class="parent-quote-embed mb-3 block">
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
                  {:else}
                    <div class="parent-quote-embed mb-3">
                      <div class="parent-quote-header">
                        <span class="parent-quote-author">Replying to a note</span>
                      </div>
                    </div>
                  {/if}
                {/if}
              {/if}

              <!-- Content - strip quoted note reference if present to avoid bubble embed -->
              {#if hasQuotedNote(event)}
                {@const cleanContent = getContentWithoutMedia(
                  getContentWithoutQuote(event.content)
                )}
                {#if cleanContent}
                  <div
                    class="text-sm leading-relaxed mb-3"
                    style="color: var(--color-text-primary)"
                  >
                    <NoteContent content={cleanContent} />
                  </div>
                {/if}
              {:else if getContentWithoutMedia(event.content)}
                {@const cleanContent = getContentWithoutMedia(event.content)}
                <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
                  <NoteContent content={cleanContent} />
                </div>
              {/if}

              <!-- Quoted note embed (appears below user's content) -->
              {#if hasQuotedNote(event)}
                {@const quotedNoteId = getQuotedNoteId(event)}
                {#if quotedNoteId}
                  {@const quotedHref = noteHrefFromEventId(quotedNoteId)}
                  {#if quotedHref}
                    {#await resolveReplyContext(quotedNoteId)}
                      <!-- Loading state -->
                      <div class="parent-quote-embed mb-3">
                        <div class="parent-quote-loading">
                          <div class="w-4 h-4 bg-accent-gray rounded-full animate-pulse"></div>
                          <div class="h-3 bg-accent-gray rounded w-20 animate-pulse"></div>
                        </div>
                      </div>
                    {:then context}
                      <!-- Quoted note with orange bracket style -->
                      <a
                        href={quotedHref}
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
                        <span class="parent-quote-link"> View quoted note → </span>
                      </a>
                    {:catch}
                      <!-- Fallback - simple link -->
                      <a href={quotedHref} class="parent-quote-embed mb-3 block">
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
                              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                            />
                          </svg>
                          <span class="parent-quote-author">Quoting a note</span>
                        </div>
                      </a>
                    {/await}
                  {:else}
                    <div class="parent-quote-embed mb-3">
                      <div class="parent-quote-header">
                        <span class="parent-quote-author">Quoting a note</span>
                      </div>
                    </div>
                  {/if}
                {/if}
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
                            <div class="carousel-image">
                              <VideoPreview url={imageUrl} />
                            </div>
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
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                class="flex items-center justify-between flex-wrap gap-2 px-2 sm:px-0 py-1"
                use:lazyLoadAction={event.id}
              >
                <div class="flex items-center space-x-1 flex-shrink-0">
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

                    <div class="hover:bg-amber-50/50 rounded-full p-1 transition-colors">
                      <NoteTotalZaps {event} onZapClick={() => openZapModal(event)} showPills={true} maxPills={3} />
                    </div>
                  {:else}
                    <span class="text-caption p-1.5">♡ –</span>
                    <span class="text-caption p-1.5">💬 –</span>
                    <span class="text-caption p-1.5">🔁 –</span>
                    <span class="text-caption p-1.5">⚡ –</span>
                  {/if}
                </div>
              </div>

              <div class="px-2 sm:px-0">
                {#if visibleNotes.has(event.id)}
                  <FeedComments {event} />
                {/if}
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
  <ZapModal
    bind:open={zapModal}
    event={selectedEvent}
    on:zap-complete={() => selectedEvent && handleZapComplete(selectedEvent.id)}
  />
{/if}

<ShareModal
  bind:open={shareModalOpen}
  url={shareUrl}
  title={shareTitle}
  imageUrl={shareImageUrl}
  imageBlob={shareImageBlob}
  imageName={shareImageName}
  isGeneratingImage={isGeneratingShareImage}
  onGenerateImage={shareModalEvent ? generateShareModalImage : null}
/>

<!-- Image generation loading overlay -->
{#if isGeneratingImage}
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    style="backdrop-filter: blur(4px);"
    on:click={() => (isGeneratingImage = false)}
    role="button"
    tabindex="0"
    on:keydown={(e) => e.key === 'Escape' && (isGeneratingImage = false)}
  >
    <div
      class="bg-input rounded-lg p-6 max-w-sm mx-4 text-center"
      style="border: 1px solid var(--color-input-border);"
      on:click|stopPropagation
      role="dialog"
    >
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-500 mx-auto mb-3"
      ></div>
      <p class="text-base font-semibold mb-1" style="color: var(--color-text-primary);">
        Generating image...
      </p>
      <p class="text-xs mb-3" style="color: var(--color-text-secondary);">
        This may take a few seconds
      </p>
      <button
        on:click={() => (isGeneratingImage = false)}
        class="text-xs px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-white transition"
      >
        Cancel
      </button>
    </div>
  </div>
{/if}

{#if imageGenerationError}
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    style="backdrop-filter: blur(4px);"
    on:click={() => (imageGenerationError = null)}
  >
    <div
      class="bg-input rounded-lg p-6 max-w-sm mx-4"
      style="border: 1px solid var(--color-input-border);"
      on:click|stopPropagation
    >
      <p class="text-lg font-semibold mb-2 text-red-500">Error</p>
      <p class="text-sm mb-4" style="color: var(--color-text-primary);">
        {imageGenerationError}
      </p>
      <button
        on:click={() => (imageGenerationError = null)}
        class="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
      >
        Close
      </button>
    </div>
  </div>
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

  /* Zap-popular post golden border animation */
  .zap-popular-post {
    animation: golden-pulse 3s ease-in-out infinite;
    transition: all 0.3s ease;
  }

  @keyframes golden-pulse {
    0%,
    100% {
      box-shadow:
        0 0 20px rgba(251, 191, 36, 0.4),
        0 0 40px rgba(251, 191, 36, 0.2);
    }
    50% {
      box-shadow:
        0 0 30px rgba(251, 191, 36, 0.6),
        0 0 60px rgba(251, 191, 36, 0.3);
    }
  }

  /* Tiered zap glow effects - amber/gold glow for dark mode */
  /* Tier 1: Soft glow (>500 sats) - Gentle amber hint */
  .zap-glow-soft {
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.03) 0%, transparent 100%);
    box-shadow:
      0 0 15px rgba(251, 191, 36, 0.25),
      0 0 30px rgba(251, 191, 36, 0.12),
      inset 0 0 20px rgba(251, 191, 36, 0.03);
    border: none !important;
    transition: all 0.5s ease-in-out;
    margin: 0.25rem 0 1rem 0;
    padding: 0.75rem !important;
    padding-bottom: 1.5rem !important;
    overflow-x: hidden; /* Prevent horizontal overflow of content */
    max-width: 100%; /* Ensure it doesn't exceed container */
  }

  /* Tier 2: Medium glow (>1000 sats) - Noticeable warm glow */
  .zap-glow-medium {
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.05) 0%, transparent 100%);
    box-shadow:
      0 0 20px rgba(251, 191, 36, 0.35),
      0 0 40px rgba(251, 191, 36, 0.18),
      0 0 60px rgba(251, 191, 36, 0.08),
      inset 0 0 30px rgba(251, 191, 36, 0.04);
    border: none !important;
    transition: all 0.5s ease-in-out;
    margin: 0.25rem 0 1.5rem 0;
    padding: 0.75rem !important;
    padding-bottom: 2rem !important;
    overflow-x: hidden; /* Prevent horizontal overflow of content */
    max-width: 100%; /* Ensure it doesn't exceed container */
  }

  /* Tier 3: Bright glow (>2000 sats) - Prominent golden aura */
  .zap-glow-bright {
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%);
    box-shadow:
      0 0 25px rgba(251, 191, 36, 0.45),
      0 0 50px rgba(251, 191, 36, 0.25),
      0 0 75px rgba(251, 191, 36, 0.12),
      0 0 100px rgba(251, 191, 36, 0.06),
      inset 0 0 40px rgba(251, 191, 36, 0.05);
    border: none !important;
    transition: all 0.5s ease-in-out;
    animation: subtle-glow-pulse 4s ease-in-out infinite;
    margin: 0.25rem 0 2rem 0;
    padding: 0.75rem !important;
    padding-bottom: 2.5rem !important;
    overflow-x: hidden; /* Prevent horizontal overflow of content */
    max-width: 100%; /* Ensure it doesn't exceed container */
  }

  /* Subtle pulse animation for highest tier */
  @keyframes subtle-glow-pulse {
    0%,
    100% {
      box-shadow:
        0 0 25px rgba(251, 191, 36, 0.45),
        0 0 50px rgba(251, 191, 36, 0.25),
        0 0 75px rgba(251, 191, 36, 0.12),
        0 0 100px rgba(251, 191, 36, 0.06),
        inset 0 0 40px rgba(251, 191, 36, 0.05);
    }
    50% {
      box-shadow:
        0 0 35px rgba(251, 191, 36, 0.55),
        0 0 60px rgba(251, 191, 36, 0.3),
        0 0 85px rgba(251, 191, 36, 0.15),
        0 0 110px rgba(251, 191, 36, 0.08),
        inset 0 0 50px rgba(251, 191, 36, 0.07);
    }
  }

  /* Light mode: More visible orange glow (when .dark is NOT present) */
  :global(html:not(.dark)) .zap-glow-soft {
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.08) 0%, transparent 100%);
    box-shadow:
      0 0 15px rgba(249, 115, 22, 0.4),
      0 0 30px rgba(249, 115, 22, 0.2),
      inset 0 0 20px rgba(249, 115, 22, 0.05);
  }

  :global(html:not(.dark)) .zap-glow-medium {
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, transparent 100%);
    box-shadow:
      0 0 20px rgba(249, 115, 22, 0.5),
      0 0 40px rgba(249, 115, 22, 0.28),
      0 0 60px rgba(249, 115, 22, 0.15),
      inset 0 0 30px rgba(249, 115, 22, 0.06);
  }

  :global(html:not(.dark)) .zap-glow-bright {
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.12) 0%, rgba(234, 88, 12, 0.06) 100%);
    box-shadow:
      0 0 25px rgba(249, 115, 22, 0.6),
      0 0 50px rgba(249, 115, 22, 0.35),
      0 0 75px rgba(249, 115, 22, 0.18),
      0 0 100px rgba(249, 115, 22, 0.1),
      inset 0 0 40px rgba(249, 115, 22, 0.07);
    animation: subtle-glow-pulse-light 4s ease-in-out infinite;
  }

  @keyframes subtle-glow-pulse-light {
    0%,
    100% {
      box-shadow:
        0 0 25px rgba(249, 115, 22, 0.6),
        0 0 50px rgba(249, 115, 22, 0.35),
        0 0 75px rgba(249, 115, 22, 0.18),
        0 0 100px rgba(249, 115, 22, 0.1),
        inset 0 0 40px rgba(249, 115, 22, 0.07);
    }
    50% {
      box-shadow:
        0 0 35px rgba(249, 115, 22, 0.7),
        0 0 60px rgba(249, 115, 22, 0.4),
        0 0 85px rgba(249, 115, 22, 0.22),
        0 0 110px rgba(249, 115, 22, 0.12),
        inset 0 0 50px rgba(249, 115, 22, 0.09);
    }
  }

  /* Remove bottom border from articles that come before glowing articles */
  article:has(+ .zap-glow-soft),
  article:has(+ .zap-glow-medium),
  article:has(+ .zap-glow-bright) {
    border-bottom: none !important;
    margin-bottom: 1rem;
  }

  /* Accessibility: Respect user preference for reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .zap-glow-bright {
      animation: none;
    }
  }

  /* Lightning bolt rain animation ⚡️ */
  .zap-bolt-animation {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    animation: zap-flash-bg 0.15s ease-out;
  }

  /* Lightning flash background */
  @keyframes zap-flash-bg {
    0% {
      background-color: rgba(255, 215, 0, 0.3);
    }
    100% {
      background-color: transparent;
    }
  }

  /* Container for lightning bolts */
  .zap-bolt-animation::before {
    content: '⚡️⚡️⚡️⚡️⚡️⚡️⚡️⚡️';
    position: absolute;
    top: -40px;
    left: 0;
    right: 0;
    font-size: 24px;
    letter-spacing: 8px;
    text-align: center;
    animation: lightning-rain 0.6s ease-in forwards;
    pointer-events: none;
    z-index: 20;
    filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.9)) drop-shadow(0 0 15px rgba(255, 215, 0, 0.6));
    opacity: 0;
  }

  /* Second wave of lightning - staggered */
  .zap-bolt-animation::after {
    content: '⚡️⚡️⚡️⚡️⚡️⚡️';
    position: absolute;
    top: -30px;
    left: 15%;
    right: 15%;
    font-size: 20px;
    letter-spacing: 12px;
    text-align: center;
    animation: lightning-rain 0.7s ease-in 0.1s forwards;
    pointer-events: none;
    z-index: 19;
    filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.8)) drop-shadow(0 0 12px rgba(255, 215, 0, 0.5));
    opacity: 0;
  }

  @keyframes lightning-rain {
    0% {
      opacity: 0;
      transform: translateY(0) scaleY(0.5);
    }
    15% {
      opacity: 1;
      transform: translateY(20px) scaleY(1.2);
    }
    30% {
      opacity: 1;
      transform: translateY(60px) scaleY(1);
    }
    50% {
      opacity: 0.9;
      transform: translateY(120px) scaleY(0.9);
    }
    70% {
      opacity: 0.6;
      transform: translateY(200px) scaleY(0.8);
    }
    100% {
      opacity: 0;
      transform: translateY(350px) scaleY(0.5);
    }
  }

  /* Golden border pulse effect */
  .zap-bolt-animation {
    box-shadow:
      0 0 0 2px rgba(255, 215, 0, 0.8),
      0 0 20px rgba(255, 215, 0, 0.6),
      0 0 40px rgba(255, 215, 0, 0.3),
      inset 0 0 30px rgba(255, 215, 0, 0.1);
    animation:
      zap-flash-bg 0.15s ease-out,
      zap-border-pulse 2s ease-out forwards;
  }

  @keyframes zap-border-pulse {
    0% {
      box-shadow:
        0 0 0 3px rgba(255, 215, 0, 1),
        0 0 30px rgba(255, 215, 0, 0.8),
        0 0 60px rgba(255, 215, 0, 0.5),
        inset 0 0 40px rgba(255, 215, 0, 0.2);
    }
    30% {
      box-shadow:
        0 0 0 2px rgba(255, 215, 0, 0.8),
        0 0 20px rgba(255, 215, 0, 0.6),
        0 0 40px rgba(255, 215, 0, 0.3),
        inset 0 0 25px rgba(255, 215, 0, 0.1);
    }
    100% {
      box-shadow:
        0 0 0 0px rgba(255, 215, 0, 0),
        0 0 0px rgba(255, 215, 0, 0),
        0 0 0px rgba(255, 215, 0, 0),
        inset 0 0 0px rgba(255, 215, 0, 0);
    }
  }
</style>
