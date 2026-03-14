<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { mutedPubkeys } from '$lib/muteListStore';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import CommentLikes from './CommentLikes.svelte';
  import NoteContent from './NoteContent.svelte';
  import { get } from 'svelte/store';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifPicker from './GifPicker.svelte';
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';

  export let parentComment: NDKEvent;

  let showReplies = false;
  let showGifPicker = false;
  let replies: NDKEvent[] = [];
  let loading = false;
  let replyText = '';
  let postingReply = false;
  let replyCount = 0;
  let errorMessage = '';
  let successMessage = '';
  let replyComposerEl: HTMLDivElement;
  let lastRenderedReply = '';
  let replySubscription: any = null;
  let uploadedImages: string[] = [];
  let uploadedVideos: string[] = [];
  let uploadingImage = false;
  let uploadingVideo = false;
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
      replyText = text;
      lastRenderedReply = text;
    }
  );

  $: mentionCtrl.setComposerEl(replyComposerEl);

  $: if (replyComposerEl && replyText !== lastRenderedReply) {
    mentionCtrl.syncContent(replyText);
    lastRenderedReply = replyText;
  }

  // Load replies for this comment
  async function loadReplies() {
    if (loading) return;

    loading = true;
    replies = [];
    replyCount = 0;

    // Close previous subscription if exists
    if (replySubscription) {
      replySubscription.stop();
    }

    try {
      // Use subscribe collection for more reliable reply loading
      replySubscription = $ndk.subscribe(
        {
          kinds: [1, 1111] as any,
          '#e': [parentComment.id] // Replies that reference this comment
        },
        { closeOnEose: true }
      );

      replySubscription.on('event', (ev: NDKEvent) => {
        loading = false;
        replies.push(ev);
        replies = replies;
      });

      replySubscription.on('eose', () => {
        loading = false;
      });
    } catch (error) {
      console.error('Error loading replies:', error);
      loading = false;
    }
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    uploadingImage = true;
    errorMessage = '';
    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage($ndk, file);
        uploadedImages = [...uploadedImages, url];
      }
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to upload image.';
      setTimeout(() => errorMessage = '', 5000);
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
    errorMessage = '';
    try {
      for (const file of Array.from(files)) {
        const url = await uploadVideo($ndk, file);
        uploadedVideos = [...uploadedVideos, url];
      }
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to upload video.';
      setTimeout(() => errorMessage = '', 5000);
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

  // Post a new reply
  async function postReply() {
    if ((!replyText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) || postingReply || !$ndk.signer) return;

    postingReply = true;
    errorMessage = '';
    successMessage = '';

    try {
      if (replyComposerEl) {
        replyText = mentionCtrl.extractText();
        lastRenderedReply = replyText;
      }

      const replyEvent = new NDKEvent($ndk);

      // Check if this is a reply to a recipe comment
      // If the parent comment is kind 1111 or has an 'a' tag referencing kind 30023, use kind 1111
      const aTag = parentComment.getMatchingTags('a')[0];
      const ATag = parentComment.getMatchingTags('A')[0];
      const isRecipeReply =
        parentComment.kind === 1111 ||
        (aTag && aTag[1]?.startsWith('30023:')) ||
        (ATag && ATag[1]?.startsWith('30023:'));
      replyEvent.kind = isRecipeReply ? 1111 : 1;

      let replyContent = mentionCtrl.replacePlainMentions(replyText.trim());
      const mediaUrls = [...uploadedImages, ...uploadedVideos];
      if (mediaUrls.length > 0) {
        const mediaText = mediaUrls.join('\n');
        replyContent = replyContent ? `${replyContent}\n\n${mediaText}` : mediaText;
      }
      replyEvent.content = replyContent;

      // Reconstruct a minimal event object for the parent comment
      const parentEventObj = {
        id: parentComment.id,
        pubkey: parentComment.pubkey,
        kind: parentComment.kind,
        tags: parentComment.tags
      };

      // For recipe replies, we need to get the root event info from the parent's tags
      if (isRecipeReply) {
        // Get root event info from parent comment's tags
        const rootATag =
          parentComment.getMatchingTags('A')[0] || parentComment.getMatchingTags('a')[0];

        if (rootATag) {
          // Parse the address tag to extract root event info.
          // Format is kind:pubkey:d, where d may itself contain colons.
          const addressParts = rootATag[1].split(':');
          const kind = addressParts[0];
          const pubkey = addressParts[1];
          const dTag = addressParts.slice(2).join(':');
          const rootEventObj = {
            kind: parseInt(kind),
            pubkey: pubkey,
            id: '', // We don't need the actual event ID for tag generation
            tags: [
              ['d', dTag],
              ['relay', rootATag[2] || '']
            ]
          };

          // Use the utility with both root and parent event
          replyEvent.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
        } else {
          // Fallback: treat parent as if it's the root
          replyEvent.tags = buildNip22CommentTags(
            {
              ...parentEventObj,
              kind: parentEventObj.kind ?? 1,
              tags: parentEventObj.tags as string[][]
            },
            {
              ...parentEventObj,
              tags: parentEventObj.tags as string[][]
            }
          );
        }
      } else {
        // For non-recipe replies, use simplified tag structure
        replyEvent.tags = [
          ['e', parentComment.id, '', 'reply'],
          ['p', parentComment.pubkey]
        ];
      }

      // Parse and add @ mention tags (p tags)
      const mentions = mentionCtrl.parseMentions(replyContent);
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!replyEvent.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          replyEvent.tags.push(['p', pubkey]);
        }
      }

      // Add NIP-89 client tag
      addClientTagToEvent(replyEvent);

      await replyEvent.publish();

      // Clear the form and show success
      replyText = '';
      lastRenderedReply = '';
      uploadedImages = [];
      uploadedVideos = [];
      if (replyComposerEl) {
        replyComposerEl.innerHTML = '';
      }
      mentionCtrl.resetMentionState();
      successMessage = 'Reply posted successfully!';

      // Reload replies to show the new one
      await loadReplies();

      // Clear success message after a delay
      setTimeout(() => {
        successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error posting reply:', error);
      errorMessage = 'Failed to post reply. Please try again.';
    } finally {
      postingReply = false;
    }
  }

  // Toggle replies visibility
  function toggleReplies() {
    showReplies = !showReplies;
    if (showReplies && replies.length === 0) {
      loadReplies();
    }
    // Preload mention profiles when opening replies
    if (showReplies && $userPublickey) {
      mentionCtrl.preloadFollowList();
    }
  }

  onDestroy(() => {
    mentionCtrl.destroy();
    if (replySubscription) {
      replySubscription.stop();
    }
  });
</script>

<div class="comment-replies" data-comment-id={parentComment.id}>
  <!-- Reply Button -->
  <button
    on:click={toggleReplies}
    class="text-sm text-caption hover:text-primary font-medium cursor-pointer transition duration-300 print:hidden"
  >
    {showReplies ? 'Hide replies' : 'Reply'}
    {replyCount > 0 ? `(${replyCount})` : ''}
  </button>

  <!-- Replies Section -->
  {#if showReplies}
    <div class="mt-3 space-y-3">
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
          <strong>Please log in</strong> to reply to comments.
        </div>
      {/if}

      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-xs text-red-600 bg-red-50 p-2 rounded print:hidden">
          {errorMessage}
        </div>
      {/if}

      {#if successMessage}
        <div class="text-xs text-green-600 bg-green-50 p-2 rounded print:hidden">
          {successMessage}
        </div>
      {/if}

      <!-- Reply Form -->
      <div class="space-y-1 print:hidden">
        <div class="relative">
          <div
            bind:this={replyComposerEl}
            class="reply-input w-full px-4 py-3 text-sm input rounded-xl transition duration-200"
            class:opacity-50={!$ndk.signer || postingReply}
            class:cursor-not-allowed={!$ndk.signer || postingReply}
            contenteditable={$ndk.signer && !postingReply}
            role="textbox"
            tabindex="0"
            aria-multiline="true"
            aria-disabled={!$ndk.signer || postingReply}
            data-placeholder={$ndk.signer ? 'Add a reply...' : 'Log in to reply...'}
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
          <label
            class="p-1.5 rounded-full hover:bg-accent-gray transition-colors cursor-pointer"
            style="color: var(--color-caption)"
            title="Upload image"
            class:opacity-40={postingReply || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <ImageIcon size={16} />
            <input bind:this={imageInputEl} type="file" accept="image/*" class="sr-only" on:change={handleImageUpload} disabled={postingReply || !$ndk.signer || uploadingImage || uploadingVideo} />
          </label>
          <label
            class="p-1.5 rounded-full hover:bg-accent-gray transition-colors cursor-pointer"
            style="color: var(--color-caption)"
            title="Upload video"
            class:opacity-40={postingReply || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <VideoIcon size={16} />
            <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={postingReply || !$ndk.signer || uploadingImage || uploadingVideo} />
          </label>
          <button
            on:click={() => (showGifPicker = true)}
            class="p-1.5 rounded-full hover:bg-accent-gray transition-colors"
            style="color: var(--color-caption)"
            title="Add GIF"
            disabled={postingReply || !$ndk.signer || uploadingImage || uploadingVideo}
            class:opacity-40={postingReply || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <GifIcon size={16} />
          </button>
          {#if uploadingImage}
            <span class="text-xs text-caption">Uploading image...</span>
          {:else if uploadingVideo}
            <span class="text-xs text-caption">Uploading video...</span>
          {/if}
          <Button
            on:click={postReply}
            disabled={(!replyText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) || postingReply || !$ndk.signer || uploadingImage || uploadingVideo}
            class="px-4 py-2 text-sm"
          >
            {postingReply ? 'Posting...' : $ndk.signer ? 'Post Reply' : 'Log in to reply'}
          </Button>
        </div>
      </div>

      <!-- Replies List -->
      <div class="replies-list">
        {#if loading}
          <div class="py-2 text-sm text-caption">Loading replies...</div>
        {:else if replies.length === 0}
          <div class="text-center py-2 text-xs text-caption">No replies yet</div>
        {:else}
          {#each replies as reply}
            {#if !$mutedPubkeys.has(reply.pubkey)}
              <div class="reply-row">
                <div class="reply-avatar">
                  <Avatar className="flex-shrink-0" pubkey={reply.pubkey} size={24} />
                </div>
                <div class="reply-content">
                  <div class="reply-header">
                    <span class="reply-author">
                      <CustomName pubkey={reply.pubkey} />
                    </span>
                    <span class="reply-time">
                      {formatDate(new Date((reply.created_at || 0) * 1000))}
                    </span>
                  </div>
                  <div class="reply-body">
                    <NoteContent content={reply.content} />
                  </div>
                  <!-- Reply Actions -->
                  <div class="flex items-center gap-2">
                    <CommentLikes event={reply} />
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<GifPicker
  bind:open={showGifPicker}
  on:select={(e) => {
    uploadedImages = [...uploadedImages, e.detail.url];
  }}
/>

<style>
  /* Replies list container */
  .replies-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Reply row - 2 column flex layout */
  .reply-row {
    display: flex;
    gap: 0.5rem;
  }

  /* Avatar gutter - fixed width, never shrinks */
  .reply-avatar {
    flex: 0 0 auto;
    width: 24px;
  }

  /* Content column - takes remaining width, CAN shrink */
  .reply-content {
    flex: 1 1 0%;
    min-width: 0; /* Critical: allows content to shrink below intrinsic width */
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Name + Time header - wraps naturally on mobile */
  .reply-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .reply-author {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .reply-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Reply body text */
  .reply-body {
    font-size: 0.875rem;
    line-height: 1.625;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .reply-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .reply-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }
</style>
