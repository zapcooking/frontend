<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { TargetType } from '$lib/types/reactions';
  import { publishReaction, canPublishReaction } from '$lib/reactions/publishReaction';
  import { getEngagementStore, fetchEngagement, markEventAsProcessed, trackOptimisticReaction, clearOptimisticReaction } from '$lib/engagementCache';

  export let event: NDKEvent;
  export let targetType: TargetType;

  const store = getEngagementStore(event.id);

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

  async function handlePillClick(emoji: string) {
    if (!canPublishReaction($ndk, $userPublickey)) {
      window.location.href = '/login';
      return;
    }

    const wasReacted = $store.reactions.userReactions.has(emoji);

    if (!wasReacted) {
      // Track optimistic reaction BEFORE publishing to prevent double counting
      // This must happen before any async operations so the subscription can detect it
      trackOptimisticReaction(event.id, emoji, $userPublickey);
      
      // Optimistic update
      store.update(s => {
        const updated = { ...s };
        updated.reactions.userReactions.add(emoji);
        updated.reactions.count++;
        updated.reactions.userReacted = true;
        
        const existingGroup = updated.reactions.groups.find(g => g.emoji === emoji);
        if (existingGroup) {
          existingGroup.count++;
          existingGroup.userReacted = true;
        } else {
          updated.reactions.groups = [{ emoji, count: 1, userReacted: true }, ...updated.reactions.groups];
        }
        
        return updated;
      });

      const result = await publishReaction({
        ndk: $ndk,
        targetEvent: event,
        emoji,
        targetType
      });

      if (result?.id) {
        // Also mark by event ID as secondary protection
        markEventAsProcessed(event.id, result.id);
      } else {
        // Clear optimistic tracking on failure to allow retry
        clearOptimisticReaction(event.id, emoji, $userPublickey);
        
        // Revert on failure
        store.update(s => {
          const updated = { ...s };
          updated.reactions.userReactions.delete(emoji);
          updated.reactions.count--;
          
          const group = updated.reactions.groups.find(g => g.emoji === emoji);
          if (group) {
            group.count--;
            group.userReacted = false;
            if (group.count === 0) {
              updated.reactions.groups = updated.reactions.groups.filter(g => g.emoji !== emoji);
            }
          }
          
          updated.reactions.userReacted = updated.reactions.userReactions.size > 0;
          return updated;
        });
      }
    }
  }

  const maxVisible = 6;
  $: visibleGroups = $store.reactions.groups.slice(0, maxVisible);
  $: hiddenCount = $store.reactions.groups.length - maxVisible;
  $: hiddenReactionCount = $store.reactions.groups.slice(maxVisible).reduce((sum, g) => sum + g.count, 0);
  
  // Count integrity check - only log significant mismatches in dev mode, throttled
  // Small mismatches are normal during real-time updates
  let lastMismatchLog = 0;
  $: if ($store.reactions.groups.length > 0 && !$store.loading) {
    const sumOfGroups = $store.reactions.groups.reduce((sum, g) => sum + g.count, 0);
    const diff = Math.abs(sumOfGroups - $store.reactions.count);
    // Only log if diff > 5 AND throttle to once per 10 seconds per component
    if (diff > 5 && Date.now() - lastMismatchLog > 10000) {
      lastMismatchLog = Date.now();
      console.debug(`[ReactionPills] Count drift: groups=${sumOfGroups}, total=${$store.reactions.count}, diff=${diff}`);
    }
  }
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
