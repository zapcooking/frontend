<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import Comment from './Comment.svelte';
  import { onDestroy } from 'svelte';
  import { createCommentFilter } from '$lib/commentFilters';
  import { get } from 'svelte/store';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';

  export let event: NDKEvent;
  let events = [];
  let commentText = '';
  let commentComposerEl: HTMLDivElement;
  let lastRenderedComment = '';
  let processedEvents = new Set();
  let subscribed = false;
  let commentSubscription: any = null;

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

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed) {
    subscribed = true;

    const filter = createCommentFilter(event);
    commentSubscription = $ndk.subscribe(filter, { closeOnEose: false });

    commentSubscription.on('event', (e) => {
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    commentSubscription.on('eose', () => {
      // End of stored events
    });
  }

  onDestroy(() => {
    mentionCtrl.destroy();
    if (commentSubscription) {
      commentSubscription.stop();
    }
  });

  // Dummy refresh function for Comment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function postComment() {
    if (!commentText.trim()) {
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

    const ev = new NDKEvent($ndk);
    // Recipe replies should be kind 1111, not kind 1
    const isRecipe = event.kind === 30023;
    ev.kind = isRecipe ? 1111 : 1;
    const commentContent = mentionCtrl.replacePlainMentions(commentText.trim());
    ev.content = commentContent;

    // Use shared utility to build NIP-22 or NIP-10 tags
    ev.tags = buildNip22CommentTags({
      kind: event.kind,
      pubkey: event.author?.pubkey || event.pubkey,
      id: event.id,
      tags: event.tags
    });

    // Parse and add @ mention tags (p tags)
    const mentions = mentionCtrl.parseMentions(commentContent);
    for (const pubkey of mentions.values()) {
      if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
        ev.tags.push(['p', pubkey]);
      }
    }
    // Add NIP-89 client tag
    addClientTagToEvent(ev);

    try {
      // Ensure created_at is set before signing
      if (!ev.created_at) {
        ev.created_at = Math.floor(Date.now() / 1000);
      }

      // Sign the event - NIP-07 extension should prompt user
      // Don't timeout signing - let the extension handle it naturally
      // Users may need time to approve in their extension
      await ev.sign();

      if (!ev.id) {
        throw new Error('Event was not signed - no ID generated');
      }

      // Publish the event with a reasonable timeout
      await Promise.race([
        ev.publish(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Publishing timeout after 30 seconds')), 30000)
        )
      ]);

      // Immediately add to local events array so it appears right away
      if (!processedEvents.has(ev.id)) {
        processedEvents.add(ev.id);
        events.push(ev);
        events = events; // Trigger reactivity
      }

      // Clear the comment text
      commentText = '';
      lastRenderedComment = '';
      if (commentComposerEl) {
        commentComposerEl.innerHTML = '';
      }
      mentionCtrl.resetMentionState();
    } catch (error) {
      console.error('Error posting comment:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert('Error posting comment: ' + errorMsg);
    }
  }

  // Sort all comments chronologically (oldest first)
  $: sortedComments = [...events].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List - flat with embedded parent quotes -->
  <div class="comments-list">
    {#if sortedComments.length === 0}
      <p class="text-caption">No comments yet. Be the first to comment!</p>
    {:else}
      {#each sortedComments as comment (comment.id)}
        <Comment event={comment} allReplies={events} {refresh} />
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
      <Button
        on:click={(e) => {
          e.preventDefault?.();
          postComment();
        }}
        disabled={!commentText.trim()}
      >
        Post Comment
      </Button>
    {:else}
      <p class="text-sm text-caption">Sign in to comment.</p>
      <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
    {/if}
  </div>
</div>

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
</style>
