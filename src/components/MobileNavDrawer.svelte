<script lang="ts">
  import { fly } from 'svelte/transition';
  import { goto, afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { mobileNavOpen } from '$lib/stores/mobileNav';

  import XIcon from 'phosphor-svelte/lib/X';
  import FlameIcon from 'phosphor-svelte/lib/Flame';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CrownSimpleIcon from 'phosphor-svelte/lib/CrownSimple';
  import HandshakeIcon from 'phosphor-svelte/lib/Handshake';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { walletConnected, openWallet, walletModalOpen } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';

  $: pathname = $page.url.pathname;
  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  type NavItem = {
    href: string;
    label: string;
    icon: any;
    match: (path: string) => boolean;
    badge?: 'messages' | 'wallet';
  };

  const homeItems: NavItem[] = [
    { href: '/community', label: 'Feed', icon: FlameIcon, match: (p) => p === '/' || p.startsWith('/community') },
    { href: '/recipes', label: 'Recipes', icon: ForkKnifeIcon, match: (p) => p.startsWith('/recipes') || p.startsWith('/recent') },
    { href: '/reads', label: 'Reads', icon: NewspaperIcon, match: (p) => p.startsWith('/reads') || p.startsWith('/r/') },
    { href: '/polls', label: 'Polls', icon: ChartBarHorizontalIcon, match: (p) => p.startsWith('/polls') },
    { href: '/market', label: 'Market', icon: StorefrontIcon, match: (p) => p.startsWith('/market') || p.startsWith('/my-store') },
    { href: '/messages', label: 'Messages', icon: EnvelopeSimpleIcon, match: (p) => p.startsWith('/messages'), badge: 'messages' },
    { href: '/memories', label: 'Memories', icon: ClockCounterClockwiseIcon, match: (p) => p.startsWith('/memories') },
  ];

  const kitchenItems: NavItem[] = [
    { href: '/cookbook', label: 'Cookbook', icon: CookbookIcon, match: (p) => p.startsWith('/cookbook') },
    { href: '/grocery', label: 'Grocery Lists', icon: ShoppingCartIcon, match: (p) => p.startsWith('/grocery') },
    { href: '/wallet', label: 'Wallet', icon: WalletIcon, match: () => $walletModalOpen, badge: 'wallet' },
    { href: '/nourish', label: 'Nourish', icon: LeafIcon, match: (p) => p.startsWith('/nourish') },
    { href: '/membership', label: 'Membership', icon: CrownSimpleIcon, match: (p) => p.startsWith('/membership') },
    { href: '/sponsors', label: 'Sponsors', icon: HandshakeIcon, match: (p) => p.startsWith('/sponsors') },
  ];

  function close() {
    mobileNavOpen.set(false);
  }

  function navigate(path: string) {
    close();
    goto(path);
  }

  afterNavigate(() => close());

  $: if (browser) {
    document.body.style.overflow = $mobileNavOpen ? 'hidden' : '';
  }

  // Touch swipe to close
  let touchStartX = 0;
  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
  }
  function handleTouchEnd(e: TouchEvent) {
    if (touchStartX - e.changedTouches[0].clientX > 80) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $mobileNavOpen}
  <!-- Backdrop -->
  <div
    class="nav-drawer-backdrop"
    on:click={close}
    on:keydown={handleKeydown}
    role="presentation"
    transition:fly={{ duration: 250, opacity: 0 }}
  ></div>

  <!-- Drawer -->
  <aside
    class="nav-drawer"
    transition:fly={{ x: -320, duration: 280, easing: (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2) }}
    on:touchstart={handleTouchStart}
    on:touchend={handleTouchEnd}
    role="dialog"
    aria-modal="true"
    aria-label="Navigation"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style="border-color: var(--color-input-border);">
      <img src="/zapcooking-text-light.svg" class="w-32 dark:hidden" alt="Zap Cooking" />
      <img src="/zapcooking-text-dark.svg" class="w-32 hidden dark:block" alt="Zap Cooking" />
      <button on:click={close} class="p-2 rounded-full transition-colors cursor-pointer" style="color: var(--color-text-primary);" aria-label="Close menu">
        <XIcon size={22} weight="bold" />
      </button>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

      <!-- HOME -->
      <div>
        <h3 class="px-3 pb-2 font-semibold uppercase tracking-wider" style="color: var(--color-caption); font-size: 11px;">Home</h3>
        <ul class="flex flex-col gap-0.5">
          {#each homeItems as item}
            {@const active = item.match(pathname)}
            <li>
              <button
                on:click={() => navigate(item.href)}
                class="nav-row w-full {active ? 'nav-row-active' : ''}"
                style="color: var(--color-text-primary);"
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0">
                  <svelte:component this={item.icon} size={20} weight={item.badge === 'messages' && $totalUnreadCount > 0 ? 'fill' : 'regular'} />
                  {#if item.badge === 'messages' && $totalUnreadCount > 0}
                    <span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" aria-hidden="true"></span>
                  {/if}
                </span>
                <span class="font-medium">{item.label}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>

      <!-- MY KITCHEN -->
      <div>
        <h3 class="px-3 pb-2 font-semibold uppercase tracking-wider" style="color: var(--color-caption); font-size: 11px;">My Kitchen</h3>
        <ul class="flex flex-col gap-0.5">
          {#each kitchenItems as item}
            {@const active = item.match(pathname)}
            <li>
              <button
                on:click={() => { if (item.badge === 'wallet') { close(); openWallet(); } else { navigate(item.href); } }}
                class="nav-row w-full {active ? 'nav-row-active' : ''}"
                style="color: var(--color-text-primary);"
              >
                <span class="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0">
                  <svelte:component this={item.icon} size={20} />
                </span>
                <span class="font-medium">{item.label}</span>
                {#if item.badge === 'wallet' && !hasWallet}
                  <span class="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Connect</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>

    </nav>
  </aside>
{/if}

<style>
  .nav-drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .nav-drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 9999;
    width: 100%;
    max-width: 18rem;
    display: flex;
    flex-direction: column;
    background-color: var(--color-bg-secondary);
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.3);
  }

  .nav-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border-radius: 0.75rem;
    transition: background-color 0.15s;
    cursor: pointer;
    min-height: 44px;
  }

  .nav-row:hover {
    background-color: var(--color-input-bg);
  }

  .nav-row-active {
    border-left: 2px solid #f97316;
  }
</style>
