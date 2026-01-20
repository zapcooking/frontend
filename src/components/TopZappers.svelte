<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  import type { Zapper } from '$lib/engagementCache';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import { formatSats } from '$lib/utils';
  
  export let topZappers: Zapper[] = [];
  export let maxDisplay = 3; // Show top 3 by default
  
  interface ZapperWithProfile extends Zapper {
    user?: NDKUser;
    profilePicture?: string;
    displayName?: string;
  }
  
  let displayZappers: ZapperWithProfile[] = [];
  let allZappersWithProfiles: ZapperWithProfile[] = [];
  let showPopup = false;
  let popupElement: HTMLDivElement;
  
  onMount(async () => {
    // Fetch profile info for ALL zappers (for popup)
    const allZappers = [...topZappers].sort((a, b) => b.amount - a.amount);
    
    const zappersWithProfiles = await Promise.all(
      allZappers.map(async (zapper) => {
        try {
          const user = $ndk.getUser({ pubkey: zapper.pubkey });
          await user.fetchProfile();
          
          return {
            ...zapper,
            user,
            profilePicture: user.profile?.image,
            displayName: user.profile?.name || user.profile?.displayName || 'Anonymous'
          };
        } catch {
          return {
            ...zapper,
            displayName: 'Anonymous'
          };
        }
      })
    );
    
    allZappersWithProfiles = zappersWithProfiles;
    displayZappers = zappersWithProfiles.slice(0, maxDisplay);
  });
  
  function getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function togglePopup(e: MouseEvent) {
    e.stopPropagation();
    showPopup = !showPopup;
  }

  function handleClickOutside(e: MouseEvent) {
    if (popupElement && !popupElement.contains(e.target as Node)) {
      showPopup = false;
    }
  }

  function navigateToProfile(pubkey: string) {
    window.location.href = `/user/${pubkey}`;
  }
</script>

<svelte:window on:click={handleClickOutside} />

{#if displayZappers.length > 0}
  <div class="relative flex items-center gap-2 mt-2">
    <!-- Clickable zappers area -->
    <button
      class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
      on:click={togglePopup}
      title="View all zappers"
    >
      <div class="flex -space-x-2">
        {#each displayZappers as zapper, i}
          <div
            class="relative inline-block"
            style="z-index: {displayZappers.length - i}"
          >
            {#if zapper.profilePicture}
              <img
                src={optimizeImageUrl(zapper.profilePicture, { width: 32, height: 32, format: 'webp' })}
                alt={zapper.displayName}
                class="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800 object-cover"
                loading="lazy"
              />
            {:else}
              <div
                class="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800 bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold"
              >
                {getInitials(zapper.displayName || 'A')}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      
      <div class="flex items-center gap-1 text-xs">
        <span class="text-orange-500">⚡</span>
      </div>
    </button>

    <!-- Popup showing all zappers -->
    {#if showPopup}
      <div
        bind:this={popupElement}
        class="absolute left-0 bottom-full mb-2 z-50 min-w-[200px] max-w-[280px] rounded-lg shadow-lg border overflow-hidden"
        style="background-color: var(--color-bg-primary); border-color: var(--color-input-border)"
        role="dialog"
        aria-label="Zappers list"
      >
        <!-- Header -->
        <div class="px-3 py-2 border-b" style="border-color: var(--color-input-border); background-color: var(--color-bg-secondary)">
          <div class="flex items-center gap-1.5 text-sm font-medium" style="color: var(--color-text-primary)">
            <span class="text-orange-500">⚡</span>
            <span>Zapped by {allZappersWithProfiles.length}</span>
          </div>
        </div>

        <!-- Zappers list -->
        <div class="max-h-[240px] overflow-y-auto">
          {#each allZappersWithProfiles as zapper, index}
            <button
              class="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent-gray transition-colors cursor-pointer text-left"
              on:click={() => navigateToProfile(zapper.pubkey)}
            >
              <!-- Avatar -->
              <div class="flex-shrink-0 relative">
                {#if zapper.profilePicture}
                  <img
                    src={optimizeImageUrl(zapper.profilePicture, { width: 32, height: 32, format: 'webp' })}
                    alt={zapper.displayName}
                    class="w-8 h-8 rounded-full object-cover"
                    loading="lazy"
                  />
                {:else}
                  <div
                    class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold"
                  >
                    {getInitials(zapper.displayName || 'A')}
                  </div>
                {/if}
                <!-- Top zapper crown -->
                {#if index === 0}
                  <div class="absolute -top-1 -right-1 text-xs">👑</div>
                {/if}
              </div>

              <!-- Name -->
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate" style="color: var(--color-text-primary)">
                  {zapper.displayName}
                </div>
              </div>

              <!-- Amount -->
              <div class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                   style="background-color: rgba(251, 191, 36, 0.15); color: rgb(217, 119, 6)">
                <span>⚡</span>
                <span>{formatSats(zapper.amount)}</span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Smooth scrollbar for popup */
  .overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .overflow-y-auto::-webkit-scrollbar {
    width: 4px;
  }

  .overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: var(--color-input-border);
    border-radius: 2px;
  }
</style>
