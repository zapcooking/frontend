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

  // Initial fetch times out because relay connections aren't established
  // yet on cold page load. Wait 3s for the pool to stabilize, then
  // retry via NDKUser.fetchProfile() which checks Dexie cache first and
  // then queries the connected pool — no hard timeout, resolves on EOSE.
  async function backgroundRetry() {
    if (destroyed || !$ndk || !pubkey) return;
    await new Promise(r => setTimeout(r, 3000));
    if (destroyed) return;
    try {
      const user = $ndk.getUser({ pubkey });
      const ndkProfile = await user.fetchProfile();
      if (destroyed) return;
      const name = ndkProfile?.displayName || ndkProfile?.name;
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
          backgroundRetry();
        }
      } else if (fallbackToRaw) {
        displayName = nostrString;
      } else {
        displayName = getAnonChefName(pubkey);
        backgroundRetry();
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
        backgroundRetry();
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
