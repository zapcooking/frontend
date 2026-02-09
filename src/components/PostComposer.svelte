<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, normalizeRelayUrl } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import CustomAvatar from './CustomAvatar.svelte';
  import ProfileLink from './ProfileLink.svelte';
  import { nip19 } from 'nostr-tools';
  import NoteContent from './NoteContent.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';
  import { clearQuotedNote } from '$lib/postComposerStore';
  import { publishQueue, publishQueueState } from '$lib/publishQueue';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';

  // Clear stuck posts from the publish queue
  async function clearPendingQueue() {
    try {
      await publishQueue.clearQueue();
      console.log('[PostComposer] Cleared publish queue');
    } catch (err) {
      console.error('[PostComposer] Failed to clear queue:', err);
    }
  }

  type FilterMode = 'global' | 'following' | 'replies' | 'members' | 'garden';
  type RelaySelection = 'all' | 'garden' | 'pantry' | 'garden-pantry';

  export let activeTab: FilterMode = 'global';
  export let variant: 'inline' | 'modal' = 'inline';
  export let selectedRelay: RelaySelection | undefined = undefined;
  export let initialQuotedNote: { nevent: string; event: NDKEventType } | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  let isComposerOpen = variant === 'modal';
  let content = '';
  let posting = false;
  let success = false;
  let successQueued = false; // True when post was queued for retry
  let error = '';
  let composerEl: HTMLDivElement;
  let lastRenderedContent = '';
  let uploadedImages: string[] = [];
  let uploadedVideos: string[] = [];
  let uploadingImage = false;
  let uploadingVideo = false;
  let imageInputEl: HTMLInputElement;
  let videoInputEl: HTMLInputElement;
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;

  // Mention autocomplete (shared controller)
  let mentionState: MentionState = {
    mentionQuery: '',
    showMentionSuggestions: false,
    mentionSuggestions: [],
    selectedMentionIndex: 0,
    mentionSearching: false
  };

  const mentionCtrl = new MentionComposerController(
    (state) => {
      mentionState = state;
    },
    (text) => {
      content = text;
      lastRenderedContent = text;
    }
  );

  $: mentionCtrl.setComposerEl(composerEl);

  $: if (composerEl && content !== lastRenderedContent) {
    mentionCtrl.syncContent(content);
    lastRenderedContent = content;
  }

  $: if (variant === 'modal') {
    isComposerOpen = true;
  }

  function focusComposer() {
    setTimeout(() => {
      if (composerEl) {
        mentionCtrl.syncContent(content);
        composerEl.focus();
      }
    }, 50);
  }

  // Listen for quote-note events from NoteRepost component
  function handleQuoteNote(e: CustomEvent) {
    quotedNote = e.detail;
    if (variant === 'inline') {
      openComposer();
    }
  }

  onMount(() => {
    if (variant === 'inline') {
      window.addEventListener('quote-note', handleQuoteNote as EventListener);
    }

    // Preload mention profiles in background
    if ($userPublickey) {
      mentionCtrl.preloadFollowList();
    }

    if (variant === 'modal') {
      // Set initial quoted note if provided (from store via PostModal)
      if (initialQuotedNote) {
        quotedNote = initialQuotedNote;
      }
      focusComposer();
    }
  });

  onDestroy(() => {
    if (variant === 'inline') {
      window.removeEventListener('quote-note', handleQuoteNote as EventListener);
    }
    mentionCtrl.destroy();
  });

  function openComposer() {
    isComposerOpen = true;
    focusComposer();
  }

  function resetComposerState() {
    content = '';
    lastRenderedContent = '';
    error = '';
    successQueued = false;
    mentionCtrl.resetMentionState();
    uploadedImages = [];
    uploadedVideos = [];
    quotedNote = null;
    if (composerEl) {
      composerEl.innerHTML = '';
    }
  }

  function closeComposer() {
    if (posting) return;

    resetComposerState();

    if (variant === 'modal') {
      // Clear the quoted note store when closing modal
      clearQuotedNote();
      dispatch('close');
      return;
    }

    isComposerOpen = false;
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

    try {
      const response = await fetch(url, {
        body,
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
        }
      });

      // Check if response is ok
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(
          errorData.message || errorData.error || `Upload failed with status ${response.status}`
        );
      }

      const result = await response.json();
      return result;
    } catch (err: any) {
      console.error('Upload error:', err);
      error = err?.message || 'Upload failed. Please try again.';
      throw err;
    }
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingImage = true;
    error = '';

    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) {
          error = 'Image must be less than 5MB';
          continue;
        }

        const body = new FormData();
        body.append('file[]', file);

        const result = await uploadToNostrBuild(body);

        if (result && result.data && result.data[0]?.url) {
          uploadedImages = [...uploadedImages, result.data[0].url];
        } else {
          const errorMsg = result?.message || result?.error || 'Unknown error';
          console.error('Upload failed - response:', result);
          error = `Failed to upload image${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : ''}`;
        }
      }
    } catch (err: any) {
      console.error('Error uploading image:', err);
      const errorMsg =
        err?.message || err?.response?.message || err?.response?.error || 'Unknown error';
      error = `Failed to upload image${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : '. Please try again.'}`;
    } finally {
      uploadingImage = false;
      if (imageInputEl) {
        imageInputEl.value = '';
      }
    }
  }

  async function handleVideoUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingVideo = true;
    error = '';

    try {
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          error = 'Video must be less than 50MB';
          continue;
        }

        // Validate video duration
        let videoDuration = 0;
        try {
          const video = document.createElement('video');
          video.preload = 'metadata';

          await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => {
              videoDuration = video.duration;
              resolve();
            };
            video.onerror = () => reject(new Error('Failed to load video metadata'));
            video.src = URL.createObjectURL(file);
          });

          if (videoDuration > 0 && videoDuration > 60) {
            error = 'Video must be less than 60 seconds';
            continue;
          }
        } catch (metaError) {
          console.warn('Could not read video metadata:', metaError);
        }

        console.log(
          `Uploading video: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type}, duration: ${videoDuration > 0 ? videoDuration.toFixed(1) + 's' : 'unknown'}`
        );

        const body = new FormData();
        body.append('file[]', file);

        const result = await uploadToNostrBuild(body);

        if (result && result.data && result.data[0]?.url) {
          uploadedVideos = [...uploadedVideos, result.data[0].url];
        } else {
          const errorMsg = result?.message || result?.error || 'Unknown error';
          console.error('Upload failed - response:', result);
          error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : ''}`;
        }
      }
    } catch (err: any) {
      console.error('Error uploading video:', err);
      const errorMsg =
        err?.message || err?.response?.message || err?.response?.error || 'Unknown error';
      error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : '. Please try again.'}`;
    } finally {
      uploadingVideo = false;
      if (videoInputEl) {
        videoInputEl.value = '';
      }
    }
  }

  function removeImage(index: number) {
    uploadedImages = uploadedImages.filter((_, i) => i !== index);
  }

  function removeVideo(index: number) {
    uploadedVideos = uploadedVideos.filter((_, i) => i !== index);
  }

  async function postToFeed() {
    console.log('[PostComposer] postToFeed called');
    console.log('[PostComposer] content:', content);
    console.log('[PostComposer] quotedNote:', quotedNote);
    console.log('[PostComposer] uploadedImages:', uploadedImages);
    console.log('[PostComposer] uploadedVideos:', uploadedVideos);

    if (
      !content.trim() &&
      !quotedNote &&
      uploadedImages.length === 0 &&
      uploadedVideos.length === 0
    ) {
      console.log('[PostComposer] No content to post');
      error = 'Please enter some content';
      return;
    }

    if (!$userPublickey) {
      console.log('[PostComposer] No user public key');
      error = 'Please sign in to post';
      return;
    }

    console.log('[PostComposer] Starting post process...');
    posting = true;
    error = '';

    try {
      if (composerEl) {
        content = mentionCtrl.extractText();
        lastRenderedContent = content;
        console.log('[PostComposer] Extracted content from composer:', content);
      }

      // Ensure NIP-46 signer is ready if using remote signer
      console.log('[PostComposer] Checking auth manager...');
      const { getAuthManager } = await import('$lib/authManager');
      const authManager = getAuthManager();
      if (authManager) {
        console.log('[PostComposer] Ensuring NIP-46 signer ready...');
        await authManager.ensureNip46SignerReady();
        console.log('[PostComposer] Signer ready');
      }

      console.log('[PostComposer] Creating NDKEvent...');
      const event = new NDKEvent($ndk);
      event.kind = 1;

      // Build content with text, image URLs, and video URLs
      let postContent = content.trim();
      const mediaUrls: string[] = [];

      if (uploadedImages.length > 0) {
        mediaUrls.push(...uploadedImages);
      }

      if (uploadedVideos.length > 0) {
        mediaUrls.push(...uploadedVideos);
      }

      if (mediaUrls.length > 0) {
        const mediaUrlsText = mediaUrls.join('\n');
        postContent = postContent ? `${postContent}\n\n${mediaUrlsText}` : mediaUrlsText;
      }

      if (quotedNote) {
        postContent = postContent
          ? `${postContent}\n\nnostr:${quotedNote.nevent}`
          : `nostr:${quotedNote.nevent}`;
      }

      postContent = mentionCtrl.replacePlainMentions(postContent);
      const mentions = mentionCtrl.parseMentions(postContent);

      event.content = postContent;
      event.tags = [['t', 'zapcooking']];

      for (const pubkey of mentions.values()) {
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          event.tags.push(['p', pubkey]);
        }
      }

      if (quotedNote) {
        const quotedPubkey = quotedNote.event.pubkey;
        event.tags.push(['q', quotedNote.event.id]);
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === quotedPubkey)) {
          event.tags.push(['p', quotedPubkey]);
        }
      }

      addClientTagToEvent(event);

      // Determine which relays to publish to
      // Priority: explicit selectedRelay prop (from modal) > activeTab (from feed context)
      const relayMode =
        selectedRelay ||
        (activeTab === 'garden' ? 'garden' : activeTab === 'members' ? 'pantry' : 'all');

      console.log(`[PostComposer] Publishing with relay mode: ${relayMode}`);
      console.log('[PostComposer] Event content:', event.content);
      console.log('[PostComposer] Event tags:', event.tags);

      // Use the resilient publish queue with automatic retry
      console.log('[PostComposer] Calling publishQueue.publishWithRetry...');
      const result = await publishQueue.publishWithRetry(event, relayMode);
      console.log('[PostComposer] Publish result:', result);

      if (result.success) {
        // Published successfully on first attempt
        success = true;
        successQueued = false;
        resetComposerState();

        const closeDelay = variant === 'modal' ? 1500 : 2500;
        setTimeout(() => {
          success = false;
          if (variant === 'modal') {
            dispatch('close');
          } else {
            isComposerOpen = false;
          }
        }, closeDelay);
      } else if (result.queued) {
        // Failed initial publish, but queued for background retry
        // Show optimistic success - the post will be published when connection improves
        success = true;
        successQueued = true;
        resetComposerState();

        // Log for debugging
        console.log('[PostComposer] Post queued for background retry:', result.error);

        const closeDelay = variant === 'modal' ? 2000 : 3000; // Slightly longer to read the message
        setTimeout(() => {
          success = false;
          successQueued = false;
          if (variant === 'modal') {
            dispatch('close');
          } else {
            isComposerOpen = false;
          }
        }, closeDelay);
      } else {
        error = result.error || 'Failed to publish';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = err instanceof Error ? err.message : 'Failed to post. Please try again.';
    } finally {
      posting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // Let controller handle mention-related keys first
    if (mentionCtrl.handleKeydown(event)) return;

    // No additional non-mention keydown logic in PostComposer
  }
