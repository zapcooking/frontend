<script lang="ts">
  import { page } from '$app/stores';
  import { unreadCount } from '$lib/notificationStore';
  import { triggerNotificationsNav } from '$lib/notificationsNav';
  import { theme } from '$lib/themeStore';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import { walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';

  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import CompassIcon from 'phosphor-svelte/lib/Compass';
  import BellIcon from 'phosphor-svelte/lib/Bell';

  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import TimerIcon from 'phosphor-svelte/lib/Timer';
  import { timerWidgetOpen } from '$lib/stores/timerWidget';

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
    badge?: 'notificationsDot' | 'walletConnect' | 'members';
    external?: boolean;
  };

  const primary: NavItem[] = [
    {
      href: '/community',
      label: 'Community',
      icon: ChatCircleDotsIcon,
      match: (p) => p === '/' || p.startsWith('/community')
    },
    { href: '/recent', label: 'Recipes', icon: ForkKnifeIcon, match: (p) => p.startsWith('/recent') },
    { href: '/explore', label: 'Explore', icon: CompassIcon, match: (p) => p.startsWith('/explore') },
    {
      href: '/notifications',
      label: 'Notifications',
      icon: BellIcon,
      match: (p) => p.startsWith('/notifications'),
      badge: 'notificationsDot'
    }
  ];

  const kitchen: NavItem[] = [
    { href: '/cookbook', label: 'Cookbook', icon: CookbookIcon, match: (p) => p.startsWith('/cookbook') },
    { href: '/grocery', label: 'Grocery Lists', icon: ShoppingCartIcon, match: (p) => p.startsWith('/grocery') },
    { href: '/wallet', label: 'Wallet', icon: WalletIcon, match: (p) => p.startsWith('/wallet'), badge: 'walletConnect' }
  ];

  function linkClasses(active: boolean) {
    return [
      'group',
      'w-full',
      'flex',
      'items-center',
      'gap-3',
      'px-3',
      'py-2.5',
      'rounded-xl',
      'transition-colors',
      'cursor-pointer',
      active ? 'bg-accent-gray border-l-2 border-orange-500' : 'hover:bg-accent-gray'
    ].join(' ');
  }

  function handleNotificationsClick(event: MouseEvent, isActive: boolean) {
    triggerNotificationsNav();
    // If we're already on the page, prevent navigation and just refresh/scroll
    if (isActive) {
      event.preventDefault();
    }
  }
</script>

<aside class="hidden lg:block lg:w-72 xl:w-80">
  <div
    class="sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto p-3 border-r"
    style="background-color: var(--color-bg-primary); border-color: var(--color-input-border);"
  >
    <a href="/community" class="block px-2 py-2 rounded-xl hover:bg-accent-gray transition-colors">
      <img
        src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
        class="w-44 my-1"
        alt="Zap Cooking"
      />
    </a>

    <nav class="flex flex-col gap-4 mt-2">
    <div>
      <h3 class="px-3 pb-2 font-semibold uppercase tracking-wider" style="color: var(--color-caption); font-size: 12px;">
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
                <svelte:component this={item.icon} size={20} weight={item.href === '/notifications' && $unreadCount > 0 ? 'fill' : 'regular'} />
                {#if item.badge === 'notificationsDot' && $unreadCount > 0}
                  <span
                    class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2"
                    style="border-color: var(--color-bg-primary);"
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

    <div>
      <h3 class="px-3 pb-2 font-semibold uppercase tracking-wider" style="color: var(--color-caption); font-size: 12px;">
        My Kitchen
      </h3>
      <ul class="flex flex-col gap-1">
        <li>
          <button
            type="button"
            class={linkClasses($timerWidgetOpen)}
            style="color: var(--color-text-primary);"
            aria-pressed={$timerWidgetOpen}
            on:click={() => timerWidgetOpen.update((open) => !open)}
          >
            <span class="relative flex items-center justify-center w-9 h-9 rounded-xl">
              <TimerIcon size={20} weight={$timerWidgetOpen ? 'fill' : 'regular'} />
            </span>
            <span class="font-medium">Timer</span>
          </button>
        </li>
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
                  <span class="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Connect</span>
                {:else if item.badge === 'members'}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Members</span>
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
