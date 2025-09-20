<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';

  export let event: NDKEvent;
  export let className: string = 'font-semibold text-sm text-gray-900';

  let pubkey: string = '';
  let displayName: string = '';
  let isLoading: boolean = true;

  // Get pubkey from event
  $: {
    pubkey = event.author?.hexpubkey || '';
    if (pubkey) {
      loadProfile();
    }
  }

  async function loadProfile() {
    if (!pubkey || !$ndk) return;
    
    try {
      isLoading = true;
      const profile = await resolveProfileByPubkey(pubkey, $ndk);
      displayName = formatDisplayName(profile);
    } catch (error) {
      console.error('AuthorName: Failed to load profile:', error);
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
  class="{className} hover:text-blue-600 hover:underline cursor-pointer"
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
