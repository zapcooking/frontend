<script lang="ts">
  import ChefHatIcon from 'phosphor-svelte/lib/CookingPot';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import CrownIcon from 'phosphor-svelte/lib/Crown';
  import type { MembershipTier } from '$lib/membershipStore';

  export let tier: MembershipTier;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let showLabel: boolean = false;

  const tierConfig = {
    open: {
      icon: ChefHatIcon,
      name: 'Open Table',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
      borderColor: 'border-emerald-300 dark:border-emerald-700'
    },
    cook: {
      icon: HeartIcon,
      name: 'Cook+',
      color: 'text-pink-600',
      bgColor: 'bg-pink-100 dark:bg-pink-900/30',
      borderColor: 'border-pink-300 dark:border-pink-700'
    },
    pro: {
      icon: CrownIcon,
      name: 'Pro Kitchen',
      color: 'text-orange-600',
      bgColor: 'bg-orange-100 dark:bg-orange-900/30',
      borderColor: 'border-orange-300 dark:border-orange-700'
    }
  };

  $: config = tierConfig[tier];
  $: IconComponent = config.icon;
  $: sizeConfig = {
    sm: { iconSize: 12, text: 'text-[10px]', padding: 'p-0.5', gap: 'gap-0.5' },
    md: { iconSize: 14, text: 'text-xs', padding: 'p-1', gap: 'gap-1' },
    lg: { iconSize: 16, text: 'text-xs', padding: 'p-1.5', gap: 'gap-1.5' }
  }[size];
</script>

{#if tier !== 'open'}
  <div
    class="inline-flex items-center justify-center {sizeConfig.gap} {sizeConfig.padding} rounded-full {config.bgColor} {config.borderColor} border"
    title={config.name}
  >
    <svelte:component this={IconComponent} size={sizeConfig.iconSize} weight="fill" class="{config.color}" />
    {#if showLabel}
      <span class="{sizeConfig.text} font-semibold {config.color}">
        {config.name}
      </span>
    {/if}
  </div>
{/if}

