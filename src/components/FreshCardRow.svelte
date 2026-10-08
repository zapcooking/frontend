<script lang="ts">
  /**
   * A row of tiles inside a special card: swipeable (scroll-snap) on
   * phones, `columns` across from 640px when it holds that many or fewer.
   */
  export let columns = 3;
  export let label = '';
</script>

<div class="row" role="list" aria-label={label || undefined} style="--cols: {columns}">
  <slot />
</div>

<style>
  .row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 72%;
    gap: 0.625rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    margin: 0 calc(-1 * var(--media-bleed-x));
    padding: 0 var(--media-bleed-x) 0.25rem;
    scroll-padding: 0 var(--media-bleed-x);
    scrollbar-width: none;
  }

  .row::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 640px) {
    .row {
      grid-auto-columns: calc(
        (100% - 2 * var(--media-bleed-x) - (var(--cols) - 1) * 0.625rem) / var(--cols)
      );
    }
  }

  .row > :global(*) {
    scroll-snap-align: start;
    min-width: 0;
  }
</style>
