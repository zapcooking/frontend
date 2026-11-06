<script lang="ts">
  import { tick } from 'svelte';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import { theme, exploreStyle, type Theme } from '$lib/themeStore';
  import { EXPLORE_STYLES, findExploreStyle, type ExploreStyleMode } from '$lib/themeStyles';

  const modes: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' }
  ];

  let moodOpen = false;
  let moodSelect: HTMLDivElement | null = null;
  let moodList: HTMLUListElement | null = null;

  $: selectedTheme = $theme;
  $: activeStyle = findExploreStyle($exploreStyle);

  const modeLabel = (mode: ExploreStyleMode) => (mode === 'dark' ? 'Dark' : 'Light');

  function setMode(mode: Theme) {
    // A single-mode mood can't render the requested mode, so the plate would
    // contradict the mode control. Instead of disabling controls, fall back
    // to the original look, which comes in every mode.
    const fixed = activeStyle.modes.length === 1;
    const supported = activeStyle.modes.includes(mode as ExploreStyleMode);
    if (fixed && !supported) theme.setStyle('original');
    theme.setTheme(mode);
  }

  function setMood(value: string) {
    const mood = findExploreStyle(value);
    theme.setStyle(value);
    // Pin the mode so the control reflects the only way this mood renders.
    if (mood.modes.length === 1 && selectedTheme !== mood.modes[0]) {
      theme.setTheme(mood.modes[0]);
    }
    moodOpen = false;
  }

  // The list scrolls once it outgrows its height cap; open it with the current
  // mood in view rather than at the top.
  async function toggleMood() {
    moodOpen = !moodOpen;
    if (!moodOpen) return;
    await tick();
    moodList?.querySelector('.mood-selected')?.scrollIntoView({ block: 'nearest' });
  }

  function handleClickOutside(event: MouseEvent) {
    if (moodOpen && moodSelect && !moodSelect.contains(event.target as Node)) {
      moodOpen = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') moodOpen = false;
  }
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap gap-2" role="group" aria-label="Color mode">
    {#each modes as mode (mode.value)}
      <button
        type="button"
        class="px-4 py-2 rounded-full text-sm font-medium transition-colors
          {selectedTheme === mode.value
          ? 'bg-action text-on-action'
          : 'bg-secondary hover:bg-accent-gray'}"
        style={selectedTheme !== mode.value ? 'color: var(--color-text-primary)' : ''}
        aria-pressed={selectedTheme === mode.value}
        on:click={() => setMode(mode.value)}
      >
        {mode.label}
      </button>
    {/each}
  </div>

  <div class="flex flex-col gap-1.5">
    <span class="text-xs text-caption">Mood</span>
    <div class="relative" bind:this={moodSelect}>
      <button
        type="button"
        class="mood-trigger w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors"
        style="border-color: var(--color-input-border); background: var(--color-input-bg); color: var(--color-text-primary);"
        aria-haspopup="listbox"
        aria-expanded={moodOpen}
        on:click={toggleMood}
      >
        <span class="truncate">
          {activeStyle.label}
          {#if activeStyle.modes.length === 1}
            ({modeLabel(activeStyle.modes[0])} only)
          {/if}
        </span>
        <CaretDownIcon
          size={14}
          class="flex-none transition-transform {moodOpen ? 'rotate-180' : ''}"
        />
      </button>

      {#if moodOpen}
        <ul
          bind:this={moodList}
          role="listbox"
          aria-label="Mood"
          class="mood-list absolute z-20 mt-1 w-full rounded-lg border overflow-y-auto"
          style="border-color: var(--color-input-border); background: var(--color-bg-primary);"
        >
          {#each EXPLORE_STYLES as mood (mood.value)}
            <li role="option" aria-selected={$exploreStyle === mood.value}>
              <button
                type="button"
                class="mood-item w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-left
                  {$exploreStyle === mood.value ? 'mood-selected' : ''}"
                style="color: var(--color-text-primary);"
                on:click={() => setMood(mood.value)}
              >
                <span class="flex items-center gap-2 min-w-0">
                  {#if $exploreStyle === mood.value}
                    <CheckIcon size={14} class="flex-none text-[var(--color-success)]" />
                  {/if}
                  <span class="truncate">
                    {mood.label}
                    {#if mood.modes.length === 1}
                      ({modeLabel(mood.modes[0])} only)
                    {/if}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Cap the list so a long mood registry scrolls inside it instead of running
     off the panel; scrolling stays inside the list rather than moving the panel. */
  .mood-list {
    max-height: min(20rem, 50vh);
    overscroll-behavior: contain;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .mood-item:hover {
    background-color: var(--color-hover-bg);
  }
  .mood-item.mood-selected {
    background-color: var(--color-selected-bg);
    font-weight: 500;
  }
</style>
