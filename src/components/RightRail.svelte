<script lang="ts">
  // Supplementary content column shown to the right of the main reading
  // column when the viewport is wide enough (2xl+). Never holds essential
  // content — it's hidden below the breakpoint, where the main column stands
  // alone. Sticky so it stays in view while the main column scrolls.
  //
  // `wide` (the /feed discovery column) appears from 1440px instead, where
  // the sidebar, the 672px feed column and this rail still fit, and scrolls
  // on its own when it is taller than the window.
  export let wide = false;
</script>

<aside class="right-rail" class:wide>
  <div class="right-rail-inner">
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
  /* The feed scroller (#app-scroll) already sits below the header, so a
     sticky child pins from its top edge (see the /feed tab row). */
  .wide .right-rail-inner {
    top: 1rem;
    max-height: calc(100dvh - var(--header-h, 4rem) - 2rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
</style>
