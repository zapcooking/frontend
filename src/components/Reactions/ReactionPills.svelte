<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import type { TargetType } from '$lib/types/reactions';
  import { aggregateReactions } from '$lib/reactionAggregator';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import { getReactionStore } from '$lib/stores/reactionStore';

  export let event: NDKEvent;
  export let targetType: TargetType;

  const store = getReactionStore(event.id);

  let subscription: NDKSubscription | null = null;
  let reactionEvents: NDKEvent[] = [];
  let processedIds = new Set<string>();

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
    const reactions = aggregateReactions(reactionEvents, $userPublickey);
    store.update(s => ({ ...s, reactions, loading: false }));
  }

  async function loadReactions() {
    if (!event?.id) return;

    store.update(s => ({ ...s, loading: true }));
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
      });

      subscription.on('eose', () => {
        store.update(s => ({ ...s, loading: false }));
      });
    } catch (error) {
      console.error('Error loading reactions:', error);
      store.update(s => ({ ...s, loading: false }));
    }
  }

  async function handlePillClick(emoji: string) {
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

  onMount(() => {
    loadReactions();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });

  const maxVisible = 6;
  $: visibleGroups = $store.reactions.groups.slice(0, maxVisible);
  $: hiddenCount = $store.reactions.groups.length - maxVisible;
  $: hiddenReactionCount = $store.reactions.groups.slice(maxVisible).reduce((sum, g) => sum + g.count, 0);
</script>

{#if $store.reactions.groups.length > 0}
  <div class="flex flex-wrap gap-1 mb-2">
    {#each visibleGroups as group}
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

    {#if hiddenCount > 0}
      <span
        class="flex items-center gap-1 h-6 px-2 rounded-full bg-accent-gray text-caption text-xs"
        title="{hiddenCount} more emoji types ({hiddenReactionCount} reactions)"
      >
        +{hiddenReactionCount}
      </span>
    {/if}
  </div>
{/if}