</script>

{#if $userPublickey !== '' || variant === 'modal'}
  <div
    class={`bg-input rounded-xl transition-all ${variant === 'inline' ? 'mb-4' : 'flex-1 flex flex-col'}`}
    class:overflow-hidden={!isComposerOpen}
    class:overflow-visible={isComposerOpen}
    style="border: 1px solid var(--color-input-border)"
  >
    {#if variant === 'inline' && !isComposerOpen}
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
    {:else if $userPublickey === ''}
      <div class="p-4">
        <p class="text-sm text-caption">Sign in to post.</p>
        <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
      </div>
    {:else}
      <div class={`p-3 ${variant === 'modal' ? 'flex-1 flex flex-col' : ''}`}>
        <div class={`flex gap-3 ${variant === 'modal' ? 'flex-1' : ''}`}>
          <CustomAvatar pubkey={$userPublickey} size={36} />
          <div class={`flex-1 ${variant === 'modal' ? 'flex flex-col' : ''}`}>
            <div class={`relative ${variant === 'modal' ? 'flex-1' : ''}`}>
              <div
                bind:this={composerEl}
                class={`composer-input w-full min-h-[120px] sm:min-h-[100px] overflow-y-auto p-2 border-0 focus:outline-none focus:ring-0 bg-transparent ${variant === 'modal' ? 'max-h-[40vh]' : 'max-h-[50vh]'}`}
                style="color: var(--color-text-primary); font-size: 16px;"
                contenteditable={!posting}
                role="textbox"
                aria-multiline="true"
                data-placeholder="What are you eating, cooking, or loving?"
                on:keydown={handleKeydown}
                on:input={() => mentionCtrl.handleInput()}
                on:beforeinput={(e) => mentionCtrl.handleBeforeInput(e)}
                on:paste={(e) => mentionCtrl.handlePaste(e)}
              ></div>

              <MentionDropdown
                show={mentionState.showMentionSuggestions}
                suggestions={mentionState.mentionSuggestions}
                selectedIndex={mentionState.selectedMentionIndex}
                searching={mentionState.mentionSearching}
                query={mentionState.mentionQuery}
                on:select={(e) => mentionCtrl.insertMention(e.detail)}
              />
            </div>

            {#if error}
              <p class="text-red-500 text-xs mb-2">{error}</p>
            {/if}

            {#if success}
              {#if successQueued}
                <p class="text-amber-600 text-xs mb-2">
                  Post queued — will publish when connection improves
                </p>
              {:else}
                <p class="text-green-600 text-xs mb-2">Posted!</p>
              {/if}
            {/if}

            {#if quotedNote}
              <div class="quoted-note-embed mb-3">
                <div class="quoted-note-header">
                  <CustomAvatar pubkey={quotedNote.event.pubkey} size={16} />
                  <span class="quoted-note-author">
                    <ProfileLink
                      nostrString={'nostr:' + nip19.npubEncode(quotedNote.event.pubkey)}
                    />
                  </span>
                  <button
                    type="button"
                    on:click={() => (quotedNote = null)}
                    class="ml-auto text-caption hover:opacity-80 p-0.5 hover:bg-input rounded transition-colors"
                    aria-label="Remove quote"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div class="quoted-note-content">
                  <NoteContent content={quotedNote.event.content || ''} />
                </div>
              </div>
            {/if}

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
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            {#if uploadedVideos.length > 0}
              <div class="mb-2 flex flex-wrap gap-2">
                {#each uploadedVideos as videoUrl, index}
                  <div class="relative group">
                    <video
                      src={videoUrl}
                      class="w-32 h-20 object-cover rounded-lg"
                      style="border: 1px solid var(--color-input-border)"
                      preload="metadata"
                      muted
                    />
                    <button
                      type="button"
                      on:click={() => removeVideo(index)}
                      class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all opacity-90 hover:opacity-100"
                      disabled={posting}
                      aria-label="Remove video"
                    >
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            {#if activeTab === 'members' || selectedRelay === 'pantry'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
              >
                <p class="text-xs font-medium text-blue-700 dark:text-blue-300">
                  🏪 The Pantry — If you're seeing this, you're early.
                </p>
              </div>
            {:else if activeTab === 'garden' || selectedRelay === 'garden'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              >
                <p class="text-xs font-medium text-green-700 dark:text-green-300">
                  🌱 Posting to: <span class="font-semibold">garden.zap.cooking</span>
                </p>
              </div>
            {:else if selectedRelay === 'garden-pantry'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800"
              >
                <p class="text-xs font-medium text-purple-700 dark:text-purple-300">
                  🌱🏪 Posting to Garden + Pantry
                </p>
              </div>
            {:else if selectedRelay === 'all'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
              >
                <p class="text-xs font-medium text-orange-700 dark:text-orange-300">
                  📡 Posting to: <span class="font-semibold">All connected relays</span>
                </p>
              </div>
            {/if}

            <div
              class="flex items-center justify-between pt-2 border-t"
              style="border-color: var(--color-input-border)"
            >
              <div class="flex items-center gap-3">
                <label
                  class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                  class:opacity-50={posting || uploadingImage || uploadingVideo}
                  class:cursor-not-allowed={posting || uploadingImage || uploadingVideo}
                  aria-disabled={posting || uploadingImage}
                  title="Upload image"
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

                <label
                  class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                  class:opacity-50={posting || uploadingVideo}
                  class:cursor-not-allowed={posting || uploadingVideo}
                  aria-disabled={posting || uploadingVideo}
                  title="Upload video"
                >
                  <VideoIcon size={18} class="text-caption" />
                  <input
                    bind:this={videoInputEl}
                    type="file"
                    accept="video/*"
                    class="sr-only"
                    on:change={handleVideoUpload}
                    disabled={posting || uploadingVideo}
                  />
                </label>

                {#if uploadingImage}
                  <span class="text-xs text-caption">Uploading image...</span>
                {:else if uploadingVideo}
                  <span class="text-xs text-caption">Uploading video...</span>
                {/if}
              </div>

              <div class="flex items-center gap-2">
                {#if $publishQueueState.pending > 0}
                  <span
                    class="text-xs text-amber-600 flex items-center gap-1"
                    title="Posts queued for retry"
                  >
                    <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      ></circle>
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {$publishQueueState.pending} pending
                  </span>
                  <button
                    on:click={clearPendingQueue}
                    class="text-xs text-red-500 hover:text-red-600 underline"
                    title="Clear stuck posts from queue"
                  >
                    clear
                  </button>
                {/if}
                <button
                  on:click={closeComposer}
                  class="px-3 py-1.5 text-xs text-caption hover:opacity-80 transition-colors"
                  disabled={posting}
                >
                  Cancel
                </button>
                <button
                  on:click={postToFeed}
                  disabled={posting ||
                    uploadingImage ||
                    uploadingVideo ||
                    (!content.trim() &&
                      uploadedImages.length === 0 &&
                      uploadedVideos.length === 0 &&
                      !quotedNote)}
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

<style>
  .composer-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Custom scrollbar for composer */
  .composer-input::-webkit-scrollbar {
    width: 6px;
  }

  .composer-input::-webkit-scrollbar-track {
    background: transparent;
  }

  .composer-input::-webkit-scrollbar-thumb {
    background: var(--color-input-border);
    border-radius: 3px;
  }

  .composer-input::-webkit-scrollbar-thumb:hover {
    background: var(--color-caption);
  }

  .composer-input[contenteditable='true']:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  /* Quoted note embed - orange bracket style matching feed */
  .quoted-note-embed {
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-secondary);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
    overflow: hidden;
    max-width: 100%;
  }

  .quoted-note-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .quoted-note-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .quoted-note-author :global(a) {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .quoted-note-author :global(a:hover) {
    text-decoration: underline;
  }

  .quoted-note-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-height: 7em;
  }

  .quoted-note-content :global(p) {
    margin: 0;
  }

  .quoted-note-content :global(a) {
    color: var(--color-primary, #f97316);
  }

  /* Hide images and videos in quoted note preview - they cause overflow */
  .quoted-note-content :global(img),
  .quoted-note-content :global(video),
  .quoted-note-content :global(.video-preview),
  .quoted-note-content :global(.my-1.relative),
  .quoted-note-content :global(div[style*='aspect-ratio']) {
    display: none !important;
  }

  /* Ensure all text breaks properly */
  .quoted-note-content :global(*) {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
