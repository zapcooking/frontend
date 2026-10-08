<script lang="ts">
  /**
   * A topic spotlight (a swipeable row of posts from one topic), a locked
   * spotlight teaser (non-members), or a memory ("One year ago today" /
   * "From the archive"). The recipe box is FreshPostCard's `box` mode.
   */
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { Special } from '$lib/freshFeed/specials';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import type { SpecialType } from '$lib/freshFeed/specialsConfig';
  import FreshSpecialShell from './FreshSpecialShell.svelte';
  import FreshMiniPost from './FreshMiniPost.svelte';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';
  import LockIcon from 'phosphor-svelte/lib/LockSimple';

  export let special: Exclude<Special, { type: 'recipe' }>;
  /** Wraps a post for its components (FreshFeed's `wrap`). */
  export let toEvent: (raw: RelayEvent) => NDKEvent;

  const dispatch = createEventDispatcher<{
    fewer: SpecialType;
    hideTopic: string;
    openTopic: string;
    seen: void;
  }>();

  $: menu =
    special.type === 'memory'
      ? [{ label: 'Show fewer like this', action: () => dispatch('fewer', 'memory') }]
      : [
          { label: 'Show fewer like this', action: () => dispatch('fewer', 'spotlight') },
          { label: 'Hide this topic', action: () => dispatch('hideTopic', special.slug) }
        ];
  $: tab =
    special.type === 'memory'
      ? special.label
      : special.type === 'teaser'
        ? 'Topic spotlight · Members'
        : 'Topic spotlight';
</script>

<FreshSpecialShell {tab} {menu} on:seen>
  {#if special.type === 'spotlight'}
    <h3 class="special-title">{special.title}</h3>
    <div class="row" role="list">
      {#each special.posts as raw (raw.id)}
        <div class="row-item" role="listitem">
          <FreshMiniPost {raw} event={toEvent(raw)} />
        </div>
      {/each}
    </div>
    <button type="button" class="see-more" on:click={() => dispatch('openTopic', special.slug)}>
      See more {special.name}
      <ArrowRightIcon size={14} weight="bold" />
    </button>
  {:else if special.type === 'teaser'}
    <h3 class="special-title">{special.title} <span class="members">— members only</span></h3>
    <p class="teaser-text">Topic spotlights are for Zap Cooking members.</p>
    <a href="/membership" class="teaser-link">
      <LockIcon size={14} weight="bold" />
      See membership
    </a>
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
    font-weight: 600;
    color: var(--box-ink);
  }

  /* Swipeable on phones (scroll-snap), three across from 640px. */
  .row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 72%;
    gap: 0.625rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    margin: 0 calc(-1 * var(--media-bleed-x));
    padding: 0 var(--media-bleed-x) 0.25rem;
    scroll-padding: 0 var(--media-bleed-x);
    scrollbar-width: none;
  }

  .row::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 640px) {
    .row {
      grid-auto-flow: row;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }

  .row-item {
    scroll-snap-align: start;
    min-width: 0;
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

  .teaser-text {
    margin: 0 0 0.875rem;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  .teaser-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.25rem;
    padding: 0 1rem;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    background: var(--color-primary);
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
