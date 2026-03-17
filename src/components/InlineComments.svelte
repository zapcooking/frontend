<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import CommentWithActions from './CommentWithActions.svelte';
  import { createCommentFilter } from '$lib/commentFilters';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifPicker from './GifPicker.svelte';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import PollCreator from './PollCreator.svelte';
  import { buildPollTags, type PollConfig } from '$lib/polls';
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';

  export let event: NDKEvent;

  let showComments = false;
  let comments: NDKEvent[] = [];
  let loading = false;
  let commentText = '';
  let postingComment = false;
  let commentCount = 0;
  let errorMessage = '';
  let successMessage = '';
  let commentSubscription: any = null;
  let showGifPicker = false;
  let showPollCreator = false;
  let pollConfig: PollConfig | null = null;
  let uploadedImages: string[] = [];
  let uploadedVideos: string[] = [];
  let uploadingImage = false;
  let uploadingVideo = false;
  let imageInputEl: HTMLInputElement;
  let videoInputEl: HTMLInputElement;

  // Load comments for this event
  async function loadComments() {
    if (loading) return;
    
    loading = true;
    comments = [];
    commentCount = 0;
    
    // Close previous subscription if exists
    if (commentSubscription) {
      commentSubscription.stop();
    }
    
    try {
      const filter = createCommentFilter(event);
      commentSubscription = $ndk.subscribe(filter, { closeOnEose: true });
      
      commentSubscription.on("event", (ev: NDKEvent) => {
        loading = false;
        comments.push(ev);
        comments = comments;
      });
      
      commentSubscription.on("eose", () => {
        loading = false;
      });

    } catch (error) {
      console.error('Error loading comments:', error);
      loading = false;
    }
  }

  onDestroy(() => {
    if (commentSubscription) {
      commentSubscription.stop();
    }
  });

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

  // Post a new comment
  async function postComment() {
    if ((!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig) || postingComment) return;
    
    // Check if user is authenticated
    if (!$ndk.signer) {
      errorMessage = 'Please log in to post comments';
      setTimeout(() => errorMessage = '', 3000);
      return;
    }
    
    // Ensure NDK is connected
    try {
      await $ndk.connect();
      console.log('NDK connected successfully');
    } catch (connectError) {
      console.error('Failed to connect NDK:', connectError);
      errorMessage = 'Failed to connect to relays. Please try again.';
      setTimeout(() => errorMessage = '', 5000);
      postingComment = false;
      return;
    }
    
    postingComment = true;
    errorMessage = '';
    successMessage = '';
    
    console.log('Starting comment post process...');
    console.log('Comment text:', commentText.trim());
    console.log('Event ID:', event.id);
    console.log('Event pubkey:', event.pubkey);
    
    try {
      const commentEvent = new NDKEvent($ndk);
      
      // Check if replying to a recipe (kind 30023)
      // Recipe replies should be kind 1111, not kind 1
      const isRecipe = event.kind === 30023;
      commentEvent.kind = pollConfig ? 1068 : (isRecipe ? 1111 : 1);
      
      let commentContent = commentText.trim();
      const mediaUrls = [...uploadedImages, ...uploadedVideos];
      if (mediaUrls.length > 0) {
        const mediaText = mediaUrls.join('\n');
        commentContent = commentContent ? `${commentContent}\n\n${mediaText}` : mediaText;
      }
      commentEvent.content = commentContent;
      
      // Use shared utility to build NIP-22 or NIP-10 tags
      commentEvent.tags = buildNip22CommentTags({
        kind: event.kind ?? 1,
        pubkey: event.pubkey,
        id: event.id,
        tags: event.tags as string[][]
      });
      
      // Add NIP-89 client tag
      addClientTagToEvent(commentEvent);

      if (pollConfig) {
        commentEvent.tags.push(...buildPollTags(pollConfig));
      }

      console.log('Created comment event:', commentEvent);
      console.log('Comment event tags:', commentEvent.tags);
      
      // Debug NDK state before publishing
      console.log('NDK state:', {
        signer: !!$ndk.signer,
        signerType: $ndk.signer?.constructor.name
      });
      
      // Try a simple publish with detailed logging
      console.log('Attempting simple publish...');
      
      // Ensure the event is signed first
      await commentEvent.sign();
      console.log('Event signed successfully');
      
      // Try publishing with a reasonable timeout
      const publishPromise = commentEvent.publish();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Publish timeout after 8 seconds')), 8000)
      );
      
      try {
        await Promise.race([publishPromise, timeoutPromise]);
        console.log('Comment published successfully');
      } catch (publishError) {
        console.error('Publish failed:', publishError);
        
        // If it's a timeout, try one more time with a different approach
        if (publishError instanceof Error && publishError.message.includes('timeout')) {
          console.log('Publish timed out, trying alternative approach...');
          
          // Try creating a new event and publishing it
          const newCommentEvent = new NDKEvent($ndk);
          const isRecipe = event.kind === 30023;
          newCommentEvent.kind = pollConfig ? 1068 : (isRecipe ? 1111 : 1);
          newCommentEvent.content = commentText.trim();

          // Use shared utility to build NIP-22 or NIP-10 tags
          newCommentEvent.tags = buildNip22CommentTags({
            kind: event.kind ?? 1,
            pubkey: event.pubkey,
            id: event.id,
            tags: event.tags as string[][]
          });

          // Add NIP-89 client tag
          addClientTagToEvent(newCommentEvent);

          if (pollConfig) {
            newCommentEvent.tags.push(...buildPollTags(pollConfig));
          }
          
          await newCommentEvent.sign();
          console.log('New event signed, attempting publish...');
          
          const newPublishPromise = newCommentEvent.publish();
          const newTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('New event publish timeout after 5 seconds')), 5000)
          );
          
          await Promise.race([newPublishPromise, newTimeoutPromise]);
          console.log('New event published successfully');
        } else {
          throw publishError;
        }
      }
      
      console.log('Comment published successfully');
      successMessage = 'Comment posted successfully!';
      setTimeout(() => successMessage = '', 3000);
      
      // Clear the comment text and media
      commentText = '';
      uploadedImages = [];
      uploadedVideos = [];
      pollConfig = null;

      // Reload comments to show the new one
      console.log('Reloading comments...');
      loadComments();
      
    } catch (error) {
      console.error('Error posting comment:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined
      });
      
      errorMessage = 'Error posting comment: ' + (error instanceof Error ? error.message : String(error));
      setTimeout(() => errorMessage = '', 5000);
    } finally {
      console.log('Comment posting process finished, setting postingComment to false');
      postingComment = false;
    }
  }

  // Toggle comments visibility
  function toggleComments() {
    showComments = !showComments;
    if (showComments && comments.length === 0) {
      loadComments();
    }
  }

  // Initialize comment count
  onMount(() => {
    loadComments();
    
    // Listen for custom toggle event from the center comment button
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
</script>

<div class="mt-3 inline-comments" data-event-id={event.id}>

  <!-- Comments Section -->
  {#if showComments}
    <div class="mt-3 space-y-3 border-t border-gray-100 pt-3 comments-section" data-event-id={event.id}>
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          <strong>Please log in</strong> to post comments. Use the login button in the navigation.
        </div>
      {/if}
      
      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          {errorMessage}
        </div>
      {/if}
      
      {#if successMessage}
        <div class="text-sm text-green-600 bg-green-50 p-3 rounded-lg">
          {successMessage}
        </div>
      {/if}
      
      <!-- Comment Form -->
      <div class="space-y-2">
        <textarea
          bind:value={commentText}
          placeholder={$ndk.signer ? "Add a comment..." : "Log in to comment..."}
          disabled={!$ndk.signer}
          class="w-full p-3 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          rows="2"
        />

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
            class:opacity-40={postingComment || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <ImageIcon size={16} />
            <input bind:this={imageInputEl} type="file" accept="image/*" class="sr-only" on:change={handleImageUpload} disabled={postingComment || !$ndk.signer || uploadingImage || uploadingVideo} />
          </label>
          <label
            class="p-1.5 rounded-full hover:bg-accent-gray transition-colors cursor-pointer"
            style="color: var(--color-caption)"
            title="Upload video"
            class:opacity-40={postingComment || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <VideoIcon size={16} />
            <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={postingComment || !$ndk.signer || uploadingImage || uploadingVideo} />
          </label>
          <button
            on:click={() => (showGifPicker = true)}
            class="p-1.5 rounded-full hover:bg-accent-gray transition-colors"
            style="color: var(--color-caption)"
            title="Add GIF"
            disabled={postingComment || !$ndk.signer || uploadingImage || uploadingVideo}
            class:opacity-40={postingComment || !$ndk.signer || uploadingImage || uploadingVideo}
          >
            <GifIcon size={16} />
          </button>
          <button
            on:click={() => (showPollCreator = true)}
            class="btn-gif"
            title="Create poll"
            disabled={postingComment}
            class:opacity-50={postingComment}
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
          <Button
            on:click={postComment}
            disabled={(!commentText.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0 && !pollConfig) || postingComment || !$ndk.signer || uploadingImage || uploadingVideo}
            class="px-4 py-2 text-sm"
          >
            {postingComment ? 'Posting...' : ($ndk.signer ? 'Post Comment' : 'Log in to comment')}
          </Button>
        </div>
      </div>

      <!-- Comments List -->
      <div class="space-y-3">
        {#if loading}
          <div class="text-center py-4 text-sm text-gray-500">Loading comments...</div>
        {:else if comments.length === 0}
          <div class="text-center py-4 text-sm text-gray-500">No comments yet</div>
        {:else}
          {#each comments as comment}
            <CommentWithActions event={comment} />
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

<PollCreator
  bind:open={showPollCreator}
  on:create={(e) => {
    pollConfig = e.detail;
  }}
/>
