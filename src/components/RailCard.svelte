<script lang="ts">
  export let title: string = '';
  /** A panel on the feed cards' surface (the /feed discovery column). */
  export let panel = false;
</script>

<section class="rail-card" class:panel>
  {#if title}
    <h3 class="rail-card-title">{title}</h3>
  {/if}
  <div class="rail-card-body">
    <slot />
  </div>
</section>

<style>
  /* Quiet by design: no box or fill, so the rail reads as secondary content
     and doesn't pull focus from the reading column. */
  .rail-card {
    background: transparent;
    border: 0;
    padding: 0;
  }
  /* Same surface and radius as a Fresh post card (FreshPostCard .fresh-post). */
  .rail-card.panel {
    background-color: var(--color-card-sunken);
    border-radius: 1rem;
    padding: 1.125rem 1.25rem;
  }
  .rail-card-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 1.25rem;
    color: var(--color-caption);
  }
  .panel .rail-card-title {
    margin-bottom: 0.875rem;
  }
  .rail-card-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .panel .rail-card-body {
    gap: 0.75rem;
  }
</style>
