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
  import CustomAvatar from '../../../components/CustomAvatar.svelte';
  import CustomName from '../../../components/CustomName.svelte';
  import Button from '../../../components/Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import SpeakerSlashIcon from 'phosphor-svelte/lib/SpeakerSlash';
  import SpeakerSimpleSlashIcon from 'phosphor-svelte/lib/SpeakerSimpleSlash';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { requestProvider } from 'webln';
  import { canOneTapZap, sendOneTapZap } from '$lib/oneTapZap';
  import ProfileEditModal from '../../../components/ProfileEditModal.svelte';
  import ParsedBio from '../../../components/ParsedBio.svelte';
  import ProfileDrafts from '../../../components/ProfileDrafts.svelte';
  import Modal from '../../../components/Modal.svelte';
  import FoodstrFeedOptimized from '../../../components/FoodstrFeedOptimized.svelte';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';
  import { Fetch } from 'hurdak';
  import { profileCacheManager } from '$lib/profileCache';
  import { RECIPE_TAGS } from '$lib/consts';

  export const data: PageData = {} as PageData;

  let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let user: NDKUser | null = null;
  let profile: NDKUserProfile | null = null;
  let loaded = false;
  let zapModal = false;
  let isZapping = false;

  // Tab state: 'recipes' | 'posts' | 'drafts'
  // Default to 'posts' tab for a more social-first experience
  let activeTab: 'recipes' | 'posts' | 'drafts' = 'posts';

  // Infinite scroll state for recipes
  let hasMoreRecipes = true;
  let loadingMoreRecipes = false;
  let oldestRecipeTime: number | null = null;
  let recipeSentinel: HTMLElement;
  let postsSentinel: HTMLElement;
  let foodstrFeedComponent: FoodstrFeedOptimized;
  let recipeObserver: IntersectionObserver | null = null;
  let postsObserver: IntersectionObserver | null = null;

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
  let pictureInputEl: HTMLInputElement;
  let avatarRefreshKey = 0; // Used to force CustomAvatar to remount after picture change

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
    const allowedTabs = new Set(['recipes', 'posts', 'drafts']);

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
      // Reset bio expanded state
      bioExpanded = false;
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

  let qrModal = false;
  let npubCopied = false;
  let lightningCopied = false;

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
      setTimeout(() => {
        npubCopied = false;
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

        // Force CustomAvatar to remount with fresh data
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

  $: og_meta = {
    title: `${profileTitleBase} - zap.cooking`,
    description: "View this user's recipes on zap.cooking",
    image: profile ? profile.picture : 'https://zap.cooking/social-share.png'
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
  }

  // Reactive statement to setup observers when tab or sentinels change
  $: if (recipeSentinel || postsSentinel) {
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
  });
</script>

<svelte:head>
  <title>{og_meta.title}</title>

  {#if loaded}
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
  {/if}
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
            on:click={() => copyLightningAddress(profile.lud16 || profile.lud06)}
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

<div class="max-w-4xl mx-auto overflow-x-hidden w-full">
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
          <CustomAvatar
            className="cursor-pointer"
            pubkey={hexpubkey || ''}
            size={80}
            imageUrl={$userPublickey === hexpubkey ? $userProfilePictureOverride : null}
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
        <button class="hover:opacity-80 transition-opacity" on:click={() => (qrModal = true)}>
          <h1 class="text-xl font-bold truncate"><CustomName pubkey={hexpubkey || ''} /></h1>
        </button>

        <!-- Action Buttons (right-aligned) -->
        <div class="flex items-center gap-2 flex-shrink-0">
          {#if hexpubkey === $userPublickey}
            <button
              on:click={() => (profileEditModal = true)}
              class="p-2 rounded-full transition-colors bg-input hover:bg-accent-gray"
              style="color: var(--color-text-primary)"
              aria-label="Edit profile"
            >
              <PencilSimpleIcon size={20} weight="bold" />
            </button>
          {:else}
            <!-- Zap button (hidden for muted users) -->
            {#if (profile?.lud16 || profile?.lud06) && hexpubkey && !$mutedPubkeys.has(hexpubkey)}
              <button
                class="p-2 bg-yellow-500 hover:bg-yellow-400 rounded-full transition-colors disabled:opacity-50"
                on:click={handleZapClick}
                disabled={isZapping}
                aria-label="Zap user"
              >
                <LightningIcon size={20} weight="fill" class="text-white" />
              </button>
            {/if}

            {#if $userPublickey}
              <button
                on:click={toggleFollow}
                disabled={followLoading}
                class="p-2 rounded-full transition-colors disabled:opacity-50 {isFollowing
                  ? 'bg-input hover:bg-accent-gray'
                  : 'bg-orange-500 hover:bg-orange-600'}"
                style={isFollowing ? 'color: var(--color-text-primary)' : ''}
                aria-label={isFollowing ? 'Unfollow' : 'Follow'}
              >
                {#if followLoading}
                  <span class="animate-pulse text-sm">...</span>
                {:else if isFollowing}
                  <CheckIcon size={20} weight="bold" />
                {:else}
                  <UserPlusIcon size={20} weight="bold" class="text-white" />
                {/if}
              </button>

              {#if hexpubkey && $mutedPubkeys.has(hexpubkey)}
                <div
                  class="p-2 rounded-full bg-input"
                  style="color: var(--color-text-primary)"
                  title="User is muted"
                >
                  <SpeakerSimpleSlashIcon size={20} weight="bold" class="opacity-70" />
                </div>
              {/if}
            {/if}

            <button
              on:click={() => (qrModal = true)}
              class="p-2 rounded-full bg-input hover:bg-accent-gray transition-colors"
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

  <!-- Tabs -->
  <div class="border-b mb-4" style="border-color: var(--color-input-border)">
    <div class="flex gap-1">
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
    <div class="max-w-2xl w-full overflow-x-hidden">
      <FoodstrFeedOptimized bind:this={foodstrFeedComponent} authorPubkey={hexpubkey} />
      <div bind:this={postsSentinel} class="py-4 text-center"></div>
    </div>
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

<style>
  /* Ensure line-clamp works for bio text */
  :global(.line-clamp-2) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
