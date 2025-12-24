<script lang="ts">
  import { goto } from '$app/navigation';
  import Button from './Button.svelte';
  // import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import { userPublickey } from '$lib/nostr';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import UserIcon from 'phosphor-svelte/lib/User';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import AddIcon from 'phosphor-svelte/lib/Plus';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import { nip19 } from 'nostr-tools';
  import { clickOutside } from '$lib/clickOutside';
  import { fade, blur } from 'svelte/transition';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import { getAuthManager } from '$lib/authManager';
  import Modal from './Modal.svelte';
  import { qr } from "@svelte-put/qr/svg";
  import CustomAvatar from './CustomAvatar.svelte';
  import { theme } from '$lib/themeStore';
  import NotificationBell from './NotificationBell.svelte';

  let dropdownActive = false;
  let searchActive = false;
  let supportModalOpen = false;
  let isLoading = true;

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
    <a class="transition duration-300 hover:text-primary" href="/why">Why</a>
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

    <!-- Zap Us - Hidden on mobile to save space, dark mode optimized -->
    <button
      on:click={() => supportModalOpen = true}
      class="hidden sm:flex items-center gap-2 px-3 py-2 text-amber-500 hover:text-amber-600 hover:bg-accent-gray rounded-full transition-colors cursor-pointer text-sm"
      aria-label="Support Zap Cooking"
      title="Support Zap Cooking"
    >
      <LightningIcon size={20} weight="fill" />
      <span class="hidden sm:inline">Zap Us</span>
    </button>

    <!-- Notifications - only show when logged in -->
    {#if $userPublickey}
      <NotificationBell />
    {/if}
    
    <!-- Sign in / User menu -->
    <div class="self-center print:hidden flex-shrink-0">
      {#if $userPublickey !== ''}
        <button class="flex self-center scale-[0.85] sm:scale-100 origin-right" on:click={() => (dropdownActive = !dropdownActive)}>
          <CustomAvatar pubkey={$userPublickey} size={48} />
        </button>
        {#if dropdownActive}
          <div class="relative z-20" transition:fade={{ delay: 0, duration: 150 }}>
            <div
              role="button"
              tabindex="-1"
              on:click={() => (dropdownActive = false)}
              on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
              use:clickOutside
              on:click_outside={() => (dropdownActive = false)}
              class="flex flex-col right-3 gap-4 absolute z-10 bg-input rounded-3xl drop-shadow px-5 py-6"
              style="color: var(--color-text-primary)"
            >
              <button
                class="flex gap-2 cursor-pointer hover:text-primary"
                on:click={() => goto(`/user/${nip19.npubEncode($userPublickey)}`)}
              >
                <UserIcon class="self-center" size={18} />
                Profile
              </button>
              <button class="flex gap-2 cursor-pointer hover:text-primary" on:click={() => goto('/bookmarks')}>
                <BookmarkIcon class="self-center" size={18} />
                Bookmarks
              </button>
              <button class="flex gap-2 cursor-pointer hover:text-primary" on:click={() => goto('/settings')}>
                <GearIcon class="self-center" size={18} />
                Settings
              </button>
              <button class="flex gap-2 cursor-pointer hover:text-primary" on:click={logout}>
                <SignOutIcon class="self-center" size={18} />
                Log out
              </button>
            </div>
          </div>
        {/if}
      {:else}
        <a href="/login" class="px-4 py-2 rounded-full border font-medium transition duration-300 text-sm signin-button" style="color: var(--color-text-primary); border-color: var(--color-input-border);">Sign in</a>
      {/if}
    </div>
  </div>
</div>

<!-- Support Modal -->
<Modal bind:open={supportModalOpen}>
  <div class="flex flex-col items-center justify-center p-6 max-w-sm mx-auto">
    <!-- Header -->
    <div class="text-center mb-6">
      <div class="text-3xl mb-3">⚡</div>
      <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">Support Zap Cooking</h2>
      <p class="text-sm text-caption">
        Help us keep Zap Cooking running and improving!
      </p>
    </div>

    <!-- QR Code Section -->
    <div class="p-6 rounded-2xl shadow-lg border mb-4 w-full" style="background-color: var(--color-bg-primary); border-color: var(--color-input-border);">
      <!-- QR Code -->
      <div class="flex justify-center mb-4">
        <!-- QR code on white background for optimal scanning -->
        <div class="p-4 bg-white rounded-xl">
          <svg class="w-40 h-40"
               use:qr={{
                 data: "lightning:ZapCooking@getalby.com",
                 logo: "https://zap.cooking/favicon.svg",
                 shape: "circle",
                 width: 160,
                 height: 160,
               }}
          />
        </div>
      </div>

      <div class="text-center text-xs text-caption mb-4">
        Scan with your Lightning wallet
      </div>
    </div>

    <!-- Lightning Address Section -->
    <div class="w-full mb-4">
      <div class="text-sm font-medium mb-2" style="color: var(--color-text-primary)">Lightning Address</div>
      <div class="flex items-center gap-2">
        <div class="flex-1 bg-input border rounded-lg px-3 py-2 text-sm break-all" style="color: var(--color-text-primary); border-color: var(--color-input-border);">
          ZapCooking@getalby.com
        </div>
        <button 
          on:click={() => {
            navigator.clipboard.writeText('ZapCooking@getalby.com');
            // Simple feedback - you could enhance this with a toast
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('bg-green-500');
            setTimeout(() => {
              btn.textContent = originalText;
              btn.classList.remove('bg-green-500');
            }, 1500);
          }}
          class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition duration-200 flex-shrink-0"
          title="Copy lightning address"
        >
          Copy
        </button>
      </div>
    </div>
    
    <!-- Action Buttons -->
    <div class="flex gap-3 w-full">
      <a 
        href="lightning:ZapCooking@getalby.com"
        class="flex-1 bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-white font-semibold py-2.5 px-4 rounded-lg transition duration-300 text-center text-sm"
      >
        Open in Wallet
      </a>
      <button
        on:click={() => supportModalOpen = false}
        class="px-4 py-2.5 text-caption hover:opacity-80 font-medium text-sm transition duration-200"
      >
        Close
      </button>
    </div>
  </div>
</Modal>

<style>
  .signin-button:hover {
    border-color: var(--color-accent-gray);
    background-color: var(--color-input-bg);
  }
</style>
