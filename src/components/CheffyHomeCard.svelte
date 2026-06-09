<script lang="ts">
  /**
   * Lightweight, borderless Cheffy mention for the Explore (home) page.
   *
   * On mobile the persistent floating launcher is the primary way in, so
   * the homepage must NOT also carry a large bordered Cheffy card — that
   * would be a duplicate entry point. This is a single, low-noise inline
   * row that stays subordinate to browsing recipes and opens the same
   * messenger.
   */
  import { openCheffy } from '$lib/stores/cheffyChat';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
</script>

<button type="button" class="cheffy-row" on:click={() => openCheffy()}>
  <span class="muted">Need help deciding?</span>
  <span class="cta">Ask Cheffy</span>
  <CaretRightIcon size={15} weight="bold" class="cheffy-row-caret" />
</button>

<style>
  .cheffy-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 2px;
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
    line-height: 1.2;
    cursor: pointer;
    text-align: left;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .cta {
    font-weight: 600;
    color: var(--color-primary);
  }
  .cheffy-row:hover .cta {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .cheffy-row :global(.cheffy-row-caret) {
    color: var(--color-primary);
    flex-shrink: 0;
  }
  .cheffy-row:focus-visible {
    outline: none;
    border-radius: 6px;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }
</style>
