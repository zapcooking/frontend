<script lang="ts">
  export let period: 'annual' | 'monthly';
  export let onPeriodChange: (period: 'annual' | 'monthly') => void;
  export let savingsPercent: number = 18;

  function handleToggle(newPeriod: 'annual' | 'monthly') {
    onPeriodChange(newPeriod);
  }
</script>

<div class="toggle-container">
  <button
    class="toggle-option {period === 'annual' ? 'active' : ''}"
    on:click={() => handleToggle('annual')}
    type="button"
    aria-pressed={period === 'annual'}
  >
    Annual
    {#if savingsPercent > 0}
      <span class="savings-badge">Save {savingsPercent}%</span>
    {/if}
  </button>
  <button
    class="toggle-option {period === 'monthly' ? 'active' : ''}"
    on:click={() => handleToggle('monthly')}
    type="button"
    aria-pressed={period === 'monthly'}
  >
    Monthly
  </button>
</div>

<style>
  .toggle-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
  }

  .toggle-option {
    padding: 0.75rem 1.5rem;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.95rem;
    border: 2px solid var(--color-input-border);
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-option:hover:not(.active) {
    border-color: var(--color-text-secondary);
  }

  .toggle-option.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(236, 71, 0, 0.3);
  }

  .savings-badge {
    background: #22c55e;
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
  }

  @media (max-width: 480px) {
    .toggle-option {
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      flex: 1;
      justify-content: center;
    }
  }
</style>
