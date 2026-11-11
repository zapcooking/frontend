<script lang="ts">
  /**
   * A miniature of the app in one theme: patterned canvas, sidebar, header with
   * a search field, and the solid content sheet holding two recipe cards. The
   * theme tokens come from the rescoped theme CSS the gallery injects
   * ($lib/themePreviewCss), so the miniature always matches the real theme.
   */
  import { findExploreStyle } from '$lib/themeStyles';

  export let theme: string;
  export let mode: 'light' | 'dark';

  const style = findExploreStyle(theme);
</script>

<div class="theme-preview" data-preview-theme={theme} data-preview-mode={mode} aria-hidden="true">
  <div class="pv-side">
    <span class="pv-logo"></span>
    <span class="pv-nav pv-nav-on"></span>
    <span class="pv-nav"></span>
    <span class="pv-nav"></span>
  </div>
  <div class="pv-main">
    <div class="pv-header">
      <span class="pv-search">{style.search ?? 'Search recipes…'}</span>
      <span class="pv-action">Join</span>
    </div>
    <div class="pv-sheet">
      <div class="pv-card">
        <span class="pv-photo"></span>
        <span class="pv-title">Weeknight ramen</span>
        <span class="pv-caption">25 min · 4 servings</span>
      </div>
      <div class="pv-card">
        <span class="pv-photo pv-photo-alt"></span>
        <span class="pv-title">Lemon olive cake</span>
        <span class="pv-caption">1 hr · 8 slices</span>
      </div>
    </div>
  </div>
</div>

<style>
  .theme-preview {
    display: flex;
    height: 100%;
    overflow: hidden;
    background-color: var(--color-bg-primary);
    background-image: var(--mood-texture);
    background-size: var(--mood-texture-size);
    background-position: var(--mood-texture-position);
    color: var(--color-text-primary);
    font-size: 11px;
    line-height: 1.25;
    text-align: left;
  }
  .pv-side {
    display: flex;
    flex: 0 0 26%;
    flex-direction: column;
    gap: 8px;
    padding: 12px 10px;
  }
  .pv-logo {
    width: 70%;
    height: 9px;
    margin-bottom: 6px;
    border-radius: 3px;
    background: var(--color-text-primary);
  }
  .pv-nav {
    width: 80%;
    height: 7px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--color-text-secondary) 45%, transparent);
  }
  .pv-nav-on {
    background: var(--color-primary);
  }
  .pv-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .pv-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-input-border) 60%, transparent);
  }
  .pv-search {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 4px 8px;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: var(--color-input-bg);
    color: var(--color-caption);
    white-space: nowrap;
    box-shadow: var(--mood-input-shadow);
  }
  .pv-action {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--explore-action-bg, var(--color-primary));
    color: var(--explore-action-ink, var(--color-on-action, #fff));
    font-weight: 600;
    box-shadow: var(--mood-action-shadow);
  }
  .pv-sheet {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 12px;
    /* Transparent, like the real app: the recipe cards float on the textured
       canvas with the motif showing in the gaps and around them. */
    background: transparent;
  }
  .pv-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--color-text-secondary) 22%, transparent);
    border-radius: 8px;
    background-color: var(--color-bg-secondary);
    background-image: var(--mood-surface-sheen);
    box-shadow: var(--mood-surface-shadow);
  }
  .pv-photo {
    height: 44px;
    margin-bottom: 3px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--color-explore-peach, #f5d8c4), var(--color-primary));
  }
  .pv-photo-alt {
    background: linear-gradient(135deg, var(--color-explore-sage, #dfe0c8), var(--color-card-sunken, #ccc));
  }
  .pv-title {
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pv-caption {
    overflow: hidden;
    color: var(--color-caption);
    font-size: 10px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
