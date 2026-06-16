<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, normalizeRelayUrl } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import GifPicker from './GifPicker.svelte';
  import PollCreator from './PollCreator.svelte';
  import { buildPollTags, buildZapPollTags, type PollConfig, type ZapPollConfig } from '$lib/polls';
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
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';
  import { clickOutside } from '$lib/clickOutside';

  // Clear stuck posts from the publish queue
  async function clearPendingQueue() {
    try {
      await publishQueue.clearQueue();
      console.log('[PostComposer] Cleared publish queue');
    } catch (err) {
      console.error('[PostComposer] Failed to clear queue:', err);
    }
  }

  type FilterMode = 'global' | 'following' | 'replies' | 'members';
  type RelaySelection = 'all' | 'pantry';

  export let activeTab: FilterMode = 'global';
  export let variant: 'inline' | 'modal' = 'inline';
  export let selectedRelay: RelaySelection | undefined = undefined;
  export let initialQuotedNote: { nevent: string; event: NDKEventType } | null = null;

  const dispatch = createEventDispatcher<{ close: void; minimize: { preview: string } }>();

  // Exposed so the wrapping modal's X button routes through the same
  // close/minimize logic as the composer's own Cancel button.
  export function requestClose() {
    closeComposer();
  }

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
  let showMediaMenu = false;

  function openImagePicker() {
    showMediaMenu = false;
    imageInputEl?.click();
  }

  function openVideoPicker() {
    showMediaMenu = false;
    videoInputEl?.click();
  }

  // Close the media menu if posting / upload starts while it's open.
  $: if (showMediaMenu && (posting || uploadingImage || uploadingVideo)) {
    showMediaMenu = false;
  }
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;
  let showGifPicker = false;
  let showPollCreator = false;
  let pollConfig: PollConfig | null = null;
  let zapPollConfig: ZapPollConfig | null = null;

  const DRAFT_KEY = 'zapcooking_note_draft';
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSaved = false;
  let showPreview = false;
  let isMinimized = false;
  let previewContent = '';

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

  $: previewContent = computePreviewContent(content, uploadedImages, uploadedVideos, quotedNote);

  $: if (composerEl && (content || uploadedImages.length || uploadedVideos.length)) {
    scheduleDraftSave();
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

    // Restore saved draft — set content directly so the reactive
    // $: if (composerEl && content !== lastRenderedContent) fires when composerEl binds
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { content?: string; images?: string[]; videos?: string[]; savedAt?: number };
        if (draft.content || draft.images?.length || draft.videos?.length) {
          if (draft.content) content = draft.content; // don't set lastRenderedContent — let reactive sync handle DOM
          if (draft.images?.length) uploadedImages = draft.images;
          if (draft.videos?.length) uploadedVideos = draft.videos;
          draftSaved = true;
        }
      }
    } catch (_) {}

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
    isMinimized = false;
    isComposerOpen = true;
    focusComposer();
  }

  function resetComposerState() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    content = '';
    lastRenderedContent = '';
    error = '';
    successQueued = false;
    showPreview = false;
    draftSaved = false;
    isMinimized = false;
    mentionCtrl.resetMentionState();
    uploadedImages = [];
    uploadedVideos = [];
    quotedNote = null;
    pollConfig = null;
    zapPollConfig = null;
    if (composerEl) {
      composerEl.innerHTML = '';
    }
  }

  function closeComposer() {
    if (posting) return;

    // Persist the latest content before we tear anything down
    flushDraftSave();

    const hasContent = !!(content.trim() || uploadedImages.length || uploadedVideos.length);
    const isDesktop =
      typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

    if (variant === 'modal') {
      // Desktop with content → minimize to the bottom drawer (handled by PostModal,
      // which survives the modal unmount). Otherwise fully close — the autosaved
      // draft is restored on next open.
      if (hasContent && isDesktop) {
        dispatch('minimize', { preview: toPreviewLabel(content) || 'Media note' });
      } else {
        dispatch('close');
      }
      return;
    }

    // Inline: minimize to floating pill on desktop; on mobile just collapse
    // (in-memory content is preserved, no pill needed).
    if (hasContent) {
      isMinimized = isDesktop;
      isComposerOpen = false;
      return;
    }

    resetComposerState();
    isComposerOpen = false;
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingImage = true;
    error = '';

    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage($ndk, file);
        uploadedImages = [...uploadedImages, url];
      }
    } catch (err: any) {
      console.error('Error uploading image:', err);
      error = err?.message || 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
      if (imageInputEl) imageInputEl.value = '';
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
        const url = await uploadVideo($ndk, file);
        uploadedVideos = [...uploadedVideos, url];
      }
    } catch (err: any) {
      console.error('Error uploading video:', err);
      error = err?.message || 'Failed to upload video. Please try again.';
    } finally {
      uploadingVideo = false;
      if (videoInputEl) videoInputEl.value = '';
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
      uploadedVideos.length === 0 &&
      !pollConfig &&
      !zapPollConfig
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
      event.kind = zapPollConfig ? 6969 : pollConfig ? 1068 : 1;

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

      if (zapPollConfig) {
        // Zap polls need a p tag with creator's pubkey for Lightning routing
        if ($userPublickey) {
          const relay = $ndk.explicitRelayUrls?.[0] || '';
          event.tags.push(relay ? ['p', $userPublickey, relay] : ['p', $userPublickey]);
        }
        event.tags.push(...buildZapPollTags(zapPollConfig));
      } else if (pollConfig) {
        event.tags.push(...buildPollTags(pollConfig));
      }

      // Determine which relays to publish to
      // Priority: explicit selectedRelay prop (from modal) > activeTab (from feed context)
      const relayMode = selectedRelay || (activeTab === 'members' ? 'pantry' : 'all');

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

  function saveDraftNow() {
    try {
      const text = composerEl ? mentionCtrl.extractText() : content;
      if (!text.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) {
        localStorage.removeItem(DRAFT_KEY);
        draftSaved = false;
        return;
      }
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ content: text, images: uploadedImages, videos: uploadedVideos, savedAt: Date.now() })
      );
      draftSaved = true;
    } catch (_) {}
  }

  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 300);
  }

  // Flush any pending debounced save immediately (called before closing)
  function flushDraftSave() {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    saveDraftNow();
  }

  // Human-readable label for the minimized draft tab — strip image URLs,
  // links, and raw nostr refs so the tab shows meaningful text, not a URL.
  function toPreviewLabel(raw: string): string {
    return raw
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/nostr:\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  $: minimizedLabel = toPreviewLabel(content) || 'Media note';

  function restoreFromMinimized() {
    isMinimized = false;
    openComposer();
  }

  function discardAndFullyClose() {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    isMinimized = false;
    resetComposerState();
    isComposerOpen = false;
  }

  function computePreviewContent(text: string, images: string[], videos: string[], quote: typeof quotedNote): string {
    const resolved = mentionCtrl.replacePlainMentions(text);
    let preview = resolved.trim();
    const media = [...images, ...videos];
    if (media.length) {
      preview = preview ? `${preview}\n\n${media.join('\n')}` : media.join('\n');
    }
    if (quote) {
      preview = preview ? `${preview}\n\nnostr:${quote.nevent}` : `nostr:${quote.nevent}`;
    }
    return preview;
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
      <div class={`${variant === 'modal' ? 'flex-1 flex flex-col min-h-0' : 'p-3'}`}>
        <!-- Scrollable content area -->
        <div class={variant === 'modal' ? 'composer-scroll-area flex-1 overflow-y-auto min-h-0 p-3' : ''}>
          <div class="flex gap-3">
            <CustomAvatar pubkey={$userPublickey} size={36} />
            <div class="flex-1 min-w-0">
              <!-- Write / Preview tab bar -->
              <div class="flex border-b mb-1" style="border-color: var(--color-input-border)">
                <button
                  type="button"
                  on:click={() => (showPreview = false)}
                  class="px-3 py-1.5 text-xs font-medium transition-colors -mb-px border-b-2 {!showPreview ? 'text-primary border-primary' : 'text-caption border-transparent'}"
                >Write</button>
                <button
                  type="button"
                  on:click={() => (showPreview = true)}
                  class="px-3 py-1.5 text-xs font-medium transition-colors -mb-px border-b-2 {showPreview ? 'text-primary border-primary' : 'text-caption border-transparent'}"
                >Preview</button>
              </div>

              <!-- Write pane (hidden when preview active, DOM kept for content preservation) -->
              <div class:hidden={showPreview}>
                <div class="relative">
                  <div
                    bind:this={composerEl}
                    class={`composer-input w-full overflow-y-auto p-2 border-0 focus:outline-none focus:ring-0 bg-transparent ${variant === 'modal' ? 'min-h-[200px] max-h-[45vh]' : 'min-h-[120px] sm:min-h-[100px] max-h-[40vh]'}`}
                    style="color: var(--color-text-primary);"
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
              </div>

              <!-- Preview pane — matches Write pane padding/font so toggling feels seamless -->
              {#if showPreview}
                <div class={`composer-input overflow-y-auto p-2 ${variant === 'modal' ? 'min-h-[200px] max-h-[45vh]' : 'min-h-[120px] sm:min-h-[100px] max-h-[40vh]'}`} style="color: var(--color-text-primary);">
                  {#if previewContent.trim()}
                    <NoteContent content={previewContent} collapsible={false} showLinkPreviews={true} />
                  {:else}
                    <p class="text-caption italic">Nothing to preview yet — start writing in the Write tab.</p>
                  {/if}
                </div>
              {/if}

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

              {#if !showPreview && quotedNote}
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

              {#if !showPreview && uploadedImages.length > 0}
                <div class="mb-2 flex flex-wrap gap-2">
                  {#each uploadedImages as imageUrl, index}
                    <div class="relative group">
                      <img
                        src={imageUrl}
                        alt="Upload preview"
                        class="composer-img-preview object-cover rounded-lg"
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

              {#if !showPreview && uploadedVideos.length > 0}
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

              {#if pollConfig || zapPollConfig}
                <div class="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <ChartBarHorizontalIcon size={14} class="text-orange-600 dark:text-orange-400" />
                  <span class="text-xs font-medium text-orange-700 dark:text-orange-300">
                    {#if zapPollConfig}
                      Zap Poll: {zapPollConfig.options.length} options (min {zapPollConfig.valueMinimum} sats)
                    {:else if pollConfig}
                      Poll: {pollConfig.options.length} options
                    {/if}
                  </span>
                  <button
                    type="button"
                    on:click={() => { pollConfig = null; zapPollConfig = null; }}
                    class="ml-auto text-orange-500 hover:text-orange-700 p-0.5"
                    aria-label="Remove poll"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              {/if}

            </div>
          </div>
        </div>

        <!-- Action bar — pinned at bottom in modal, inline otherwise -->
        <div
          class="{variant === 'modal' ? 'flex-shrink-0 px-3 pb-3' : ''}"
        >
          <div
            class="flex items-center justify-between pt-2"
            style="border-top: 1px solid var(--color-input-border)"
          >
          <div class="flex items-center gap-3">
            <div
              class="media-menu"
              use:clickOutside
              on:click_outside={() => (showMediaMenu = false)}
            >
              <button
                type="button"
                class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                class:opacity-50={posting || uploadingImage || uploadingVideo}
                class:cursor-not-allowed={posting || uploadingImage || uploadingVideo}
                disabled={posting || uploadingImage || uploadingVideo}
                aria-haspopup="menu"
                aria-expanded={showMediaMenu}
                aria-label="Upload photo or video"
                title="Upload photo or video"
                on:click={() => (showMediaMenu = !showMediaMenu)}
              >
                <ImageIcon size={18} class="text-caption" />
              </button>
              {#if showMediaMenu}
                <div class="media-menu-panel" role="menu">
                  <button
                    type="button"
                    class="media-menu-item"
                    role="menuitem"
                    on:click={openImagePicker}
                  >
                    <ImageIcon size={16} />
                    <span>Photo</span>
                  </button>
                  <button
                    type="button"
                    class="media-menu-item"
                    role="menuitem"
                    on:click={openVideoPicker}
                  >
                    <VideoIcon size={16} />
                    <span>Video</span>
                  </button>
                </div>
              {/if}
              <input
                bind:this={imageInputEl}
                type="file"
                accept="image/*"
                class="sr-only"
                on:change={handleImageUpload}
                disabled={posting || uploadingImage || uploadingVideo}
              />
              <input
                bind:this={videoInputEl}
                type="file"
                accept="video/*"
                class="sr-only"
                on:change={handleVideoUpload}
                disabled={posting || uploadingImage || uploadingVideo}
              />
            </div>

            <button
              on:click={() => (showGifPicker = true)}
              class="p-1.5 rounded-full hover:bg-accent-gray transition-colors"
              class:opacity-50={posting}
              class:cursor-not-allowed={posting}
              disabled={posting}
              title="Add GIF"
            >
              <GifIcon size={18} class="text-caption" />
            </button>

            <button
              on:click={() => (showPollCreator = true)}
              class="p-1.5 rounded-full hover:bg-accent-gray transition-colors"
              class:opacity-50={posting}
              class:cursor-not-allowed={posting}
              disabled={posting}
              title="Create poll"
            >
              <ChartBarHorizontalIcon size={18} class={pollConfig || zapPollConfig ? 'text-primary' : 'text-caption'} />
            </button>

            {#if uploadingImage}
              <span class="text-xs text-caption">Uploading image...</span>
            {:else if uploadingVideo}
              <span class="text-xs text-caption">Uploading video...</span>
            {/if}
          </div>

          <div class="flex items-center gap-2">
            {#if draftSaved && !posting && !success}
              <span class="text-xs text-caption flex items-center gap-0.5" title="Draft autosaved">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                </svg>
                Saved
              </span>
            {/if}
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
                  !quotedNote &&
                  !pollConfig &&
                  !zapPollConfig)}
              class="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {posting ? 'Posting...' : 'Post'}
            </button>
          </div>
          </div>
          {#if variant === 'inline' && (activeTab === 'members' || selectedRelay === 'pantry')}
            <p class="pt-1.5 text-[11px] text-caption">
              <span class="mr-1">🏪</span>Posting to the Pantry — if you're seeing this, you're early.
            </p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if isMinimized && variant === 'inline'}
  <!-- Desktop-only minimized draft drawer. Docks flush to the bottom edge on
       the left, clear of the bottom-right FAB and the bottom nav. -->
  <div
    class="hidden md:block fixed z-50"
    style="bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px)); right: calc(1.25rem + 56px + 0.75rem);"
  >
    <div
      class="flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-t-xl cursor-pointer"
      style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); border-bottom: none; box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);"
      on:click={restoreFromMinimized}
      on:keydown={(e) => e.key === 'Enter' && restoreFromMinimized()}
      role="button"
      tabindex="0"
      aria-label="Restore draft"
    >
      <PencilSimpleIcon size={14} class="text-caption flex-shrink-0" />
      <span class="text-sm truncate max-w-[200px]" style="color: var(--color-text-primary)">
        {minimizedLabel}
      </span>
      <button
        type="button"
        on:click|stopPropagation={discardAndFullyClose}
        class="ml-1 p-0.5 text-caption hover:text-primary flex-shrink-0"
        aria-label="Discard draft"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
{/if}

<GifPicker
  bind:open={showGifPicker}
  on:select={(e) => {
    uploadedImages = [...uploadedImages, e.detail.url];
  }}
/>

<PollCreator
  bind:open={showPollCreator}
  on:create={(e) => {
    pollConfig = e.detail;
    zapPollConfig = null;
  }}
  on:createZapPoll={(e) => {
    zapPollConfig = e.detail;
    pollConfig = null;
  }}
/>

<style>
  .composer-input {
    white-space: pre-wrap;
    word-break: break-word;
    /* 16px on mobile avoids iOS focus-zoom; slightly smaller on desktop reads better */
    font-size: 16px;
  }

  @media (min-width: 768px) {
    .composer-input {
      font-size: 15px;
    }
  }

  /* Scrollable content area for modal variant */
  .composer-scroll-area {
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .composer-scroll-area::-webkit-scrollbar {
    width: 6px;
  }

  .composer-scroll-area::-webkit-scrollbar-track {
    background: transparent;
  }

  .composer-scroll-area::-webkit-scrollbar-thumb {
    background: var(--color-input-border);
    border-radius: 3px;
  }

  /* Constrain image preview size so they don't dominate the scroll area */
  .composer-img-preview {
    width: 5rem;
    height: 5rem;
    max-height: 200px;
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

  .media-menu {
    position: relative;
    display: inline-flex;
  }

  .media-menu-panel {
    position: absolute;
    bottom: calc(100% + 0.375rem);
    left: 0;
    z-index: 45;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.6rem;
    min-width: 140px;
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
  }

  .media-menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 0.4rem;
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    text-align: left;
    transition: background 0.15s ease;
  }

  .media-menu-item:hover {
    background: var(--color-accent-gray);
  }
</style>
