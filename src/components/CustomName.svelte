<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { profileCacheManager } from '$lib/profileCache';
  import type { NDKUser } from '@nostr-dev-kit/ndk';

  export let pubkey: string;
  export let className: string = '';
  export let showNpub: boolean = false;

  const dispatch = createEventDispatcher();

  let user: NDKUser | null = null;
  let displayName: string = '';
  let loading = true;
  let lastPubkey: string = '';

  // Generate a display name based on pubkey as fallback
  function generateDisplayName(pk: string): string {
    if (!pk) return '';
    // Create a readable name based on pubkey hash
    const hash = pk.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);

    const adjectives = ['Cool', 'Smart', 'Creative', 'Bright', 'Swift', 'Bold', 'Sharp', 'Quick'];
    const nouns = ['Chef', 'Cook', 'Baker', 'Foodie', 'Gourmet', 'Epicure', 'Culinary', 'Kitchen'];

    const adjective = adjectives[Math.abs(hash) % adjectives.length];
    const noun = nouns[Math.abs(hash >> 8) % nouns.length];

    return `${adjective} ${noun}`;
  }

  function formatNpub(pk: string): string {
    if (!pk) return '';
    // Format pubkey as npub (simplified version)
    return `npub1${pk.substring(0, 8)}...${pk.substring(pk.length - 8)}`;
  }

  async function loadName(pk: string) {
    if (!pk) return;

    loading = true;

    try {
      // First try to get from cache
      user = profileCacheManager.getCachedProfile(pk);

      if (user && user.profile) {
        displayName = user.profile.displayName || user.profile.name || generateDisplayName(pk);
        loading = false;
        return;
      }

      // If not in cache, fetch from relays (waits for NDK ready)
      user = await profileCacheManager.getProfile(pk);

      if (user?.profile) {
        displayName = user.profile.displayName || user.profile.name || generateDisplayName(pk);
      } else {
        displayName = generateDisplayName(pk);
      }
    } catch (error) {
      console.warn('Failed to fetch profile for name:', error);
      displayName = generateDisplayName(pk);
    } finally {
      loading = false;
    }
  }

  // React to pubkey changes
  $: if (pubkey && pubkey !== lastPubkey) {
    lastPubkey = pubkey;
    loadName(pubkey);
  }

  $: npub = formatNpub(pubkey);
</script>

<span
  class="name {className}"
  on:click={() => dispatch('click')}
  role="button"
  tabindex="0"
  on:keydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dispatch('click');
    }
  }}
>
  {displayName}
  {#if showNpub}
    <span class="npub">({npub})</span>
  {/if}
</span>

<style>
  .name {
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .name:hover {
    color: #ec4700;
  }

  .name:focus {
    outline: 2px solid #ec4700;
    outline-offset: 2px;
    border-radius: 2px;
  }

  .npub {
    font-size: 0.8em;
    opacity: 0.7;
    margin-left: 0.25rem;
  }
</style>
