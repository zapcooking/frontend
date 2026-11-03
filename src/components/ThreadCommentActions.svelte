<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { goto } from '$app/navigation';
  import { eventPath } from '$lib/utils/eventUrl';
  import { formatAmount } from '$lib/utils';
  import { getEngagementStore, fetchEngagement, loadOwnReactions } from '$lib/engagementCache';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import { requireAuth } from '$lib/auth/requireAuth';
  import EmojiReactionPicker from './Reactions/EmojiReactionPicker.svelte';
  import FullEmojiPicker from './Reactions/FullEmojiPicker.svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import ZapModal from './ZapModal.svelte';

  export let event: NDKEvent;
  export let compact: boolean = false;
  export let showReplyButton: boolean = true;

  const dispatch = createEventDispatcher();

  const store = getEngagementStore(event.id);

  // Reaction state
  let reactionButtonEl: HTMLButtonElement;
  let showPicker = false;
  let showFullPicker = false;

  // Zap state
  let zapModalOpen = false;

  onMount(() => {
    fetchEngagement($ndk, event, $userPublickey);
  });

  $: hasUserReacted = $store.reactions.userReactions.size > 0;
  $: userEmoji = hasUserReacted ? Array.from($store.reactions.userReactions)[0] : null;

  async function handleReactionClick() {
    if (!canPublishReaction($ndk, $userPublickey)) {
      if (!(await requireAuth({ kind: 'react', reason: 'Sign in to react' }))) return;
      // The new account's own reactions weren't loaded while signed out;
      // wait for them so the picker can't double-publish one it already has.
      await loadOwnReactions($ndk, event.id, $userPublickey);
      showPicker = true;
      return;
    }
    showPicker = !showPicker;
  }

  async function handleReaction(emoji: string) {
    showPicker = false;
    showFullPicker = false;

    // The picker only opens signed in (handleClick); a session that ended
    // since then signs in again and the member picks once more.
    if (!canPublishReaction($ndk, $userPublickey)) {
      await requireAuth({ kind: 'react', reason: 'Sign in to react' });
      return;
    }

    const wasReacted = $store.reactions.userReactions.has(emoji);

    if (!wasReacted) {
      // Optimistic update
      store.update((s) => {
        const updated = { ...s };
        updated.reactions.userReactions.add(emoji);
        updated.reactions.count++;
        updated.reactions.userReacted = true;

        const existingGroup = updated.reactions.groups.find((g) => g.emoji === emoji);
        if (existingGroup) {
          existingGroup.count++;
          existingGroup.userReacted = true;
        } else {
          updated.reactions.groups = [
            { emoji, count: 1, userReacted: true },
            ...updated.reactions.groups
          ];
        }

        return updated;
      });

      const result = await publishReaction({
        ndk: $ndk,
        targetEvent: event,
        emoji,
        targetType: 'note'
      });

      if (!result?.id) {
        // Revert on failure
        store.update((s) => {
          const updated = { ...s };
          updated.reactions.userReactions.delete(emoji);
          updated.reactions.count--;

          const group = updated.reactions.groups.find((g) => g.emoji === emoji);
          if (group) {
            group.count--;
            group.userReacted = false;
            if (group.count === 0) {
              updated.reactions.groups = updated.reactions.groups.filter((g) => g.emoji !== emoji);
            }
          }

          updated.reactions.userReacted = updated.reactions.userReactions.size > 0;
          return updated;
        });
      }
    }
  }

  function openZapModal() {
    // Signed out, the zap sheet itself offers sign-in or an anonymous zap.
    zapModalOpen = true;
  }

  function handleReplyClick() {
    // Navigate to the note's thread page
    goto(eventPath(event));
  }
</script>

<div class="thread-actions" class:compact>
  <!-- Reaction Button -->
  <button
    bind:this={reactionButtonEl}
    type="button"
    class="action-btn"
    on:click={handleReactionClick}
    title="Add reaction"
  >
    {#if hasUserReacted && userEmoji}
      <span class="emoji">{userEmoji}</span>
    {:else}
      <HeartIcon size={compact ? 16 : 18} weight="regular" class="icon" />
    {/if}
    <span class="count">
      {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.reactions.count}{/if}
    </span>
  </button>

  <!-- Zap Button -->
  <button type="button" class="action-btn" on:click={openZapModal} title="Send zap">
    <LightningIcon
      size={compact ? 16 : 18}
      weight={$store.zaps.userZapped ? 'fill' : 'regular'}
      class="icon {$store.zaps.totalAmount > 0 ? 'text-yellow-500' : ''}"
    />
    <span class="count">
      {#if $store.loading}<span class="opacity-0">0</span>{:else}{formatAmount(
          $store.zaps.totalAmount / 1000
        )}{/if}
    </span>
  </button>

  <!-- Reply Button -->
  {#if showReplyButton}
    <button type="button" class="action-btn" on:click={handleReplyClick} title="Reply to this note">
      <ChatCircleIcon size={compact ? 16 : 18} weight="regular" class="icon" />
      <span class="count">
        {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.comments.count}{/if}
      </span>
    </button>
  {/if}
</div>

<!-- Quick picker -->
{#if showPicker}
  <EmojiReactionPicker
    anchorEl={reactionButtonEl}
    userReactions={$store.reactions.userReactions}
    on:select={(e) => handleReaction(e.detail.emoji)}
    on:openFullPicker={() => {
      showPicker = false;
      showFullPicker = true;
    }}
    on:close={() => (showPicker = false)}
  />
{/if}

<!-- Full picker -->
<FullEmojiPicker
  open={showFullPicker}
  anchorEl={reactionButtonEl}
  on:select={(e) => handleReaction(e.detail.emoji)}
  on:close={() => (showFullPicker = false)}
/>

<!-- Zap Modal -->
{#if zapModalOpen}
  <ZapModal bind:open={zapModalOpen} {event} />
{/if}

<style>
  .thread-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .thread-actions.compact {
    gap: 0.5rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
    transition:
      background-color 0.15s,
      color 0.15s;
    cursor: pointer;
    color: var(--color-caption);
  }

  .action-btn:hover {
    background-color: var(--color-light-input-bg, var(--color-input));
    color: var(--color-text-primary);
  }

  .compact .action-btn {
    padding: 0.125rem 0.25rem;
  }

  :global(.action-btn .icon) {
    color: var(--color-caption);
  }

  .action-btn:hover :global(.icon) {
    color: var(--color-text-primary);
  }

  .emoji {
    font-size: 1rem;
    line-height: 1;
  }

  .compact .emoji {
    font-size: 0.875rem;
  }

  .count {
    font-size: 0.75rem;
  }
</style>
