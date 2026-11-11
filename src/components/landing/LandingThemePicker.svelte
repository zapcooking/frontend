<script lang="ts">
  import { onMount } from 'svelte';
  import { EXPLORE_STYLES } from '$lib/themeStyles';

  export let label = 'Choose your style';
  export let inApp = false;

  onMount(() => {
    document.dispatchEvent(new Event('zapcooking:theme-controls-ready'));
  });
</script>

<div class="theme-picker" class:app-style-picker={inApp} data-explore-theme-control hidden>
  <label>
    <span>{label}</span>
    <select data-explore-theme-select>
      {#each EXPLORE_STYLES as style (style.value)}
        <!-- appearance.js drops the lock from themes the visitor has unlocked. -->
        <option value={style.value}>{style.label}{style.price ? ' 🔒' : ''}</option>
      {/each}
    </select>
  </label>
  <a class="gallery-link" href="/themes">Theme Gallery</a>
  <span class="sr-only" data-explore-theme-status role="status" aria-live="polite"></span>
</div>

<style>
  .theme-picker[hidden] {
    display: none;
  }
  .theme-picker {
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  label {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    color: var(--explore-masthead-muted, var(--color-text-secondary));
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
  }
  .gallery-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--color-input-border);
    border-radius: var(--explore-control-radius, 8px);
    color: var(--color-text-primary);
    font-size: var(--explore-meta, 13px);
    font-weight: 500;
    text-decoration: none;
  }
  .gallery-link:hover {
    background: var(--color-hover-bg);
  }
  select {
    min-width: 0;
    max-width: 100%;
    min-height: 44px;
    padding: 10px 32px 10px 12px;
    border: 1px solid var(--color-input-border);
    border-radius: var(--explore-control-radius, 8px);
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 16px;
    cursor: pointer;
  }
  select:focus-visible {
    outline: 3px solid var(--explore-picker-focus, var(--color-primary));
    outline-offset: 4px;
  }
  .app-style-picker label {
    color: var(--color-text-secondary);
  }
  .app-style-picker select {
    border-radius: 8px;
  }
  .app-style-picker select:focus-visible {
    outline-color: var(--color-primary);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
