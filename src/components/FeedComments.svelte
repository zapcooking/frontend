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

  export let event: NDKEvent;
  let events: NDKEvent[] = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;
  let showComments = false;
  let commentComposerEl: HTMLDivElement;
  let lastRenderedComment = '';
  let feedCommentSubscription: any = null;

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
    if (feedCommentSubscription) {
      feedCommentSubscription.stop();
    }
  });

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed && showComments) {
    subscribed = true;

    const filter = createCommentFilter(event);
    feedCommentSubscription = $ndk.subscribe(filter, { closeOnEose: false });

    feedCommentSubscription.on('event', (e) => {
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

  async function postComment() {
    if (!commentText.trim()) return;

    try {
      if (commentComposerEl) {
        commentText = mentionCtrl.extractText();
        lastRenderedComment = commentText;
      }

      const ev = new NDKEvent($ndk);

      // Check if replying to a recipe (kind 30023)
      // Recipe replies should be kind 1111, not kind 1
      const isRecipe = event.kind === 30023;
      ev.kind = isRecipe ? 1111 : 1;

      const commentContent = mentionCtrl.replacePlainMentions(commentText);
      ev.content = commentContent;

      // Use shared utility to build NIP-22 or NIP-10 tags
      ev.tags = buildNip22CommentTags({
        kind: event.kind,
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

      await ev.publish();
      commentText = '';
      lastRenderedComment = '';
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
          <div class="flex justify-end">
            <Button on:click={postComment} disabled={!commentText.trim()} class="text-sm px-4 py-2">
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
</style>
