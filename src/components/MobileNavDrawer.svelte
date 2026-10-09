<script lang="ts">
  import { fly } from 'svelte/transition';
  import { slide } from 'svelte/transition';
  import { afterNavigate } from '$app/navigation';
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
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CrownSimpleIcon from 'phosphor-svelte/lib/CrownSimple';
  import HandshakeIcon from 'phosphor-svelte/lib/Handshake';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { navBalanceVisible } from '$lib/wallet';
  import { userPublickey } from '$lib/nostr';
  import SidebarWallet from './SidebarWallet.svelte';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import BasketIcon from 'phosphor-svelte/lib/Basket';
  import MeasuringCupIcon from './icons/MeasuringCupIcon.svelte';
  import { cookingToolsStore } from '$lib/stores/cookingToolsWidget';

  $: pathname = $page.url.pathname;

  type NavItem = {
    href: string;
    label: string;
    icon: any;
    match: (path: string) => boolean;
    badge?: 'messages';
  };

  const homeItems: NavItem[] = [
    { href: '/feed', label: 'Feed', icon: FlameIcon, match: (p) => p === '/' || p.startsWith('/feed') },
    { href: '/recipes', label: 'Recipes', icon: ForkKnifeIcon, match: (p) => p.startsWith('/recipes') || p.startsWith('/recent') },
    { href: '/reads', label: 'Reads', icon: NewspaperIcon, match: (p) => p.startsWith('/reads') || p.startsWith('/r/') },
    { href: '/polls', label: 'Polls', icon: ChartBarHorizontalIcon, match: (p) => p.startsWith('/polls') },
    { href: '/market', label: 'Market', icon: StorefrontIcon, match: (p) => p.startsWith('/market') || p.startsWith('/my-store') },
    { href: '/messages', label: 'Messages', icon: EnvelopeSimpleIcon, match: (p) => p.startsWith('/messages'), badge: 'messages' },
    { href: '/memories', label: 'Memories', icon: ClockCounterClockwiseIcon, match: (p) => p.startsWith('/memories') },
  ];

  const kitchenItems: NavItem[] = [
    { href: '/my-kitchen', label: 'My Kitchen', icon: CookbookIcon, match: (p) => p.startsWith('/my-kitchen') },
    { href: '/nourish', label: 'Nourish', icon: LeafIcon, match: (p) => p.startsWith('/nourish') },
    { href: '/membership', label: 'Membership', icon: CrownSimpleIcon, match: (p) => p.startsWith('/membership') },
    { href: '/sponsors', label: 'Sponsors', icon: HandshakeIcon, match: (p) => p.startsWith('/sponsors') },
    { href: '/pantry', label: 'The Pantry Relay', icon: BasketIcon, match: (p) => p.startsWith('/pantry') },
  ];

  // My Kitchen collapses to save vertical space; defaults open when the
  // user is on one of its pages. The component is NOT remounted when the
  // {#if $mobileNavOpen} block reopens, so a one-time init would go
  // stale: reactively expand on match (never auto-collapse on the way
  // out, the user's open/closed choice survives browsing). ($page
  // directly: the `pathname` reactive hasn't run at init time.)
  let kitchenExpanded = kitchenItems.some((item) => item.match($page.url.pathname));

  $: {
    const onKitchenRoute = kitchenItems.some((item) => item.match($page.url.pathname));
    if (onKitchenRoute && !kitchenExpanded) {
      kitchenExpanded = true;
    }
  }

  function close() {
    mobileNavOpen.set(false);
  }

  // Same row styling as the desktop sidebar (DesktopSideNav.linkClasses)
  // so active/hover states match across both menus.
  function linkClasses(active: boolean) {
    return [
      'group',
      'w-full',
      'flex',
      'items-center',
      'gap-3',
      'px-3',
      'py-1.5',
      'rounded-xl',
      'transition-colors',
      'cursor-pointer',
      active ? 'nav-active border-l-2 border-orange-500' : 'nav-hover'
    ].join(' ');
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
        <!-- Unlabeled group: spacer keeps the items at the position the
             removed heading held. -->
        <div class="h-[25px]" aria-hidden="true"></div>
        <ul class="flex flex-col gap-1">
          {#each homeItems as item}
            {@const active = item.match(pathname)}
            <li>
              <a
                href={item.href}
                on:click={close}
                class={linkClasses(active)}
                style="color: var(--color-text-primary);"
                aria-current={active ? 'page' : undefined}
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0">
                  <svelte:component this={item.icon} size={20} weight={item.badge === 'messages' && $totalUnreadCount > 0 ? 'fill' : 'regular'} />
                  {#if item.badge === 'messages' && $totalUnreadCount > 0}
                    <span
                      class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2"
                      style="border-color: var(--color-bg-secondary);"
                      aria-hidden="true"
                    ></span>
                  {/if}
                </span>
                <span class="font-medium">{item.label}</span>
              </a>
            </li>
          {/each}
        </ul>
      </div>

      <!-- Wallet lives in its own section (not a nav link): a balance
           card, like the mobile app's wallet surface. Tapping it closes
           the drawer and opens the wallet modal (the drawer stacks above
           the modal, so it must close first). Sits ABOVE the My Kitchen
           group and carries no heading — same placement as the desktop
           sidebar. Hidden for logged-out users and when the wallet
           widget is switched off in settings. -->
      {#if $userPublickey && $navBalanceVisible}
        <div class="mt-1">
          <SidebarWallet onBeforeOpen={close} />
        </div>
      {/if}

      <!-- MY KITCHEN -->
      <div class="mt-1">
        <!-- Expandable group header (defaults closed — see kitchenExpanded) -->
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 pb-2 font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:opacity-80"
          style="color: var(--color-caption); font-size: 12px;"
          on:click={() => (kitchenExpanded = !kitchenExpanded)}
          aria-expanded={kitchenExpanded}
          aria-controls="kitchen-nav-mobile"
        >
          My Kitchen
          <CaretDownIcon
            size={12}
            weight="bold"
            class="transition-transform duration-200 {kitchenExpanded ? 'rotate-180' : ''}"
          />
        </button>
        {#if kitchenExpanded}
        <ul id="kitchen-nav-mobile" class="flex flex-col gap-1" transition:slide={{ duration: 200 }}>
          {#each kitchenItems as item}
            {@const active = item.match(pathname)}
            <li>
              <a
                href={item.href}
                on:click={close}
                class={linkClasses(active)}
                style="color: var(--color-text-primary);"
                aria-current={active ? 'page' : undefined}
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0">
                  <svelte:component this={item.icon} size={20} />
                </span>
                <span class="font-medium">{item.label}</span>
              </a>
            </li>
          {/each}

          <!-- Gadgets — a tool launcher, not a destination: one click
               opens the cooking-tools widget (same as the header's
               measuring cup). The drawer stacks above the widget, so it
               closes first. -->
          <li>
            <button
              type="button"
              class={linkClasses(false)}
              style="color: var(--color-text-primary);"
              on:click={() => {
                cookingToolsStore.toggle();
                close();
              }}
            >
              <span class="relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0">
                <MeasuringCupIcon size={20} />
              </span>
              <span class="font-medium">Gadgets</span>
            </button>
          </li>
        </ul>
        {/if}
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
</style>
