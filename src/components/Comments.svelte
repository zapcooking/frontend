<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import Comment from './Comment.svelte';
  import { onDestroy } from 'svelte';
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
  import { postComment as postCommentLib, PostCommentError } from '$lib/comments/postComment';

  export let event: NDKEvent;
  let sub: CommentSubscription | null = null;
  let commentText = '';
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

  // Preload follow list when user is logged in
  $: if ($userPublickey) {
    mentionCtrl.preloadFollowList();
  }

  // Create subscription once ndk is ready. `sub` is nulled in onDestroy so
  // reconnection paths (if $ndk ever becomes null → non-null) re-subscribe.
  let events: Readable<NDKEvent[]> = writable([]);
  $: if ($ndk && !sub) {
    sub = createCommentSubscription($ndk, event, {
      closeOnEose: false,
      applyMuteFilter: false
    });
    events = sub.events;
  }

  onDestroy(() => {
    mentionCtrl.destroy();
    sub?.stop();
    sub = null;
  });

  // Refresh hook passed to child Comment components. No-op: the subscription
  // stays open and automatically delivers new events (including replies posted
  // from within a Comment's inline composer).
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
    if (!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig) {
      return;
    }

    if (commentComposerEl) {
      commentText = mentionCtrl.extractText();
      lastRenderedComment = commentText;
    }
    if (!$ndk?.signer) {
      console.error('No signer available - user must be logged in');
      alert('Please log in to post comments');
      return;
    }

    // Compose content: mention substitution + media URL append.
    let commentContent = mentionCtrl.replacePlainMentions(commentText.trim());
    const mediaUrls = [...uploadedImages, ...uploadedVideos];
    if (mediaUrls.length > 0) {
      const mediaText = mediaUrls.join('\n');
      commentContent = commentContent ? `${commentContent}\n\n${mediaText}` : mediaText;
    }

    // Collect @-mention p-tags + optional poll tags to merge into the event.
    const extraTags: string[][] = [];
    const mentions = mentionCtrl.parseMentions(commentContent);
    for (const pubkey of mentions.values()) {
      extraTags.push(['p', pubkey]);
    }
    if (pollConfig) {
      extraTags.push(...buildPollTags(pollConfig));
    }

    try {
      const { event: posted } = await postCommentLib($ndk, {
        parentEvent: event,
        content: commentContent,
        extraTags,
        contentKind: pollConfig ? 1068 : undefined,
        signingStrategy: 'explicit-with-timeout'
      });

      // Optimistic add — recipe comments want the new entry visible
      // immediately rather than waiting for the subscription round-trip.
      sub?.addLocal(posted);

      // Clear the composer
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
    } catch (error) {
      console.error('Error posting comment:', error);
      if (error instanceof PostCommentError && error.cause instanceof Error) {
        console.error('Error stack:', error.cause.stack);
      } else if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert('Error posting comment: ' + errorMsg);
    }
  }
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List - flat with embedded parent quotes -->
  <div class="comments-list">
    {#if $events.length === 0}
      <p class="text-caption">No comments yet. Be the first to comment!</p>
    {:else}
      {#each $events as comment (comment.id)}
        <Comment event={comment} allReplies={$events} {refresh} />
      {/each}
    {/if}
  </div>

  <!-- Add Comment Form -->
  <div class="space-y-3 pt-4 border-t">
    <h3 class="text-lg font-semibold">Add a comment</h3>
    {#if $ndk?.signer}
      <div class="relative">
        <div
          id="comment-input"
          bind:this={commentComposerEl}
          class="comment-composer-input w-full px-4 py-3 text-base input rounded-lg"
          contenteditable="true"
          role="textbox"
          tabindex="0"
          aria-multiline="true"
          data-placeholder="Share your thoughts..."
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
              <img src={imageUrl} alt="Upload preview" class="w-20 h-20 object-cover rounded-lg" style="border: 1px solid var(--color-input-border)" />
              <button type="button" on:click={() => removeImage(index)} class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg" aria-label="Remove image">
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
              <video src={videoUrl} class="w-32 h-20 object-cover rounded-lg" style="border: 1px solid var(--color-input-border)" preload="metadata" muted />
              <button type="button" on:click={() => removeVideo(index)} class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg" aria-label="Remove video">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo} title="Upload image">
          <ImageIcon size={18} />
          <input bind:this={imageInputEl} type="file" accept="image/*" class="sr-only" on:change={handleImageUpload} disabled={uploadingImage || uploadingVideo} />
        </label>
        <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo} title="Upload video">
          <VideoIcon size={18} />
          <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={uploadingImage || uploadingVideo} />
        </label>
        <button
          on:click={() => (showGifPicker = true)}
          class="btn-gif"
          title="Add GIF"
          disabled={uploadingImage || uploadingVideo}
          class:opacity-50={uploadingImage || uploadingVideo}
        >
          <GifIcon size={18} />
        </button>
        <button
          on:click={() => (showPollCreator = true)}
          class="btn-gif"
          title="Create poll"
          disabled={uploadingImage || uploadingVideo}
          class:opacity-50={uploadingImage || uploadingVideo}
        >
          <ChartBarHorizontalIcon size={18} class={pollConfig ? 'text-primary' : ''} />
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
        <Button
          on:click={(e) => {
            e.preventDefault?.();
            postComment();
          }}
          disabled={uploadingImage || uploadingVideo || (!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig)}
        >
          Post Comment
        </Button>
      </div>
    {:else}
      <p class="text-sm text-caption">Sign in to comment.</p>
      <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
    {/if}
  </div>
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
