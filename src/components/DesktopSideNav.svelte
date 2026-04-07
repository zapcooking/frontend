<script lang="ts">
  import { page } from '$app/stores';
  import { unreadCount } from '$lib/notificationStore';
  import { triggerNotificationsNav } from '$lib/notificationsNav';
  import { triggerExploreNav } from '$lib/exploreNav';
  import { goto } from '$app/navigation';
  import { theme } from '$lib/themeStore';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import { walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';

  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import FlameIcon from 'phosphor-svelte/lib/Flame';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';

  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import CrownSimpleIcon from 'phosphor-svelte/lib/CrownSimple';
  import HandshakeIcon from 'phosphor-svelte/lib/Handshake';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { userSidePanelOpen } from '$lib/stores/userSidePanel';

  $: pathname = $page.url.pathname;
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  type NavItem = {
    href: string;
    label: string;
    icon: any;
    match?: (path: string) => boolean;
    badge?: 'notificationsDot' | 'walletConnect' | 'members' | 'messagesDot';
    external?: boolean;
  };

  const primary: NavItem[] = [
    {
      href: '/community',
      label: 'Feed',
      icon: FlameIcon,
      match: (p) => p === '/' || p.startsWith('/community')
    },
    {
      href: '/recent',
      label: 'Recipes',
      icon: ForkKnifeIcon,
      match: (p) => p.startsWith('/recent')
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
    {
      href: '/notifications',
      label: 'Notifications',
      icon: BellIcon,
      match: (p) => p.startsWith('/notifications'),
      badge: 'notificationsDot'
    },
    {
      href: '/messages',
      label: 'Messages',
      icon: EnvelopeSimpleIcon,
      match: (p) => p.startsWith('/messages'),
      badge: 'messagesDot'
    }
  ];

  const kitchen: NavItem[] = [
    {
      href: '/cookbook',
      label: 'Cookbook',
      icon: CookbookIcon,
      match: (p) => p.startsWith('/cookbook')
    },
    {
      href: '/grocery',
      label: 'Grocery Lists',
      icon: ShoppingCartIcon,
      match: (p) => p.startsWith('/grocery')
    },
    {
      href: '/wallet',
      label: 'Wallet',
      icon: WalletIcon,
      match: (p) => p.startsWith('/wallet'),
      badge: 'walletConnect'
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
    }
  ];

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

  function handleNotificationsClick(event: MouseEvent, isActive: boolean) {
    triggerNotificationsNav();
    if (isActive) {
      event.preventDefault();
    }
  }

  function handleLogoClick() {
    if ($page.url.pathname === '/explore') {
      triggerExploreNav();
    } else {
      goto('/explore');
    }
  }

</script>

<aside
  class="hidden lg:block lg:w-72 xl:w-80 fixed top-0 left-0 h-screen z-10 transition-opacity duration-300"
  class:opacity-0={$userSidePanelOpen}
  class:pointer-events-none={$userSidePanelOpen}
>
  <div class="h-full overflow-y-auto scrollbar-hide p-3" style="background-color: var(--color-bg-primary);">
    <!-- Logo aligned with header position -->
    <button
      on:click={handleLogoClick}
      class="block pl-2 py-2 cursor-pointer transition-transform duration-150 active:scale-95 active:opacity-80"
    >
      <img
        src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
        class="w-40"
        alt="Zap Cooking"
      />
    </button>
    <nav class="flex flex-col gap-3 mt-3">
      <div>
        <h3
          class="px-3 pb-2 font-semibold uppercase tracking-wider"
          style="color: var(--color-caption); font-size: 12px;"
        >
          Home
        </h3>
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
                on:click={(e) => {
                  if (item.href === '/notifications') handleNotificationsClick(e, active);
                }}
              >
                <span class="relative flex items-center justify-center w-9 h-9 rounded-xl">
                  <svelte:component
                    this={item.icon}
                    size={20}
                    weight={(item.href === '/notifications' && $unreadCount > 0) || (item.href === '/messages' && $totalUnreadCount > 0) ? 'fill' : 'regular'}
                  />
                  {#if item.badge === 'notificationsDot' && $unreadCount > 0}
                    <span
                      class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2"
                      style="border-color: var(--color-bg-primary);"
                      aria-hidden="true"
                    ></span>
                  {/if}
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
        <h3
          class="px-3 pb-2 font-semibold uppercase tracking-wider"
          style="color: var(--color-caption); font-size: 12px;"
        >
          My Kitchen
        </h3>
        <ul class="flex flex-col gap-1">
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
                <span class="ml-auto">
                  {#if item.badge === 'walletConnect' && !hasWallet}
                    <span class="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary"
                      >Connect</span
                    >
                  {:else if item.badge === 'members'}
                    <span
                      class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                      >Members</span
                    >
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </div>

    </nav>
  </div>
</aside>
