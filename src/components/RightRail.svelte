<script lang="ts">
  // Supplementary content column shown to the right of the main reading
  // column when the viewport is wide enough (2xl+). Never holds essential
  // content — it's hidden below the breakpoint, where the main column stands
  // alone. Sticky so it stays in view while the main column scrolls.
</script>

<aside class="right-rail">
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
</style>
