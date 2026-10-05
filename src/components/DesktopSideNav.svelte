<script lang="ts">
  import { page } from '$app/stores';
  import { triggerExploreNav } from '$lib/exploreNav';
  import { goto } from '$app/navigation';
  import { theme } from '$lib/themeStore';
  import { userPublickey } from '$lib/nostr';
  import { navBalanceVisible } from '$lib/wallet';
  import SidebarWallet from './SidebarWallet.svelte';
  import { slide } from 'svelte/transition';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import TimerIcon from 'phosphor-svelte/lib/Timer';
  import CalculatorIcon from 'phosphor-svelte/lib/Calculator';
  import MeasuringCupIcon from './icons/MeasuringCupIcon.svelte';
  import BasketIcon from 'phosphor-svelte/lib/Basket';
  import { cookingToolsStore } from '$lib/stores/cookingToolsWidget';

  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import FlameIcon from 'phosphor-svelte/lib/Flame';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';

  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import CrownSimpleIcon from 'phosphor-svelte/lib/CrownSimple';
  import HandshakeIcon from 'phosphor-svelte/lib/Handshake';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import { totalUnreadCount } from '$lib/stores/messages';

  $: pathname = $page.url.pathname;
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  type NavItem = {
    href: string;
    label: string;
    icon: any;
    match?: (path: string) => boolean;
    badge?: 'members' | 'messagesDot';
    external?: boolean;
  };


  const primary: NavItem[] = [
    {
      href: '/feed',
      label: 'Feed',
      icon: FlameIcon,
      match: (p) => p === '/' || p.startsWith('/feed')
    },
    {
      href: '/recipes',
      label: 'Recipes',
      icon: ForkKnifeIcon,
      // Match /recent too so the nav stays highlighted while the legacy
      // URL redirects through to /recipes — avoids a flash of unhighlighted
      // tab during the 301 round-trip on cold links.
      match: (p) => p.startsWith('/recipes') || p.startsWith('/recent')
    },
    {
      href: '/reads',
      label: 'Reads',
      icon: NewspaperIcon,
      match: (p) => p.startsWith('/reads') || p.startsWith('/r/')
    },
    {
      href: '/polls',
      label: 'Polls',
      icon: ChartBarHorizontalIcon,
      match: (p) => p.startsWith('/polls')
    },
    {
      href: '/market',
      label: 'Market',
      icon: StorefrontIcon,
      match: (p) => p.startsWith('/market') || p.startsWith('/my-store')
    },
    // Notifications intentionally has no side-nav entry on desktop —
    // it lives in the header as a bell + dropdown beside the user
    // avatar (NotificationBell.svelte). Mobile keeps the bottom-nav
    // bell.
    {
      href: '/messages',
      label: 'Messages',
      icon: EnvelopeSimpleIcon,
      match: (p) => p.startsWith('/messages'),
      badge: 'messagesDot'
    },
    {
      href: '/memories',
      label: 'Memories',
      icon: ClockCounterClockwiseIcon,
      match: (p) => p.startsWith('/memories')
    }
  ];

  const kitchen: NavItem[] = [
    {
      href: '/my-kitchen',
      label: 'My Kitchen',
      icon: CookbookIcon,
      match: (p) => p.startsWith('/my-kitchen')
    },
    {
      href: '/nourish',
      label: 'Nourish',
      icon: LeafIcon,
      match: (p) => p.startsWith('/nourish')
    },
    {
      href: '/membership',
      label: 'Membership',
      icon: CrownSimpleIcon,
      match: (p) => p.startsWith('/membership')
    },
    {
      href: '/sponsors',
      label: 'Sponsors',
      icon: HandshakeIcon,
      match: (p) => p.startsWith('/sponsors')
    },
    {
      href: '/pantry',
      label: 'The Pantry Relay',
      icon: BasketIcon,
      match: (p) => p.startsWith('/pantry')
    }
  ];

  // My Kitchen collapses to save vertical space; defaults open when the
  // user is already on one of its pages (so the active link isn't
  // hidden). The sidebar isn't remounted on navigation, so a one-time
  // init would leave the group collapsed when a link lands on a kitchen
  // route from elsewhere: reactively expand on match, leave the choice
  // untouched everywhere else. ($page directly: the `pathname` reactive
  // hasn't run at init time.)
  let kitchenExpanded = kitchen.some((item) =>
    item.match ? item.match($page.url.pathname) : $page.url.pathname === item.href
  );

  // Auto-expand only (never auto-collapse): arriving on a kitchen route
  // while the group is closed reveals the active link; browsing away
  // preserves whatever open/closed state the user last chose.
  $: {
    const onKitchenRoute = kitchen.some((item) =>
      item.match ? item.match($page.url.pathname) : $page.url.pathname === item.href
    );
    if (onKitchenRoute && !kitchenExpanded) {
      kitchenExpanded = true;
    }
  }

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

  function handleLogoClick() {
    if ($page.url.pathname === '/explore') {
      triggerExploreNav();
    } else {
      goto('/explore');
    }
  }
