<script lang="ts">
  /**
   * Floating Cheffy launcher. Sits one button ABOVE the orange create
   * FAB on every breakpoint (same right column, stacked) so it never
   * overlaps create or the bottom nav, and clears the safe-area inset.
   *
   * Visually distinct from the solid-orange create button: a surface
   * chip carrying the colourful compact Cheffy character. First-time
   * visitors briefly see an expanded "Need dinner help?" label that then
   * collapses to the icon.
   */
  import { onMount, onDestroy } from 'svelte';
  import CheffyIcon from './icons/CheffyIcon.svelte';
  import {
    cheffyOpen,
    cheffyHintSeen,
    dismissCheffyHint,
    openCheffy
  } from '$lib/stores/cheffyChat';

  let hintTimer: ReturnType<typeof setTimeout>;
  // Show the expanded hint only for first-timers, and only this session.
  let showHint = false;

  // Scroll-dim — mirrors the behaviour on CreateMenuButton (the orange
  // create FAB that sits directly below us). Both launchers dim to
  // 0.45 opacity while the page is actively scrolling so they don't
  // distract from the content, and snap back ~160ms after scroll ends.
  let isScrolling = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleScroll() {
    isScrolling = true;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 160);
  }

  onMount(() => {
    if (!$cheffyHintSeen) {
      showHint = true;
      // Collapse to the icon after a few seconds.
      hintTimer = setTimeout(() => {
        showHint = false;
        dismissCheffyHint();
      }, 6000);
    }

    if (typeof window === 'undefined') return;
    // Scrolling happens on the #app-scroll container, not the window.
    // Window listener is a defensive fallback for routes that scroll the
    // window directly.
    const scrollContainer = document.getElementById('app-scroll');
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
  });

  onDestroy(() => {
    if (hintTimer) clearTimeout(hintTimer);
    if (scrollTimeout) clearTimeout(scrollTimeout);
    if (typeof window === 'undefined') return;
    const scrollContainer = document.getElementById('app-scroll');
    scrollContainer?.removeEventListener('scroll', handleScroll);
    window.removeEventListener('scroll', handleScroll);
  });

  function launch() {
    showHint = false;
    if (hintTimer) clearTimeout(hintTimer);
    openCheffy();
  }
</script>

{#if !$cheffyOpen}
  <button
    id="cheffy-launcher-btn"
    type="button"
    class="cheffy-launcher"
    class:has-hint={showHint}
    class:is-scrolling={isScrolling}
    on:click={launch}
    aria-label="Open Cheffy"
  >
    {#if showHint}
      <span class="hint" aria-hidden="true">Need dinner help?</span>
    {/if}
    <span class="launcher-icon" aria-hidden="true">
      <CheffyIcon size={32} expression="happy" />
    </span>
  </button>
{/if}

<style>
  .cheffy-launcher {
    position: fixed;
    right: 1.25rem;
    /* One button above the create FAB: its bottom (40px nav + safe-area
       + 1rem) + the 56px FAB + a 0.75rem gap. Mobile / tablet. */
    bottom: calc(
      40px + env(safe-area-inset-bottom, 0px) + 1rem + var(--timer-widget-offset, 0px) + 56px +
        0.75rem
    );
    z-index: 40;

    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 54px;
    min-width: 54px;
    padding: 0 7px;
    border-radius: 999px;
    background-color: var(--color-bg-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-input-border));
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.18),
      0 1px 3px rgba(0, 0, 0, 0.12);
    color: var(--color-text-primary);
    cursor: pointer;
    transition:
      transform 160ms ease,
      box-shadow 160ms ease;
  }
  /* Desktop: the create FAB drops to bottom:1.25rem, so we stack above
     that instead (no bottom nav at this width). */
  @media (min-width: 1024px) {
    .cheffy-launcher {
      bottom: calc(1.25rem + var(--timer-widget-offset, 0px) + 56px + 0.75rem);
    }
  }

  .cheffy-launcher:hover {
    transform: translateY(-1px);
    box-shadow:
      0 10px 24px rgba(0, 0, 0, 0.22),
      0 2px 5px rgba(0, 0, 0, 0.14);
  }
  .cheffy-launcher:active {
    transform: scale(0.97);
  }
  .cheffy-launcher:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }

  /* Dim while the page is actively scrolling — matches CreateMenuButton.
     pointer-events:none so a tap landing mid-scroll doesn't accidentally
     pop the chat panel; restores ~160 ms after scroll ends. */
  .cheffy-launcher.is-scrolling {
    opacity: 0.45;
    pointer-events: none;
    transition: opacity 160ms ease;
  }

  .launcher-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
    flex-shrink: 0;
  }

  .hint {
    padding-left: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--color-text-primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .cheffy-launcher {
      transition: none;
    }
    .cheffy-launcher:hover {
      transform: none;
    }
  }
</style>
