<script lang="ts">
  /**
   * Settings → Fresh: the reader's special-card choices ("Show fewer like
   * this", hidden spotlight topics, all special cards off), each with a way
   * back. Stored on this device only ($lib/freshFeed/specialsPrefs).
   */
  import {
    resetFewer,
    resetPrefs,
    setSpecialsOff,
    specialsPrefs,
    unhideTopic
  } from '$lib/freshFeed/specialsPrefs';
  import { SPOTLIGHT_TITLES } from '$lib/freshFeed/spotlightTitles';
  import type { SpecialType } from '$lib/freshFeed/specialsConfig';

  const prefs = specialsPrefs();
  const TYPES: { type: SpecialType; label: string }[] = [
    { type: 'recipe', label: 'From the recipe box' },
    { type: 'spotlight', label: 'Topic spotlights' },
    { type: 'memory', label: 'Memories (on this day, from the archive)' }
  ];

  $: fewer = TYPES.filter((t) => $prefs.fewer[t.type]);
  $: changed = $prefs.off || fewer.length > 0 || $prefs.hiddenTopics.length > 0;
</script>

<div class="flex flex-col gap-4">
  <div class="p-4 rounded-xl" style="border: 1px solid var(--color-input-border);">
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1">
        <span class="font-medium" style="color: var(--color-text-primary)">Special cards</span>
        <p class="text-sm text-caption mt-1">
          Recipes from the recipe box, topic spotlights and memories between posts in Fresh.
        </p>
      </div>
      <button
        role="switch"
        aria-checked={!$prefs.off}
        aria-label="Special cards"
        class="relative w-12 h-7 rounded-full transition-colors cursor-pointer flex-shrink-0 {!$prefs.off
          ? 'bg-primary'
          : 'bg-gray-300 dark:bg-gray-600'}"
        on:click={() => setSpecialsOff(!$prefs.off)}
      >
        <span
          class="absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform {!$prefs.off
            ? 'translate-x-5'
            : ''}"
        ></span>
      </button>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium" style="color: var(--color-text-primary)">Showing fewer</span>
    {#if fewer.length}
      <ul class="flex flex-col gap-2">
        {#each fewer as t (t.type)}
          <li class="flex items-center justify-between gap-3 text-sm">
            <span style="color: var(--color-text-secondary)">{t.label}</span>
            <button class="text-sm font-medium text-primary" on:click={() => resetFewer(t.type)}>
              Show as usual
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-xs" style="color: var(--color-caption)">
        Nothing. Choose "Show fewer like this" in a card's … menu.
      </p>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium" style="color: var(--color-text-primary)">Hidden topics</span>
    {#if $prefs.hiddenTopics.length}
      <ul class="flex flex-col gap-2">
        {#each $prefs.hiddenTopics as slug (slug)}
          <li class="flex items-center justify-between gap-3 text-sm">
            <span style="color: var(--color-text-secondary)">{SPOTLIGHT_TITLES[slug] ?? slug}</span>
            <button class="text-sm font-medium text-primary" on:click={() => unhideTopic(slug)}>
              Show again
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-xs" style="color: var(--color-caption)">
        None. Choose "Hide this topic" in a spotlight's … menu.
      </p>
    {/if}
  </div>

  <div class="flex items-center justify-between gap-3">
    <p class="text-xs" style="color: var(--color-caption)">
      These choices stay on this device and are never sent anywhere.
    </p>
    <button
      class="px-3 py-1.5 rounded-lg text-sm font-medium bg-input hover:bg-accent-gray disabled:opacity-50"
      style="color: var(--color-text-primary)"
      disabled={!changed}
      on:click={() => resetPrefs()}
    >
      Reset
    </button>
  </div>
</div>
