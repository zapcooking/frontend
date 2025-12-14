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
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import { nip19 } from 'nostr-tools';
  import { clickOutside } from '$lib/clickOutside';
  import { fade, blur } from 'svelte/transition';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import { getAuthManager } from '$lib/authManager';
  import Modal from './Modal.svelte';
  import { qr } from "@svelte-put/qr/svg";
  import CustomAvatar from './CustomAvatar.svelte';

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
<div class="flex gap-4 sm:gap-9 justify-between">
    <a href="/recent" class="flex-none">
      <img src={SVGNostrCookingWithText} class="w-35 sm:w-40 my-3" alt="zap.cooking Logo With Text" />
    </a>
  <div class="hidden sm:max-lg:flex xl:flex flex-1 grow self-center print:hidden">
    <TagsSearchAutocomplete
      placeholderString={"Search by tag, like 'italian', 'steak' or 'glutenfree'."}
      action={openTag}
    />
  </div>
  <span class="hidden lg:max-xl:flex lg:max-xl:grow"></span>
  <div class="flex gap-3 sm:gap-4 self-center flex-none print:hidden">
    <div class="block sm:max-lg:hidden xl:hidden self-center grow">
      <!-- for some reason if i have all of these selector classes then it styles correctly. wtf. -->
      <Button class="self-center max-md:w-10 max-md:h-10 flex max-md:justify-center max-md:px-1 max-md:py-1 font-semibold !bg-[#FFECE8] cursor-pointer" on:click={() => searchActive = true}>
          <SearchIcon class="self-center text-primary" size={16} weight="bold" />
      </Button>
    </div>
      <Button class="self-center max-md:w-10 max-md:h-10 flex max-md:justify-center max-md:px-1 max-md:py-1 font-semibold gap-2 cursor-pointer" on:click={() => goto('/create')}>
          <AddIcon class="self-center" size={16} />
          <div class="hidden md:flex">Create</div>
      </Button>
      <button on:click={() => supportModalOpen = true} class="self-center max-md:w-10 max-md:h-10 flex max-md:justify-center max-md:px-1 max-md:py-1 text-white rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 px-4 py-2.5 font-semibold transition duration-300 flex items-center gap-2 cursor-pointer">
        <span class="hidden md:inline">Tip</span> ⚡️
      </button>
    <div class="self-center print:hidden">
      {#if $userPublickey !== ''}
        <button class="flex self-center" on:click={() => (dropdownActive = !dropdownActive)}>
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
              class="flex flex-col right-3 gap-4 absolute z-10 bg-white rounded-3xl drop-shadow px-5 py-6"
            >
              <button
                class="flex gap-2 cursor-pointer"
                on:click={() => goto(`/user/${nip19.npubEncode($userPublickey)}`)}
              >
                <UserIcon class="self-center" size={18} />
                Profile
              </button>
              <button class="flex gap-2 cursor-pointer" on:click={() => goto('/bookmarks')}>
                <BookmarkIcon class="self-center" size={18} />
                Bookmarks
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
