<script lang="ts">
  import { ndk, userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { NDKFilter, NDKUser, NDKUserProfile } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import ZapModal from '../../../components/ZapModal.svelte';
  import Feed from '../../../components/Feed.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Avatar from '../../../components/Avatar.svelte';
  import CustomName from '../../../components/CustomName.svelte';
  import Button from '../../../components/Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import SpeakerSlashIcon from 'phosphor-svelte/lib/SpeakerSlash';
  import SpeakerSimpleSlashIcon from 'phosphor-svelte/lib/SpeakerSimpleSlash';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import UsersIcon from 'phosphor-svelte/lib/Users';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { requestProvider } from 'webln';
  import { canOneTapZap, sendOneTapZap } from '$lib/oneTapZap';
  import ProfileEditModal from '../../../components/ProfileEditModal.svelte';
  import ParsedBio from '../../../components/ParsedBio.svelte';
  import ProfileDrafts from '../../../components/ProfileDrafts.svelte';
  import Modal from '../../../components/Modal.svelte';
  import FoodstrFeedOptimized from '../../../components/FoodstrFeedOptimized.svelte';
  import ShareMyRecipesAction from '../../../components/ShareMyRecipesAction.svelte';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import BookOpenIcon from 'phosphor-svelte/lib/BookOpen';
  import ImageSquareIcon from 'phosphor-svelte/lib/ImageSquare';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';
  import { Fetch } from 'hurdak';
  import { profileCacheManager } from '$lib/profileCache';
  import { RECIPE_TAGS } from '$lib/consts';
  import ArticleFeed from '../../../components/ArticleFeed.svelte';
  import MembershipBeltBadge from '../../../components/MembershipBeltBadge.svelte';
  import { fetchUserStatsFromPrimal, getPrimalCache, type PrimalUserStats } from '$lib/primalCache';

  export let data: PageData;

  let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let user: NDKUser | null = null;
  let profile: NDKUserProfile | null = null;
  let loaded = false;
  let zapModal = false;
  let isZapping = false;

  // Tab state: 'recipes' | 'posts' | 'media' | 'reads' | 'following' | 'drafts'
  // Default to 'posts' tab for a more social-first experience
  let activeTab:
    | 'recipes'
    | 'posts'
    | 'replies'
    | 'media'
    | 'reads'
    | 'following'
    | 'drafts' = 'posts';

  // Reads tab state (longform articles)
  let readsEvents: NDKEvent[] = [];
  let readsLoaded = false;
  let loadingMoreReads = false;
  let hasMoreReads = true;
  let oldestReadsTime: number | null = null;
  let readsSentinel: HTMLElement;

  // Media tab state
  type MediaItem = {
    event: NDKEvent;
    url: string;
    type: 'image' | 'video';
  };
  let mediaItems: MediaItem[] = [];
  let mediaLoaded = false;
  let loadingMoreMedia = false;
  let hasMoreMedia = true;
  let oldestMediaTime: number | null = null;
  let mediaSentinel: HTMLElement;

  // Profile stats from Primal
  let profileStats: PrimalUserStats | null = null;

  // Following tab state
  type FollowingProfile = {
    pubkey: string;
    npub: string;
    name: string;
    picture?: string;
    nip05?: string;
    about?: string;
  };
  let followingProfiles: FollowingProfile[] = [];
  let followingLoaded = false;
  let followingLoading = false;
  let followingCount: number | null = null;

  // Infinite scroll state for recipes
  let hasMoreRecipes = true;
  let loadingMoreRecipes = false;
  let oldestRecipeTime: number | null = null;
  let recipeSentinel: HTMLElement;
  let postsSentinel: HTMLElement;
  let repliesSentinel: HTMLElement;
  let foodstrFeedComponent: FoodstrFeedOptimized;
  let foodstrRepliesFeedComponent: FoodstrFeedOptimized;
  let recipeObserver: IntersectionObserver | null = null;
  let postsObserver: IntersectionObserver | null = null;
  let repliesObserver: IntersectionObserver | null = null;
  let readsObserver: IntersectionObserver | null = null;
  let mediaObserver: IntersectionObserver | null = null;

  // Bio expand/collapse state
  let bioExpanded = false;

  // Follow state
  let isFollowing = false;
  let followLoading = false;
  let currentFollowTags: string[][] = []; // Preserve full tag structure ['p', pubkey, relay?, petname?]
  let currentFollowContent: string = ''; // Preserve relay configuration from content

  // Mute state
  let isMuted = false;
  let muteLoading = false;
  let mutedUsers: string[] = [];

  // Profile picture upload state
  let uploadingPicture = false;
  let pictureInputEl: HTMLInputElement | null = null;
  let avatarRefreshKey = 0; // Used to force Avatar remount after picture change

  // Profile edit modal state
  let profileEditModal = false;

  // Track slug changes and reload data when navigating between profiles
  let currentSlug: string | undefined;
  $: if ($page.params.slug && $page.params.slug !== currentSlug) {
    currentSlug = $page.params.slug;
    loadData();
  }

  // Handle ?tab= query parameter for direct tab navigation
  $: {
    const tabParam = $page.url.searchParams.get('tab');
    const allowedTabs = new Set(['recipes', 'posts', 'media', 'reads', 'following', 'drafts']);

    if (tabParam && allowedTabs.has(tabParam)) {
      // Only allow "drafts" tab for the profile owner
      if (tabParam === 'drafts') {
        if ($userPublickey && $userPublickey === hexpubkey) {
          activeTab = 'drafts';
        }
      } else {
        activeTab = tabParam as any;
      }
    }
    // Redirect old 'lists' tab to cookbook
    if (tabParam === 'lists') {
      goto('/cookbook');
    }
  }

  // Check follow status when user logs in or profile changes
  $: if ($userPublickey && hexpubkey) {
    checkFollowStatus();
    checkMuteStatus();
  }

  async function loadData(forceRefresh = false) {
    try {
      events = [];
      profile = {};
      hexpubkey = undefined;
      loaded = false;
      activeTab = 'posts'; // Default to posts tab for social-first experience
      // Reset pagination state
      hasMoreRecipes = true;
      loadingMoreRecipes = false;
      oldestRecipeTime = null;
      // Reset reads state
      readsEvents = [];
      readsLoaded = false;
      hasMoreReads = true;
      oldestReadsTime = null;
      // Reset media state
      mediaItems = [];
      mediaLoaded = false;
      loadingMoreMedia = false;
      hasMoreMedia = true;
      oldestMediaTime = null;
      if (mediaObserver) {
        mediaObserver.disconnect();
        mediaObserver = null;
      }
      // Reset bio expanded state
      bioExpanded = false;
      // Reset profile stats
      profileStats = null;
      // Reset following tab state
      followingProfiles = [];
      followingLoaded = false;
      followingLoading = false;
      followingCount = null;
      // Reset mute state
      isMuted = false;
      mutedUsers = [];
      // Note: We don't reset userProfilePictureOverride here since it's a global store
      // that should persist until the user logs out or the session ends
      console.log('loadData', forceRefresh ? '(force refresh)' : '');

      if ($page.params.slug?.startsWith(`npub1`)) {
        hexpubkey = nip19.decode($page.params.slug).data.toString();
      } else if ($page.params.slug) {
        goto(`/user/${nip19.npubEncode($page.params.slug)}`);
        return;
      } else {
        throw new Error('Invalid user slug');
      }

      if (hexpubkey) {
        // load user
        const u = $ndk.getUser({ pubkey: hexpubkey });

        // If force refresh, fetch profile metadata directly from relays
        if (forceRefresh) {
          console.log('[loadData] Force refreshing profile from relays...');
          const profileFilter: NDKFilter = {
            kinds: [0],
            authors: [hexpubkey],
            limit: 1
          };
          const profileEvents = await $ndk.fetchEvents(profileFilter);
          const latestProfile = Array.from(profileEvents).sort(
            (a, b) => (b.created_at || 0) - (a.created_at || 0)
          )[0];
          if (latestProfile) {
            try {
              const profileData = JSON.parse(latestProfile.content);
              profile = profileData;
              console.log('[loadData] Fresh profile:', profileData);
            } catch (e) {
              console.error('[loadData] Failed to parse profile:', e);
            }
          }
        } else {
          const p = await u.fetchProfile();
          if (p) {
            profile = p;
          }
        }
        user = u;

        // load recipes (initial load with smaller limit for pagination)
        let filter: NDKFilter = {
          authors: [hexpubkey],
          limit: 20,
          kinds: [30023],
          '#t': RECIPE_TAGS
        };

        let subscription = $ndk.subscribe(filter);

        subscription.on('event', (ev: NDKEvent) => {
          if (validateMarkdownTemplate(ev.content) != null) {
            events.push(ev);
            events = events;
          }
        });

        subscription.on('eose', () => {
          subscription.stop();
          loaded = true;
          // Sort events by created_at and set oldestRecipeTime for pagination
          if (events.length > 0) {
            events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            const oldestEvent = events[events.length - 1];
            if (oldestEvent?.created_at) {
              oldestRecipeTime = oldestEvent.created_at;
            }
          }
          // If we got fewer than 20 recipes, there are no more
          hasMoreRecipes = events.length >= 20;
        });

        // Check follow status and mute status if logged in
        if ($userPublickey) {
          checkFollowStatus();
          checkMuteStatus();
        }

        // Fetch profile stats (follower/following counts) from Primal
        const requestedHexpubkey = hexpubkey;
        fetchUserStatsFromPrimal(requestedHexpubkey).then((stats) => {
          if (stats && requestedHexpubkey === hexpubkey) {
            profileStats = stats;
          }
        });
      }
    } catch (error) {
      console.error('Error in loadData:', error);
      // Set default values on error
      events = [];
      profile = {};
      loaded = true;
    }
  }

  async function checkFollowStatus() {
    if (!$userPublickey || !hexpubkey) return;

    try {
      // Fetch the logged-in user's contact list (kind:3)
      const filter: NDKFilter = {
        authors: [$userPublickey],
        kinds: [3],
        limit: 1
      };

      const contactEvents = await $ndk.fetchEvents(filter);
      const contactList = Array.from(contactEvents)[0];

      if (contactList) {
        // Preserve full tags structure (includes relay hints and petnames)
        currentFollowTags = contactList.tags.filter((tag) => tag[0] === 'p');
        // Preserve content (contains relay configuration)
        currentFollowContent = contactList.content || '';

        // Check if we're following this user
        const followedPubkeys = currentFollowTags.map((tag) => tag[1]);
        isFollowing = followedPubkeys.includes(hexpubkey);
      } else {
        currentFollowTags = [];
        currentFollowContent = '';
        isFollowing = false;
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  }

  async function toggleFollow() {
    if (!$userPublickey || !hexpubkey || followLoading) return;

    followLoading = true;

    try {
      // IMPORTANT: Always fetch the latest follow list before modifying
      // This prevents accidentally publishing an empty list if local state is stale
      const filter: NDKFilter = {
        authors: [$userPublickey],
        kinds: [3],
        limit: 1
      };

      const contactEvents = await $ndk.fetchEvents(filter);
      const existingContactList = Array.from(contactEvents)[0];

      let freshFollowTags: string[][] = [];
      let freshFollowContent: string = '';

      if (existingContactList) {
        freshFollowTags = existingContactList.tags.filter((tag) => tag[0] === 'p');
        freshFollowContent = existingContactList.content || '';
      }

      // Update local cache with fresh data
      currentFollowTags = freshFollowTags;
      currentFollowContent = freshFollowContent;

      let newFollowTags: string[][];

      if (isFollowing) {
        // Unfollow: remove the pubkey while preserving other tags
        newFollowTags = freshFollowTags.filter((tag) => tag[1] !== hexpubkey);
      } else {
        // Follow: add new pubkey tag
        newFollowTags = [...freshFollowTags, ['p', hexpubkey]];
      }

      // SAFEGUARD: Prevent publishing an empty follow list when unfollowing
      // (unless user genuinely has only 1 follow and is unfollowing them)
      if (isFollowing && newFollowTags.length === 0 && freshFollowTags.length > 1) {
        console.error(
          'Safety check failed: Would publish empty follow list but user has multiple follows. Aborting.'
        );
        throw new Error('Failed to update follow list. Please try again.');
      }

      // Create new kind:3 contact list event, preserving content (relay config)
      const contactEvent = new NDKEvent($ndk);
      contactEvent.kind = 3;
      contactEvent.content = freshFollowContent; // Preserve relay configuration
      contactEvent.tags = newFollowTags; // Preserve full tag structure

      await contactEvent.publish();

      // Update local state
      currentFollowTags = newFollowTags;
      isFollowing = !isFollowing;
    } catch (error) {
      console.error('Error toggling follow:', error);
    } finally {
      followLoading = false;
    }
  }

  async function checkMuteStatus() {
    if (!$userPublickey || !hexpubkey) return;

    try {
      // Load mute list from localStorage first (fast)
      const storedMutes = localStorage.getItem('mutedUsers');
      if (storedMutes) {
        mutedUsers = JSON.parse(storedMutes);
        isMuted = mutedUsers.includes(hexpubkey);
      }

      // Also fetch from Nostr (kind:10000 = mute list)
      const muteFilter: NDKFilter = {
        authors: [$userPublickey],
        kinds: [10000],
        limit: 1
      };

      const muteEvents = await $ndk.fetchEvents(muteFilter);
      const muteList = Array.from(muteEvents)[0];

      if (muteList) {
        // Extract muted pubkeys from 'p' tags
        mutedUsers = muteList.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]);

        // Update localStorage
        localStorage.setItem('mutedUsers', JSON.stringify(mutedUsers));

        isMuted = mutedUsers.includes(hexpubkey);
      }
    } catch (error) {
      console.error('Error checking mute status:', error);
    }
  }

  async function toggleMute() {
    if (!$userPublickey || !hexpubkey || muteLoading) return;

    muteLoading = true;

    try {
      const newMuted = isMuted
        ? mutedUsers.filter((pk) => pk !== hexpubkey)
        : [...mutedUsers, hexpubkey];

      // Create new kind:10000 mute list event
      const muteEvent = new NDKEvent($ndk);
      muteEvent.kind = 10000;
      muteEvent.content = '';
      muteEvent.tags = newMuted.map((pk) => ['p', pk]);

      await muteEvent.publish();

      // Update local state
      mutedUsers = newMuted;
      isMuted = !isMuted;

      // Update localStorage
      localStorage.setItem('mutedUsers', JSON.stringify(mutedUsers));
    } catch (error) {
      console.error('Error toggling mute:', error);
    } finally {
      muteLoading = false;
    }
  }

  async function loadMoreRecipes() {
    if (loadingMoreRecipes || !hasMoreRecipes || !hexpubkey || !oldestRecipeTime) return;

    loadingMoreRecipes = true;

    try {
      const filter: NDKFilter = {
        authors: [hexpubkey],
        limit: 20,
        kinds: [30023],
        '#t': RECIPE_TAGS,
        until: oldestRecipeTime - 1
      };

      const subscription = $ndk.subscribe(filter);
      const newRecipes: NDKEvent[] = [];

      await new Promise<void>((resolve) => {
        let resolved = false;

        subscription.on('event', (ev: NDKEvent) => {
          if (validateMarkdownTemplate(ev.content) != null) {
            newRecipes.push(ev);
          }
        });

        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();

            if (newRecipes.length > 0) {
              // Filter out duplicates
              const existingIds = new Set(events.map((e) => e.id));
              const uniqueNewRecipes = newRecipes.filter((r) => !existingIds.has(r.id));

              // Add new recipes and sort by created_at
              events = [...events, ...uniqueNewRecipes].sort(
                (a, b) => (b.created_at || 0) - (a.created_at || 0)
              );

              // Update oldest time from the actual oldest event
              const oldestEvent = events[events.length - 1];
              if (oldestEvent?.created_at) {
                oldestRecipeTime = oldestEvent.created_at;
              }
              hasMoreRecipes = uniqueNewRecipes.length >= 20;
            } else {
              hasMoreRecipes = false;
            }

            resolve();
          }
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (newRecipes.length > 0) {
              // Filter out duplicates
              const existingIds = new Set(events.map((e) => e.id));
              const uniqueNewRecipes = newRecipes.filter((r) => !existingIds.has(r.id));

              // Add new recipes and sort by created_at
              events = [...events, ...uniqueNewRecipes].sort(
                (a, b) => (b.created_at || 0) - (a.created_at || 0)
              );

              // Update oldest time from the actual oldest event
              const oldestEvent = events[events.length - 1];
              if (oldestEvent?.created_at) {
                oldestRecipeTime = oldestEvent.created_at;
              }
              hasMoreRecipes = uniqueNewRecipes.length >= 20;
            } else {
              hasMoreRecipes = false;
            }
            resolve();
          }
        }, 5000);
      });
    } catch (error) {
      console.error('Error loading more recipes:', error);
    } finally {
      loadingMoreRecipes = false;
    }
  }

  // Helper functions for reads/articles formatting
  const IMAGE_URL_REGEX = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^\s]*)?)/gi;

  function extractArticleImage(event: NDKEvent): string | null {
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

    return null;
  }

  function calculateReadTime(content: string): number {
    const text = content
      .replace(/#+\s+/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\*\*([^\*]+)\*\*/g, '$1')
      .replace(/\*([^\*]+)\*/g, '$1')
      .trim();

    const words = text.split(/\s+/).filter((word) => word.length > 0);
    const minutes = Math.ceil(words.length / 200);
    return Math.max(1, minutes);
  }

  function cleanArticlePreview(content: string): string {
    let cleaned = content;
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    cleaned = cleaned.replace(/^#+\s+/gm, '');
    cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1');
    cleaned = cleaned.replace(/`[^`]+`/g, '');

    const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) {
      const preview = lines[0].trim();
      return preview.length > 150 ? preview.substring(0, 150).trim() + '...' : preview;
    }

    return cleaned.trim().substring(0, 150);
  }

  function getArticleUrl(event: NDKEvent): string {
    if (event.kind === 30023) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag && event.pubkey) {
        try {
          const naddr = nip19.naddrEncode({
            identifier: dTag,
            kind: 30023,
            pubkey: event.pubkey
          });
          return `/recipe/${naddr}`;
        } catch (e) {
          console.warn('Failed to encode naddr:', e);
        }
      }
    }
    return '#';
  }

  function getArticleTitle(event: NDKEvent): string {
    const titleTag = event.tags.find((t) => t[0] === 'title');
    if (titleTag && titleTag[1]) {
      return titleTag[1];
    }

    const content = event.content || '';
    const lines = content.split('\n').filter((line) => line.trim());
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.startsWith('# ')) {
        return firstLine.substring(2).trim();
      }
      if (firstLine.length < 100) {
        return firstLine;
      }
    }

    return 'Untitled Article';
  }

  function getArticleTags(event: NDKEvent): string[] {
    return event.tags
      .filter((t) => t[0] === 't' && t[1])
      .map((t) => t[1])
      .slice(0, 3); // Limit to 3 tags for display
  }

  function formatReadsArticles(events: NDKEvent[]) {
    return events.map((event) => ({
      event,
      imageUrl: extractArticleImage(event),
      title: getArticleTitle(event),
      preview: cleanArticlePreview(event.content || ''),
      readTime: calculateReadTime(event.content || ''),
      tags: getArticleTags(event),
      articleUrl: getArticleUrl(event)
    }));
  }

  // Load user's longform articles (reads)
  async function loadReads() {
    if (!hexpubkey || readsLoaded) return;

    try {
      const filter: NDKFilter = {
        authors: [hexpubkey],
        kinds: [30023],
        limit: 20
      };

      const subscription = $ndk.subscribe(filter);
      const fetchedEvents: NDKEvent[] = [];
      const seenIds = new Set<string>();

      await new Promise<void>((resolve) => {
        let resolved = false;

        subscription.on('event', (ev: NDKEvent) => {
          if (seenIds.has(ev.id)) return;
          seenIds.add(ev.id);

          // Exclude recipes (events with recipe tags)
          const hasRecipeTag = ev.tags.some(
            (tag) => tag[0] === 't' && RECIPE_TAGS.includes(tag[1]?.toLowerCase() || '')
          );
          if (hasRecipeTag) return;

          // Exclude events that match recipe format
          const recipeValidation = validateMarkdownTemplate(ev.content);
          if (typeof recipeValidation !== 'string') return;

          fetchedEvents.push(ev);
        });

        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();

            readsEvents = fetchedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            readsLoaded = true;

            if (readsEvents.length > 0) {
              const oldestEvent = readsEvents[readsEvents.length - 1];
              if (oldestEvent?.created_at) {
                oldestReadsTime = oldestEvent.created_at;
              }
            }
            hasMoreReads = fetchedEvents.length >= 20;
            resolve();
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            readsEvents = fetchedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            readsLoaded = true;
            hasMoreReads = fetchedEvents.length >= 20;
            resolve();
          }
        }, 10000);
      });
    } catch (error) {
      console.error('Error loading reads:', error);
      readsLoaded = true;
    }
  }

  async function loadMoreReads() {
    if (loadingMoreReads || !hasMoreReads || !hexpubkey || !oldestReadsTime) return;

    loadingMoreReads = true;

    try {
      const filter: NDKFilter = {
        authors: [hexpubkey],
        kinds: [30023],
        limit: 20,
        until: oldestReadsTime - 1
      };

      const subscription = $ndk.subscribe(filter);
      const newReads: NDKEvent[] = [];
      const existingIds = new Set(readsEvents.map((e) => e.id));

      await new Promise<void>((resolve) => {
        let resolved = false;

        subscription.on('event', (ev: NDKEvent) => {
          if (existingIds.has(ev.id)) return;

          // Exclude recipes
          const hasRecipeTag = ev.tags.some(
            (tag) => tag[0] === 't' && RECIPE_TAGS.includes(tag[1]?.toLowerCase() || '')
          );
          if (hasRecipeTag) return;

          const recipeValidation = validateMarkdownTemplate(ev.content);
          if (typeof recipeValidation !== 'string') return;

          newReads.push(ev);
        });

        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();

            if (newReads.length > 0) {
              readsEvents = [...readsEvents, ...newReads].sort(
                (a, b) => (b.created_at || 0) - (a.created_at || 0)
              );

              const oldestEvent = readsEvents[readsEvents.length - 1];
              if (oldestEvent?.created_at) {
                oldestReadsTime = oldestEvent.created_at;
              }
              hasMoreReads = newReads.length >= 20;
            } else {
              hasMoreReads = false;
            }
            resolve();
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (newReads.length > 0) {
              readsEvents = [...readsEvents, ...newReads].sort(
                (a, b) => (b.created_at || 0) - (a.created_at || 0)
              );
              hasMoreReads = newReads.length >= 20;
            } else {
              hasMoreReads = false;
            }
            resolve();
          }
        }, 5000);
      });
    } catch (error) {
      console.error('Error loading more reads:', error);
    } finally {
      loadingMoreReads = false;
    }
  }

  // Load reads when switching to reads tab
  $: if (activeTab === 'reads' && hexpubkey && !readsLoaded) {
    loadReads();
  }

  // ── Media tab ──────────────────────────────────────────────────
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i;
  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?.*)?$/i;
  const URL_REGEX = /https?:\/\/[^\s<)"\]]+/g;

  function isMediaImageUrl(url: string): boolean {
    try {
      const u = new URL(url);
      if (IMAGE_EXTENSIONS.test(u.pathname)) return true;
      if (u.hostname.includes('image.nostr.build')) return true;
      if (u.hostname.includes('nostr.build') && u.pathname.includes('/i/')) return true;
      if (u.hostname.includes('imgur.com')) return true;
      if (u.hostname.includes('primal.b-cdn.net')) return true;
      if (u.hostname.includes('i.ibb.co')) return true;
      if (u.hostname.includes('void.cat')) return true;
      return false;
    } catch { return false; }
  }

  function isMediaVideoUrl(url: string): boolean {
    try {
      return VIDEO_EXTENSIONS.test(new URL(url).pathname);
    } catch { return false; }
  }

  function extractMediaFromEvent(event: NDKEvent): MediaItem[] {
    const items: MediaItem[] = [];
    const seen = new Set<string>();

    // Check imeta tags first (NIP-92)
    for (const tag of event.tags) {
      if (tag[0] === 'imeta') {
        for (const part of tag.slice(1)) {
          if (part.startsWith('url ')) {
            const url = part.substring(4).trim();
            if (!seen.has(url)) {
              seen.add(url);
              items.push({ event, url, type: isMediaVideoUrl(url) ? 'video' : 'image' });
            }
          }
        }
      }
    }

    // Check image tags
    for (const tag of event.tags) {
      if (tag[0] === 'image' && tag[1] && !seen.has(tag[1])) {
        seen.add(tag[1]);
        items.push({ event, url: tag[1], type: 'image' });
      }
    }

    // Parse content for media URLs
    const urls = event.content?.match(URL_REGEX) || [];
    for (const url of urls) {
      const clean = url.replace(/[.,;:!?)]+$/, ''); // Strip trailing punctuation
      if (seen.has(clean)) continue;
      if (isMediaImageUrl(clean)) {
        seen.add(clean);
        items.push({ event, url: clean, type: 'image' });
      } else if (isMediaVideoUrl(clean)) {
        seen.add(clean);
        items.push({ event, url: clean, type: 'video' });
      }
    }

    return items;
  }

  async function loadMedia() {
    if (!hexpubkey || mediaLoaded) return;

    try {
      const filter: NDKFilter = {
        authors: [hexpubkey],
        kinds: [1],
        limit: 100
      };

      const subscription = $ndk.subscribe(filter);
      const fetchedItems: MediaItem[] = [];
      const seenEventIds = new Set<string>();
      let latestOldest: number | null = null;

      await new Promise<void>((resolve) => {
        let resolved = false;

        subscription.on('event', (ev: NDKEvent) => {
          if (seenEventIds.has(ev.id)) return;
          seenEventIds.add(ev.id);

          const t = ev.created_at || 0;
          if (latestOldest === null || t < latestOldest) latestOldest = t;
          const items = extractMediaFromEvent(ev);
          if (items.length > 0) {
            fetchedItems.push(...items);
          }
        });

        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            mediaItems = fetchedItems.sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0));
            mediaLoaded = true;
            oldestMediaTime = latestOldest;
            hasMoreMedia = seenEventIds.size >= 100;
            resolve();
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            mediaItems = fetchedItems.sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0));
            mediaLoaded = true;
            oldestMediaTime = latestOldest;
            hasMoreMedia = seenEventIds.size >= 100;
            resolve();
          }
        }, 10000);
      });
    } catch (error) {
      console.error('Error loading media:', error);
      mediaLoaded = true;
    }
  }

  async function loadMoreMedia() {
    if (loadingMoreMedia || !hasMoreMedia || !hexpubkey || !oldestMediaTime) return;
    loadingMoreMedia = true;

    try {
      const filter: NDKFilter = {
        authors: [hexpubkey],
        kinds: [1],
        limit: 100,
        until: oldestMediaTime - 1
      };

      const subscription = $ndk.subscribe(filter);
      const newItems: MediaItem[] = [];
      const existingUrls = new Set(mediaItems.map((m) => m.url));
      let eventCount = 0;
      let latestOldest: number | null = null;

      await new Promise<void>((resolve) => {
        let resolved = false;

        subscription.on('event', (ev: NDKEvent) => {
          eventCount++;
          const items = extractMediaFromEvent(ev);
          for (const item of items) {
            if (!existingUrls.has(item.url)) {
              newItems.push(item);
              existingUrls.add(item.url);
            }
          }
          const t = ev.created_at || 0;
          if (latestOldest === null || t < latestOldest) latestOldest = t;
        });

        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (newItems.length > 0) {
              mediaItems = [...mediaItems, ...newItems].sort(
                (a, b) => (b.event.created_at || 0) - (a.event.created_at || 0)
              );
              if (latestOldest !== null) oldestMediaTime = latestOldest;
              hasMoreMedia = eventCount >= 100;
            } else {
              hasMoreMedia = false;
            }
            resolve();
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (newItems.length > 0) {
              mediaItems = [...mediaItems, ...newItems].sort(
                (a, b) => (b.event.created_at || 0) - (a.event.created_at || 0)
              );
              if (latestOldest !== null) oldestMediaTime = latestOldest;
              hasMoreMedia = eventCount >= 100;
            } else {
              hasMoreMedia = false;
            }
            resolve();
          }
        }, 5000);
      });
    } catch (error) {
      console.error('Error loading more media:', error);
    } finally {
      loadingMoreMedia = false;
    }
  }

  function handleMediaImgError(e: Event) {
    const el = e.target as HTMLElement;
    const tile = el?.closest('.media-tile') as HTMLElement | null;
    if (tile) tile.style.display = 'none';
  }

  function getMediaEventUrl(event: NDKEvent): string {
    const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey });
    return `/${nevent}`;
  }

  // Load media when switching to media tab
  $: if (activeTab === 'media' && hexpubkey && !mediaLoaded) {
    loadMedia();
  }

  // Load following list when switching to following tab
  $: if (activeTab === 'following' && hexpubkey && !followingLoaded && !followingLoading) {
    loadFollowing();
  }

  /** Fetch NDK events with a timeout that resolves to an empty set (no unhandled rejections) */
  function fetchEventsWithTimeout(
    filter: NDKFilter,
    timeoutMs = 8000
  ): Promise<Set<NDKEvent>> {
    return new Promise<Set<NDKEvent>>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Set<NDKEvent>()), timeoutMs);
      $ndk
        .fetchEvents(filter)
        .then((result: Set<NDKEvent>) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async function loadFollowing() {
    if (!hexpubkey || followingLoading) return;

    const requestedPubkey = hexpubkey;
    followingLoading = true;

    try {
      // Step 1: Get the followed pubkeys — try Primal first (fast), fall back to NDK
      let followPubkeys: string[] = [];

      const primal = getPrimalCache();
      if (primal) {
        try {
          followPubkeys = await primal.fetchContactList(requestedPubkey, 5000);
        } catch (e) {
          console.debug('[Following] Primal contact list failed, trying NDK:', e);
        }
      }

      if (followPubkeys.length === 0) {
        // NDK fallback with a resolving timeout (empty set = timed out)
        try {
          const contactEvents = await fetchEventsWithTimeout(
            { authors: [requestedPubkey], kinds: [3], limit: 1 },
            8000
          );
          const contactList = Array.from(contactEvents)[0];
          if (contactList) {
            followPubkeys = contactList.tags
              .filter((t) => t[0] === 'p' && t[1])
              .map((t) => t[1]);
          }
        } catch (e) {
          console.debug('[Following] NDK contact list also failed:', e);
        }
      }

      // Bail if user navigated away
      if (hexpubkey !== requestedPubkey) return;

      followingCount = followPubkeys.length;

      if (followPubkeys.length === 0) {
        followingProfiles = [];
        followingLoaded = true;
        followingLoading = false;
        return;
      }

      // Step 2: Fetch profile metadata via NDK with resolving timeouts per batch
      const profiles: FollowingProfile[] = [];
      const resolvedPubkeys = new Set<string>();
      const batchSize = 100;
      for (let i = 0; i < followPubkeys.length; i += batchSize) {
        const batch = followPubkeys.slice(i, i + batchSize);

        // Bail if user navigated away mid-batch
        if (hexpubkey !== requestedPubkey) return;

        try {
          const profileEvents = await fetchEventsWithTimeout(
            { kinds: [0], authors: batch },
            8000
          );

          for (const event of profileEvents) {
            try {
              const profileData = JSON.parse(event.content);
              resolvedPubkeys.add(event.pubkey);
              profiles.push({
                pubkey: event.pubkey,
                npub: nip19.npubEncode(event.pubkey),
                name: profileData.display_name || profileData.name || nip19.npubEncode(event.pubkey).slice(0, 12) + '...',
                picture: profileData.picture,
                nip05: profileData.nip05,
                about: profileData.about
              });
            } catch (e) {
              resolvedPubkeys.add(event.pubkey);
              profiles.push({
                pubkey: event.pubkey,
                npub: nip19.npubEncode(event.pubkey),
                name: nip19.npubEncode(event.pubkey).slice(0, 12) + '...'
              });
            }
          }
        } catch (e) {
          console.debug('[Following] Profile batch failed, continuing with what we have');
        }
      }

      // Bail if user navigated away
      if (hexpubkey !== requestedPubkey) return;

      // Add placeholder entries for pubkeys we couldn't resolve
      for (const pk of followPubkeys) {
        if (!resolvedPubkeys.has(pk)) {
          profiles.push({
            pubkey: pk,
            npub: nip19.npubEncode(pk),
            name: nip19.npubEncode(pk).slice(0, 12) + '...'
          });
        }
      }

      // Sort: resolved names first, then truncated npubs at the end
      profiles.sort((a, b) => {
        const aIsNpub = a.name.startsWith('npub1');
        const bIsNpub = b.name.startsWith('npub1');
        if (aIsNpub && !bIsNpub) return 1;
        if (!aIsNpub && bIsNpub) return -1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      followingProfiles = profiles;
      followingLoaded = true;
    } catch (error) {
      console.error('Error loading following list:', error);
      if (hexpubkey === requestedPubkey) {
        followingLoaded = true;
      }
    } finally {
      if (hexpubkey === requestedPubkey) {
        followingLoading = false;
      }
    }
  }

  let qrModal = false;
  let npubCopied = false;
  let lightningCopied = false;
  let npubToast = false;

  function qrModalCleanup() {
    qrModal = false;
    npubCopied = false;
    lightningCopied = false;
  }

  async function handleZapClick() {
    if (!user) return;

    if (canOneTapZap()) {
      isZapping = true;
      const result = await sendOneTapZap(user);
      isZapping = false;
      if (!result.success) {
        // Fallback to modal on failure
        zapModal = true;
      }
    } else {
      zapModal = true;
    }
  }

  async function copyNpub() {
    if (user?.npub) {
      await navigator.clipboard.writeText(user.npub);
      npubCopied = true;
      npubToast = true;
      setTimeout(() => {
        npubCopied = false;
      }, 2000);
      setTimeout(() => {
        npubToast = false;
      }, 2000);
    }
  }

  async function copyLightningAddress(address: string) {
    if (address) {
      await navigator.clipboard.writeText(address);
      lightningCopied = true;
      setTimeout(() => {
        lightningCopied = false;
      }, 2000);
    }
  }

  async function uploadProfilePicture(body: FormData) {
    const url = 'https://nostr.build/api/v2/upload/profile';

    // Check if we have a signer
    if (!$ndk.signer) {
      console.error('[Profile Upload] No signer available');
      throw new Error('Not authenticated - please sign in again');
    }

    console.log('[Profile Upload] Creating NIP-98 auth event...');

    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();

    console.log('[Profile Upload] Event signed, uploading...');

    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    const result = await Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });

    console.log('[Profile Upload] Upload result:', result);
    return result;
  }

  async function handlePictureUpload(event: Event) {
    console.log('[Profile Upload] handlePictureUpload called');
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) {
      console.log('[Profile Upload] No files selected');
      return;
    }
    if (!$userPublickey || hexpubkey !== $userPublickey) {
      console.log('[Profile Upload] Not own profile or not logged in');
      return;
    }

    uploadingPicture = true;
    console.log('[Profile Upload] Starting upload...');

    try {
      const file = target.files[0];
      console.log('[Profile Upload] File:', file.name, file.type, file.size);

      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        uploadingPicture = false;
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert('Image must be less than 10MB');
        uploadingPicture = false;
        return;
      }

      const body = new FormData();
      body.append('file[]', file);
      body.append('media_type', 'avatar');

      const result = await uploadProfilePicture(body);
      console.log('[Profile Upload] Upload complete, result:', result);

      if (result && result.data && result.data[0]?.url) {
        const newPictureUrl = result.data[0].url;
        console.log('[Profile Upload] New picture URL:', newPictureUrl);

        // Get current profile
        const currentUser = $ndk.getUser({ pubkey: $userPublickey });
        await currentUser.fetchProfile();

        // Update profile metadata (kind 0)
        const metaEvent = new NDKEvent($ndk);
        metaEvent.kind = 0;
        metaEvent.tags = [];

        // Preserve existing profile data, update picture
        const profileContent: any = {
          picture: newPictureUrl
        };

        if (currentUser.profile?.displayName) {
          profileContent.display_name = currentUser.profile.displayName;
        }
        if (currentUser.profile?.name) {
          profileContent.name = currentUser.profile.name;
        }
        if (currentUser.profile?.about) {
          profileContent.about = currentUser.profile.about;
        }
        if (currentUser.profile?.nip05) {
          profileContent.nip05 = currentUser.profile.nip05;
        }
        if (currentUser.profile?.lud16) {
          profileContent.lud16 = currentUser.profile.lud16;
        }
        if (currentUser.profile?.lud06) {
          profileContent.lud06 = currentUser.profile.lud06;
        }

        metaEvent.content = JSON.stringify(profileContent);
        console.log('[Profile Upload] Publishing profile update:', profileContent);

        // Publish and wait for relay confirmations
        const publishedRelays = await metaEvent.publish();
        console.log('[Profile Upload] Published to relays:', publishedRelays.size);

        // Wait for at least one relay to confirm
        if (publishedRelays.size > 0) {
          console.log(
            '[Profile Upload] Profile updated successfully on',
            publishedRelays.size,
            'relays'
          );
        } else {
          console.warn('[Profile Upload] No relays confirmed the publish');
        }

        // Clear profile cache so it refreshes
        profileCacheManager.invalidateProfile($userPublickey);

        // Small delay to allow relays to propagate
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Update local profile immediately with new picture
        if (profile) {
          profile = { ...profile, picture: newPictureUrl, image: newPictureUrl };
        }

        // Set override URL so avatar shows new picture immediately (global store updates header too)
        console.log('[Profile Upload] Setting userProfilePictureOverride store to:', newPictureUrl);
        userProfilePictureOverride.set(newPictureUrl);
        console.log('[Profile Upload] Store value after set:', $userProfilePictureOverride);

        // Force Avatar to remount with fresh data
        avatarRefreshKey++;

        // Reload profile data with force refresh
        await loadData(true);
      } else {
        console.error('[Profile Upload] No URL in result:', result);
        alert('Failed to upload image');
      }
    } catch (err) {
      console.error('[Profile Upload] Error:', err);
      alert('Failed to upload image. Please try again.');
    } finally {
      uploadingPicture = false;
      // Reset input
      if (pictureInputEl) {
        pictureInputEl.value = '';
      }
    }
  }

  function triggerPictureUpload() {
    console.log('[Profile Upload] triggerPictureUpload called');
    console.log('[Profile Upload] userPublickey:', $userPublickey);
    console.log('[Profile Upload] hexpubkey:', hexpubkey);
    console.log('[Profile Upload] pictureInputEl:', pictureInputEl);

    if (!$userPublickey || hexpubkey !== $userPublickey) {
      console.log('[Profile Upload] Not own profile, skipping');
      return;
    }
    if (pictureInputEl) {
      console.log('[Profile Upload] Triggering file input click');
      pictureInputEl.click();
    } else {
      console.error('[Profile Upload] pictureInputEl is not available');
    }
  }

  $: profileTitleBase = profile
    ? profile.name || (user ? user.npub.slice(0, 10) + '...' : 'Unknown User')
    : 'Unknown User';

  // OG meta: prefer server-provided data (for crawlers), fall back to client data when loaded
  $: og_meta = {
    title: loaded ? `${profileTitleBase} - zap.cooking` : (data?.ogMeta?.title || 'User Profile - zap.cooking'),
    description: loaded
      ? (profile?.about ? profile.about.slice(0, 155) : "View this user's recipes on zap.cooking")
      : (data?.ogMeta?.description || "A user on zap.cooking - Food. Friends. Freedom."),
    image: loaded
      ? (profile?.picture || 'https://zap.cooking/social-share.png')
      : (data?.ogMeta?.image || 'https://zap.cooking/social-share.png')
  };

  // Setup IntersectionObserver for infinite scroll
  function setupObservers() {
    // Clean up existing observers
    if (recipeObserver) {
      recipeObserver.disconnect();
      recipeObserver = null;
    }
    if (postsObserver) {
      postsObserver.disconnect();
      postsObserver = null;
    }
    if (repliesObserver) {
      repliesObserver.disconnect();
      repliesObserver = null;
    }
    if (readsObserver) {
      readsObserver.disconnect();
      readsObserver = null;
    }

    // Observer for recipes tab
    if (recipeSentinel && activeTab === 'recipes') {
      recipeObserver = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            activeTab === 'recipes' &&
            hasMoreRecipes &&
            !loadingMoreRecipes
          ) {
            loadMoreRecipes();
          }
        },
        { rootMargin: '200px' }
      );
      recipeObserver.observe(recipeSentinel);
    }

    // Observer for posts tab
    if (postsSentinel && activeTab === 'posts') {
      postsObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && activeTab === 'posts' && foodstrFeedComponent) {
            // Trigger loadMore on FoodstrFeedOptimized component
            if (
              foodstrFeedComponent &&
              typeof (foodstrFeedComponent as any).loadMore === 'function'
            ) {
              (foodstrFeedComponent as any).loadMore();
            }
          }
        },
        { rootMargin: '200px' }
      );
      postsObserver.observe(postsSentinel);
    }

    // Observer for replies tab
    if (repliesSentinel && activeTab === 'replies') {
      repliesObserver = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            activeTab === 'replies' &&
            foodstrRepliesFeedComponent
          ) {
            if (
              foodstrRepliesFeedComponent &&
              typeof (foodstrRepliesFeedComponent as any).loadMore === 'function'
            ) {
              (foodstrRepliesFeedComponent as any).loadMore();
            }
          }
        },
        { rootMargin: '200px' }
      );
      repliesObserver.observe(repliesSentinel);
    }

    // Observer for reads tab
    if (readsSentinel && activeTab === 'reads') {
      readsObserver = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            activeTab === 'reads' &&
            hasMoreReads &&
            !loadingMoreReads
          ) {
            loadMoreReads();
          }
        },
        { rootMargin: '200px' }
      );
      readsObserver.observe(readsSentinel);
    }

    // Observer for media tab
    if (mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
    if (mediaSentinel && activeTab === 'media') {
      mediaObserver = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            activeTab === 'media' &&
            hasMoreMedia &&
            !loadingMoreMedia
          ) {
            loadMoreMedia();
          }
        },
        { rootMargin: '200px' }
      );
      mediaObserver.observe(mediaSentinel);
    }
  }

  // Reactive statement to setup observers when tab or sentinels change
  $: if (recipeSentinel || postsSentinel || repliesSentinel || readsSentinel || mediaSentinel) {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      setupObservers();
    }, 100);
  }

  onDestroy(() => {
    if (recipeObserver) {
      recipeObserver.disconnect();
      recipeObserver = null;
    }
    if (postsObserver) {
      postsObserver.disconnect();
      postsObserver = null;
    }
    if (repliesObserver) {
      repliesObserver.disconnect();
      repliesObserver = null;
    }
    if (readsObserver) {
      readsObserver.disconnect();
      readsObserver = null;
    }
    if (mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
  });
</script>

<svelte:head>
  <title>{og_meta.title}</title>
  <meta name="description" content={og_meta.description} />

  <meta property="og:url" content={`https://zap.cooking/user/${$page.params.slug}`} />
  <meta property="og:type" content="profile" />
  <meta property="og:title" content={og_meta.title} />
  <meta property="og:description" content={og_meta.description} />
  <meta property="og:image" content={String(og_meta.image)} />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content={`https://zap.cooking/user/${$page.params.slug}`} />
  <meta name="twitter:title" content={og_meta.title} />
  <meta name="twitter:description" content={og_meta.description} />
  <meta name="twitter:image" content={String(og_meta.image)} />
</svelte:head>

{#if user}
  <ZapModal bind:open={zapModal} event={user} />
{/if}

<!-- Profile Edit Modal -->
<ProfileEditModal
  bind:open={profileEditModal}
  {profile}
  onProfileUpdated={() => {
    // Refresh profile data and update avatar
    avatarRefreshKey++;
    loadData(true);
  }}
/>

<Modal cleanup={qrModalCleanup} open={qrModal}>
  <h1 slot="title">{profile && profile.name ? profile.name : '...'}'s Profile</h1>

  <div class="flex flex-col items-center gap-6">
    <!-- Profile Info -->
    <div class="w-full space-y-3 border-t pt-4">
      <!-- NIP-05 -->
      {#if profile?.nip05}
        <div class="flex items-center gap-2 text-sm">
          <SealCheckIcon size={18} weight="fill" class="text-purple-500 flex-shrink-0" />
          <span class="break-all" style="color: var(--color-text-primary)">{profile.nip05}</span>
        </div>
      {/if}

      <!-- Lightning Address -->
      {#if profile?.lud16 || profile?.lud06}
        <div class="flex items-center gap-2 text-sm">
          <LightningIcon size={18} weight="fill" class="text-yellow-500 flex-shrink-0" />
          <span class="break-all flex-1" style="color: var(--color-text-primary)"
            >{profile.lud16 || profile.lud06}</span
          >
          <button
            on:click={() => copyLightningAddress(profile?.lud16 || profile?.lud06 || '')}
            class="text-caption hover:text-primary transition-colors cursor-pointer flex-shrink-0"
            title="Copy lightning address"
          >
            {#if lightningCopied}
              <CheckIcon size={16} weight="bold" class="text-green-500" />
            {:else}
              <CopyIcon size={16} />
            {/if}
          </button>
        </div>
      {/if}

      <!-- Action buttons for other users -->
      {#if hexpubkey !== $userPublickey}
        <!-- Zap Button (hidden for muted users) -->
        {#if (profile?.lud16 || profile?.lud06) && hexpubkey && !$mutedPubkeys.has(hexpubkey)}
          <button
            class="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-lg font-medium text-base transition-colors bg-yellow-500 text-black hover:bg-yellow-400 disabled:opacity-50"
            disabled={isZapping}
            on:click={() => {
              qrModal = false;
              handleZapClick();
            }}
          >
            <LightningIcon size={22} weight="fill" />
            <span>{isZapping ? 'Zapping...' : 'Send Zap'}</span>
          </button>
        {/if}

        <!-- DM Button -->
        {#if $userPublickey && hexpubkey && !$mutedPubkeys.has(hexpubkey)}
          <a
            href="/messages?pubkey={hexpubkey}"
            class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors bg-input hover:bg-accent-gray"
            style="color: var(--color-text-primary)"
            on:click={() => (qrModal = false)}
          >
            <ChatCircleIcon size={18} weight="bold" />
            <span>Message</span>
          </a>
        {/if}

        <!-- Follow Button with mute indicator -->
        {#if $userPublickey}
          <button
            on:click={toggleFollow}
            disabled={followLoading}
            class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 {isFollowing
              ? 'bg-input hover:bg-accent-gray'
              : 'bg-orange-500 text-white hover:bg-orange-600'}"
            style={isFollowing ? 'color: var(--color-text-primary)' : ''}
          >
            {#if followLoading}
              <span class="animate-pulse">...</span>
            {:else if isFollowing}
              <CheckIcon size={18} weight="bold" />
              <span>Following</span>
            {:else}
              <UserPlusIcon size={18} weight="bold" />
              <span>Follow</span>
            {/if}
            {#if hexpubkey && $mutedPubkeys.has(hexpubkey)}
              <SpeakerSimpleSlashIcon size={18} weight="bold" class="opacity-70" />
            {/if}
          </button>
        {/if}
      {/if}

      <!-- Copy Npub Button -->
      <button
        on:click={copyNpub}
        class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-input hover:bg-accent-gray rounded-lg transition-colors text-sm font-medium"
        style="color: var(--color-text-primary)"
      >
        {#if npubCopied}
          <CheckIcon size={18} weight="bold" />
          <span>Copied!</span>
        {:else}
          <CopyIcon size={18} />
          <span>Copy npub</span>
        {/if}
      </button>

      <!-- Mute Button -->
      {#if hexpubkey !== $userPublickey && $userPublickey}
        <button
          on:click={toggleMute}
          disabled={muteLoading}
          class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 {isMuted
            ? 'bg-red-100 text-red-700 hover:bg-red-200'
            : 'bg-input hover:bg-accent-gray'}"
          style={!isMuted ? 'color: var(--color-text-primary)' : ''}
        >
          {#if muteLoading}
            <span class="animate-pulse">...</span>
          {:else if isMuted}
            <SpeakerSlashIcon size={18} weight="bold" />
            <span>Unmute User</span>
          {:else}
            <SpeakerSlashIcon size={18} />
            <span>Mute User</span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
</Modal>

<div class="max-w-4xl mx-auto w-full">
  <!-- Profile Banner -->
  <div class="relative -mx-4 sm:-mx-6 lg:-mx-8 mb-4">
    <div
      class="h-32 sm:h-40 overflow-hidden rounded-2xl"
      style="background: {profile?.banner
        ? 'transparent'
        : 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)'}"
    >
      {#if profile?.banner}
        <img src={profile.banner} alt="Profile banner" class="w-full h-full object-cover" />
      {/if}
    </div>

    <!-- Avatar overlapping banner -->
    <div class="absolute -bottom-10 left-4 sm:left-6 lg:left-8">
      <button
        class="hover:opacity-90 transition-opacity flex-shrink-0 rounded-full ring-4 ring-[var(--color-bg-primary)]"
        on:click={() => (qrModal = true)}
        title="View profile details"
      >
        {#key `${hexpubkey}-${avatarRefreshKey}`}
          <Avatar
            className="cursor-pointer"
            pubkey={hexpubkey || ''}
            size={80}
            src={$userPublickey === hexpubkey ? $userProfilePictureOverride : null}
          />
        {/key}
      </button>
    </div>
  </div>

  <!-- Profile Header -->
  <div class="flex items-start gap-5 pb-5 pt-8">
    <!-- Spacer for avatar (hidden on mobile where avatar overlaps banner) -->
    <div class="hidden sm:block w-20 flex-shrink-0"></div>

    <!-- Profile Info (right side) -->
    <div class="flex-1 min-w-0 flex flex-col gap-2">
      <!-- Name Row with Action Buttons on Right -->
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <button class="hover:opacity-80 transition-opacity" on:click={() => (qrModal = true)}>
            <h1 class="text-xl font-bold truncate flex items-center gap-1.5">
              <CustomName pubkey={hexpubkey || ''} />
              <MembershipBeltBadge pubkey={hexpubkey || ''} size={20} />
            </h1>
          </button>
          {#if user?.npub && hexpubkey === $userPublickey}
            <button
              on:click={copyNpub}
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer flex-shrink-0 bg-input hover:bg-accent-gray"
              style="color: var(--color-caption);"
              title="Click to copy npub"
            >
              <span class="font-mono">{user.npub.slice(0, 8)}...{user.npub.slice(-4)}</span>
              {#if npubCopied}
                <CheckIcon size={12} weight="bold" class="text-green-500" />
              {:else}
                <CopyIcon size={12} />
              {/if}
            </button>
          {/if}
        </div>

        <!-- Action Buttons (right-aligned) -->
        <div class="flex items-center gap-2 flex-shrink-0">
          {#if hexpubkey === $userPublickey}
            <button
              on:click={() => (profileEditModal = true)}
              class="h-9 w-9 p-2 rounded-full transition-colors bg-input hover:bg-accent-gray flex items-center justify-center"
              style="color: var(--color-text-primary)"
              aria-label="Edit profile"
            >
              <PencilSimpleIcon size={20} weight="bold" />
            </button>
          {:else}
            <!-- Zap button (hidden for muted users) -->
            {#if (profile?.lud16 || profile?.lud06) && hexpubkey && !$mutedPubkeys.has(hexpubkey)}
              <button
                class="h-9 w-9 p-2 bg-yellow-500 hover:bg-yellow-400 rounded-full transition-colors disabled:opacity-50 flex items-center justify-center"
                on:click={handleZapClick}
                disabled={isZapping}
                aria-label="Zap user"
              >
                <LightningIcon size={20} weight="fill" class="text-white" />
              </button>
            {/if}

            {#if $userPublickey}
              <!-- DM button -->
              <a
                href="/messages?pubkey={hexpubkey}"
                class="h-9 w-9 p-2 rounded-full transition-colors bg-input hover:bg-accent-gray flex items-center justify-center"
                style="color: var(--color-text-primary)"
                aria-label="Send message"
              >
                <ChatCircleIcon size={20} weight="bold" />
              </a>

              <button
                on:click={toggleFollow}
                disabled={followLoading}
                class="h-9 w-9 p-2 rounded-full transition-colors disabled:opacity-50 flex items-center justify-center {isFollowing
                  ? 'bg-input hover:bg-accent-gray'
                  : 'bg-orange-500 hover:bg-orange-600'}"
                style={isFollowing ? 'color: var(--color-text-primary)' : ''}
                aria-label={isFollowing ? 'Unfollow' : 'Follow'}
              >
                {#if followLoading}
                  <SpinnerIcon size={20} class="animate-spin" />
                {:else if isFollowing}
                  <CheckIcon size={20} weight="bold" />
                {:else}
                  <UserPlusIcon size={20} weight="bold" class="text-white" />
                {/if}
              </button>

              {#if hexpubkey && $mutedPubkeys.has(hexpubkey)}
                <div
                  class="h-9 w-9 p-2 rounded-full bg-input flex items-center justify-center"
                  style="color: var(--color-text-primary)"
                  title="User is muted"
                >
                  <SpeakerSimpleSlashIcon size={20} weight="bold" class="opacity-70" />
                </div>
              {/if}
            {/if}

            <button
              on:click={() => (qrModal = true)}
              class="h-9 w-9 p-2 rounded-full bg-input hover:bg-accent-gray transition-colors flex items-center justify-center"
              style="color: var(--color-text-primary)"
              aria-label="More options"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
                />
              </svg>
            </button>
          {/if}
        </div>
      </div>

      <!-- Bio -->
      {#if profile?.about}
        {@const bioText = profile.about.trim()}
        {@const needsTruncation = bioText.length > 200}

        <div class="max-w-2xl">
          <p
            class="text-sm text-caption leading-relaxed"
            class:line-clamp-2={!bioExpanded && needsTruncation}
          >
            <ParsedBio text={bioText} />
          </p>
          {#if needsTruncation}
            <button
              on:click={() => (bioExpanded = !bioExpanded)}
              class="text-xs text-orange-500 hover:text-orange-600 transition-colors mt-1"
            >
              {bioExpanded ? 'Show less' : 'Read more'}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Profile Stats -->
  {#if profileStats}
    <div class="flex items-center gap-5 pb-3">
      <button
        on:click={() => (activeTab = 'following')}
        class="flex items-center gap-1.5 text-sm transition-colors hover:opacity-70"
        style="color: var(--color-text-secondary)"
      >
        <span class="font-semibold" style="color: var(--color-text-primary)">{profileStats.follows_count.toLocaleString()}</span>
        <span>Following</span>
      </button>
      <div
        class="flex items-center gap-1.5 text-sm"
        style="color: var(--color-text-secondary)"
      >
        <span class="font-semibold" style="color: var(--color-text-primary)">{profileStats.followers_count.toLocaleString()}</span>
        <span>Followers</span>
      </div>
    </div>
  {/if}

  <!-- Tabs -->
  <div class="border-b mb-4 overflow-x-auto scrollbar-hide" style="border-color: var(--color-input-border)">
    <div class="flex gap-1 min-w-max">
      <button
        on:click={() => (activeTab = 'recipes')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'recipes'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Recipes
        {#if activeTab === 'recipes'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      <button
        on:click={() => (activeTab = 'posts')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'posts'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Posts
        {#if activeTab === 'posts'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      <button
        on:click={() => (activeTab = 'replies')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'replies'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Replies
        {#if activeTab === 'replies'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      <button
        on:click={() => (activeTab = 'media')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'media'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Media
        {#if activeTab === 'media'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      <button
        on:click={() => (activeTab = 'reads')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'reads'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Reads
        {#if activeTab === 'reads'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      <button
        on:click={() => (activeTab = 'following')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'following'
          ? 'var(--color-text-primary)'
          : 'var(--color-text-secondary)'}"
      >
        Following
        {#if activeTab === 'following'}
          <span
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
          ></span>
        {/if}
      </button>
      {#if $userPublickey && $userPublickey === hexpubkey}
        <button
          on:click={() => (activeTab = 'drafts')}
          class="px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-1"
          style="color: {activeTab === 'drafts'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          <FloppyDiskIcon size={16} />
          Drafts
          {#if activeTab === 'drafts'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <!-- Tab Content -->
  {#if activeTab === 'recipes'}
    {#if hexpubkey && $mutedPubkeys.has(hexpubkey)}
      <!-- Muted user message for recipes tab -->
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
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              ></path>
            </svg>
            <p class="text-lg font-medium">This user is muted</p>
            <p class="text-sm">You won't see recipes from this user.</p>
          </div>
          <button
            on:click={toggleMute}
            class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Unmute User
          </button>
        </div>
      </div>
    {:else}
      {#if hexpubkey && $userPublickey === hexpubkey}
        <!-- Own-profile-only "Share My Recipes" action. Mounts inline
             above the Feed so the entry point lives where users
             already think of "my recipes". The component owns its
             own loading + empty-state + modal — page stays slim. -->
        <div class="mb-3 flex">
          <ShareMyRecipesAction
            pubkey={hexpubkey}
            displayName={String(profile?.display_name ?? profile?.name ?? '')}
          />
        </div>
      {/if}
      <Feed {events} {loaded} isProfileView={true} isOwnProfile={$userPublickey === hexpubkey} />
      {#if hasMoreRecipes}
        <div bind:this={recipeSentinel} class="py-4 text-center">
          {#if loadingMoreRecipes}
            <div class="text-gray-500 text-sm">Loading more recipes...</div>
          {/if}
        </div>
      {/if}
    {/if}
  {:else if activeTab === 'posts'}
    <div class="max-w-2xl w-full">
      <FoodstrFeedOptimized
        bind:this={foodstrFeedComponent}
        authorPubkey={hexpubkey}
        authorScope="top-level"
      />
      <div bind:this={postsSentinel} class="py-4 text-center"></div>
    </div>
  {:else if activeTab === 'replies'}
    <div class="max-w-2xl w-full">
      <FoodstrFeedOptimized
        bind:this={foodstrRepliesFeedComponent}
        authorPubkey={hexpubkey}
        authorScope="replies"
      />
      <div bind:this={repliesSentinel} class="py-4 text-center"></div>
    </div>
  {:else if activeTab === 'media'}
    {#if !mediaLoaded}
      <!-- Skeleton grid -->
      <div class="media-grid">
        {#each Array(12) as _}
          <div class="media-tile-skeleton animate-pulse"></div>
        {/each}
      </div>
    {:else if mediaItems.length > 0}
      <div class="media-grid">
        {#each mediaItems as item}
          <a href={getMediaEventUrl(item.event)} class="media-tile">
            {#if item.type === 'video'}
              <video
                src={item.url}
                class="media-tile-img"
                on:error={handleMediaImgError}
                playsinline
                muted
                loop
              ></video>
              <div class="media-video-badge">
                <PlayIcon size={20} weight="fill" />
              </div>
            {:else}
              <img
                src={item.url}
                alt=""
                loading="lazy"
                class="media-tile-img"
                on:error={handleMediaImgError}
              />
            {/if}
          </a>
        {/each}
      </div>
      {#if hasMoreMedia}
        <div bind:this={mediaSentinel} class="py-4 text-center">
          {#if loadingMoreMedia}
            <div class="text-gray-500 text-sm">Loading more media...</div>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <div class="max-w-sm mx-auto space-y-4" style="color: var(--color-caption)">
          <ImageSquareIcon size={48} class="mx-auto opacity-50" />
          <p class="text-lg font-medium">No media yet</p>
          <p class="text-sm">This user hasn't posted any images or videos.</p>
        </div>
      </div>
    {/if}
  {:else if activeTab === 'reads'}
    {#if hexpubkey && $mutedPubkeys.has(hexpubkey)}
      <!-- Muted user message for reads tab -->
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
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              ></path>
            </svg>
            <p class="text-lg font-medium">This user is muted</p>
            <p class="text-sm">You won't see articles from this user.</p>
          </div>
          <button
            on:click={toggleMute}
            class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Unmute User
          </button>
        </div>
      </div>
    {:else if !readsLoaded}
      <!-- Loading skeleton for reads -->
      <div class="reads-feed-vertical">
        {#each Array(3) as _}
          <div
            class="article-card-skeleton rounded-lg overflow-hidden animate-pulse"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
          >
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
        {/each}
      </div>
    {:else if readsEvents.length > 0}
      {@const formattedArticles = formatReadsArticles(readsEvents)}
      <div class="reads-feed-vertical">
        <ArticleFeed articles={formattedArticles} />
      </div>
      {#if hasMoreReads}
        <div bind:this={readsSentinel} class="py-4 text-center">
          {#if loadingMoreReads}
            <div class="text-gray-500 text-sm">Loading more articles...</div>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <div class="max-w-sm mx-auto space-y-4" style="color: var(--color-caption)">
          <BookOpenIcon size={48} class="mx-auto opacity-50" />
          <p class="text-lg font-medium">No articles found</p>
          <p class="text-sm">This user hasn't published any longform articles yet.</p>
        </div>
      </div>
    {/if}
  {:else if activeTab === 'following'}
    {#if followingLoading && !followingLoaded}
      <!-- Loading skeleton -->
      <div class="flex flex-col gap-3">
        {#each Array(6) as _}
          <div class="flex items-center gap-3 p-3 rounded-xl animate-pulse" style="background: var(--color-bg-secondary)">
            <div class="w-10 h-10 rounded-full" style="background: var(--color-accent-gray, #e5e7eb)"></div>
            <div class="flex-1">
              <div class="h-4 w-32 rounded" style="background: var(--color-accent-gray, #e5e7eb)"></div>
              <div class="h-3 w-48 rounded mt-1.5" style="background: var(--color-accent-gray, #e5e7eb)"></div>
            </div>
          </div>
        {/each}
      </div>
    {:else if followingProfiles.length === 0}
      <div class="py-12 text-center">
        <UsersIcon size={48} class="mx-auto mb-4 opacity-30" />
        <p class="text-lg font-medium" style="color: var(--color-text-secondary)">Not following anyone yet</p>
      </div>
    {:else}
      <div class="flex flex-col gap-1">
        {#each followingProfiles as fp (fp.pubkey)}
          <a
            href="/user/{fp.npub}"
            class="flex items-center gap-3 p-3 rounded-xl transition-colors hover:opacity-80"
            style="background: var(--color-bg-secondary); border: 1px solid transparent;"
          >
            <Avatar pubkey={fp.pubkey} src={fp.picture || null} size={40} />
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate" style="color: var(--color-text-primary)">{fp.name}</div>
              {#if fp.nip05}
                <div class="text-xs truncate" style="color: var(--color-text-secondary)">{fp.nip05}</div>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {:else if activeTab === 'drafts'}
    {#if $userPublickey === hexpubkey}
      <ProfileDrafts />
    {:else}
      <Feed {events} {loaded} isProfileView={true} isOwnProfile={$userPublickey === hexpubkey} />
      {#if hasMoreRecipes}
        <div bind:this={recipeSentinel} class="py-4 text-center">
          {#if loadingMoreRecipes}
            <div class="text-gray-500 text-sm">Loading more recipes...</div>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<!-- Toast for npub copied -->
{#if npubToast}
  <div class="npub-toast" role="status" aria-live="polite">
    <CheckIcon size={16} weight="bold" class="text-green-500" />
    <span>npub copied</span>
  </div>
{/if}

<style>
  /* Ensure line-clamp works for bio text */
  :global(.line-clamp-2) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Vertical layout for reads feed on profile page */
  .reads-feed-vertical {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 100%;
  }

  .reads-feed-vertical :global(.article-feed-horizontal) {
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow-x: visible;
  }

  .reads-feed-vertical :global(.article-card-wrapper) {
    flex: none;
    width: 100%;
    max-width: 600px;
    height: auto;
  }

  .article-card-skeleton {
    width: 100%;
    max-width: 600px;
    height: 400px;
    display: flex;
    flex-direction: column;
  }

  /* Media grid */
  /* Mobile: tight square grid (Instagram-style) */
  .media-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
  }

  .media-tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--color-accent-gray, #f3f4f6);
    border-radius: 2px;
    display: block;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .media-tile:hover {
    opacity: 0.85;
  }

  .media-tile-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .media-video-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border-radius: 4px;
    padding: 2px 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .media-tile-skeleton {
    aspect-ratio: 1;
    background: var(--color-accent-gray, #e5e7eb);
    border-radius: 2px;
  }

  /* Desktop: thumbnail cards with rounded corners and spacing */
  @media (min-width: 768px) {
    .media-grid {
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    .media-tile {
      border-radius: 0.75rem;
      border: 1px solid var(--color-input-border, #e5e7eb);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }

    .media-tile:hover {
      opacity: 1;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .media-tile-img {
      border-radius: 0.75rem;
    }

    .media-tile-skeleton {
      border-radius: 0.75rem;
    }

    .media-video-badge {
      top: 8px;
      right: 8px;
      border-radius: 6px;
      padding: 3px 6px;
    }
  }

  /* Hide scrollbar on tab bar */
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }

  /* Toast notification */
  .npub-toast {
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-primary);
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 100;
    animation: toast-in 0.25s ease-out;
    pointer-events: none;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @media (min-width: 768px) {
    .npub-toast {
      bottom: 2rem;
    }
  }
</style>
