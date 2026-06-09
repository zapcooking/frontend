<script lang="ts">
  /**
   * Compact inline Cheffy launcher for the Explore (home) page. Replaces
   * the older large card so the homepage stays focused on browsing
   * recipes and there's no large Cheffy surface competing with the
   * persistent floating launcher. Tapping it opens the Cheffy messenger.
   */
  import { openCheffy } from '$lib/stores/cheffyChat';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
</script>

<button type="button" class="cheffy-inline" on:click={() => openCheffy()}>
  <CheffyAvatar size={32} expression="happy" />
  <span class="cheffy-inline-text">
    <span class="lead">Not sure what to make?</span>
    <span class="cta">Ask Cheffy</span>
  </span>
  <CaretRightIcon size={18} weight="bold" class="cheffy-inline-caret" />
</button>

<style>
  .cheffy-inline {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 14px;
    background-color: var(--color-bg-secondary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 20%, var(--color-input-border));
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition:
      background-color 140ms ease,
      transform 140ms ease;
  }
  .cheffy-inline:hover {
    background-color: color-mix(in srgb, var(--color-primary) 6%, var(--color-bg-secondary));
  }
  .cheffy-inline:active {
    transform: scale(0.995);
  }
  .cheffy-inline:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }
  .cheffy-inline-text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
    flex: 1;
  }
  .lead {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }
  .cta {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-primary);
  }
  .cheffy-inline :global(.cheffy-inline-caret) {
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .cheffy-inline {
      transition: none;
    }
  }
</style>
