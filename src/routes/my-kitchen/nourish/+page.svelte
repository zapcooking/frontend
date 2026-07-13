<script lang="ts">
  /**
   * Nourish placeholder — static Phase 1 stand-in for the Phase 4
   * personal Nourish section. Public, and links OUT to the catalog
   * explorer rather than embedding it (the personal rollups arrive
   * with Phases 3–4).
   */
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
</script>

<svelte:head>
  <title>Nourish - My Kitchen - zap.cooking</title>
  <meta
    name="description"
    content="Personal Nourish insights are coming to My Kitchen on zap.cooking."
  />
</svelte:head>

<div class="teaser-card">
  <LeafIcon size={28} weight="fill" class="nourish-leaf" />
  <div class="teaser-content">
    <p class="teaser-title">Nourish, personalized</p>
    <p class="teaser-desc">
      Personal Nourish insights are coming to your kitchen — see how your saved recipes and planned
      weeks nourish you.
    </p>
  </div>
  <a href="/nourish/explore" class="explore-link">Browse analyzed recipes</a>
</div>

<style>
  .teaser-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 3rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .teaser-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 28rem;
  }
  .teaser-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }
  .teaser-desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .teaser-card :global(.nourish-leaf) {
    color: #22c55e;
  }
  .explore-link {
    font-size: 0.75rem;
    font-weight: 500;
    color: #22c55e;
    text-decoration: none;
    margin-top: 0.25rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid rgba(34, 197, 94, 0.2);
    transition:
      background 150ms,
      border-color 150ms;
  }
  .explore-link:hover {
    background: rgba(34, 197, 94, 0.08);
    border-color: rgba(34, 197, 94, 0.35);
  }
</style>
