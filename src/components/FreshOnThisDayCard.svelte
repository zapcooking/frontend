<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import { yearsAgoLabel } from '$lib/freshFeed/archive';

  /**
   * "On this day", in Fresh's caught-up state.
   * - teaser: not a member (or signed out): the membership link. The card
   *   itself sends nothing.
   * - invite: a member not yet logged in to the feed relay: Open (the view
   *   logs in when opened; the card never prompts the signer by itself).
   * - ready: post counts per year, loaded on an already logged-in connection.
   */
  export let mode: 'teaser' | 'invite' | 'ready';
  export let signedIn = false;
  export let counts: { yearsBack: number; count: number }[] = [];

  const dispatch = createEventDispatcher<{ open: void }>();
</script>

<aside
  class="my-4 rounded-xl p-4"
  style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary);"
  aria-label="On this day"
>
  <div class="flex items-center gap-2">
    <ClockCounterClockwiseIcon size={18} class="text-caption" />
    <p class="font-medium" style="color: var(--color-text-primary)">On this day</p>
  </div>
  {#if mode === 'teaser'}
    <p class="text-sm mt-1" style="color: var(--color-caption)">
      Members see what the community cooked on this date in past years, and can browse the archive
      month by month.
    </p>
    <a
      href="/membership"
      class="inline-block mt-3 px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
    >
      {signedIn ? 'Become a member' : 'Learn about membership'}
    </a>
  {:else}
    {#if mode === 'ready'}
      <ul class="text-sm mt-1 space-y-0.5" style="color: var(--color-caption)">
        {#each counts as c (c.yearsBack)}
          <li>{yearsAgoLabel(c.yearsBack)} · {c.count} {c.count === 1 ? 'post' : 'posts'}</li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm mt-1" style="color: var(--color-caption)">
        See what the community cooked on this date in past years.
      </p>
    {/if}
    <button
      type="button"
      class="mt-3 px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
      on:click={() => dispatch('open')}
    >
      Open
    </button>
  {/if}
</aside>
