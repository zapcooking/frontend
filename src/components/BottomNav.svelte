<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import FlameIcon from 'phosphor-svelte/lib/Flame';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import { page } from '$app/stores';
  import { unreadCount } from '$lib/notificationStore';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { triggerNotificationsNav } from '$lib/notificationsNav';
  import { openWallet, closeWallet, walletModalOpen } from '$lib/wallet';

  $: pathname = $page.url.pathname;

  let navEl: HTMLElement;
  let resizeObserver: ResizeObserver | null = null;

  function updateNavHeight() {
    if (!browser || !navEl) return;
    const height = navEl.offsetHeight;
    document.documentElement.style.setProperty('--bottom-nav-height', `${height}px`);
  }

  onMount(() => {
    if (browser && navEl) {
      updateNavHeight();
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => updateNavHeight());
        resizeObserver.observe(navEl);
      }
    }
  });

  onDestroy(() => {
    if (resizeObserver) resizeObserver.disconnect();
  });

  function handleNotificationsClick(event: MouseEvent) {
    triggerNotificationsNav();
    if (pathname.startsWith('/notifications')) event.preventDefault();
  }
</script>

<nav
  bind:this={navEl}
  class="lg:hidden w-full fixed left-0 right-0 z-40 print:hidden bottom-nav-ios"
  style="background-color: var(--color-bg-secondary); overflow: visible;"
>
  <div class="grid grid-cols-5 nav-row">

    <!-- Feed -->
    <a href="/community" class="nav-tab" class:active={pathname === '/' || pathname.startsWith('/community')}>
      <FlameIcon size={28} weight={pathname === '/' || pathname.startsWith('/community') ? 'fill' : 'bold'} />
      <span class="sr-only">Feed</span>
    </a>

    <!-- Recipes -->
    <a href="/recipes" class="nav-tab" class:active={pathname.startsWith('/recipes') || pathname.startsWith('/recent')}>
      <ForkKnifeIcon size={28} weight={pathname.startsWith('/recipes') || pathname.startsWith('/recent') ? 'fill' : 'bold'} />
      <span class="sr-only">Recipes</span>
    </a>

    <!-- Wallet. Sits in the row like every other tab, with the same icon
         the nav menu uses: the raised disc read as a compose or action
         button, which is what that shape means in the apps this now
         matches, and it isn't one. -->
    <button
      on:click={() => ($walletModalOpen ? closeWallet() : openWallet())}
      class="nav-tab"
      class:active={$walletModalOpen}
      aria-label="Wallet"
    >
      <WalletIcon size={28} weight={$walletModalOpen ? 'fill' : 'bold'} />
      <span class="sr-only">Wallet</span>
    </button>

    <!-- Messages -->
    <a href="/messages" class="nav-tab" class:active={pathname.startsWith('/messages')}>
      <span class="relative">
        <EnvelopeSimpleIcon size={28} weight={pathname.startsWith('/messages') ? 'fill' : 'bold'} />
        {#if $totalUnreadCount > 0}
          <span class="badge-dot" aria-hidden="true"></span>
        {/if}
      </span>
      <span class="sr-only">Messages</span>
    </a>

    <!-- Notifications -->
    <a
      href="/notifications"
      class="nav-tab"
      class:active={pathname.startsWith('/notifications')}
      on:click={handleNotificationsClick}
    >
      <span class="relative">
        <BellIcon size={28} weight={pathname.startsWith('/notifications') ? 'fill' : 'bold'} />
        {#if $unreadCount > 0}
          <span class="badge-dot" aria-hidden="true"></span>
        {/if}
      </span>
      <span class="sr-only">Alerts</span>
    </a>

  </div>
</nav>

<style>
  .bottom-nav-ios {
    bottom: 0;
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Fixed-height row so side icons center vertically instead of hugging
     the bottom edge. */
  .nav-row {
    height: 56px;
  }

  .nav-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 3px;
    opacity: 0.45;
    transition: opacity 0.15s ease;
    color: var(--color-text-primary);
  }

  .nav-tab:hover,
  .nav-tab.active {
    opacity: 1;
  }

  .nav-tab.active {
    color: var(--color-accent, #f97316);
  }

  .badge-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: #ef4444;
    border: 2px solid var(--color-bg-secondary);
  }
</style>
