<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FloorPrompt } from '$lib/freshFeed/floorPrompt';

  /**
   * The card at the end of Fresh's free window (14 days). Members who
   * declined the relay login get the "Log in to the feed" button (one prompt
   * per click, never automatic); everyone else who isn't a member gets the
   * membership link.
   */
  export let prompt: FloorPrompt;
  /** Where the card shows: the end of the 14-day window, or a topic feed. */
  export let context: 'floor' | 'topic' = 'floor';

  $: topic = context === 'topic';

  const dispatch = createEventDispatcher<{ login: void }>();
</script>

{#if prompt.kind !== 'none'}
  <aside
    class="my-4 rounded-xl p-4 text-center"
    style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary);"
    aria-live="polite"
  >
    {#if prompt.kind === 'join'}
      <p class="font-medium" style="color: var(--color-text-primary)">
        {topic ? 'Topic feeds are for members' : "You're caught up on the last 14 days"}
      </p>
      <p class="text-sm mt-1" style="color: var(--color-caption)">
        {topic
          ? 'Members can follow topics like Sourdough or Kimchi, back through the full history.'
          : 'Members get the full history of the Fresh feed, plus topic feeds.'}
      </p>
      <a
        href="/membership"
        class="inline-block mt-3 px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
      >
        {prompt.signedIn ? 'Become a member' : 'Learn about membership'}
      </a>
    {:else if prompt.kind === 'pending'}
      <p class="text-sm" style="color: var(--color-caption)">
        Approve the login in your signer to {topic ? 'open this topic' : 'see older posts'}…
      </p>
    {:else if prompt.kind === 'login'}
      <p class="font-medium" style="color: var(--color-text-primary)">
        {topic ? 'Topic feeds are for members' : 'Older posts are for members'}
      </p>
      <p class="text-sm mt-1" style="color: var(--color-caption)">
        Log in to the feed relay to {topic ? 'open topic feeds' : 'keep scrolling'}. It only checks
        your membership; nothing is logged.
      </p>
      <button
        type="button"
        class="mt-3 px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
        on:click={() => dispatch('login')}
      >
        Log in to the feed
      </button>
    {/if}
  </aside>
{/if}
