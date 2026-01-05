<script lang="ts">
  import TierCard from './TierCard.svelte';
  import type { PricingPeriod } from './paymentStore';

  export let period: PricingPeriod;
  export let spotsRemaining: number;
  export let showSoldOutState: boolean;

  // Tier data array - ensures consistent rendering order
  const tiers = ['open', 'cook', 'pro'] as const;
</script>

<!-- 
  Grid Layout:
  - Mobile (< md): Single column, cards stack vertically
  - Tablet (md): 2 columns, Pro spans both columns centered
  - Desktop (lg): 3 columns side by side
-->
<div data-pricing-grid class="pricing-grid">
  {#each tiers as tier}
    <div class="pricing-card-wrapper {tier === 'pro' ? 'pricing-card-pro' : ''}">
      <TierCard 
        {tier} 
        {period}
        spotsRemaining={tier === 'pro' ? spotsRemaining : undefined}
        showSoldOutState={tier === 'pro' ? showSoldOutState : undefined}
      />
    </div>
  {/each}
</div>

<style>
  .pricing-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    align-items: stretch;
  }

  .pricing-card-wrapper {
    display: flex;
    width: 100%;
  }

  /* Tablet: 2 columns */
  @media (min-width: 768px) {
    .pricing-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .pricing-card-pro {
      grid-column: span 2;
      max-width: 400px;
      margin: 0 auto;
    }
  }

  /* Desktop: 3 columns */
  @media (min-width: 1024px) {
    .pricing-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
    }

    .pricing-card-pro {
      grid-column: span 1;
      max-width: none;
      margin: 0;
    }
  }
</style>