</script>

<!-- Stays visible (dimmed and blurred like the rest of the page)
     under the user side panel's backdrop — it must NOT fade itself
     out when the panel opens, or the backdrop completely obscures the
     menu and logo (issue #426). -->
<aside class="hidden lg:block lg:w-56 xl:w-80 fixed top-0 left-0 h-screen z-10">
  <div
    class="h-full overflow-y-auto scrollbar-hide p-3"
    style="background-color: var(--color-bg-primary);"
  >
    <!-- Logo on the header's center line: the button is exactly the
         header row's height (51px, same var the header centers its
         search bar and icons in) so logo, search and icons share one
         optical axis. -->
    <button
      on:click={handleLogoClick}
      class="flex h-[var(--header-row-h)] items-center pl-2 cursor-pointer transition-transform duration-150 active:scale-95 active:opacity-80"
    >
      <img src="/zapcooking-text-light.svg" class="logo-light w-40 dark:hidden" alt="Zap Cooking" />
      <img
        src="/zapcooking-text-dark.svg"
        class="logo-dark w-40 hidden dark:block"
        alt="Zap Cooking"
      />
    </button>
    <nav class="flex flex-col gap-3 mt-3">
      <div>
        <!-- The Home group runs unlabeled; this spacer holds the height
             the removed heading occupied so the items (and the dotted
             separator aligned to the Feed row) don't shift. -->
        <div class="h-[25px]" aria-hidden="true"></div>
        <ul class="flex flex-col gap-1">
          {#each primary as item (item.href)}
            {@const active = item.match ? item.match(pathname) : pathname === item.href}
            <li>
              <a
                href={item.href}
                class={linkClasses(active)}
                style="color: var(--color-text-primary);"
                aria-current={active ? 'page' : undefined}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl">
                  <svelte:component
                    this={item.icon}
                    size={20}
                    weight={item.href === '/messages' && $totalUnreadCount > 0
                      ? 'fill'
                      : 'regular'}
                  />
                  {#if item.badge === 'messagesDot' && $totalUnreadCount > 0}
                    <span
                      class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2"
                      style="border-color: var(--color-bg-primary);"
                      aria-hidden="true"
                    ></span>
                  {/if}
                </span>
                <span class="font-medium">{item.label}</span>
                {#if item.badge === 'members'}
                  <span class="ml-auto">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                      >Members</span
                    >
                  </span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>

      <div class="mt-1">
        <!-- Expandable group header (defaults closed — see kitchenExpanded) -->
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 pb-2 font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:opacity-80"
          style="color: var(--color-caption); font-size: 12px;"
          on:click={() => (kitchenExpanded = !kitchenExpanded)}
          aria-expanded={kitchenExpanded}
          aria-controls="kitchen-nav-desktop"
        >
          My Kitchen
          <CaretDownIcon
            size={12}
            weight="bold"
            class="transition-transform duration-200 {kitchenExpanded ? 'rotate-180' : ''}"
          />
        </button>
        {#if kitchenExpanded}
          <ul id="kitchen-nav-desktop" class="flex flex-col gap-1" transition:slide={{ duration: 200 }}>
            {#each kitchen as item (item.href)}
            {@const active = item.match ? item.match(pathname) : pathname === item.href}
            <li>
              <a
                href={item.href}
                class={linkClasses(active)}
                style="color: var(--color-text-primary);"
                aria-current={active ? 'page' : undefined}
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl">
                  <svelte:component this={item.icon} size={20} />
                </span>
                <span class="font-medium">{item.label}</span>
                {#if item.badge === 'members'}
                  <span class="ml-auto">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Members</span>
                  </span>
                {/if}
              </a>
            </li>
          {/each}

          <!-- Gadgets — a tool launcher, not a destination: one click
               opens the cooking-tools widget (same as the header's
               measuring cup), so no nested expander needed. -->
          <li>
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-1.5 rounded-xl transition-colors cursor-pointer nav-hover"
              style="color: var(--color-text-primary);"
              on:click={() => cookingToolsStore.toggle()}
            >
              <span class="relative flex items-center justify-center w-9 h-9 rounded-xl">
                <MeasuringCupIcon size={20} />
              </span>
              <span class="font-medium">Gadgets</span>
            </button>
          </li>
          </ul>
        {/if}
      </div>

      <!-- Wallet lives in its own section (not a nav link): a balance
           card, like the mobile app's wallet surface. Tapping it opens
           the wallet modal. Hidden for logged-out users and when the
           wallet widget is switched off in settings. -->
      {#if $userPublickey && $navBalanceVisible}
        <div class="mt-1">
          <h3
            class="px-3 pb-2 font-semibold uppercase tracking-wider"
            style="color: var(--color-caption); font-size: 12px;"
          >
            Wallet
          </h3>
          <SidebarWallet />
        </div>
      {/if}
    </nav>
  </div>
</aside>
