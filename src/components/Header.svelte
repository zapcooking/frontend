<script lang="ts">
  import { goto } from '$app/navigation';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import TimerIcon from 'phosphor-svelte/lib/Timer';
  import { clickOutside } from '$lib/clickOutside';
  import { blur } from 'svelte/transition';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import { theme } from '$lib/themeStore';
  import NotificationBell from './NotificationBell.svelte';
  import WalletBalance from './WalletBalance.svelte';
  import UserSidePanel from './UserSidePanel.svelte';
  import { timerStore } from '$lib/timerStore';
  import TimerWidget from './TimerWidget.svelte';
  import CreateMenuButton from './CreateMenuButton.svelte';

  let sidePanelOpen = false;
  let searchActive = false;
  let isLoading = true;
  let timerWidgetOpen = false;

  // Count active timers (running or paused)
  $: activeTimers = $timerStore.timers.filter(
    (t) => t.status === 'running' || t.status === 'paused'
  );
  $: hasActiveTimers = activeTimers.length > 0;

  // Debug: log when profile picture override changes
  $: if ($userProfilePictureOverride) {
    console.log('[Header] userProfilePictureOverride changed:', $userProfilePictureOverride);
  }

  function openTag(query: string) {
    searchActive = false;
    if (query.startsWith('npub')) {
      goto(`/user/${query}`);
    } else if (query.startsWith('naddr')) {
      goto(`/recipe/${query}`);
    } else {
      goto(`/tag/${query}`);
    }
  }

  // Simple loading state management
  $: if ($userPublickey !== undefined) {
    isLoading = false;
  }

  // Reactive resolved theme for logo switching
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
</script>

{#if searchActive}
  <div
    class="fixed z-20 w-full h-full top-0 left-0 duration-500 transition-opacity bg-opacity-50 backdrop-blur-sm"
    transition:blur={{ amount: 10, duration: 300 }}
  >
    <div
      class="fixed z-25 inset-x-0 top-20 w-3/4 md:w-1/2 lg:w-1/3 mx-auto"
      use:clickOutside
      on:click_outside={() => (searchActive = false)}
    >
      <TagsSearchAutocomplete
        placeholderString={'Search recipes, tags, or users...'}
        action={openTag}
        autofocus={true}
      />
    </div>
  </div>
{/if}

<!-- Mobile-first layout -->
<div class="relative flex gap-4 sm:gap-9 justify-between overflow-visible">
  <a href="/recent" class="flex-none">
    <img
      src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
      class="w-35 sm:w-40 my-3"
      alt="zap.cooking Logo With Text"
    />
  </a>
  <!-- Top row for desktop: Navigation links -->
  <div
    class="hidden lg:flex gap-9 self-center font-semibold print:hidden"
    style="color: var(--color-text-primary)"
  >
    <a class="transition duration-300 hover:text-primary" href="/recent">Recipes</a>
    <a class="transition duration-300 hover:text-primary" href="/community">Community</a>
    <a class="transition duration-300 hover:text-primary" href="/explore">Explore</a>
    <a
      class="transition duration-300 hover:text-primary"
      href="https://plebeian.market/community/seth@zap.cooking/zap-cooking-wear-orcd8yg6jd"
      target="_blank"
      rel="noopener noreferrer">Shop</a
    >
  </div>

  <div class="hidden sm:max-lg:flex xl:flex flex-1 self-center print:hidden max-w-md">
    <TagsSearchAutocomplete
      placeholderString={'Search recipes, tags, or users...'}
      action={openTag}
    />
  </div>
  <span class="hidden lg:max-xl:flex lg:max-xl:grow"></span>
  <div class="flex items-center gap-1.5 sm:gap-3 self-center flex-none print:hidden">
    <!-- Search icon (mobile/tablet only when search bar hidden) -->
    <div class="block sm:max-lg:hidden xl:hidden">
      <button
        on:click={() => (searchActive = true)}
        class="w-9 h-9 flex items-center justify-center text-caption hover:opacity-80 hover:bg-accent-gray rounded-full transition-colors cursor-pointer"
        aria-label="Search"
      >
        <SearchIcon size={20} weight="bold" />
      </button>
    </div>

    <!-- Timer toggle -->
    <button
      on:click={() => (timerWidgetOpen = !timerWidgetOpen)}
      class="w-9 h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer relative {timerWidgetOpen
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
        : 'text-caption hover:opacity-80 hover:bg-accent-gray'}"
      aria-label={timerWidgetOpen ? 'Hide timer' : 'Show timer'}
    >
      <TimerIcon size={20} weight={hasActiveTimers ? 'fill' : 'bold'} />
      {#if hasActiveTimers}
        <span
          class="absolute -top-0.5 -right-0.5 w-4 h-4 bg-amber-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
        >
          {activeTimers.length}
        </span>
      {/if}
    </button>

    <CreateMenuButton variant="header" />

    <!-- Wallet Balance - only show when logged in and wallet connected -->
    {#if $userPublickey}
      <div class="hidden sm:block">
        <WalletBalance />
      </div>
    {/if}

    <!-- Notifications - only show when logged in -->
    {#if $userPublickey}
      <NotificationBell />
    {/if}

    <!-- Sign in / User menu -->
    <div class="print:hidden flex-shrink-0">
      {#if $userPublickey !== ''}
        <button
          class="flex cursor-pointer rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
          on:click={() => (sidePanelOpen = true)}
          aria-label="Open user menu"
        >
          <CustomAvatar pubkey={$userPublickey} size={36} imageUrl={$userProfilePictureOverride} />
        </button>
        <UserSidePanel bind:open={sidePanelOpen} />
      {:else}
        <a
          href="/login"
          class="px-4 py-2 rounded-full border font-medium transition duration-300 text-sm signin-button"
          style="color: var(--color-text-primary); border-color: var(--color-input-border);"
          >Sign in</a
        >
      {/if}
    </div>
  </div>
</div>

<!-- Timer Widget -->
<TimerWidget bind:open={timerWidgetOpen} />

<style>
  .signin-button:hover {
    border-color: var(--color-accent-gray);
    background-color: var(--color-input-bg);
  }
</style>
