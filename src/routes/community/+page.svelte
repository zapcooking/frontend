<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  // Tab state - use local state for immediate reactivity
  type FilterMode = 'global' | 'following' | 'replies';
  
  // Local state for immediate UI updates
  let activeTab: FilterMode = 'global';
  
  // Initialize from URL on mount
  onMount(() => {
    const tab = $page.url.searchParams.get('tab');
    if (tab === 'following' || tab === 'replies' || tab === 'global') {
      activeTab = tab;
    }
  });
  
  // Key to force component recreation
  let feedKey = 0;
  
  function setTab(tab: FilterMode) {
    if (tab === activeTab) return;
    
    activeTab = tab;
    feedKey++;
    
    // Update URL for bookmarking/sharing
    const url = new URL($page.url);
    url.searchParams.set('tab', tab);
    goto(url.pathname + url.search, { noScroll: true, replaceState: true });
  }

  let isComposerOpen = false;
  let content = '';
  let posting = false;
  let success = false;
  let error = '';
  let textareaEl: HTMLTextAreaElement;

  function openComposer() {
    isComposerOpen = true;
    setTimeout(() => {
      textareaEl?.focus();
    }, 50);
  }

  function closeComposer() {
    if (!posting) {
      isComposerOpen = false;
      content = '';
      error = '';
    }
  }

  async function postToFeed() {
    if (!content.trim()) {
      error = 'Please enter some content';
      return;
    }

    if (!$userPublickey) {
      error = 'Please sign in to post';
      return;
    }

    posting = true;
    error = '';

    try {
      const event = new NDKEvent($ndk);
      event.kind = 1;
      event.content = content.trim();
      event.tags = [['t', 'zapcooking']];

      const publishedEvent = await event.publish();
      
      if (publishedEvent) {
        success = true;
        content = '';
        
        setTimeout(() => {
          isComposerOpen = false;
          success = false;
        }, 2500);
      } else {
        error = 'Failed to publish';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = 'Failed to post. Please try again.';
    } finally {
      posting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      postToFeed();
    }
    if (event.key === 'Escape') {
      closeComposer();
    }
  }
</script>

<svelte:head>
  <title>Community - zap.cooking</title>
  <meta name="description" content="Community - Share and discover delicious food content from the Nostr network" />
</svelte:head>

<div class="container mx-auto px-4 max-w-2xl">
  <!-- Orientation text for signed-out users -->
  {#if $userPublickey === ''}
    <div class="mb-4 pt-1">
      <p class="text-sm text-gray-400">A place to share food with friends.</p>
      <p class="text-xs text-gray-300 mt-0.5">People share meals, recipes, and food ideas here. <a href="/login" class="text-gray-400 hover:text-gray-500 underline">Sign in</a> to share your own and follow cooks you like.</p>
    </div>
  {/if}

  <!-- Inline Post Composer for logged-in users -->
  {#if $userPublickey !== ''}
    <div class="mb-4 bg-white border border-gray-200 rounded-xl overflow-hidden transition-all">
      {#if !isComposerOpen}
        <!-- Collapsed state -->
        <button
          class="w-full p-3 hover:bg-gray-50 transition-colors cursor-pointer text-left"
          on:click={openComposer}
        >
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center">
              <PencilSimpleIcon size={18} class="text-gray-400" />
            </div>
            <span class="text-gray-400 text-sm">Share what you're eating, cooking, or loving</span>
          </div>
        </button>
      {:else}
        <!-- Expanded composer -->
        <div class="p-3">
          <div class="flex gap-3">
            <CustomAvatar pubkey={$userPublickey} size={36} />
            <div class="flex-1">
              <textarea
                bind:this={textareaEl}
                bind:value={content}
                placeholder="What are you eating, cooking, or loving?"
                class="w-full min-h-[80px] p-2 text-sm border-0 focus:outline-none focus:ring-0 resize-none bg-transparent"
                disabled={posting}
                on:keydown={handleKeydown}
              ></textarea>
              
              {#if error}
                <p class="text-red-500 text-xs mb-2">{error}</p>
              {/if}
              
              {#if success}
                <p class="text-green-600 text-xs mb-2">Posted!</p>
              {/if}
              
              <div class="flex items-center justify-between pt-2 border-t border-gray-100">
                <span class="text-xs text-gray-300">#zapcooking</span>
                
                <div class="flex items-center gap-2">
                  <button
                    on:click={closeComposer}
                    class="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    disabled={posting}
                  >
                    Cancel
                  </button>
                  <button
                    on:click={postToFeed}
                    disabled={posting || !content.trim()}
                    class="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {posting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Filter Tabs -->
  <div class="mb-4 border-b border-gray-200">
    <div class="flex gap-1">
      <button
        on:click={() => setTab('global')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        class:text-gray-900={activeTab === 'global'}
        class:text-gray-500={activeTab !== 'global'}
        class:hover:text-gray-900={activeTab !== 'global'}
      >
        Global
        {#if activeTab === 'global'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
      
      <button
        on:click={() => setTab('following')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        class:text-gray-900={activeTab === 'following'}
        class:text-gray-500={activeTab !== 'following'}
        class:hover:text-gray-900={activeTab !== 'following'}
        disabled={!$userPublickey}
        class:opacity-50={!$userPublickey}
        class:cursor-not-allowed={!$userPublickey}
        class:cursor-pointer={$userPublickey}
      >
        Following
        {#if activeTab === 'following'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
      
      <button
        on:click={() => setTab('replies')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        class:text-gray-900={activeTab === 'replies'}
        class:text-gray-500={activeTab !== 'replies'}
        class:hover:text-gray-900={activeTab !== 'replies'}
      >
        Notes & Replies
        {#if activeTab === 'replies'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Show login prompt for Following/Replies tabs if not logged in -->
  {#if (activeTab === 'following' || activeTab === 'replies') && !$userPublickey}
    <div class="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p class="text-sm text-amber-800">
        <a href="/login" class="font-medium underline hover:text-amber-900">Log in</a> to see {activeTab === 'following' ? 'posts from people you follow' : 'replies from people you follow'}.
      </p>
    </div>
  {/if}
  
  {#key feedKey}
    <FoodstrFeedOptimized filterMode={activeTab} />
  {/key}
</div>
