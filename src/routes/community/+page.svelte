<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

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
  
  <FoodstrFeedOptimized />
</div>
