<script lang="ts">
  export let title: string = '';
</script>

<section class="rail-card">
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
  .rail-card-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 1.25rem;
    color: var(--color-caption);
  }
  .rail-card-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
</style>
