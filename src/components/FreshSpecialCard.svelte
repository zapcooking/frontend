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
  import FreshCardRow from './FreshCardRow.svelte';
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
    unlock: void;
  }>();

  $: menu =
    special.type === 'unlock'
      ? []
      : special.type === 'memory'
        ? [{ label: 'Show fewer like this', action: () => dispatch('fewer', 'memory') }]
        : [
            { label: 'Show fewer like this', action: () => dispatch('fewer', 'spotlight') },
            { label: 'Hide this topic', action: () => dispatch('hideTopic', special.slug) }
          ];
  $: tab =
    special.type === 'unlock'
      ? special.for === 'memory'
        ? 'Memories · Members'
        : 'Topic spotlight · Members'
      : special.type === 'memory'
        ? special.label
        : special.type === 'teaser'
          ? 'Topic spotlight · Members'
          : 'Topic spotlight';
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
    <button type="button" class="see-more" on:click={() => dispatch('openTopic', special.slug)}>
      See more {special.name}
      <ArrowRightIcon size={14} weight="bold" />
    </button>
  {:else if special.type === 'unlock'}
    <h3 class="special-title">
      {special.for === 'memory' ? '🕰️ From the archive' : '✨ Topic spotlights'}
    </h3>
    {#if special.status === 'declined'}
      <p class="teaser-text">
        No problem. Recipes from the recipe box will keep coming; members-only cards are off for
        this visit.
      </p>
    {:else}
      <p class="teaser-text">
        {special.for === 'memory'
          ? 'Moments from the Fresh archive, for members. '
          : 'The best of each topic from the Fresh archive, for members. '}
        Sign in to the feed relay with your key to see them here. Your signer will ask once;
        nothing is posted.
      </p>
      <button
        type="button"
        class="teaser-link"
        disabled={special.status === 'busy'}
        on:click={() => dispatch('unlock')}
      >
        {special.status === 'busy' ? 'Signing in…' : '🔓 Sign in to the feed'}
      </button>
    {/if}
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

  .teaser-link:disabled {
    opacity: 0.7;
  }

  .teaser-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    line-height: 1.3;
    text-align: center;
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
