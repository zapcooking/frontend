<script lang="ts">
  import { goto } from '$app/navigation';
  import Button from './Button.svelte';
  // import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import UserIcon from 'phosphor-svelte/lib/User';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import AddIcon from 'phosphor-svelte/lib/Plus';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import SunIcon from 'phosphor-svelte/lib/Sun';
  import MoonIcon from 'phosphor-svelte/lib/Moon';
  import { nip19 } from 'nostr-tools';
  import { clickOutside } from '$lib/clickOutside';
  import { fade, blur } from 'svelte/transition';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import { getAuthManager } from '$lib/authManager';
  import CustomAvatar from './CustomAvatar.svelte';
  import { theme } from '$lib/themeStore';
  import NotificationBell from './NotificationBell.svelte';
  import WalletBalance from './WalletBalance.svelte';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';

  let dropdownActive = false;
  let searchActive = false;
  let isLoading = true;

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

  async function logout() {
    const authManager = getAuthManager();
    if (authManager) {
      await authManager.logout();
    }
    
    // Clear the userPublickey store
    userPublickey.set('');
    
    // Clear any additional localStorage items
    if (typeof window !== 'undefined') {
      localStorage.removeItem('nostrcooking_loggedInPublicKey');
      localStorage.removeItem('nostrcooking_privateKey');
    }
    
    setTimeout(() => (window.location.href = ''), 1);
  }

  // Simple loading state management
  $: if ($userPublickey !== undefined) {
    isLoading = false;
  }

  // Reactive resolved theme for logo switching
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  function toggleTheme(e: Event) {
    // Prevent any default behavior or navigation
    e.preventDefault();
    e.stopPropagation();
    // Toggle between light and dark (not system)
    theme.setTheme(isDarkMode ? 'light' : 'dark');
    // Close dropdown after toggling
    dropdownActive = false;
  }
</script>

{#if searchActive}
  <div class="fixed z-20 w-full h-full top-0 left-0 duration-500 transition-opacity bg-opacity-50 backdrop-blur-sm" transition:blur={{ amount: 10, duration: 300 }}>
    <div class="fixed z-25 inset-x-0 top-20 w-3/4 md:w-1/2 lg:w-1/3 mx-auto" use:clickOutside on:click_outside={() => (searchActive = false)} >
        <TagsSearchAutocomplete
            placeholderString={"Search recipes, tags, or users..."}
            action={openTag}
            autofocus={true}
        />
    </div>
  </div>  
{/if}

<!-- Mobile-first layout -->
<div class="flex gap-4 sm:gap-9 justify-between">
    <a href="/recent" class="flex-none">
      <img src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText} class="w-35 sm:w-40 my-3" alt="zap.cooking Logo With Text" />
    </a>
  <!-- Top row for desktop: Navigation links -->
  <div class="hidden lg:flex gap-9 self-center font-semibold print:hidden" style="color: var(--color-text-primary)">
    <a class="transition duration-300 hover:text-primary" href="/recent">Recipes</a>
    <a class="transition duration-300 hover:text-primary" href="/community">Community</a>
    <a class="transition duration-300 hover:text-primary" href="/explore">Explore</a>
    <a class="transition duration-300 hover:text-primary" href="https://plebeian.market/community/seth@zap.cooking/zap-cooking-wear-orcd8yg6jd" target="_blank" rel="noopener noreferrer">Shop</a>
  </div>

  <div class="hidden sm:max-lg:flex xl:flex flex-1 self-center print:hidden max-w-md">
    <TagsSearchAutocomplete
      placeholderString={"Search recipes, tags, or users..."}
      action={openTag}
    />
  </div>
  <span class="hidden lg:max-xl:flex lg:max-xl:grow"></span>
  <div class="flex gap-1.5 sm:gap-3 self-center flex-none print:hidden">
    <!-- Search icon (mobile/tablet only when search bar hidden) -->
    <div class="block sm:max-lg:hidden xl:hidden self-center">
      <button 
        on:click={() => searchActive = true}
        class="w-9 h-9 flex items-center justify-center text-caption hover:opacity-80 hover:bg-accent-gray rounded-full transition-colors cursor-pointer"
        aria-label="Search"
      >
        <SearchIcon size={20} weight="bold" />
      </button>
    </div>
    
    <!-- Create - Primary CTA (compact on mobile) -->
    <button 
      on:click={() => goto('/create')}
      class="flex items-center justify-center gap-1.5 w-9 h-9 sm:w-auto sm:h-auto sm:gap-2 sm:px-4 sm:py-2 text-white rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 font-semibold transition duration-300 cursor-pointer text-sm"
    >
      <AddIcon size={18} weight="bold" />
      <span class="hidden sm:inline">Create</span>
    </button>


    <!-- Wallet Balance - only show when logged in and wallet connected -->
    {#if $userPublickey}
      <div class="self-center hidden sm:block">
        <WalletBalance />
      </div>
    {/if}

    <!-- Notifications - only show when logged in -->
    {#if $userPublickey}
      <div class="self-center">
        <NotificationBell />
      </div>
    {/if}
    
    <!-- Sign in / User menu -->
    <div class="self-center print:hidden flex-shrink-0">
      {#if $userPublickey !== ''}
        <div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
          <button class="flex self-center scale-[0.85] sm:scale-100 origin-right cursor-pointer" on:click={() => (dropdownActive = !dropdownActive)}>
            <CustomAvatar pubkey={$userPublickey} size={48} imageUrl={$userProfilePictureOverride} />
          </button>
          {#if dropdownActive}
            <div class="absolute right-0 top-full mt-2 z-20" transition:fade={{ delay: 0, duration: 150 }}>
              <div
                role="menu"
                tabindex="-1"
                on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
                class="flex flex-col gap-4 bg-input rounded-3xl drop-shadow px-5 py-6 min-w-[160px]"
                style="color: var(--color-text-primary)"
              >
                <button
                  class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap"
                  on:click={() => { dropdownActive = false; goto(`/user/${nip19.npubEncode($userPublickey)}`); }}
                >
                  <UserIcon class="self-center" size={18} />
                  Profile
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={() => { dropdownActive = false; goto('/cookbook'); }}>
                  <CookbookIcon class="self-center" size={18} />
                  Cookbook
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={() => { dropdownActive = false; goto(`/user/${nip19.npubEncode($userPublickey)}?tab=drafts`); }}>
                  <FloppyDiskIcon class="self-center" size={18} />
                  Drafts
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={() => { dropdownActive = false; goto('/wallet'); }}>
                  <WalletIcon class="self-center" size={18} />
                  Wallet
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={toggleTheme} type="button">
                  {#if isDarkMode}
                    <SunIcon class="self-center" size={18} />
                    Light Mode
                  {:else}
                    <MoonIcon class="self-center" size={18} />
                    Dark Mode
                  {/if}
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={() => { dropdownActive = false; goto('/settings'); }}>
                  <GearIcon class="self-center" size={18} />
                  Settings
                </button>
                <button class="flex gap-2 cursor-pointer hover:text-primary whitespace-nowrap" on:click={logout}>
                  <SignOutIcon class="self-center" size={18} />
                  Log out
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <a href="/login" class="px-4 py-2 rounded-full border font-medium transition duration-300 text-sm signin-button" style="color: var(--color-text-primary); border-color: var(--color-input-border);">Sign in</a>
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
