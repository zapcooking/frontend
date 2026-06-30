<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { profileActions, profiles, loadingProfiles, profileErrors } from '$lib/profileStore';
  import { decodeNostrProfile, resolveProfile, formatDisplayName } from '$lib/profileResolver';
  import { getAnonChefName } from '$lib/anonName';
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
  let destroyed = false;

  onDestroy(() => { destroyed = true; });

  // Get pubkey for navigation
  $: {
    pubkey = decodeNostrProfile(nostrString);
  }

  // When the initial fetch times out (relay not ready on cold load),
  // retry once using NDK's native user.fetchProfile() which has no
  // hard timeout and will resolve when the relay catches up.
  async function backgroundRetry(pk: string) {
    if (destroyed || !$ndk) return;
    try {
      const user = $ndk.getUser({ pubkey: pk });
      const profile = await user.fetchProfile();
      if (destroyed) return;
      const name = profile?.displayName || profile?.name;
      if (name) displayName = name;
    } catch { /* ignore */ }
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
          // Stable per-pubkey anon-chef name when the profile is gone
          // (account abandoned / kind:0 deleted / relay GC'd). Falls
          // through to a generic "Anon Chef" if we couldn't decode a
          // pubkey from nostrString.
          displayName = getAnonChefName(pubkey);
          // Initial fetch timed out — profile may exist but relay wasn't
          // ready yet. Retry in background; update if we find the name.
          if (pubkey) backgroundRetry(pubkey);
        }
      } else if (fallbackToRaw) {
        displayName = nostrString;
      } else {
        displayName = getAnonChefName(pubkey);
        if (pubkey) backgroundRetry(pubkey);
      }
    } catch (err) {
      console.error('Failed to resolve profile:', err);
      error = err instanceof Error ? err.message : 'Unknown error';
      if (fallbackToRaw) {
        displayName = nostrString;
      } else {
        // Same friendly fallback on resolution error — the user doesn't
        // care that it was a network blip vs. a missing profile.
        displayName = getAnonChefName(pubkey);
        if (pubkey) backgroundRetry(pubkey);
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
    <!-- Error branch: keep the red styling + tooltip so the failure
         is still visible to anyone hovering, but render `displayName`
         (which the catch above already set to the friendly anon-chef
         name when fallbackToRaw is false, or to `nostrString` when
         true). The previous '@Error' literal bypassed the friendly
         fallback we computed in the load path. -->
    <span class="text-red-500" title="Error: {error}">{displayName}</span>
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
