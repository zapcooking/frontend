<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import FeedComment from './FeedComment.svelte';
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
  import { writable, type Readable } from 'svelte/store';
  import {
    createCommentSubscription,
    type CommentSubscription
  } from '$lib/comments/subscription';
  import { postComment as postCommentLib } from '$lib/comments/postComment';

  export let event: NDKEvent;
  let sub: CommentSubscription | null = null;
  let commentText = '';
  let showComments = false;
  let commentComposerEl: HTMLDivElement;
  let lastRenderedComment = '';
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
    sub?.stop();
    sub = null;
  });

  // Lazy subscription — only when the comments panel is open. `sub` is nulled
  // in onDestroy so reconnect paths re-subscribe correctly.
  let events: Readable<NDKEvent[]> = writable([]);
  $: if ($ndk && !sub && showComments) {
    sub = createCommentSubscription($ndk, event, {
      closeOnEose: false,
      applyMuteFilter: true
    });
    events = sub.events;
  }

  // Refresh hook passed to child FeedComment components. No-op: the
  // subscription stays open and delivers new events automatically.
  function refresh() {
    // intentionally empty
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

      // Compose content: mention substitution + media URL append.
      let commentContent = mentionCtrl.replacePlainMentions(commentText);
      const mediaUrls = [...uploadedImages, ...uploadedVideos];
      if (mediaUrls.length > 0) {
        const mediaText = mediaUrls.join('\n');
        commentContent = commentContent ? `${commentContent}\n\n${mediaText}` : mediaText;
      }

      // Collect @-mention p-tags + optional poll tags.
      const extraTags: string[][] = [];
      const mentions = mentionCtrl.parseMentions(commentContent);
      for (const pubkey of mentions.values()) {
        extraTags.push(['p', pubkey]);
      }
      if (pollConfig) {
        extraTags.push(...buildPollTags(pollConfig));
      }

      await postCommentLib($ndk, {
        parentEvent: event,
        content: commentContent,
        extraTags,
        contentKind: pollConfig ? 1068 : undefined,
        signingStrategy: 'implicit'
      });

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
      // Failed to post comment — feed context swallows silently today.
      // Stage 5 will unify to explicit + toast surface.
    }
  }

  function toggleComments() {
    showComments = !showComments;
  }
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
      <!-- Comments List - flat list with embedded parent quotes -->
      <div class="comments-list">
        {#if $events.length === 0}
          <p class="text-sm text-caption">No comments yet. {#if !$userPublickey}<a href="/login?redirect={encodeURIComponent($page.url.pathname)}" class="underline hover:opacity-80">Sign in</a> to comment!{:else}Be the first to comment!{/if}</p>
        {:else}
          {#each $events as comment (comment.id)}
            <FeedComment event={comment} allComments={$events} {refresh} mainEventId={event.id} />
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
              on:input={() => mentionCtrl.handleInput()}
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
