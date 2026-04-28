<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { getAnonChefName } from '$lib/anonName';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';

  export let event: NDKEvent;
  export let className: string = 'font-semibold text-sm';

  let displayName: string = '';
  let isLoading: boolean = true;
  let mounted = false;
  let isHovering = false;

  // Get pubkey from event
  $: pubkey = event?.pubkey || event?.author?.hexpubkey || '';

  /**
   * Friendly fallback when no profile is resolvable. Uses the pubkey
   * (when we have one) to map to a stable per-author name like
   * "Nostrich" or "Sat Chef". Recipes whose authors deleted their
   * kind:0 still feel attributed instead of rendering "@Anonymous".
   */
  function anonFallback(): string {
    return getAnonChefName(pubkey);
  }

  // Load profile on mount only (not reactively)
  onMount(() => {
    mounted = true;
    loadProfile();
  });

  async function loadProfile() {
    if (!pubkey) {
      displayName = anonFallback();
      isLoading = false;
      return;
    }

    try {
      // Get NDK instance
      let ndkInstance: any;
      const unsub = ndk.subscribe((v) => {
        ndkInstance = v;
      });
      unsub();

      if (!ndkInstance) {
        displayName = anonFallback();
        isLoading = false;
        return;
      }

      // No outer timeout — `resolveProfileByPubkey` (and the
      // `fetchProfileFromRelays` it calls) already cap the fetch at
      // 5s and return null on timeout. The previous 3s outer race
      // here fired *before* the underlying 5s could complete, so
      // slow-but-eventual profile fetches landed in the cache while
      // this component had already rendered the anon fallback —
      // requiring a refresh to pick up the now-cached profile.
      const profile = await resolveProfileByPubkey(pubkey, ndkInstance);

      if (profile) {
        // formatDisplayName already returns a stable anon-chef name when
        // the profile has no `name` field, so we just guard against the
        // rare empty-string return defensively.
        displayName = formatDisplayName(profile) || anonFallback();
      } else {
        displayName = anonFallback();
      }
    } catch {
      displayName = anonFallback();
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
  class="{className} cursor-pointer"
  style="color: {isHovering
    ? '#ec4700'
    : 'var(--color-text-primary)'}; background: none; border: none; padding: 0; text-decoration: none;"
  on:click={handleClick}
  on:mouseenter={() => (isHovering = true)}
  on:mouseleave={() => (isHovering = false)}
  disabled={!pubkey}
>
  {#if isLoading}
    <span class="animate-pulse" style="color: inherit;">Loading...</span>
  {:else}
    <span style="color: inherit;">{displayName}</span>
  {/if}
</button>
