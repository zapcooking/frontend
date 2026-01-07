<script lang="ts">
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import UsersIcon from 'phosphor-svelte/lib/Users';

  export let prepTime: string | null = null;
  export let cookTime: string | null = null;
  export let servings: string | null = null;

  // Optional scroll handlers
  export let scrollToDetails: (() => void) | null = null;
  export let scrollToIngredients: (() => void) | null = null;

  function handleCookTimeClick() {
    if (scrollToDetails) {
      scrollToDetails();
    }
  }

  function handleServingsClick() {
    if (scrollToIngredients) {
      scrollToIngredients();
    }
  }

  // Check if we have any data to display
  $: hasData = prepTime || cookTime || servings;
</script>

{#if hasData}
  <div class="overview-card">
    <dl class="overview-grid">
      {#if prepTime}
        <div class="overview-item">
          <dt class="overview-label">
            <ClockIcon size={20} weight="regular" class="overview-icon" aria-hidden="true" />
            <span>Prep Time</span>
          </dt>
          <dd class="overview-value">{prepTime}</dd>
        </div>
      {/if}

      {#if cookTime}
        <div class="overview-item {scrollToDetails ? 'cursor-pointer' : ''}" role={scrollToDetails ? 'button' : undefined} tabindex={scrollToDetails ? 0 : undefined} on:click={handleCookTimeClick} on:keydown={(e) => e.key === 'Enter' && handleCookTimeClick()}>
          <dt class="overview-label">
            <CookingPotIcon size={20} weight="regular" class="overview-icon" aria-hidden="true" />
            <span>Cook Time</span>
          </dt>
          <dd class="overview-value">{cookTime}</dd>
        </div>
      {/if}

      {#if servings}
        <div class="overview-item {scrollToIngredients ? 'cursor-pointer' : ''}" role={scrollToIngredients ? 'button' : undefined} tabindex={scrollToIngredients ? 0 : undefined} on:click={handleServingsClick} on:keydown={(e) => e.key === 'Enter' && handleServingsClick()}>
          <dt class="overview-label">
            <UsersIcon size={20} weight="regular" class="overview-icon" aria-hidden="true" />
            <span>Servings</span>
          </dt>
          <dd class="overview-value">{servings}</dd>
        </div>
      {/if}
    </dl>
  </div>
{/if}

<style>
  .overview-card {
    padding: 1rem 1.25rem;
    background-color: var(--color-input-bg, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.75rem;
    margin: 0.5rem 0;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin: 0;
    padding: 0;
  }

  @media (min-width: 640px) {
    .overview-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .overview-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }
  }

  .overview-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    transition: opacity 0.2s ease;
  }

  .overview-item.cursor-pointer {
    cursor: pointer;
  }

  .overview-item.cursor-pointer:hover {
    opacity: 0.8;
  }

  .overview-item.cursor-pointer:focus {
    outline: 2px solid var(--color-primary, #3b82f6);
    outline-offset: 2px;
    border-radius: 0.25rem;
  }

  .overview-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .overview-icon {
    flex-shrink: 0;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  }

  .overview-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary, rgba(255, 255, 255, 0.9));
    margin: 0;
    line-height: 1.5;
  }

  @media (min-width: 640px) {
    .overview-value {
      font-size: 1.125rem;
    }
  }
</style>

