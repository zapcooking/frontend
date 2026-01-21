<script lang="ts">
  import { ndk } from '$lib/nostr';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  import type { Zapper } from '$lib/engagementCache';
  import Modal from './Modal.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import { formatSats } from '$lib/utils';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import { format as formatDate } from 'timeago.js';

  export let open = false;
  export let zappers: Zapper[] = [];
  export let totalAmount: number = 0;

  interface ZapperWithProfile extends Zapper {
    user?: NDKUser;
    profilePicture?: string;
    displayName?: string;
  }

  let displayZappers: ZapperWithProfile[] = [];
  let loading = true;
  
  // Cache to avoid re-fetching profiles
  let cachedZapperPubkeys: string = '';
  let profileCache = new Map<string, { profilePicture?: string; displayName: string }>();

  // Fetch profile info when modal opens (with caching)
  $: if (open && zappers.length > 0) {
    // Create a key from zapper pubkeys to detect changes
    const currentPubkeys = zappers.map(z => z.pubkey).sort().join(',');
    
    // Only reload if zappers changed
    if (currentPubkeys !== cachedZapperPubkeys) {
      cachedZapperPubkeys = currentPubkeys;
      loadZapperProfiles();
    } else if (displayZappers.length > 0) {
      // Same zappers, just re-sort (amounts might have changed)
      displayZappers = [...displayZappers].sort((a, b) => b.amount - a.amount);
      loading = false;
    }
  }

  async function loadZapperProfiles() {
    loading = true;
    
    // Sort zappers by amount (descending) before fetching profiles
    const sortedZappers = [...zappers].sort((a, b) => b.amount - a.amount);
    
    const zappersWithProfiles = await Promise.all(
      sortedZappers.map(async (zapper) => {
        // Check cache first
        const cached = profileCache.get(zapper.pubkey);
        if (cached) {
          return {
            ...zapper,
            profilePicture: cached.profilePicture,
            displayName: cached.displayName
          };
        }
        
        try {
          const user = $ndk.getUser({ pubkey: zapper.pubkey });
          await user.fetchProfile();
          
          const profile = {
            profilePicture: user.profile?.image,
            displayName: user.profile?.name || user.profile?.displayName || 'Anonymous'
          };
          
          // Cache the result
          profileCache.set(zapper.pubkey, profile);
          
          return {
            ...zapper,
            user,
            ...profile
          };
        } catch {
          const profile = { displayName: 'Anonymous' };
          profileCache.set(zapper.pubkey, profile);
          return {
            ...zapper,
            displayName: 'Anonymous'
          };
        }
      })
    );
    
    displayZappers = zappersWithProfiles;
    loading = false;
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function handleZapperClick(pubkey: string) {
    // Navigate to user profile
    window.location.href = `/user/${pubkey}`;
  }

  // Format timestamp safely - convert from seconds to milliseconds
  function formatTimestamp(timestamp: number): string {
    if (!timestamp || timestamp < 1000000000) {
      // Invalid or missing timestamp
      return '';
    }
    // Convert Unix seconds to milliseconds for timeago.js
    return formatDate(timestamp * 1000);
  }

  // Individual zapper glow thresholds (sats): soft 100+, medium 1000+, bright 10000+
  const ZAPPER_GLOW_THRESHOLDS = [100, 1000, 10000] as const;
  const ZAPPER_GLOW_CLASSES = ['', 'zap-glow-soft', 'zap-glow-medium', 'zap-glow-bright'] as const;
  
  // Get glow tier based on zap amount - optimized lookup
  function getZapGlowClass(amount: number): string {
    if (amount >= ZAPPER_GLOW_THRESHOLDS[2]) return ZAPPER_GLOW_CLASSES[3];
    if (amount >= ZAPPER_GLOW_THRESHOLDS[1]) return ZAPPER_GLOW_CLASSES[2];
    if (amount >= ZAPPER_GLOW_THRESHOLDS[0]) return ZAPPER_GLOW_CLASSES[1];
    return ZAPPER_GLOW_CLASSES[0];
  }
</script>

<Modal bind:open>
  <h1 slot="title" class="flex items-center gap-2">
    <span class="text-orange-500">⚡</span>
    Zapped by {zappers.length} {zappers.length === 1 ? 'person' : 'people'}
  </h1>

  <div class="flex flex-col gap-3">
    <!-- Total Amount Summary -->
    <div class="p-3 rounded-lg bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-200 dark:border-orange-800">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium" style="color: var(--color-text-secondary)">Total Zapped</span>
        <div class="flex items-center gap-1">
          <span class="text-orange-500 text-lg">⚡</span>
          <span class="text-xl font-bold" style="color: var(--color-text-primary)">
            {formatSats(totalAmount / 1000)} sats
          </span>
        </div>
      </div>
    </div>

    <!-- Zappers List -->
    {#if loading}
      <div class="space-y-3">
        {#each [1, 2, 3] as _}
          <div class="flex items-center gap-3 p-3 rounded-lg animate-pulse">
            <div class="w-12 h-12 rounded-full bg-accent-gray"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-accent-gray rounded w-1/3"></div>
              <div class="h-3 bg-accent-gray rounded w-1/4"></div>
            </div>
          </div>
        {/each}
      </div>
    {:else if displayZappers.length > 0}
      <div class="space-y-2 max-h-96 overflow-y-auto">
        {#each displayZappers as zapper, index (zapper.pubkey)}
          <button
            class="relative w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent-gray transition-colors cursor-pointer text-left"
            style="background-color: {index === 0 ? 'var(--color-input)' : 'transparent'}"
            on:click={() => handleZapperClick(zapper.pubkey)}
          >
            <!-- Avatar -->
            <div class="relative flex-shrink-0">
              {#if zapper.profilePicture}
                <img
                  src={optimizeImageUrl(zapper.profilePicture, { width: 48, height: 48, format: 'webp' })}
                  alt={zapper.displayName}
                  class="w-12 h-12 rounded-full object-cover"
                  loading="lazy"
                />
              {:else}
                <div
                  class="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold"
                >
                  {getInitials(zapper.displayName || 'A')}
                </div>
              {/if}
              
              <!-- Top zapper crown -->
              {#if index === 0}
                <div class="absolute -top-1 -right-1 text-lg">👑</div>
              {/if}
            </div>

            <!-- Profile Info -->
            <div class="flex-1 min-w-0">
              <div class="font-semibold truncate" style="color: var(--color-text-primary)">
                {zapper.displayName}
              </div>
              {#if formatTimestamp(zapper.timestamp)}
                <div class="text-xs text-caption">
                  {formatTimestamp(zapper.timestamp)}
                </div>
              {/if}
            </div>

            <!-- Amount with glow -->
            <div class="flex items-center gap-1 px-3 py-1.5 rounded-full {getZapGlowClass(zapper.amount)}"
                 style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(245, 158, 11, 0.15))">
              <span class="text-orange-500 text-sm">⚡</span>
              <span class="font-bold text-sm" style="color: var(--color-text-primary)">
                {formatSats(zapper.amount)}
              </span>
            </div>
          </button>
        {/each}
      </div>
    {:else}
      <div class="text-center py-8 text-caption">
        No zaps yet
      </div>
    {/if}
  </div>
</Modal>

<style>
  /* Custom scrollbar for zappers list */
  .overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }

  .overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: var(--color-input-border);
    border-radius: 3px;
  }

  /* Tiered zap glow effects */
  .zap-glow-soft {
    box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
  }

  .zap-glow-medium {
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.5),
                0 0 20px rgba(249, 115, 22, 0.2);
  }

  .zap-glow-bright {
    box-shadow: 0 0 15px rgba(251, 191, 36, 0.6),
                0 0 30px rgba(249, 115, 22, 0.3),
                0 0 45px rgba(234, 88, 12, 0.15);
    animation: zap-pulse 2s ease-in-out infinite;
  }

  @keyframes zap-pulse {
    0%, 100% {
      box-shadow: 0 0 15px rgba(251, 191, 36, 0.6),
                  0 0 30px rgba(249, 115, 22, 0.3),
                  0 0 45px rgba(234, 88, 12, 0.15);
    }
    50% {
      box-shadow: 0 0 20px rgba(251, 191, 36, 0.8),
                  0 0 40px rgba(249, 115, 22, 0.4),
                  0 0 60px rgba(234, 88, 12, 0.2);
    }
  }

  /* Accessibility: Respect user preference for reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .zap-glow-bright {
      animation: none;
    }
  }
</style>
