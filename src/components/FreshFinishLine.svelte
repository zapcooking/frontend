<script lang="ts">
  /**
   * The end of the 14-day window ($lib/freshFeed/finishLine): "You're all
   * caught up", the opt-in "Keep exploring" section (on this day, two topic
   * spotlights, recipes from the recipe box), then "Older posts" for
   * members, or the membership / log-in card for everyone else.
   */
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { FinishLine } from '$lib/freshFeed/finishLine';
  import type { FloorPrompt } from '$lib/freshFeed/floorPrompt';
  import type { ExploreContent } from '$lib/freshFeed/specialsLoader';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import type { Special } from '$lib/freshFeed/specials';
  import type { SpecialType } from '$lib/freshFeed/specialsConfig';
  import FreshSpecialShell from './FreshSpecialShell.svelte';
  import FreshSpecialCard from './FreshSpecialCard.svelte';
  import FreshMiniPost from './FreshMiniPost.svelte';
  import FreshCardRow from './FreshCardRow.svelte';
  import FreshFloorCard from './FreshFloorCard.svelte';
  import LoadingState from './LoadingState.svelte';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import CompassIcon from 'phosphor-svelte/lib/Compass';

  export let state: FinishLine;
  export let prompt: FloorPrompt;
  export let content: ExploreContent | null = null;
  export let toEvent: (raw: RelayEvent) => NDKEvent;
  /** Not a member: the full topic behind a spotlight is the membership pitch. */
  export let locked = false;

  const dispatch = createEventDispatcher<{
    explore: void;
    older: void;
    login: void;
    seen: Special;
    seenPosts: RelayEvent[];
    seenRecipes: RelayEvent[];
    fewer: SpecialType;
    hideTopic: string;
    openTopic: string;
  }>();

  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  $: empty =
    content !== null && !content.day && content.spotlights.length === 0 && !content.recipes.length;
</script>

{#if state.caughtUp}
  <div class="finish">
    {#if state.floorCard}
      <!-- The membership / log-in card says "caught up" itself. -->
      <FreshFloorCard {prompt} on:login />
      {#if state.exploreButton}
        <div class="explore-only">
          <button type="button" class="explore-button" on:click={() => dispatch('explore')}>
            <CompassIcon size={18} weight="bold" />
            Keep exploring
          </button>
        </div>
      {/if}
    {:else}
      <div class="caught-up">
        <CheckCircleIcon size={28} weight="fill" class="text-primary" />
        <p class="caught-up-title">You're all caught up</p>
        <p class="caught-up-text">That's everything in Fresh from the last 14 days.</p>
        {#if state.exploreButton}
          <button type="button" class="explore-button" on:click={() => dispatch('explore')}>
            <CompassIcon size={18} weight="bold" />
            Keep exploring
          </button>
        {/if}
      </div>
    {/if}

    {#if state.explore}
      <section class="explore" aria-label="Keep exploring">
        {#if !content}
          <LoadingState type="spinner" size="md" text="Finding something good..." showText={true} />
        {:else}
          {#if content.day}
            <FreshSpecialShell
              tab="On this day"
              on:seen={() => content?.day && dispatch('seenPosts', content.day.posts)}
            >
              <h3 class="explore-title">🗓️ {today} in years past</h3>
              <FreshCardRow label="On this day">
                {#each content.day.posts as raw (raw.id)}
                  <div role="listitem"><FreshMiniPost {raw} event={toEvent(raw)} /></div>
                {/each}
              </FreshCardRow>
            </FreshSpecialShell>
          {/if}
          {#each content.spotlights as sp (sp.type === 'spotlight' ? sp.slug : '')}
            {#if sp.type === 'spotlight'}
              <FreshSpecialCard
                special={sp}
                {toEvent}
                {locked}
                on:seen={() => dispatch('seen', sp)}
                on:fewer
                on:hideTopic
                on:openTopic
              />
            {/if}
          {/each}
          {#if content.recipes.length}
            <FreshSpecialShell
              tab="From the recipe box"
              on:seen={() => content && dispatch('seenRecipes', content.recipes)}
            >
              <h3 class="explore-title">🧑‍🍳 Recipes to try</h3>
              <FreshCardRow label="Recipes to try">
                {#each content.recipes as raw (raw.id)}
                  <div role="listitem"><FreshMiniPost {raw} event={toEvent(raw)} /></div>
                {/each}
              </FreshCardRow>
            </FreshSpecialShell>
          {/if}
          {#if empty}
            <p class="explore-empty">Nothing more to explore right now. Check back soon.</p>
          {/if}
        {/if}
      </section>
    {/if}

    {#if state.older}
      <div class="older">
        <button type="button" class="older-button" on:click={() => dispatch('older')}>
          Older posts
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .finish {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .caught-up {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 1.5rem 1.25rem;
    border-radius: 1rem;
    text-align: center;
    background: var(--color-card-sunken);
  }

  .caught-up-title {
    margin: 0.25rem 0 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .caught-up-text {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-caption);
  }

  .explore-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    height: 2.5rem;
    padding: 0 1.25rem;
    border-radius: 999px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #fff;
    background: var(--color-primary);
  }

  .explore-only {
    display: flex;
    justify-content: center;
    margin-top: -0.75rem;
  }

  .explore {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .explore-title {
    margin: 0.125rem 2rem 0.75rem 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .explore-empty {
    text-align: center;
    font-size: 0.875rem;
    color: var(--color-caption);
  }

  .older {
    display: flex;
    justify-content: center;
    padding-bottom: 0.5rem;
  }

  .older-button {
    padding: 0.5rem 1.25rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
    background: var(--color-input-bg);
  }

  .older-button:hover {
    background: var(--color-accent-gray);
  }
</style>
