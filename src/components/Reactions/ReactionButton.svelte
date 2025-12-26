<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import type { TargetType, AggregatedReactions } from '$lib/types/reactions';
  import { aggregateReactions } from '$lib/reactionAggregator';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import EmojiReactionPicker from './EmojiReactionPicker.svelte';
  import FullEmojiPicker from './FullEmojiPicker.svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let event: NDKEvent;
  export let targetType: TargetType;
  export let compact = false;

  let loading = true;
  let reactions: AggregatedReactions = {
    groups: [],
    totalCount: 0,
    userReactions: new Set()
  };
  let showPicker = false;
  let showFullPicker = false;
  let subscription: NDKSubscription | null = null;
  let reactionEvents: NDKEvent[] = [];
  let processedIds = new Set<string>();
  let buttonEl: HTMLButtonElement;

  function getFilter() {
    if (targetType === 'recipe') {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      const pubkey = event.author?.hexpubkey || event.pubkey;
      return {
        kinds: [7],
        '#a': [`${event.kind}:${pubkey}:${dTag}`]
      };
    } else {
      return {
        kinds: [7],
        '#e': [event.id]
      };
    }
  }

  function processEvents() {
    reactions = aggregateReactions(reactionEvents, $userPublickey);
  }

  async function loadReactions() {
    if (!event?.id) return;

    loading = true;
    reactionEvents = [];
    processedIds.clear();

    try {
      const filter = getFilter();
      subscription = $ndk.subscribe(filter);

      subscription.on('event', (e: NDKEvent) => {
        if (!e.id || processedIds.has(e.id)) return;
        processedIds.add(e.id);
        reactionEvents = [...reactionEvents, e];
        processEvents();
        loading = false;
      });

      subscription.on('eose', () => {
        loading = false;
      });
    } catch (error) {
      console.error('Error loading reactions:', error);
      loading = false;
    }
  }

  async function handleReaction(emoji: string) {
    showPicker = false;
    showFullPicker = false;

    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }

    // Optimistic update
    const wasReacted = reactions.userReactions.has(emoji);
    if (!wasReacted) {
      reactions.userReactions.add(emoji);
      const existingGroup = reactions.groups.find((g) => g.emoji === emoji);
      if (existingGroup) {
        existingGroup.count++;
        existingGroup.userReacted = true;
      } else {
        reactions.groups = [{ emoji, count: 1, userReacted: true }, ...reactions.groups];
      }
      reactions.totalCount++;
      reactions = reactions;
    }

    const result = await publishReaction({
      ndk: $ndk,
      targetEvent: event,
      emoji,
      targetType
    });

    if (result) {
      if (result.id) {
        processedIds.add(result.id);
      }
    } else {
      // Revert on failure
      if (!wasReacted) {
        reactions.userReactions.delete(emoji);
        const group = reactions.groups.find((g) => g.emoji === emoji);
        if (group) {
          group.count--;
          group.userReacted = false;
          if (group.count === 0) {
            reactions.groups = reactions.groups.filter((g) => g.emoji !== emoji);
          }
        }
        reactions.totalCount--;
        reactions = reactions;
      }
    }
  }

  function handleAddClick() {
    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }
    showPicker = !showPicker;
  }

  function handlePillClick(emoji: string) {
    handleReaction(emoji);
  }

  onMount(() => {
    loadReactions();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });

  $: if (event?.id) {
    loadReactions();
  }
</script>

<div class="flex items-center gap-1">
  <!-- Emoji pills when reactions exist -->
  {#if reactions.groups.length > 0}
    {#each reactions.groups.slice(0, 5) as group}
      <button
        type="button"
        class="flex items-center gap-1 h-6 px-1.5 rounded-full border text-sm transition-colors cursor-pointer {group.userReacted
          ? 'border-primary bg-primary/20'
          : 'border-transparent bg-accent-gray hover:border-primary hover:bg-primary/20'}"
        on:click={() => handlePillClick(group.emoji)}
        title={group.userReacted ? `You reacted with ${group.emoji}` : `React with ${group.emoji}`}
      >
        <span class="text-base">{group.emoji}</span>
        <span class="text-caption text-xs">{group.count}</span>
      </button>
    {/each}
  {/if}

  <!-- Add reaction button (heart when no reactions, + when reactions exist) -->
  <button
    bind:this={buttonEl}
    type="button"
    class="flex items-center gap-1 h-6 px-1.5 rounded-full transition-colors cursor-pointer hover:bg-accent-gray {reactions.groups.length === 0 ? '' : 'border border-dashed border-gray-400'}"
    class:opacity-50={!$userPublickey}
    on:click={handleAddClick}
    title={!$userPublickey ? 'Login to react' : 'Add reaction'}
  >
    {#if reactions.groups.length === 0}
      <HeartIcon size={compact ? 18 : 20} class="text-caption" />
      <span class="text-caption text-sm">
        {#if loading}...{:else}{reactions.totalCount}{/if}
      </span>
    {:else}
      <PlusIcon size={14} class="text-caption" />
    {/if}
  </button>
</div>

<!-- Quick picker -->
{#if showPicker}
  <EmojiReactionPicker
    anchorEl={buttonEl}
    userReactions={reactions.userReactions}
    on:select={(e) => handleReaction(e.detail.emoji)}
    on:openFullPicker={() => {
      showPicker = false;
      showFullPicker = true;
    }}
    on:close={() => (showPicker = false)}
  />
{/if}

<!-- Full picker modal -->
<FullEmojiPicker
  open={showFullPicker}
  on:select={(e) => handleReaction(e.detail.emoji)}
  on:close={() => (showFullPicker = false)}
/>
