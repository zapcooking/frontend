<script lang="ts">
  /**
   * Meal Planner teaser — static Phase 1 placeholder for the Phase 3
   * planner. Public (not login-gated) and deliberately CTA-free: there
   * is no planner functionality to link to yet.
   */
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';
</script>

<svelte:head>
  <title>Meal Planner - zap.cooking</title>
  <meta
    name="description"
    content="Plan your week from your saved recipes and generate your grocery list — coming soon to My Kitchen."
  />
</svelte:head>

<div class="teaser-card">
  <CalendarBlankIcon size={28} weight="fill" class="text-orange-500" />
  <div class="teaser-content">
    <p class="teaser-title">Meal Planner — coming soon</p>
    <p class="teaser-desc">
      Plan your week from your saved recipes, then generate your grocery list in one tap. Private
      to you, like everything in My Kitchen.
    </p>
  </div>
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
</style>
