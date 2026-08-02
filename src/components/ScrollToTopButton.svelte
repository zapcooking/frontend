<script lang="ts">
  /**
   * Floating "back to top" button.
   *
   * Appears once the page has been scrolled down a screenful, and smooth-
   * scrolls the #app-scroll container back to the top on tap. Watches the
   * same #app-scroll element the rest of the app scrolls in (the layout's
   * overflow-y-auto container), with a window-scroll fallback mirroring
   * CreateMenuButton's pattern. Mounted once in the root layout so it's
   * available on every scrollable surface (feeds, recipes, profile, …).
   */
  import { onMount, onDestroy } from 'svelte';
  // fade, not fly: fly sets an inline transform, which would override the
  // translateX(-50%) that centers the button and jump it left mid-animation.
  import { fade } from 'svelte/transition';
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp';
  import { getActiveScrollTop, scrollActiveSurfaceToTop } from '$lib/activeScrollSurface';

  // Show only after scrolling at least this many px down, so it never
  // competes with page chrome when the user is already near the top.
  const SHOW_THRESHOLD_PX = 600;
  // Matches CreateMenuButton's fade-out window, so both floating controls
  // dim and restore in step while the user is scrolling.
  const SCROLL_IDLE_MS = 160;

  let visible = false;
  let isScrolling = false;
  let scrollEl: HTMLElement | null = null;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  function onScroll() {
    const top = getActiveScrollTop(scrollEl);
    visible = top > SHOW_THRESHOLD_PX;

    // Dim while actively scrolling (same treatment as the compose FAB) so
    // the control stays out of the way of the content passing under it.
    isScrolling = true;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, SCROLL_IDLE_MS);
  }

  function scrollToTop() {
    scrollActiveSurfaceToTop(scrollEl);
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    // Resolve the container after this component and its parent layout mount.
    scrollEl = document.getElementById('app-scroll');
    if (scrollEl) {
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
    }
    // Fallback for any route that scrolls the window rather than the
    // container (matches CreateMenuButton's dual-listener approach).
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      scrollEl?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
  });
</script>

{#if visible}
  <button
    type="button"
    on:click={scrollToTop}
    aria-label="Back to top"
    class="scroll-to-top-btn"
    class:is-scrolling={isScrolling}
    transition:fade={{ duration: 150 }}
  >
    <CaretUpIcon size={22} weight="bold" />
  </button>
{/if}

<style>
  .scroll-to-top-btn {
    position: fixed;
    /* Centered on the CONTENT area, not the raw viewport: on wide desktop
       the fixed sidebar occupies the left edge, so viewport-centering would
       sit visibly right of the content column. --content-left is the
       sidebar offset (0 on mobile, set per-breakpoint below), so the
       midpoint is (content-left + 100%) / 2. Keeps it clear of the compose
       FAB (bottom-right) and cooking-tools widget (bottom-left) either way.
       --bottom-nav-height lifts it above the mobile bottom nav. */
    --content-left: 0px;
    left: calc(50% + var(--content-left) / 2);
    transform: translateX(-50%);
    bottom: calc(var(--bottom-nav-height, 0px) + 1rem + var(--timer-widget-offset, 0px));
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 9999px;
    cursor: pointer;
    color: var(--color-text-primary);
    background-color: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    transition: transform 0.12s ease, background-color 0.12s ease, opacity 0.12s ease;
  }
  .scroll-to-top-btn:hover {
    background-color: var(--color-bg-hover, var(--color-input-bg));
  }
  /* Dim out of the way while scrolling — mirrors .create-trigger.is-scrolling
     on the compose FAB so both floating controls behave identically. */
  .scroll-to-top-btn.is-scrolling {
    opacity: 0.45;
  }
  .scroll-to-top-btn:active {
    /* Keep the centering translate — a bare scale() would drop it and
       snap the button to the left edge mid-press. */
    transform: translateX(-50%) scale(0.92);
  }
  /* Desktop has no bottom nav; tuck closer to the bottom edge. The sidebar
     offsets match the layout's #app-scroll margins (lg:ml-[calc(14rem+5px)],
     xl:ml-[calc(20rem+5px)]) so the button centers on the content column. */
  @media (min-width: 1024px) {
    .scroll-to-top-btn {
      --content-left: calc(14rem + 5px);
      bottom: 1.25rem;
    }
  }
  @media (min-width: 1280px) {
    .scroll-to-top-btn {
      --content-left: calc(20rem + 5px);
    }
  }
</style>
