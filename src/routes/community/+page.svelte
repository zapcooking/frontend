<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import ProfileLink from '../../components/ProfileLink.svelte';
  import { nip19 } from 'nostr-tools';
  import NoteContent from '../../components/NoteContent.svelte';
  import { page } from '$app/stores';
  import { addClientTagToEvent } from '$lib/nip89';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { Fetch } from 'hurdak';
  import type { PageData } from './$types';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';

  export const data: PageData = {} as PageData;

  // Tab state - use local state for immediate reactivity
  type FilterMode = 'global' | 'following' | 'replies';
  
  // Local state for immediate UI updates
  let activeTab: FilterMode = 'following';
  
  // Tab initialization is now in the onMount with quote listener
  
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
  let uploadedImages: string[] = [];
  let uploadingImage = false;
  let imageInputEl: HTMLInputElement;
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;

  // Listen for quote-note events from NoteRepost component
  function handleQuoteNote(e: CustomEvent) {
    quotedNote = e.detail;
    openComposer();
  }

  onMount(() => {
    const tab = $page.url.searchParams.get('tab');
    if (tab === 'following' || tab === 'replies' || tab === 'global') {
      activeTab = tab;
    }
    
    window.addEventListener('quote-note', handleQuoteNote as EventListener);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('quote-note', handleQuoteNote as EventListener);
    }
  });

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
      uploadedImages = [];
      quotedNote = null;
    }
  }

  async function uploadToNostrBuild(body: FormData) {
    const url = 'https://nostr.build/api/v2/upload/files';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();
    
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    return Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });
  }

  async function handleImageUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;
    
    uploadingImage = true;
    error = '';
    
    try {
      const file = target.files[0];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        error = 'Please upload an image file';
        uploadingImage = false;
        return;
      }
      
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        error = 'Image must be less than 10MB';
        uploadingImage = false;
        return;
      }
      
      const body = new FormData();
      body.append('file[]', file);
      
      const result = await uploadToNostrBuild(body);
      
      if (result && result.data && result.data[0]?.url) {
        uploadedImages = [...uploadedImages, result.data[0].url];
      } else {
        error = 'Failed to upload image';
      }
    } catch (err) {
      console.error('Error uploading image:', err);
      error = 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
      // Reset input so same file can be selected again
      if (imageInputEl) {
        imageInputEl.value = '';
      }
    }
  }

  function removeImage(index: number) {
    uploadedImages = uploadedImages.filter((_, i) => i !== index);
  }

  async function postToFeed() {
    if (!content.trim() && !quotedNote && uploadedImages.length === 0) {
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
      // Ensure NIP-46 signer is ready if using remote signer
      const { getAuthManager } = await import('$lib/authManager');
      const authManager = getAuthManager();
      if (authManager) {
        await authManager.ensureNip46SignerReady();
      }

      const event = new NDKEvent($ndk);
      event.kind = 1;
      
      // Build content with text and image URLs
      let postContent = content.trim();
      if (uploadedImages.length > 0) {
        // Add image URLs to content (one per line for better display)
        const imageUrls = uploadedImages.join('\n');
        postContent = postContent ? `${postContent}\n\n${imageUrls}` : imageUrls;
      }
      
      // Add quoted note reference if quoting
      if (quotedNote) {
        postContent = postContent ? `${postContent}\n\nnostr:${quotedNote.nevent}` : `nostr:${quotedNote.nevent}`;
      }
      
      event.content = postContent;
      event.tags = [['t', 'zapcooking']];
      
      // Add quote tags if quoting
      if (quotedNote) {
        event.tags.push(['q', quotedNote.event.id]);
        event.tags.push(['p', quotedNote.event.pubkey]);
      }
      
      // Add NIP-89 client tag
      addClientTagToEvent(event);

      // Publish with timeout
      const publishPromise = event.publish();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Publishing timeout - signer may not be responding')), 30000);
      });
      
      const publishedEvent = await Promise.race([publishPromise, timeoutPromise]);
      
      if (publishedEvent) {
        success = true;
        content = '';
        uploadedImages = [];
        quotedNote = null;
        
        setTimeout(() => {
          isComposerOpen = false;
          success = false;
        }, 2500);
      } else {
        error = 'Failed to publish';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = err instanceof Error ? err.message : 'Failed to post. Please try again.';
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
      <p class="text-sm text-caption">A place to share food with friends.</p>
      <p class="text-xs text-caption mt-0.5">People share meals, recipes, and food ideas here. <a href="/login" class="text-caption hover:opacity-80 underline">Sign in</a> to share your own and follow cooks you like.</p>
    </div>
  {/if}

  <!-- Inline Post Composer for logged-in users -->
  {#if $userPublickey !== ''}
    <div class="mb-4 bg-input rounded-xl overflow-hidden transition-all" style="border: 1px solid var(--color-input-border)">
      {#if !isComposerOpen}
        <!-- Collapsed state -->
        <button
          class="w-full p-3 hover:bg-accent-gray transition-colors cursor-pointer text-left"
          on:click={openComposer}
        >
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-accent-gray rounded-full flex items-center justify-center">
              <PencilSimpleIcon size={18} class="text-caption" />
            </div>
            <span class="text-caption text-sm">Share what you're eating, cooking, or loving</span>
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
                style="color: var(--color-text-primary)"
                disabled={posting}
                on:keydown={handleKeydown}
              ></textarea>
              
              {#if error}
                <p class="text-red-500 text-xs mb-2">{error}</p>
              {/if}
              
              {#if success}
                <p class="text-green-600 text-xs mb-2">Posted!</p>
              {/if}
              
              <!-- Quoted note preview -->
              {#if quotedNote}
                <div class="mb-3 rounded-xl overflow-hidden bg-input" style="border: 1px solid var(--color-input-border)">
                  <!-- Header with remove button -->
                  <div class="flex items-center justify-between px-3 py-2 bg-accent-gray" style="border-bottom: 1px solid var(--color-input-border)">
                    <span class="text-xs font-medium text-caption">Quoting post</span>
                    <button
                      type="button"
                      on:click={() => quotedNote = null}
                      class="text-caption hover:opacity-80 p-1 hover:bg-input rounded transition-colors"
                      aria-label="Remove quote"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  <!-- Quoted note content -->
                  <div class="p-3">
                    <!-- Author info -->
                    <div class="flex items-center gap-2 mb-2">
                      <CustomAvatar pubkey={quotedNote.event.pubkey} size={24} />
                      <ProfileLink nostrString={'nostr:' + nip19.npubEncode(quotedNote.event.pubkey)} />
                    </div>
                    
                    <!-- Note content with proper rendering -->
                    <div class="text-sm max-h-32 overflow-hidden" style="color: var(--color-text-primary)">
                      <NoteContent content={quotedNote.event.content || ''} />
                    </div>
                  </div>
                </div>
              {/if}
              
              <!-- Image previews -->
              {#if uploadedImages.length > 0}
                <div class="mb-2 flex flex-wrap gap-2">
                  {#each uploadedImages as imageUrl, index}
                    <div class="relative group">
                      <img
                        src={imageUrl}
                        alt="Upload preview"
                        class="w-20 h-20 object-cover rounded-lg"
                        style="border: 1px solid var(--color-input-border)"
                      />
                      <button
                        type="button"
                        on:click={() => removeImage(index)}
                        class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all opacity-90 hover:opacity-100"
                        disabled={posting}
                        aria-label="Remove image"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
              
              <div class="flex items-center justify-between pt-2 border-t" style="border-color: var(--color-input-border)">
                <div class="flex items-center gap-3">
                  <!-- Image upload button -->
                  <label
                    class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                    class:opacity-50={posting || uploadingImage}
                    class:cursor-not-allowed={posting || uploadingImage}
                    aria-disabled={posting || uploadingImage}
                  >
                    <ImageIcon size={18} class="text-caption" />
                    <input
                      bind:this={imageInputEl}
                      type="file"
                      accept="image/*"
                      class="sr-only"
                      on:change={handleImageUpload}
                      disabled={posting || uploadingImage}
                    />
                  </label>
                  
                  {#if uploadingImage}
                    <span class="text-xs text-caption">Uploading...</span>
                  {/if}
                </div>

                <div class="flex items-center gap-2">
                  <button
                    on:click={closeComposer}
                    class="px-3 py-1.5 text-xs text-caption hover:opacity-80 transition-colors"
                    disabled={posting}
                  >
                    Cancel
                  </button>
                  <button
                    on:click={postToFeed}
                    disabled={posting || uploadingImage || (!content.trim() && uploadedImages.length === 0 && !quotedNote)}
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
  <div class="mb-4 border-b" style="border-color: var(--color-input-border)">
    <div class="flex gap-1">
      <button
        on:click={() => setTab('global')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'global' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Global Food
        {#if activeTab === 'global'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>

      <button
        on:click={() => setTab('following')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'following' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
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
        style="color: {activeTab === 'replies' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
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
    <div class="mb-4 p-4 bg-accent-gray rounded-lg" style="border: 1px solid var(--color-input-border)">
      <p class="text-sm" style="color: var(--color-text-primary)">
        <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see {activeTab === 'following' ? 'posts from people you follow' : 'replies from people you follow'}.
      </p>
    </div>
  {/if}
  
  {#key feedKey}
    <FoodstrFeedOptimized filterMode={activeTab} />
  {/key}
</div>
