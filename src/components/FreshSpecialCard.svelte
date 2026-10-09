<script lang="ts">
  /**
   * A topic spotlight (a swipeable row of posts from one topic) or a memory
   * ("One year ago today" / "From the archive"). Both are previews everyone
   * sees; the link at the bottom opens the full topic feed or archive view,
   * which the feed gates for members (`locked`: a non-member sees a lock on
   * the link and gets the membership pitch when they open it). The recipe
   * box is FreshPostCard's `box` mode.
   */
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { Special } from '$lib/freshFeed/specials';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import type { SpecialType } from '$lib/freshFeed/specialsConfig';
  import FreshSpecialShell from './FreshSpecialShell.svelte';
  import FreshMiniPost from './FreshMiniPost.svelte';
  import FreshCardRow from './FreshCardRow.svelte';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';
  import LockIcon from 'phosphor-svelte/lib/LockSimple';

  export let special: Exclude<Special, { type: 'recipe' }>;
  /** Wraps a post for its components (FreshFeed's `wrap`). */
  export let toEvent: (raw: RelayEvent) => NDKEvent;
  /** The full view behind the card is for members and this reader isn't one. */
  export let locked = false;

  const dispatch = createEventDispatcher<{
    fewer: SpecialType;
    hideTopic: string;
    openTopic: string;
    openMemory: Extract<Special, { type: 'memory' }>;
    seen: void;
  }>();

  $: menu =
    special.type === 'memory'
      ? [{ label: 'Show fewer like this', action: () => dispatch('fewer', 'memory') }]
      : [
          { label: 'Show fewer like this', action: () => dispatch('fewer', 'spotlight') },
          { label: 'Hide this topic', action: () => dispatch('hideTopic', special.slug) }
        ];
  $: tab = special.type === 'memory' ? special.label : 'Topic spotlight';
  $: more =
    special.type === 'memory'
      ? special.variant === 'day'
        ? 'See all from this day'
        : `Browse ${special.heading}`
      : `See more ${special.name}`;
</script>

<FreshSpecialShell {tab} {menu} on:seen>
  {#if special.type === 'spotlight'}
    <h3 class="special-title">{special.title}</h3>
    <FreshCardRow label={special.title}>
      {#each special.posts as raw (raw.id)}
        <div role="listitem">
          <FreshMiniPost {raw} event={toEvent(raw)} />
        </div>
      {/each}
    </FreshCardRow>
  {:else}
    <h3 class="special-title">
      {special.variant === 'day' ? '🗓️' : '🕰️'}
      {special.heading}
    </h3>
    <div class="memory" class:pair={special.posts.length > 1}>
      {#each special.posts as raw (raw.id)}
        <FreshMiniPost {raw} event={toEvent(raw)} wide />
      {/each}
    </div>
  {/if}
  <button
    type="button"
    class="see-more"
    on:click={() =>
      special.type === 'memory'
        ? dispatch('openMemory', special)
        : dispatch('openTopic', special.slug)}
  >
    {more}
    {#if locked}
      <span class="members">· members</span>
      <LockIcon size={13} weight="bold" aria-hidden="true" />
    {:else}
      <ArrowRightIcon size={14} weight="bold" />
    {/if}
  </button>
</FreshSpecialShell>

<style>
  .special-title {
    margin: 0.125rem 2rem 0.75rem 0;
    font-size: 1.125rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--color-text-primary);
  }

  .members {
    font-weight: 500;
    color: var(--color-caption);
  }

  .see-more {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary);
  }

  .see-more:hover {
    text-decoration: underline;
  }

  .memory {
    display: grid;
    gap: 0.625rem;
  }

  @media (min-width: 640px) {
    .memory.pair {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
