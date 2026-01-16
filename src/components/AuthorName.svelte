<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';

  export let event: NDKEvent;
  export let className: string = 'font-semibold text-sm';

  let displayName: string = '@Anonymous';
  let isLoading: boolean = true;
  let mounted = false;

  // Get pubkey from event  
  $: pubkey = event?.pubkey || event?.author?.hexpubkey || '';

  // Load profile on mount only (not reactively)
  onMount(() => {
    mounted = true;
    loadProfile();
  });

  async function loadProfile() {
    if (!pubkey) {
      displayName = '@Anonymous';
      isLoading = false;
      return;
    }
    
    try {
      // Get NDK instance
      let ndkInstance: any;
      const unsub = ndk.subscribe(v => { ndkInstance = v; });
      unsub();
      
      if (!ndkInstance) {
        displayName = '@Anonymous';
        isLoading = false;
        return;
      }
      
      // Simple profile fetch with timeout
      const profile = await Promise.race([
        resolveProfileByPubkey(pubkey, ndkInstance),
        new Promise<null>(r => setTimeout(() => r(null), 3000))
      ]);
      
      if (profile) {
        displayName = formatDisplayName(profile) || '@Anonymous';
      } else {
        displayName = '@Anonymous';
      }
    } catch {
      displayName = '@Anonymous';
    } finally {
      isLoading = false;
    }
  }

  // Handle click to navigate to profile
  function handleClick() {
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      window.location.href = `/user/${npub}`;
    }
  }
</script>

<button
  class="{className} hover:text-primary hover:underline cursor-pointer"
  style="color: var(--color-text-primary)"
  on:click={handleClick}
  disabled={!pubkey}
>
  {#if isLoading}
    <span class="animate-pulse">Loading...</span>
  {:else}
    {displayName}
  {/if}
</button>

<style>
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
