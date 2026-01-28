<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { formatAmount } from '$lib/utils';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
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
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  $: hasUserReacted = $store.reactions.userReactions.size > 0;
  $: userEmoji = hasUserReacted ? Array.from($store.reactions.userReactions)[0] : null;

  function handleReactionClick() {
    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }
    showPicker = !showPicker;
  }

  async function handleReaction(emoji: string) {
    showPicker = false;
    showFullPicker = false;

    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
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
    if (!$userPublickey) {
      window.location.href = '/login';
      return;
    }
    zapModalOpen = true;
  }

  function handleReplyClick() {
    // Navigate to the note's thread page
    goto(`/${nip19.noteEncode(event.id)}`);
  }
</script>

<div class="thread-actions" class:compact>
  <!-- Reaction Button -->
  <button
    bind:this={reactionButtonEl}
    type="button"
    class="action-btn"
    class:opacity-50={!$userPublickey}
    on:click={handleReactionClick}
    title={!$userPublickey ? 'Login to react' : 'Add reaction'}
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
  <button
    type="button"
    class="action-btn"
    class:opacity-50={!$userPublickey}
    on:click={openZapModal}
    title={!$userPublickey ? 'Login to zap' : 'Send zap'}
  >
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
    background-color: var(--color-input);
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
