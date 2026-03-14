<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import { mutedPubkeys } from '$lib/muteListStore';
  import CustomAvatar from './CustomAvatar.svelte';
  import NoteContent from './NoteContent.svelte';
  import ZapModal from './ZapModal.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { formatAmount } from '$lib/utils';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { decode } from '@gandlaf21/bolt11-decode';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifPicker from './GifPicker.svelte';
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';

  export let event: NDKEvent;
  export let allComments: NDKEvent[] = []; // All comments for finding parent
  export let refresh: () => void;
  export let mainEventId: string;

  // Display state
  let displayName = '';
  let isLoading = true;

  // Parent comment state (for embedded quote)
  let parentComment: NDKEvent | null = null;
  let parentDisplayName = '';
  let parentLoading = true;

  // Reply box state
  let showReplyBox = false;
  let showGifPicker = false;
  let replyText = '';
  let postingReply = false;
  let replyComposerEl: HTMLDivElement;
  let lastRenderedReply = '';
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
      replyText = text;
      lastRenderedReply = text;
    }
  );

  $: mentionCtrl.setComposerEl(replyComposerEl);

  $: if (replyComposerEl && replyText !== lastRenderedReply) {
    mentionCtrl.syncContent(replyText);
    lastRenderedReply = replyText;
  }

  // Like state
  let liked = false;
  let likeCount = 0;
  let likesLoading = true;
  let processedLikes = new Set();
  let likeSubscription: any = null;

  // Zap state
  let zapModalOpen = false;
  let totalZapAmount = 0;
  let hasUserZapped = false;
  let processedZaps = new Set<string>();
  let zapSubscription: any = null;

  // Find parent comment ID (if replying to a comment, not the main post)
  function getParentCommentId(): string | null {
    const eTags = event.getMatchingTags('e');
    // Look for a 'reply' tag that points to something other than mainEventId
    const replyTag = eTags.find((tag) => tag[3] === 'reply' && tag[1] !== mainEventId);
    if (replyTag) return replyTag[1];

    // If no explicit reply tag, check if there are multiple e tags
    // The last one (before root) might be the parent comment
    const nonRootTags = eTags.filter((tag) => tag[3] !== 'root' && tag[1] !== mainEventId);
    if (nonRootTags.length > 0) {
      return nonRootTags[nonRootTags.length - 1][1];
    }

    return null;
  }

  // Load zaps for this comment
  function loadZaps() {
    if (!event?.id || !$ndk) return;

    totalZapAmount = 0;
    processedZaps.clear();
    hasUserZapped = false;

    zapSubscription = $ndk.subscribe({
      kinds: [9735],
      '#e': [event.id]
    });

    zapSubscription.on('event', (zapEvent: NDKEvent) => {
      if (!zapEvent.sig || processedZaps.has(zapEvent.sig)) return;

      const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
      if (!bolt11) return;

      try {
        const decoded = decode(bolt11);
        const amountSection = decoded.sections.find((section: any) => section.name === 'amount');

        if (amountSection && amountSection.value) {
          const amount = Number(amountSection.value);
          if (!isNaN(amount) && amount > 0) {
            totalZapAmount += amount;
            processedZaps.add(zapEvent.sig);

            if (zapEvent.tags.some((tag) => tag[0] === 'P' && tag[1] === $userPublickey)) {
              hasUserZapped = true;
            }
          }
        }
      } catch (error) {
        console.debug('Error decoding bolt11:', error);
      }
    });
  }

  // Load profile and parent comment
  onMount(async () => {
    // Preload follow list for mention autocomplete
    mentionCtrl.preloadFollowList();

    // Load author profile
    if (event.pubkey && $ndk) {
      try {
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        displayName = formatDisplayName(profile);
      } catch (error) {
        displayName = '@Anonymous';
      } finally {
        isLoading = false;
      }
    }

    // Load parent comment if this is a reply to another comment
    const parentId = getParentCommentId();
    if (parentId) {
      // First check in allComments
      parentComment = allComments.find((c) => c.id === parentId) || null;

      // If not found locally, fetch it with timeout
      if (!parentComment && $ndk) {
        try {
          const fetchPromise = $ndk.fetchEvent({
            kinds: [1, 1111] as any,
            ids: [parentId]
          });
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 5000)
          );
          parentComment = await Promise.race([fetchPromise, timeoutPromise]);
        } catch (e) {
          console.debug('Failed to fetch parent comment:', e);
        }
      }

      // Load parent author name (resolveProfileByPubkey already has timeout)
      if (parentComment?.pubkey) {
        try {
          const profile = await resolveProfileByPubkey(parentComment.pubkey, $ndk);
          parentDisplayName = formatDisplayName(profile);
        } catch {
          parentDisplayName = '@Anonymous';
        }
      }
      parentLoading = false;
    } else {
      parentLoading = false;
    }

    // Load likes
    likeSubscription = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id]
    });

    likeSubscription.on('event', (e: NDKEvent) => {
      if (processedLikes.has(e.id)) return;
      processedLikes.add(e.id);
      if (e.pubkey === $userPublickey) liked = true;
      likeCount++;
      likesLoading = false;
    });

    likeSubscription.on('eose', () => {
      likesLoading = false;
    });

    // Load zaps
    loadZaps();
  });

  onDestroy(() => {
    mentionCtrl.destroy();
    if (likeSubscription) {
      likeSubscription.stop();
    }
    if (zapSubscription) {
      zapSubscription.stop();
    }
  });

  // Like comment
  async function toggleLike() {
    if (liked || !$userPublickey) return;

    try {
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7;
      reactionEvent.content = '+';
      reactionEvent.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];
      addClientTagToEvent(reactionEvent);
      await reactionEvent.publish();
      liked = true;
      likeCount++;
    } catch {
      // Failed to like
    }
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

  // Post reply
  async function postReply() {
    if ((!replyText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) || postingReply) return;

    postingReply = true;
    try {
      if (replyComposerEl) {
        replyText = mentionCtrl.extractText();
        lastRenderedReply = replyText;
      }

      const ev = new NDKEvent($ndk);

      // Check if this is a reply to a recipe comment (kind 1111)
      // If the parent comment is kind 1111, use kind 1111 for nested reply
      const isRecipeReply = event.kind === 1111;
      ev.kind = isRecipeReply ? 1111 : 1;
      let replyContent = mentionCtrl.replacePlainMentions(replyText.trim());
      const mediaUrls = [...uploadedImages, ...uploadedVideos];
      if (mediaUrls.length > 0) {
        const mediaText = mediaUrls.join('\n');
        replyContent = replyContent ? `${replyContent}\n\n${mediaText}` : mediaText;
      }
      ev.content = replyContent;

      // Reconstruct a minimal event object for the parent comment
      const parentEventObj = {
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        tags: event.tags
      };

      // For recipe replies, we need to get the root event info from the parent's tags
      if (isRecipeReply) {
        // Get root event info from parent comment's NIP-22 tags
        const rootATag = event.getMatchingTags('A')[0] || event.getMatchingTags('a')[0];

        if (rootATag) {
          // Parse the address tag to extract root event info
          const [kind, pubkey, ...dTagParts] = rootATag[1].split(':');
          const dTag = dTagParts.join(':');
          // Find the root event's actual ID from the parent's e tags (look for the
          // e tag that references the root, not another comment)
          const rootETag = event.getMatchingTags('E')[0] ||
            event.getMatchingTags('e').find((t) => t[1] && t[1] !== event.id);
          const rootEventObj = {
            kind: parseInt(kind),
            pubkey: pubkey,
            id: rootETag?.[1] || '',
            tags: [
              ['d', dTag],
              ['relay', rootATag[2] || '']
            ]
          };

          // Use the utility with both root and parent event
          ev.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
        } else {
          // Fallback: parent lacks NIP-22 structure — build tags treating
          // the parent as both root and parent (best effort)
          ev.tags = buildNip22CommentTags(
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
        // For non-recipe replies, construct tags for standard note replies
        // Try to derive the root event's pubkey from the parent event's tags.
        // Prefer any 'p'/'P' tag, which typically references the root author.
        const rootPubkeyFromTags = event.tags.find(
          (t) => (t[0] === 'p' || t[0] === 'P') && t[1]
        )?.[1];

        const rootEventObj = {
          kind: 1,
          pubkey: rootPubkeyFromTags || event.pubkey,
          id: mainEventId,
          tags: []
        };
        ev.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
      }

      const mentions = mentionCtrl.parseMentions(replyContent);
      for (const pubkey of mentions.values()) {
        if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          ev.tags.push(['p', pubkey]);
        }
      }

      addClientTagToEvent(ev);
      await ev.publish();
      replyText = '';
      lastRenderedReply = '';
      uploadedImages = [];
      uploadedVideos = [];
      uploadError = '';
      if (replyComposerEl) {
        replyComposerEl.innerHTML = '';
      }
      mentionCtrl.resetMentionState();
      showReplyBox = false;
      refresh();
    } catch {
      // Failed to post reply
    } finally {
      postingReply = false;
    }
  }

  // Open zap modal
  function openZapModal() {
    zapModalOpen = true;
  }

  // Truncate content for parent quote
  function truncateContent(content: string, maxLength: number = 100): string {
    const cleaned = content
      .replace(/https?:\/\/[^\s]+/g, '[link]')
      .replace(/nostr:[^\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength).trim() + '...';
  }
</script>

{#if !$mutedPubkeys.has(event.pubkey)}
  <div class="comment-card">
    <!-- Embedded parent quote (if replying to another comment) -->
    {#if !parentLoading && parentComment}
      <div class="parent-quote">
        <div class="parent-quote-header">
          <CustomAvatar pubkey={parentComment.pubkey} size={16} />
          <span class="parent-quote-author">{parentDisplayName || 'Loading...'}</span>
        </div>
        <p class="parent-quote-content">{truncateContent(parentComment.content)}</p>
      </div>
    {/if}

    <!-- Main comment row -->
    <div class="comment-row">
      <!-- Avatar -->
      <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
        <CustomAvatar className="rounded-full" pubkey={event.pubkey} size={32} />
      </a>

      <!-- Content -->
      <div class="comment-content">
        <!-- Name + Time -->
        <div class="comment-header">
          <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-author">
            {#if isLoading}
              <span class="animate-pulse">Loading...</span>
            {:else}
              {displayName}
            {/if}
          </a>
          <span class="comment-time">
            {formatDate(new Date((event.created_at || 0) * 1000))}
          </span>
        </div>

        <!-- Comment Text -->
        <div class="comment-body">
          <NoteContent content={event.content} />
        </div>

        <!-- Actions -->
        <div class="comment-actions">
          <!-- Like Button -->
          <button
            on:click={toggleLike}
            class="action-btn"
            class:text-red-500={liked}
            disabled={!$userPublickey}
          >
            <HeartIcon size={14} weight={liked ? 'fill' : 'regular'} />
            {#if !likesLoading && likeCount > 0}
              <span>{likeCount}</span>
            {/if}
          </button>

          <!-- Zap Button -->
          {#if $userPublickey}
            <button
              on:click={openZapModal}
              class="action-btn zap-btn"
              class:text-yellow-500={hasUserZapped}
            >
              <LightningIcon size={14} weight={hasUserZapped ? 'fill' : 'regular'} />
              {#if totalZapAmount > 0}
                <span>{formatAmount(totalZapAmount / 1000)}</span>
              {/if}
            </button>
          {:else}
            <span class="action-btn zap-display">
              <LightningIcon size={14} class={totalZapAmount > 0 ? 'text-yellow-500' : ''} />
              {#if totalZapAmount > 0}
                <span>{formatAmount(totalZapAmount / 1000)}</span>
              {/if}
            </span>
          {/if}

          <!-- Reply Button -->
          {#if $userPublickey}
            <button
              on:click={() => {
                showReplyBox = !showReplyBox;
                if (showReplyBox && $userPublickey) {
                  mentionCtrl.preloadFollowList();
                }
              }}
              class="action-btn action-btn-text"
            >
              {showReplyBox ? 'Cancel' : 'Reply'}
            </button>
          {/if}
        </div>

        <!-- Inline Reply Box -->
        {#if showReplyBox}
          <div class="reply-form">
            <div class="relative">
              <div
                bind:this={replyComposerEl}
                class="reply-input"
                contenteditable={!postingReply}
                role="textbox"
                tabindex="0"
                aria-multiline="true"
                data-placeholder="Add a reply..."
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

            <div class="reply-buttons">
              <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo || postingReply} title="Upload image">
                <ImageIcon size={16} />
                <input bind:this={imageInputEl} type="file" accept="image/*" class="sr-only" on:change={handleImageUpload} disabled={postingReply || uploadingImage || uploadingVideo} />
              </label>
              <label class="btn-media" class:opacity-50={uploadingImage || uploadingVideo || postingReply} title="Upload video">
                <VideoIcon size={16} />
                <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={postingReply || uploadingImage || uploadingVideo} />
              </label>
              <button
                on:click={() => (showGifPicker = true)}
                class="btn-gif"
                title="Add GIF"
                disabled={postingReply || uploadingImage || uploadingVideo}
              >
                <GifIcon size={16} />
              </button>
              {#if uploadingImage}
                <span class="text-xs text-caption">Uploading image...</span>
              {:else if uploadingVideo}
                <span class="text-xs text-caption">Uploading video...</span>
              {/if}
              <button
                on:click={postReply}
                disabled={(!replyText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) || postingReply || uploadingImage || uploadingVideo}
                class="btn-post"
              >
                {postingReply ? 'Posting...' : 'Post'}
              </button>
              <button
                on:click={() => {
                  showReplyBox = false;
                  replyText = '';
                  lastRenderedReply = '';
                  uploadedImages = [];
                  uploadedVideos = [];
                  uploadError = '';
                  if (replyComposerEl) {
                    replyComposerEl.innerHTML = '';
                  }
                  mentionCtrl.resetMentionState();
                }}
                class="btn-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Zap Modal -->
  {#if zapModalOpen}
    <ZapModal bind:open={zapModalOpen} {event} />
  {/if}
{/if}

<GifPicker
  bind:open={showGifPicker}
  on:select={(e) => {
    uploadedImages = [...uploadedImages, e.detail.url];
  }}
/>

<style>
  /* Comment card - full width, no nesting */
  .comment-card {
    width: 100%;
  }

  /* Parent quote embed */
  .parent-quote {
    margin-bottom: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-input);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
  }

  .parent-quote-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .parent-quote-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .parent-quote-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Comment row - 2 column flex layout */
  .comment-row {
    display: flex;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .comment-row {
      gap: 0.75rem;
    }
  }

  /* Avatar - fixed width */
  .comment-avatar {
    flex: 0 0 auto;
    width: 32px;
  }

  /* Content - takes remaining width */
  .comment-content {
    flex: 1 1 0%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Header - wraps on mobile */
  .comment-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .comment-author {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Body text */
  .comment-body {
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Actions */
  .comment-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.75rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-primary);
    transition: color 0.15s;
  }

  .action-btn:hover {
    color: var(--color-primary);
  }

  .action-btn-text {
    font-weight: 500;
  }

  .zap-btn:hover {
    color: #eab308; /* yellow-500 */
  }

  .zap-display {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-secondary);
  }

  /* Reply form */
  .reply-form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .reply-input {
    width: 100%;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .reply-input:focus {
    outline: none;
    ring: 2px;
    ring-color: var(--color-primary);
  }

  .reply-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  .reply-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .btn-post {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: white;
    background: var(--color-primary);
    border-radius: 0.5rem;
  }

  .btn-post:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-primary);
    background: var(--color-input);
    border-radius: 0.5rem;
  }

  .btn-cancel:hover {
    opacity: 0.8;
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

  .btn-gif:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
