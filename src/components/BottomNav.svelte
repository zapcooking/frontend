<script lang="ts">
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
  import CompassIcon from 'phosphor-svelte/lib/Compass';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';

  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);
</script>

<nav
  class="lg:hidden pt-2 bg-input w-full fixed bottom-0 left-0 grid grid-cols-4 grid-rows-1 text-center print:hidden bottom-nav-safe"
  style="color: var(--color-text-primary); border-top: 1px solid var(--color-input-border);"
>
  <a href="/recent" class="flex flex-col hover:text-primary">
    <ForkKnifeIcon class="self-center" size={24} />
    Recipes
  </a>
  <a href="/community" class="flex flex-col hover:text-primary">
    <ChatCircleDotsIcon class="self-center" size={24} />
    Community
  </a>
  <a href="/explore" class="flex flex-col hover:text-primary">
    <CompassIcon class="self-center" size={24} />
    Explore
  </a>
  <a href="/wallet" class="flex flex-col hover:text-primary">
    <span class="relative self-center">
      <LightningIcon size={24} />
      {#if !hasWallet}
        <span
          class="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-amber-500 border-2 border-input"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
    Wallet
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
