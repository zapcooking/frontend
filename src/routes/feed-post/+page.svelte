<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Button from '../../components/Button.svelte';
  import { nip19 } from 'nostr-tools';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { addClientTagToEvent } from '$lib/nip89';
  import { getAuthManager } from '$lib/authManager';

  let content = '';
  let posting = false;
  let success = false;
  let error = '';

  // Auto-focus the textarea on mount
  onMount(() => {
    const textarea = document.getElementById('feed-content');
    if (textarea) {
      textarea.focus();
    }
  });

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
      // Ensure NIP-46 signer is ready if using remote signer
      const authManager = getAuthManager();
      if (authManager) {
        await authManager.ensureNip46SignerReady();
      }

      // Create a note event
      const event = new NDKEvent($ndk);
      event.kind = 1;
      event.content = content.trim();
      event.tags = [];

      // Add NIP-89 client tag
      addClientTagToEvent(event);

      // Publish the event with timeout
      const publishPromise = event.publish();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Publishing timeout - signer may not be responding')), 30000);
      });
      
      const publishedEvent = await Promise.race([publishPromise, timeoutPromise]);
      
      if (publishedEvent) {
        success = true;
        content = '';
        
        // Redirect to feed after a short delay
        setTimeout(() => {
          goto('/feed');
        }, 1500);
      } else {
        error = 'Failed to publish note';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = err instanceof Error ? err.message : 'Failed to post. Please try again.';
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
</script>

<svelte:head>
  <title>Post to Feed - zap.cooking</title>
  <meta name="description" content="Share your thoughts with the zap.cooking community" />
</svelte:head>

<div class="container mx-auto px-4 max-w-2xl py-8">
  <div class="mb-6">
    <h1 class="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-2">Share with the Community</h1>
  <p class="text-sm sm:text-base text-[var(--color-text-secondary)]">Post your thoughts, cooking tips, or food discoveries to the zap.cooking feed</p>
  </div>

  {#if success}
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
      <div class="flex items-center">
        <div class="text-green-600 text-sm font-medium">
          ✅ Posted successfully! Redirecting to feed...
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
      <div class="flex items-center">
        <div class="text-[var(--color-danger)] text-sm font-medium">
          ❌ {error}
        </div>
      </div>
    </div>
  {/if}

  <div class="bg-[var(--color-light-bg-primary,#fff)] rounded-lg border border-[var(--color-input-border)] p-6">
    <div class="mb-4">
      <label for="feed-content" class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
        What's on your mind?
      </label>
      <textarea
        id="feed-content"
        bind:value={content}
        placeholder="Share your cooking thoughts, tips, or discoveries with the community..."
        class="w-full h-32 px-3 py-2 border border-[var(--color-input-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent resize-none"
        disabled={posting}
        on:keydown={handleKeydown}
      ></textarea>
      <div class="mt-2 text-xs text-[var(--color-caption)]">
        Press Cmd+Enter (Mac) or Ctrl+Enter (Windows) to post
      </div>
    </div>

    <div class="flex items-center justify-end">
      <div class="flex gap-3">
        <Button
          on:click={() => goto('/feed')}
          class="px-4 py-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </Button>
        
        <Button
          on:click={postToFeed}
          disabled={posting || !content.trim()}
          class="px-6 py-2 bg-gradient-to-r from-action to-action hover:from-action-hover hover:to-action-hover text-on-action font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if posting}
            Posting...
          {:else}
            Post to Feed ⚡
          {/if}
        </Button>
      </div>
    </div>
  </div>

  <div class="mt-6 text-sm text-[var(--color-caption)]">
    <p class="mb-2"><strong>Tips for great posts:</strong></p>
    <ul class="list-disc list-inside space-y-1">
      <li>Share cooking tips, techniques, or discoveries</li>
      <li>Ask questions about ingredients or methods</li>
      <li>Share photos of your cooking adventures</li>
      <li>Recommend restaurants or food products</li>
      <li>Discuss food culture and traditions</li>
    </ul>
  </div>
</div>
