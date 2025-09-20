<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { onMount } from 'svelte';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createAuthManager } from '$lib/authManager';

  export let open = false;
  export let tags: string[][] = [['t', 'zapcooking']];

  let authManager = createAuthManager($ndk);
  let content = '';
  let posting = false;
  let success = false;
  let error = '';

  // Auto-focus the textarea when modal opens
  $: if (open) {
    setTimeout(() => {
      const textarea = document.getElementById('anonymous-post-content');
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }

  async function postAnonymously() {
    if (!content.trim()) {
      error = 'Please enter some content';
      return;
    }

    posting = true;
    error = '';

    try {
      await authManager.postAnonymously(content.trim(), tags);
      success = true;
      content = '';
      
      // Close modal after a short delay
      setTimeout(() => {
        open = false;
        success = false;
      }, 1500);
    } catch (err) {
      console.error('Error posting anonymously:', err);
      error = 'Failed to post. Please try again.';
    } finally {
      posting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      postAnonymously();
    }
  }

  function closeModal() {
    open = false;
    content = '';
    error = '';
    success = false;
    posting = false;
  }
</script>

<Modal bind:open>
  <svelte:fragment slot="title">
    {#if success}
      ✅ Posted Successfully!
    {:else}
      Post Anonymously
    {/if}
  </svelte:fragment>

  {#if success}
    <div class="text-center py-4">
      <p class="text-green-600 mb-4">Your anonymous post has been published!</p>
      <p class="text-sm text-gray-600">
        This post was created with a temporary key and cannot be traced back to you.
      </p>
    </div>
  {:else}
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
        <div class="text-sm text-blue-800">
          <strong>Anonymous Posting</strong><br/>
          This post will be published with a temporary key that cannot be traced back to you.
          The key is generated fresh for each post and not stored.
        </div>
      </div>

      <textarea
        id="anonymous-post-content"
        bind:value={content}
        placeholder="Share your thoughts anonymously..."
        rows="4"
        class="w-full p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        disabled={posting}
        on:keydown={handleKeydown}
      ></textarea>

      {#if error}
        <div class="text-red-500 text-sm">{error}</div>
      {/if}

      <div class="flex gap-2 justify-end">
        <Button on:click={closeModal} primary={false} disabled={posting}>
          Cancel
        </Button>
        <Button on:click={postAnonymously} primary={true} disabled={posting || !content.trim()}>
          {posting ? 'Posting...' : 'Post Anonymously'}
        </Button>
      </div>

      <div class="text-xs text-gray-500 text-center">
        Press Ctrl+Enter (or Cmd+Enter on Mac) to post
      </div>
    </div>
  {/if}
</Modal>
