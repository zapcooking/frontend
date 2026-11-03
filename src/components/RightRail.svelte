<script lang="ts">
  // Supplementary content column shown to the right of the main reading
  // column when the viewport is wide enough (2xl+). Never holds essential
  // content — it's hidden below the breakpoint, where the main column stands
  // alone. Sticky so it stays in view while the main column scrolls.
  //
  // `wide` (the /feed discovery column) appears from 1440px instead, where
  // the sidebar, the 672px feed column and this rail still fit. It is
  // sticky at the bottom: it scrolls with the feed, and once its bottom
  // reaches the bottom of the window it stays there (a column shorter than
  // the window stays at the top). Its parent must stretch it to the feed's
  // height (no `align-items: flex-start`), or there is nowhere to stick.
  import { onMount } from 'svelte';

  export let wide = false;

  /** Space kept above a short column / below a tall one. */
  const EDGE = 16;
  let inner: HTMLDivElement;
  let top: string | undefined;

  onMount(() => {
    if (!wide || typeof ResizeObserver === 'undefined') return;
    const scroller = document.getElementById('app-scroll');
    if (!scroller) return;
    // Sticky offsets count from the scroller's content box (below the
    // header padding), so the window's usable height excludes the padding.
    const update = () => {
      const cs = getComputedStyle(scroller);
      const view = scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      top = `${Math.min(EDGE, view - inner.offsetHeight - EDGE)}px`;
    };
    const ro = new ResizeObserver(update);
    ro.observe(inner);
    ro.observe(scroller);
    update();
    return () => ro.disconnect();
  });
</script>

<aside class="right-rail" class:wide>
  <div class="right-rail-inner" bind:this={inner} style:top>
    <slot />
  </div>
</aside>

<style>
  .right-rail {
    display: none;
    flex: none;
    width: 20rem;
  }
  /* Match Tailwind's 2xl breakpoint (1536px) — only appears when the content
     area has room for the reading column plus the rail. */
  @media (min-width: 1536px) {
    .right-rail {
      display: block;
    }
  }
  /* 1440 = xl sidebar (20rem + 5px) + the scroller's padding (26 + 16px) +
     the 672px column + a 2rem gap + this 20rem rail, with room left for a
     classic 17px scrollbar. */
  @media (min-width: 1440px) {
    .right-rail.wide {
      display: block;
    }
  }
  .right-rail-inner {
    position: sticky;
    top: calc(var(--header-h, 4rem) + 2.5rem);
    /* Align the rail's first item with the page's top control (e.g. the
       note view's back button, which sits in a pt-4 container). */
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  /* The column's `top` is set from its height (see the script). */
  .wide .right-rail-inner {
    top: 1rem;
  }
</style>
