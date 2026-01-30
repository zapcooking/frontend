<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import CompassIcon from 'phosphor-svelte/lib/Compass';
  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
  import { page } from '$app/stores';
  import { unreadCount } from '$lib/notificationStore';
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
  class="lg:hidden bg-input w-full fixed left-0 right-0 z-40 grid grid-cols-5 text-center print:hidden bottom-nav-ios"
  style="color: var(--color-text-primary); border-top: 1px solid var(--color-input-border);"
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
  <a href="/reads" class="flex flex-col items-center justify-center hover:text-primary">
    <NewspaperIcon class="self-center" size={24} />
    <span class="sr-only">Reads</span>
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

<style>
  /* Fix to bottom of screen; fill safe area so no gap below nav on iOS */
  .bottom-nav-ios {
    bottom: 0;
    padding: 0.5rem 0;
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
  }
</style>
