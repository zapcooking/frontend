<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { TargetType } from '$lib/types/reactions';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import EmojiReactionPicker from './EmojiReactionPicker.svelte';
  import FullEmojiPicker from './FullEmojiPicker.svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';

  export let event: NDKEvent;
  export let targetType: TargetType;
  export let compact = false;

  const store = getEngagementStore(event.id);
  let buttonEl: HTMLButtonElement;
  let showPicker = false;
  let showFullPicker = false;

  onMount(() => {
    // Only fetch if we don't have fresh data or it's not already loading
    // This allows feed components to batch fetch without duplication
    const data = $store;
    if (!data.lastFetched || Date.now() - data.lastFetched > 5 * 60 * 1000) {
      if (!data.loading) {
        fetchEngagement($ndk, event.id, $userPublickey);
      }
    }
  });

  $: hasUserReacted = $store.reactions.userReactions.size > 0;
  $: userEmoji = hasUserReacted ? Array.from($store.reactions.userReactions)[0] : null;

  function handleClick() {
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
        targetType
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
    <HeartIcon size={compact ? 20 : 24} weight="regular" class="text-caption" />
  {/if}
  <span class="text-caption {compact ? 'text-sm' : ''}">
    {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.reactions.count}{/if}
  </span>
</button>

<!-- Quick picker -->
{#if showPicker}
  <EmojiReactionPicker
    anchorEl={buttonEl}
    userReactions={$store.reactions.userReactions}
    on:select={(e) => handleReaction(e.detail.emoji)}
    on:openFullPicker={() => {
      showPicker = false;
      showFullPicker = true;
    }}
    on:close={() => (showPicker = false)}
  />
{/if}

<!-- Full picker - anchored to button -->
<FullEmojiPicker
  open={showFullPicker}
  anchorEl={buttonEl}
  on:select={(e) => handleReaction(e.detail.emoji)}
  on:close={() => (showFullPicker = false)}
/>
