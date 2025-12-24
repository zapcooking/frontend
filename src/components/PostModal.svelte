<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { addClientTagToEvent } from '$lib/nip89';

  export let open = false;

  let content = '';
  let posting = false;
  let success = false;
  let error = '';

  // Auto-focus the textarea when modal opens
  $: if (open) {
    setTimeout(() => {
      const textarea = document.getElementById('post-content');
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }

  async function postToFeed() {
    if (!content.trim()) {
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
      // Create a note event with #zapcooking tag
      const event = new NDKEvent($ndk);
      event.kind = 1;
      event.content = content.trim();
      event.tags = [['t', 'zapcooking']];
      
      // Add NIP-89 client tag
      addClientTagToEvent(event);

      // Publish the event
      const publishedEvent = await event.publish();
      
      if (publishedEvent) {
        success = true;
        content = '';
        
        // Close modal after a short delay
        setTimeout(() => {
          open = false;
          success = false;
        }, 1500);
      } else {
        error = 'Failed to publish note';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = 'Failed to post. Please try again.';
    } finally {
      posting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      postToFeed();
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
    <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">Post to Feed</h2>
  </svelte:fragment>

  {#if success}
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
      <div class="text-green-600 text-sm font-medium">
        ✅ Posted successfully!
      </div>
    </div>
  {/if}

  {#if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div class="text-red-600 text-sm font-medium">
        ❌ {error}
      </div>
    </div>
  {/if}

  <div class="space-y-4">
    <div>
      <textarea
        id="post-content"
        bind:value={content}
        placeholder="What's on your mind?"
        class="w-full h-32 px-3 py-2 input rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent resize-none"
        disabled={posting}
        on:keydown={handleKeydown}
      ></textarea>
    </div>

    <div class="flex items-center justify-between">
      <div class="text-sm text-caption">
        <span class="font-medium text-yellow-600">#zapcooking</span>
      </div>

      <div class="flex gap-3">
        <Button
          on:click={closeModal}
          class="px-4 py-2 text-caption hover:opacity-80"
        >
          Cancel
        </Button>
        
        <Button
          on:click={postToFeed}
          disabled={posting || !content.trim()}
          class="px-6 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if posting}
            Posting...
          {:else}
            Post 👨‍🍳
          {/if}
        </Button>
      </div>
    </div>
  </div>
</Modal>
