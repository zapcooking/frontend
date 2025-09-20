<script lang="ts">
  import { goto } from '$app/navigation';
  import Button from './Button.svelte';
  import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import { ndk, userPublickey } from '$lib/nostr';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import UserIcon from 'phosphor-svelte/lib/User';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import AddIcon from 'phosphor-svelte/lib/Plus';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import { nip19 } from 'nostr-tools';
  import { clickOutside } from '$lib/clickOutside';
  import { fade, blur } from 'svelte/transition';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import { getAuthManager } from '$lib/authManager';
  import Modal from './Modal.svelte';
  import { qr } from "@svelte-put/qr/svg";

  let dropdownActive = false;
  let searchActive = false;
  let supportModalOpen = false;

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
    setTimeout(() => (window.location.href = ''), 1);
  }
</script>

{#if searchActive}
  <div class="fixed z-20 w-full h-full top-0 left-0 duration-500 transition-opacity bg-opacity-50 backdrop-blur-sm" transition:blur={{ amount: 10, duration: 300 }}>
    <div class="fixed z-25 inset-x-0 top-20 w-3/4 md:w-1/2 lg:w-1/3 mx-auto" use:clickOutside on:click_outside={() => (searchActive = false)} >
        <TagsSearchAutocomplete
            placeholderString={"Search by tag, like 'italian', 'steak' or 'glutenfree'."}
            action={openTag}
            autofocus={true}
        />
    </div>
  </div>  
{/if}

<!-- Mobile-first layout -->
<div class="flex flex-col md:flex-row md:gap-9 md:justify-between">
  <!-- Top row for mobile: Logo and right buttons -->
  <div class="flex justify-between items-center md:flex-none">
    <a href="/recent" class="flex-none">
      <img src={SVGNostrCookingWithText} class="w-40 my-3" alt="Nostr.Cooking Logo With Text" />
    </a>
    
    <!-- Right side buttons for mobile -->
    <div class="flex gap-4 self-center flex-none print:hidden md:hidden">
      <div class="block self-center">
        <Button class="self-center w-10 h-10 flex justify-center px-1 py-1 font-semibold !bg-[#FFECE8]" on:click={() => searchActive = true}>
            <SearchIcon class="self-center text-primary" size={16} weight="bold" />
        </Button>
      </div>
      {#if $userPublickey !== ''}
        <Button class="self-center w-10 h-10 flex justify-center px-1 py-1 font-semibold gap-2" on:click={() => goto('/create')}>
            <AddIcon class="self-center" size={16} />
        </Button>
      {/if}
      <div class="self-center print:hidden">
        <button on:click={() => supportModalOpen = true} class="text-white rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 px-3 py-2 font-semibold transition duration-300 flex items-center gap-1 text-sm">
          Support Us ⚡
        </button>
      </div>
      <div class="self-center print:hidden">
        {#if $userPublickey !== ''}
          <button class="flex self-center" on:click={() => (dropdownActive = !dropdownActive)}>
            <Avatar
              class="cursor-pointer w-10 h-10 object-center rounded-full"
              ndk={$ndk}
              pubkey={$userPublickey}
            />
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
                class="flex flex-col right-3 gap-4 absolute z-10 bg-white rounded-3xl drop-shadow px-5 py-6"
              >
                <button
                  class="flex gap-2 cursor-pointer"
                  on:click={() => goto(`/user/${nip19.npubEncode($userPublickey)}`)}
                >
                  <UserIcon class="self-center" size={18} />
                  Profile
                </button>
                <button class="flex gap-2 cursor-pointer" on:click={() => goto('/settings')}>
                  <GearIcon class="self-center" size={18} />
                  Settings
                </button>
                <button class="flex gap-2 cursor-pointer" on:click={logout}>
                  <SignOutIcon class="self-center" size={18} />
                  Log out
                </button>
              </div>
            </div>
          {/if}
        {:else}
          <a href="/login" class="text-white rounded-full bg-black disabled:bg-black/50 hover:bg-gray-800 px-3 py-2 font-semibold transition duration-300 text-sm">Sign in</a>
        {/if}
      </div>
    </div>
  </div>

  <!-- Desktop navigation and search -->
  <div class="hidden md:flex gap-10 self-center font-semibold print:hidden">
    <a class="transition duration-300 hover:text-primary" href="/recent">Recipes</a>
    <a class="transition duration-300 hover:text-primary" href="/foodstr">Feed</a>
    <a class="transition duration-300 hover:text-primary" href="/tags">Categories</a>
  </div>

  <div class="hidden sm:flex flex-1 grow self-center print:hidden">
    <TagsSearchAutocomplete
      placeholderString={"Search by tag, like 'italian', 'steak' or 'glutenfree'."}
      action={openTag}
    />
  </div>
  
  <!-- Desktop right side buttons -->
  <div class="hidden md:flex gap-4 self-center flex-none print:hidden">
    {#if $userPublickey !== ''}
      <a class="hidden lg:flex self-center gap-2 transition duration-300 font-semibold hover:text-primary" href="/bookmarks">
        <BookmarkIcon class="self-center" size="30px" weight="bold" />
        <span class="self-center">Bookmarks</span>
      </a>
      <a href="/create" class="text-white rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 px-4 py-2.5 font-semibold transition duration-300 flex items-center gap-2">
        + Add Recipe
      </a>
    {/if}
    <div class="self-center print:hidden">
      <button on:click={() => supportModalOpen = true} class="text-white rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 px-4 py-2.5 font-semibold transition duration-300 flex items-center gap-2">
        Support Us ⚡
      </button>
    </div>
    <div class="self-center print:hidden">
      {#if $userPublickey !== ''}
        <button class="flex self-center" on:click={() => (dropdownActive = !dropdownActive)}>
          <Avatar
            class="cursor-pointer w-12 h-12 object-center rounded-full"
            ndk={$ndk}
            pubkey={$userPublickey}
          />
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
              class="flex flex-col right-3 gap-4 absolute z-10 bg-white rounded-3xl drop-shadow px-5 py-6"
            >
              <button
                class="flex gap-2 cursor-pointer"
                on:click={() => goto(`/user/${nip19.npubEncode($userPublickey)}`)}
              >
                <UserIcon class="self-center" size={18} />
                Profile
              </button>
              <button class="flex gap-2 cursor-pointer" on:click={() => goto('/settings')}>
                <GearIcon class="self-center" size={18} />
                Settings
              </button>
              <button class="flex gap-2 cursor-pointer" on:click={logout}>
                <SignOutIcon class="self-center" size={18} />
                Log out
              </button>
            </div>
          </div>
        {/if}
      {:else}
        <a href="/login" class="text-white rounded-full bg-black disabled:bg-black/50 hover:bg-gray-800 px-4 py-2.5 font-semibold transition duration-300">Sign in</a>
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
      <h2 class="text-xl font-bold text-gray-800 mb-2">Support Zap Cooking</h2>
      <p class="text-sm text-gray-600">
        Help us keep Zap Cooking running and improving!
      </p>
    </div>
    
    <!-- QR Code Section -->
    <div class="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 mb-4 w-full">
      <!-- QR Code -->
      <div class="flex justify-center mb-4">
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
      
      <div class="text-center text-xs text-gray-500 mb-4">
        Scan with your Lightning wallet
      </div>
    </div>
    
    <!-- Lightning Address Section -->
    <div class="w-full mb-4">
      <div class="text-sm font-medium text-gray-700 mb-2">Lightning Address</div>
      <div class="flex items-center gap-2">
        <div class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 break-all">
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
        class="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-medium text-sm transition duration-200"
      >
        Close
      </button>
    </div>
  </div>
</Modal>
