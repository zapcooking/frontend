<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { profileActions, profiles, loadingProfiles, profileErrors } from '$lib/profileStore';
  import { decodeNostrProfile, resolveProfile, formatDisplayName } from '$lib/profileResolver';
  import { ndk } from '$lib/nostr';

  export let nostrString: string;
  export let className: string = '';
  export let showLoading: boolean = true;
  export let fallbackToRaw: boolean = true;
  export let colorClass: string = 'text-blue-500 hover:text-blue-700';

  let displayName: string = '';
  let isLoading: boolean = false;
  let error: string | null = null;
  let pubkey: string | null = null;

  // Get pubkey for navigation
  $: {
    pubkey = decodeNostrProfile(nostrString);
  }

  // Load profile on mount
  onMount(async () => {
    try {
      if (nostrString && $ndk) {
        isLoading = true;
        const profile = await resolveProfile(nostrString, $ndk);
        if (profile) {
          displayName = formatDisplayName(profile);
        } else if (fallbackToRaw) {
          displayName = nostrString;
        } else {
          displayName = '@Anonymous';
        }
      } else if (fallbackToRaw) {
        displayName = nostrString;
      } else {
        displayName = '@Anonymous';
      }
    } catch (err) {
      console.error('Failed to resolve profile:', err);
      error = err instanceof Error ? err.message : 'Unknown error';
      if (fallbackToRaw) {
        displayName = nostrString;
      } else {
        displayName = '@Error';
      }
    } finally {
      isLoading = false;
    }
  });

  // Handle click to navigate to profile
  function handleClick() {
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      goto(`/user/${npub}`);
    }
  }
</script>

<button
  class="{colorClass} hover:underline cursor-pointer {className}"
  on:click={handleClick}
  disabled={!pubkey}
>
  {#if isLoading && showLoading}
    <span class="animate-pulse">Loading...</span>
  {:else if error}
    <span class="text-red-500" title="Error: {error}">
      {fallbackToRaw ? nostrString : '@Error'}
    </span>
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
