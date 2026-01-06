<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { TargetType } from '$lib/types/reactions';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import { getReactionStore } from '$lib/stores/reactionStore';
  import EmojiReactionPicker from './EmojiReactionPicker.svelte';
  import FullEmojiPicker from './FullEmojiPicker.svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';

  export let event: NDKEvent;
  export let targetType: TargetType;
  export let compact = false;

  const store = getReactionStore(event.id);
  let buttonEl: HTMLButtonElement;
  let processedIds = new Set<string>();

  $: hasUserReacted = $store.reactions.userReactions.size > 0;
  $: userEmoji = hasUserReacted ? Array.from($store.reactions.userReactions)[0] : null;

  function handleClick() {
    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }
    store.update(s => ({ ...s, showPicker: !s.showPicker }));
  }

  async function handleReaction(emoji: string) {
    store.update(s => ({ ...s, showPicker: false, showFullPicker: false }));

    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }

    const currentReactions = $store.reactions;
    const wasReacted = currentReactions.userReactions.has(emoji);

    if (!wasReacted) {
      // Optimistic update
      currentReactions.userReactions.add(emoji);
      const existingGroup = currentReactions.groups.find((g) => g.emoji === emoji);
      if (existingGroup) {
        existingGroup.count++;
        existingGroup.userReacted = true;
      } else {
        currentReactions.groups = [{ emoji, count: 1, userReacted: true }, ...currentReactions.groups];
      }
      currentReactions.totalCount++;
      store.update(s => ({ ...s, reactions: currentReactions }));

      const result = await publishReaction({
        ndk: $ndk,
        targetEvent: event,
        emoji,
        targetType
      });

      if (result?.id) {
        processedIds.add(result.id);
      } else {
        // Revert on failure
        currentReactions.userReactions.delete(emoji);
        const group = currentReactions.groups.find((g) => g.emoji === emoji);
        if (group) {
          group.count--;
          group.userReacted = false;
          if (group.count === 0) {
            currentReactions.groups = currentReactions.groups.filter((g) => g.emoji !== emoji);
          }
        }
        currentReactions.totalCount--;
        store.update(s => ({ ...s, reactions: currentReactions }));
      }
    }
  }
</script>

<button
  bind:this={buttonEl}
  type="button"
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  class:opacity-50={!$userPublickey}
  on:click={handleClick}
  title={!$userPublickey ? 'Login to react' : 'Add reaction'}
>
  {#if hasUserReacted && userEmoji}
    <span class={compact ? 'text-lg' : 'text-xl'}>{userEmoji}</span>
  {:else}
    <HeartIcon
      size={compact ? 20 : 24}
      weight="regular"
      class="text-caption"
    />
  {/if}
  <span class="text-caption {compact ? 'text-sm' : ''}">
    {#if $store.loading}...{:else}{$store.reactions.totalCount}{/if}
  </span>
</button>

<!-- Quick picker -->
{#if $store.showPicker}
  <EmojiReactionPicker
    anchorEl={buttonEl}
    userReactions={$store.reactions.userReactions}
    on:select={(e) => handleReaction(e.detail.emoji)}
    on:openFullPicker={() => {
      store.update(s => ({ ...s, showPicker: false, showFullPicker: true }));
    }}
    on:close={() => store.update(s => ({ ...s, showPicker: false }))}
  />
{/if}

<!-- Full picker - anchored to button -->
<FullEmojiPicker
  open={$store.showFullPicker}
  anchorEl={buttonEl}
  on:select={(e) => handleReaction(e.detail.emoji)}
  on:close={() => store.update(s => ({ ...s, showFullPicker: false }))}
/>
