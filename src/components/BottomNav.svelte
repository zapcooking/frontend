<script lang="ts">
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import CompassIcon from 'phosphor-svelte/lib/Compass';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import { page } from '$app/stores';
  import { walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { unreadCount } from '$lib/notificationStore';
  import { triggerNotificationsNav } from '$lib/notificationsNav';

  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  $: pathname = $page.url.pathname;

  function handleNotificationsClick(event: MouseEvent) {
    triggerNotificationsNav();
    // If we're already on the page, prevent navigation and just refresh/scroll
    if (pathname.startsWith('/notifications')) {
      event.preventDefault();
    }
  }
</script>

<nav
  class="lg:hidden bg-input w-full fixed left-0 right-0 z-40 grid grid-cols-5 text-center print:hidden"
  style="color: var(--color-text-primary); border-top: 1px solid var(--color-input-border); bottom: env(safe-area-inset-bottom, 0px); padding: 0.5rem 0;"
>
  <a href="/community" class="flex flex-col items-center justify-center hover:text-primary">
    <ChatCircleDotsIcon class="self-center" size={24} />
    <span class="sr-only">Community</span>
  </a>
  <a href="/recent" class="flex flex-col items-center justify-center hover:text-primary">
    <ForkKnifeIcon class="self-center" size={24} />
    <span class="sr-only">Recipes</span>
  </a>
  <a href="/explore" class="flex flex-col items-center justify-center hover:text-primary">
    <CompassIcon class="self-center" size={24} />
    <span class="sr-only">Explore</span>
  </a>
  <a href="/wallet" class="flex flex-col items-center justify-center hover:text-primary">
    <span class="relative self-center">
      <WalletIcon size={24} />
      {#if !hasWallet}
        <span
          class="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-amber-500 border-2 border-input"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
    <span class="sr-only">Wallet</span>
  </a>
  <a
    href="/notifications"
    class="flex flex-col items-center justify-center hover:text-primary"
    on:click={handleNotificationsClick}
  >
    <span class="relative self-center">
      <BellIcon size={24} weight={$unreadCount > 0 ? 'fill' : 'regular'} />
      {#if $unreadCount > 0}
        <span
          class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-input"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
    <span class="sr-only">Notifications</span>
  </a>
</nav>
