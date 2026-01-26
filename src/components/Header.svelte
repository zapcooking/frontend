<script lang="ts">
  import { goto } from '$app/navigation';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import { page } from '$app/stores';
  import CustomAvatar from './CustomAvatar.svelte';
  import { theme } from '$lib/themeStore';
  import WalletBalance from './WalletBalance.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import { userSidePanelOpen } from '$lib/stores/userSidePanel';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { timerStore } from '$lib/timerStore';
  import { navBalanceVisible, walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { cookingToolsStore, cookingToolsOpen } from '$lib/stores/cookingToolsWidget';

  let isLoading = true;

  // Count active timers (running or paused + done)
  $: activeTimers = $timerStore.timers.filter(
    (t) => t.status === 'running' || t.status === 'paused' || t.status === 'done'
  );
  $: hasActiveTimers = activeTimers.length > 0;

  // Debug: log when profile picture override changes
  $: if ($userProfilePictureOverride) {
    console.log('[Header] userProfilePictureOverride changed:', $userProfilePictureOverride);
  }

  function openTag(query: string) {
    mobileSearchOpen.set(false);
    if (query.startsWith('npub')) {
      goto(`/user/${query}`);
    } else if (query.startsWith('naddr')) {
      goto(`/recipe/${query}`);
    } else if (query.startsWith('note1') || query.startsWith('nevent1')) {
      goto(`/${query}`);
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
  $: hasNavWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  function toggleCookingTools() {
    cookingToolsStore.toggle();
  }
</script>

<!-- Mobile-first layout -->
<div class="relative flex gap-2 sm:gap-9 lg:gap-12 justify-between overflow-visible">
  <a href="/recent" class="flex-none lg:hidden">
    <img
      src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
      class="w-28 sm:w-40 my-2 sm:my-3"
      alt="zap.cooking Logo With Text"
    />
  </a>

  <div
    class="hidden sm:flex flex-1 self-center print:hidden max-w-2xl min-w-[280px] lg:min-w-[500px]"
  >
    <TagsSearchAutocomplete
      placeholderString={'Search recipes, tags, or users...'}
      action={openTag}
    />
  </div>
  <span class="hidden lg:max-xl:flex lg:max-xl:grow"></span>
  <div class="flex items-center gap-1 sm:gap-3 self-center flex-none print:hidden">
    <!-- Search icon (mobile/tablet only when search bar hidden) -->
    <div class="block sm:hidden">
      <button
        on:click={() => mobileSearchOpen.set(true)}
        class="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center hover:opacity-80 hover:bg-accent-gray rounded-full transition-colors cursor-pointer"
        style="color: var(--color-text-primary)"
        aria-label="Search"
      >
        <SearchIcon size={18} weight="bold" class="sm:w-5 sm:h-5" />
      </button>
    </div>

    <!-- Cooking Tools toggle (timer + converter) -->
    <button
      on:click={toggleCookingTools}
      class="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer relative {$cookingToolsOpen
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
        : 'hover:opacity-80 hover:bg-accent-gray'}"
      style={$cookingToolsOpen ? '' : 'color: var(--color-text-primary)'}
      aria-label={$cookingToolsOpen ? 'Hide cooking tools' : 'Show cooking tools'}
    >
      <CookingPotIcon
        size={18}
        weight={$cookingToolsOpen || hasActiveTimers ? 'fill' : 'bold'}
        class="sm:w-5 sm:h-5"
      />
      {#if hasActiveTimers}
        <span
          class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-amber-500 text-white text-[10px] sm:text-xs font-bold rounded-full flex items-center justify-center"
        >
          {activeTimers.length}
        </span>
      {/if}
    </button>

    <!-- Wallet button (mobile only) - shortcut to wallet page -->
    {#if $userPublickey}
      <a
        href="/wallet"
        class="sm:hidden w-8 h-8 flex items-center justify-center rounded-full transition-colors cursor-pointer hover:opacity-80 hover:bg-accent-gray"
        style="color: var(--color-text-primary)"
        aria-label="Open wallet"
      >
        <WalletIcon size={18} weight="bold" />
      </a>
    {/if}

    <!-- Wallet Balance - only show when logged in -->
    {#if $userPublickey && $navBalanceVisible}
      {#if hasNavWallet}
        <div class="hidden sm:block">
          <WalletBalance />
        </div>
      {:else}
        <a
          href="/wallet"
          class="hidden sm:flex items-center gap-2 px-3 py-1.5 min-w-[154px] rounded-full text-sm font-medium transition-colors hover:bg-accent-gray"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <LightningIcon size={14} weight="fill" class="text-amber-500" aria-hidden="true" />
          <span>Set up a Wallet</span>
        </a>
      {/if}
    {/if}

    <!-- Sign in / User menu -->
    <div class="print:hidden flex-shrink-0">
      {#if $userPublickey !== ''}
        <button
          class="flex cursor-pointer rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
          on:click={() => userSidePanelOpen.set(true)}
          aria-label="Open user menu"
        >
          <CustomAvatar pubkey={$userPublickey} size={32} imageUrl={$userProfilePictureOverride} />
        </button>
      {:else}
        <a
          href="/login"
          class="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border font-medium transition duration-300 text-xs sm:text-sm signin-button"
          style="color: var(--color-text-primary); border-color: var(--color-input-border);"
          >Sign in</a
        >
      {/if}
    </div>
  </div>
</div>

<style>
  .signin-button:hover {
    border-color: var(--color-accent-gray);
    background-color: var(--color-input-bg);
  }
</style>
