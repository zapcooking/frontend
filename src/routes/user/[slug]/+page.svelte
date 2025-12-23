<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
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
  import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHigh';
  import { requestProvider } from 'webln';
  import ProfileLists from '../../../components/ProfileLists.svelte';
  import Modal from '../../../components/Modal.svelte';
  import FoodstrFeedOptimized from '../../../components/FoodstrFeedOptimized.svelte';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';

  export const data: PageData = {} as PageData;

  let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let user: NDKUser | null = null;
  let profile: NDKUserProfile | null = null;
  let loaded = false;
  let zapModal = false;
  
  // Tab state: 'recipes' | 'posts' | 'lists'
  let activeTab: 'recipes' | 'posts' | 'lists' = 'recipes';
  
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
  let currentFollows: string[] = [];
  
  // Mute state
  let isMuted = false;
  let muteLoading = false;
  let mutedUsers: string[] = [];
  

  $: {
    if ($page.params.slug) {
      loadData();
    }
  }

  // Check follow status when user logs in or profile changes
  $: if ($userPublickey && hexpubkey) {
    checkFollowStatus();
    checkMuteStatus();
  }

  async function loadData() {
    try {
      events = [];
      profile = {};
      hexpubkey = undefined;
      loaded = false;
      activeTab = 'recipes';
      // Reset pagination state
      hasMoreRecipes = true;
      loadingMoreRecipes = false;
      oldestRecipeTime = null;
      // Reset bio expanded state
      bioExpanded = false;
      // Reset mute state
      isMuted = false;
      mutedUsers = [];
      console.log('loadData');
      
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
        const p = await u.fetchProfile();
        user = u;
        if (p) {
          profile = p;
        }

        // load recipes (initial load with smaller limit for pagination)
        let filter: NDKFilter = {
          authors: [hexpubkey],
          limit: 20,
          kinds: [30023],
          '#t': ['nostrcooking']
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
        // Extract followed pubkeys from 'p' tags
        currentFollows = contactList.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);
        
        isFollowing = currentFollows.includes(hexpubkey);
      } else {
        currentFollows = [];
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
      const newFollows = isFollowing
        ? currentFollows.filter(pk => pk !== hexpubkey)
        : [...currentFollows, hexpubkey];
      
      // Create new kind:3 contact list event
      const contactEvent = new NDKEvent($ndk);
      contactEvent.kind = 3;
      contactEvent.content = '';
      contactEvent.tags = newFollows.map(pk => ['p', pk]);
      
      await contactEvent.publish();
      
      // Update local state
      currentFollows = newFollows;
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
        mutedUsers = muteList.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);
        
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
        ? mutedUsers.filter(pk => pk !== hexpubkey)
        : [...mutedUsers, hexpubkey];
      
      // Create new kind:10000 mute list event
      const muteEvent = new NDKEvent($ndk);
      muteEvent.kind = 10000;
      muteEvent.content = '';
      muteEvent.tags = newMuted.map(pk => ['p', pk]);
      
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
        '#t': ['nostrcooking'],
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
              const existingIds = new Set(events.map(e => e.id));
              const uniqueNewRecipes = newRecipes.filter(r => !existingIds.has(r.id));
              
              // Add new recipes and sort by created_at
              events = [...events, ...uniqueNewRecipes].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              
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
              const existingIds = new Set(events.map(e => e.id));
              const uniqueNewRecipes = newRecipes.filter(r => !existingIds.has(r.id));
              
              // Add new recipes and sort by created_at
              events = [...events, ...uniqueNewRecipes].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              
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

  function qrModalCleanup() {
    qrModal = false;
    npubCopied = false;
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
          if (entries[0].isIntersecting && activeTab === 'recipes' && hasMoreRecipes && !loadingMoreRecipes) {
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
            if (foodstrFeedComponent && typeof (foodstrFeedComponent as any).loadMore === 'function') {
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

<Modal cleanup={qrModalCleanup} open={qrModal}>
  <h1 slot="title">{profile && profile.name ? profile.name : '...'}'s Profile</h1>

  <div class="flex flex-col items-center gap-6">
    <!-- Profile Info -->
    <div class="w-full space-y-3 border-t pt-4">
      <!-- NIP-05 -->
      {#if profile?.nip05}
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 font-medium">NIP-05:</span>
          <span class="text-gray-900">{profile.nip05}</span>
        </div>
      {/if}

      <!-- Lightning Address -->
      {#if profile?.lud16 || profile?.lud06}
        <div class="flex items-center gap-2 text-sm">
          <LightningIcon size={16} class="text-yellow-500" />
          <span class="text-gray-500 font-medium">Lightning:</span>
          <span class="text-gray-900 break-all">{profile.lud16 || profile.lud06}</span>
        </div>
      {/if}

      <!-- Copy Npub Button -->
      <button
        on:click={copyNpub}
        class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium"
      >
        {#if npubCopied}
          <CheckIcon size={18} weight="bold" />
          <span>Copied!</span>
        {:else}
          <CopyIcon size={18} />
          <span>Copy npub</span>
        {/if}
      </button>

      <!-- Zap Button -->
      {#if hexpubkey !== $userPublickey}
        <Button
          class="w-full flex items-center justify-center gap-2"
          on:click={() => {
            qrModal = false;
            zapModal = true;
          }}
        >
          <LightningIcon size={18} weight="fill" />
          <span>Send Zap</span>
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<div class="flex flex-col gap-6">
  <!-- Profile Header -->
  <div class="flex justify-between items-start gap-6">
    <div class="flex gap-4 flex-1">
      <button class="hover:opacity-80 transition-opacity flex-shrink-0" on:click={() => (qrModal = true)}>
      {#key hexpubkey}
      <CustomAvatar
          className="cursor-pointer hidden md:flex"
        pubkey={hexpubkey || ''}
        size={100}
      />
      {/key}
    </button>
      
      <div class="flex flex-col gap-2 flex-1 min-w-0">
        <!-- Name -->
        <button class="text-left hover:opacity-80 transition-opacity" on:click={() => (qrModal = true)}>
          <h1 class="text-2xl font-bold"><CustomName pubkey={hexpubkey || ''} /></h1>
        </button>
        
        <!-- Bio with dot separators and read more -->
        {#if profile?.about}
          {@const bioText = profile.about.trim()}
          {@const bioPhrases = bioText.split(/[.,;]\s*/).map(p => p.trim()).filter(p => p && p.length > 0)}
          {@const formattedBio = bioPhrases.length > 0 ? bioPhrases.join(' · ') : bioText}
          {@const needsTruncation = formattedBio.length > 150}
          
          <div class="flex flex-col gap-1">
            <p 
              class="text-xs text-gray-400 leading-relaxed transition-all md:line-clamp-none"
              class:line-clamp-2={!bioExpanded && needsTruncation}
            >
              {formattedBio}
            </p>
            {#if needsTruncation}
      <button
                on:click={() => (bioExpanded = !bioExpanded)}
                class="text-xs text-orange-500 hover:text-orange-600 self-start transition-colors mt-0.5 md:hidden"
      >
                {bioExpanded ? 'Show less' : 'Read more'}
      </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Action Buttons (top-right) -->
    <div class="flex gap-2 flex-shrink-0">
      {#if hexpubkey !== $userPublickey}
        <button
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          on:click={() => (zapModal = true)}
          aria-label="Zap user"
        >
          <LightningIcon size={24} weight="regular" />
        </button>
        
        <!-- Follow Button -->
        {#if $userPublickey}
          <button
            on:click={toggleFollow}
            disabled={followLoading}
            class="flex items-center gap-1.5 px-4 py-2 rounded-full font-medium text-sm transition-colors disabled:opacity-50 {isFollowing 
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
              : 'bg-orange-500 text-white hover:bg-orange-600'}"
          >
            {#if followLoading}
              <span class="animate-pulse">...</span>
            {:else if isFollowing}
              <CheckIcon size={16} weight="bold" />
              <span>Following</span>
            {:else}
              <UserPlusIcon size={18} weight="bold" />
              <span>Follow</span>
            {/if}
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <hr />

  <div class="flex flex-col gap-4">
    <!-- Tabs: Recipes | Posts | Lists | Mute -->
    <div class="flex gap-2 items-center">
      <button
        class="rounded-full px-4 py-2 font-semibold cursor-pointer transition-colors {activeTab === 'recipes'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-accent-gray opacity-70 hover:opacity-100'}"
        on:click={() => (activeTab = 'recipes')}
      >
        Recipes
      </button>
      <button
        class="rounded-full px-4 py-2 font-semibold cursor-pointer transition-colors {activeTab === 'posts'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-accent-gray opacity-70 hover:opacity-100'}"
        on:click={() => (activeTab = 'posts')}
      >
        Posts
      </button>
      <button
        class="rounded-full px-4 py-2 font-semibold cursor-pointer transition-colors {activeTab === 'lists'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-accent-gray opacity-70 hover:opacity-100'}"
        on:click={() => (activeTab = 'lists')}
      >
        Lists
      </button>
      
      <!-- Spacer to push mute button to the right -->
      <div class="flex-1"></div>
      
      <!-- Mute Button (only for logged-in users viewing other profiles) -->
      {#if $userPublickey && hexpubkey && hexpubkey !== $userPublickey}
        <button
          on:click={toggleMute}
          disabled={muteLoading}
          class="flex items-center gap-1.5 px-3 py-2 rounded-full font-medium text-sm transition-colors disabled:opacity-50 {isMuted 
            ? 'bg-red-100 text-red-700 hover:bg-red-200' 
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
          aria-label={isMuted ? 'Unmute user' : 'Mute user'}
          title={isMuted ? 'Unmute user' : 'Mute user'}
        >
          {#if muteLoading}
            <span class="animate-pulse">...</span>
          {:else if isMuted}
            <SpeakerSlashIcon size={16} weight="bold" />
            <span class="hidden sm:inline">Unmute</span>
          {:else}
            <SpeakerHighIcon size={16} weight="bold" />
            <span class="hidden sm:inline">Mute</span>
          {/if}
        </button>
      {/if}
    </div>

    <!-- Tab Content -->
    {#if activeTab === 'recipes'}
        <Feed {events} {loaded} />
      <!-- Infinite scroll sentinel for recipes -->
      {#if hasMoreRecipes}
        <div bind:this={recipeSentinel} class="py-4 text-center">
          {#if loadingMoreRecipes}
            <div class="text-gray-500 text-sm">Loading more recipes...</div>
          {/if}
        </div>
      {/if}
    {:else if activeTab === 'posts'}
      <div class="max-w-2xl">
        <FoodstrFeedOptimized 
          bind:this={foodstrFeedComponent}
          authorPubkey={hexpubkey} 
          hideAvatar={true} 
          hideAuthorName={true} 
        />
        <!-- Infinite scroll sentinel for posts -->
        <div bind:this={postsSentinel} class="py-4 text-center">
          <!-- FoodstrFeedOptimized handles its own loading state -->
        </div>
      </div>
    {:else}
      <ProfileLists {hexpubkey} />
    {/if}
  </div>
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
