<script lang="ts">
  import MagnifyingIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ShoppingBagIcon from 'phosphor-svelte/lib/ShoppingBag';
  import UtensilsIcon from 'phosphor-svelte/lib/ForkKnife';
</script>

<nav
  class="lg:hidden pt-2 bg-input w-full fixed bottom-0 left-0 grid grid-cols-4 grid-rows-1 text-center print:hidden bottom-nav-safe"
  style="color: var(--color-text-primary); border-top: 1px solid var(--color-input-border);"
>
  <a href="/recent" class="flex flex-col hover:text-primary">
    <MagnifyingIcon class="self-center" size={24} />
    Recipes
  </a>
  <a href="/community" class="flex flex-col hover:text-primary">
    <UtensilsIcon class="self-center" size={24} />
    Community
  </a>
  <a href="/explore" class="flex flex-col hover:text-primary">
    <LightningIcon class="self-center" size={24} />
    Explore
  </a>
  <a href="https://plebeian.market/community/seth@zap.cooking/zap-cooking-wear-orcd8yg6jd" target="_blank" rel="noopener noreferrer" class="flex flex-col hover:text-primary">
    <ShoppingBagIcon class="self-center" size={24} />
    Shop
  </a>
</nav>

<style>
  /* Add safe area padding for bottom navigation bar on Android/iOS */
  .bottom-nav-safe {
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }
</style>
