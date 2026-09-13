<script lang="ts">
  /**
   * Annual / monthly selector for Cook+.
   *
   * A two-option radio group (roving tabindex, arrow keys) rather than a
   * pill toggle, so the price of each choice is visible before it is
   * chosen and the recommended option reads as recommended.
   */
  import {
    COOK_PLUS_ANNUAL_USD,
    COOK_PLUS_MONTHLY_USD,
    annualMonthlyEquivalent,
    annualSavingsPercent,
    type BillingPeriod
  } from '$lib/cookPlusPricing';

  export let period: BillingPeriod;
  export let onChange: (period: BillingPeriod) => void;

  type Option = {
    value: BillingPeriod;
    label: string;
    price: string;
    per: string;
    note: string;
    badge: string | null;
  };

  const options: Option[] = [
    {
      value: 'annual',
      label: 'Annual',
      price: `$${COOK_PLUS_ANNUAL_USD}`,
      per: '/year',
      note: `$${annualMonthlyEquivalent()} a month, billed once a year`,
      badge: `Best value · Save ${annualSavingsPercent()}%`
    },
    {
      value: 'monthly',
      label: 'Monthly',
      price: `$${COOK_PLUS_MONTHLY_USD.toFixed(2)}`,
      per: '/month',
      note: 'Billed monthly. Cancel anytime.',
      badge: null
    }
  ];

  let buttons: HTMLButtonElement[] = [];

  function select(index: number) {
    const next = options[index];
    if (!next) return;
    if (next.value !== period) onChange(next.value);
    buttons[index]?.focus();
  }

  function onKeydown(event: KeyboardEvent, index: number) {
    let target: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(target);
  }
</script>

<div class="plan-picker" role="radiogroup" aria-label="Billing period">
  {#each options as option, i (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={period === option.value}
      tabindex={period === option.value ? 0 : -1}
      class="plan-option"
      class:selected={period === option.value}
      data-period={option.value}
      bind:this={buttons[i]}
      on:click={() => select(i)}
      on:keydown={(e) => onKeydown(e, i)}
    >
      <span class="plan-radio" aria-hidden="true"></span>
      <span class="plan-main">
        <span class="plan-label">
          {option.label}
          {#if option.badge}
            <span class="plan-badge">{option.badge}</span>
          {/if}
        </span>
        <span class="plan-note">{option.note}</span>
      </span>
      <span class="plan-price">
        {option.price}<span class="plan-per">{option.per}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .plan-picker {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.625rem;
  }

  .plan-option {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1rem;
    border-radius: 14px;
    border: 1.5px solid var(--color-input-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      box-shadow 0.15s ease;
    font: inherit;
  }

  .plan-option:hover {
    border-color: var(--color-text-secondary);
  }

  .plan-option.selected {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, var(--color-bg-primary));
    box-shadow: 0 0 0 1px var(--color-primary);
  }

  .plan-option:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
  }

  .plan-radio {
    width: 18px;
    height: 18px;
    border-radius: 9999px;
    border: 2px solid var(--color-accent-gray);
    position: relative;
    flex-shrink: 0;
  }

  .selected .plan-radio {
    border-color: var(--color-primary);
  }

  .selected .plan-radio::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 9999px;
    background: var(--color-primary);
  }

  .plan-main {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .plan-label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 1rem;
  }

  .plan-badge {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.14);
    color: #15803d;
  }

  :global(html.dark) .plan-badge {
    color: #4ade80;
  }

  .plan-note {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
  }

  .plan-price {
    font-weight: 800;
    font-size: 1.15rem;
    white-space: nowrap;
    color: var(--color-text-primary);
  }

  .plan-per {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  @media (max-width: 380px) {
    .plan-option {
      grid-template-columns: auto 1fr;
    }
    .plan-price {
      grid-column: 2;
    }
  }
</style>
