<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';
  import { page } from '$app/stores';
  import { unreadCount } from '$lib/notificationStore';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { triggerNotificationsNav } from '$lib/notificationsNav';

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
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  function handleNotificationsClick(event: MouseEvent) {
    triggerNotificationsNav();
    // If we're already on the page, prevent navigation and just refresh/scroll
    if (pathname.startsWith('/notifications')) {
      event.preventDefault();
    }
  }
</script>

<nav
  bind:this={navEl}
  class="lg:hidden bg-input w-full fixed left-0 right-0 z-40 grid grid-cols-6 text-center print:hidden bottom-nav-ios"
  style="color: var(--color-text-primary); border-top: 1px solid var(--color-input-border);"
>
  <a href="/community" class="nav-tab" class:active={pathname === '/' || pathname.startsWith('/community')}>
    <ChatCircleDotsIcon class="self-center" size={22} />
    <span class="sr-only">Community</span>
  </a>
  <a href="/recent" class="nav-tab" class:active={pathname.startsWith('/recent')}>
    <ForkKnifeIcon class="self-center" size={22} />
    <span class="sr-only">Recipes</span>
  </a>
  <a href="/market" class="nav-tab" class:active={pathname.startsWith('/market')}>
    <StorefrontIcon class="self-center" size={22} />
    <span class="sr-only">The Market</span>
  </a>
  <a href="/reads" class="nav-tab" class:active={pathname.startsWith('/reads')}>
    <NewspaperIcon class="self-center" size={22} />
    <span class="sr-only">Reads</span>
  </a>
  <a href="/messages" class="nav-tab" class:active={pathname.startsWith('/messages')}>
    <span class="relative self-center">
      <EnvelopeSimpleIcon size={22} weight={$totalUnreadCount > 0 ? 'fill' : 'regular'} />
      {#if $totalUnreadCount > 0}
        <span
          class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-input"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
    <span class="sr-only">Messages</span>
  </a>
  <a
    href="/notifications"
    class="nav-tab"
    class:active={pathname.startsWith('/notifications')}
    on:click={handleNotificationsClick}
  >
    <span class="relative self-center">
      <BellIcon size={22} weight={$unreadCount > 0 ? 'fill' : 'regular'} />
      {#if $unreadCount > 0}
        <span
          class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-input"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
    <span class="sr-only">Notifications</span>
  </a>
</nav>

<style>
  /* Fix to bottom of screen; fill safe area so no gap below nav on iOS */
  .bottom-nav-ios {
    bottom: 0;
    padding: 0.25rem 0;
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: calc(0.25rem + env(safe-area-inset-bottom, 0px));
  }

  .nav-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    padding: 0.25rem 0;
    opacity: 0.55;
    transition: opacity 0.15s ease;
  }

  .nav-tab:hover,
  .nav-tab.active {
    opacity: 1;
  }

  .nav-tab.active {
    color: var(--color-accent, #f97316);
  }
</style>
