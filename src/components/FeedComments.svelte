<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import FeedComment from './FeedComment.svelte';
  import { createCommentFilter } from '$lib/commentFilters';
  import { mutedPubkeys } from '$lib/muteListStore';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifPicker from './GifPicker.svelte';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import PollCreator from './PollCreator.svelte';
  import { buildPollTags, type PollConfig } from '$lib/polls';
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';
  import { detectHaiku } from '$lib/haiku';

  export let event: NDKEvent;
  let events: NDKEvent[] = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;
  let showComments = false;
  let commentComposerEl: HTMLDivElement;
  let lastRenderedComment = '';
  let feedCommentSubscription: any = null;
  let showGifPicker = false;
  let showPollCreator = false;
  let pollConfig: PollConfig | null = null;
  let uploadedImages: string[] = [];
  let uploadedVideos: string[] = [];
  let uploadingImage = false;
  let uploadingVideo = false;
  let uploadError = '';
  let imageInputEl: HTMLInputElement;
  let videoInputEl: HTMLInputElement;
  let haikuDetected = false;

  // Mention autocomplete
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
      commentText = text;
      lastRenderedComment = text;
    }
  );

  $: mentionCtrl.setComposerEl(commentComposerEl);

  $: if (commentComposerEl && commentText !== lastRenderedComment) {
    mentionCtrl.syncContent(commentText);
    lastRenderedComment = commentText;
  }

  $: haikuDetected = event.kind !== 30023 && !pollConfig && detectHaiku(commentText);

  $: if ($userPublickey) {
    mentionCtrl.preloadFollowList();
  }

  // Listen for toggle event from NoteTotalComments
  onMount(() => {
    const handleToggleEvent = () => {
      toggleComments();
    };

    const element = document.querySelector(`[data-event-id="${event.id}"]`);
    if (element) {
      element.addEventListener('toggleComments', handleToggleEvent);

      // Cleanup
      return () => {
        element.removeEventListener('toggleComments', handleToggleEvent);
      };
    }
  });

  onDestroy(() => {
    mentionCtrl.destroy();
    if (feedCommentSubscription) {
      feedCommentSubscription.stop();
    }
  });

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed && showComments) {
    subscribed = true;

    const filter = createCommentFilter(event);
    feedCommentSubscription = $ndk.subscribe(filter, { closeOnEose: false });

    feedCommentSubscription.on('event', (e: NDKEvent) => {
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);
      events.push(e);
      events = events;
    });

    feedCommentSubscription.on('eose', () => {});
  }

  // Dummy refresh function for FeedComment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    uploadingImage = true;
    uploadError = '';
    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage($ndk, file);
        uploadedImages = [...uploadedImages, url];
      }
    } catch (err: any) {
      uploadError = err?.message || 'Failed to upload image.';
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
    uploadError = '';
    try {
      for (const file of Array.from(files)) {
        const url = await uploadVideo($ndk, file);
        uploadedVideos = [...uploadedVideos, url];
      }
    } catch (err: any) {
      uploadError = err?.message || 'Failed to upload video.';
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

  async function postComment() {
    if (!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig) return;

    try {
      if (commentComposerEl) {
        commentText = mentionCtrl.extractText();
        lastRenderedComment = commentText;
      }

      const ev = new NDKEvent($ndk);

      // Check if replying to a recipe (kind 30023)
      // Recipe replies should be kind 1111, not kind 1
      const isRecipe = event.kind === 30023;
      ev.kind = pollConfig ? 1068 : (isRecipe ? 1111 : 1);

      let commentContent = mentionCtrl.replacePlainMentions(commentText);
      const mediaUrls = [...uploadedImages, ...uploadedVideos];
      if (mediaUrls.length > 0) {
        const mediaText = mediaUrls.join('\n');
        commentContent = commentContent ? `${commentContent}\n\n${mediaText}` : mediaText;
      }
      ev.content = commentContent;

      // Use shared utility to build NIP-22 or NIP-10 tags
      ev.tags = buildNip22CommentTags({
        kind: event.kind ?? 1,
        pubkey: event.pubkey,
        id: event.id,
        tags: event.tags
      });

      // Parse and add @ mention tags (p tags)
      const mentions = mentionCtrl.parseMentions(commentContent);
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          ev.tags.push(['p', pubkey]);
        }
      }

      // Add NIP-89 client tag
      addClientTagToEvent(ev);

      if (pollConfig) {
        ev.tags.push(...buildPollTags(pollConfig));
      }

      await ev.publish();
      commentText = '';
      lastRenderedComment = '';
      uploadedImages = [];
      pollConfig = null;
      uploadedVideos = [];
      uploadError = '';
      if (commentComposerEl) {
        commentComposerEl.innerHTML = '';
      }
      mentionCtrl.resetMentionState();
    } catch {
      // Failed to post comment
    }
  }

  function toggleComments() {
    showComments = !showComments;
  }

  // Sort all comments chronologically (oldest first for thread view) and filter muted users
  $: sortedComments = [...events]
    .filter((comment) => {
      const authorKey = comment.author?.hexpubkey || comment.pubkey;
      return !authorKey || !$mutedPubkeys.has(authorKey);
    })
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
      <!-- Comments List - flat list with embedded parent quotes -->
      <div class="comments-list">
        {#if sortedComments.length === 0}
          <p class="text-sm text-caption">No comments yet. Be the first to comment!</p>
        {:else}
          {#each sortedComments as comment (comment.id)}
            <FeedComment event={comment} allComments={events} {refresh} mainEventId={event.id} />
          {/each}
        {/if}
      </div>

      <!-- Add Comment Form -->
      {#if $userPublickey}
        <div class="space-y-2 pt-2" style="border-top: 1px solid var(--color-input-border)">
          <div class="relative">
            <div
              bind:this={commentComposerEl}
              class="comment-composer-input w-full px-3 py-2 text-sm rounded-lg bg-input"
              style="border: 1px solid var(--color-input-border); color: var(--color-text-primary)"
              contenteditable="true"
              role="textbox"
              tabindex="0"
              aria-multiline="true"
              data-placeholder="Add a comment..."
              on:input={() => {
                commentText = mentionCtrl.handleInput();
                lastRenderedComment = commentText;
              }}
              on:keydown={(e) => mentionCtrl.handleKeydown(e)}
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
          {#if uploadError}
            <p class="text-red-500 text-xs">{uploadError}</p>
          {/if}

          {#if uploadedImages.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each uploadedImages as imageUrl, index}
                <div class="relative group">
                  <img src={imageUrl} alt="Upload preview" class="w-16 h-16 object-cover rounded-lg" style="border: 1px solid var(--color-input-border)" />
                  <button type="button" on:click={() => removeImage(index)} class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg" aria-label="Remove image">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          {#if uploadedVideos.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each uploadedVideos as videoUrl, index}
                <div class="relative group">
                  <video src={videoUrl} class="w-24 h-16 object-cover rounded-lg" style="border: 1px solid var(--color-input-border)" preload="metadata" muted />
                  <button type="button" on:click={() => removeVideo(index)} class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg" aria-label="Remove video">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          {#if haikuDetected}
            <p class="px-1 text-[11px] text-amber-600 dark:text-amber-400">
              🍃 This looks like a haiku. Expect a visit from the haiku bot.
            </p>
          {/if}

          <div class="flex justify-end items-center gap-2">
            <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo} title="Upload image">
              <ImageIcon size={16} />
              <input bind:this={imageInputEl} type="file" accept="image/*" class="sr-only" on:change={handleImageUpload} disabled={uploadingImage || uploadingVideo} />
            </label>
            <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo} title="Upload video">
              <VideoIcon size={16} />
              <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={uploadingImage || uploadingVideo} />
            </label>
            <button
              on:click={() => (showGifPicker = true)}
              class="btn-gif"
              title="Add GIF"
              disabled={uploadingImage || uploadingVideo}
              class:opacity-50={uploadingImage || uploadingVideo}
            >
              <GifIcon size={16} />
            </button>
            <button
              on:click={() => (showPollCreator = true)}
              class="btn-gif"
              title="Create poll"
              disabled={uploadingImage || uploadingVideo}
              class:opacity-50={uploadingImage || uploadingVideo}
            >
              <ChartBarHorizontalIcon size={16} class={pollConfig ? 'text-primary' : ''} />
            </button>
            {#if uploadingImage}
              <span class="text-xs text-caption">Uploading image...</span>
            {:else if uploadingVideo}
              <span class="text-xs text-caption">Uploading video...</span>
            {/if}
            {#if pollConfig}
              <span class="text-xs text-orange-600 flex items-center gap-1">
                <ChartBarHorizontalIcon size={12} />
                Poll ({pollConfig.options.length})
                <button type="button" on:click={() => (pollConfig = null)} class="hover:text-orange-800">×</button>
              </span>
            {/if}
            <Button on:click={postComment} disabled={uploadingImage || uploadingVideo || (!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig)} class="text-sm px-4 py-2">
              Post Comment
            </Button>
          </div>
        </div>
      {:else}
        <div
          class="text-sm text-caption pt-2"
          style="border-top: 1px solid var(--color-input-border)"
        >
          <a href="/login" class="text-primary hover:underline">Log in</a> to comment
        </div>
      {/if}
    </div>
  {/if}
</div>

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
  }}
/>

<style>
  /* Comments list - flat layout with spacing */
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .comment-composer-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .comment-composer-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  .btn-gif,
  .btn-media {
    padding: 0.375rem;
    color: var(--color-caption);
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-gif:hover,
  .btn-media:hover {
    opacity: 0.7;
  }
</style>
