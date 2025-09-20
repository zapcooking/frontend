<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { profileCacheManager } from '$lib/profileCache';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  
  export let pubkey: string;
  export let className: string = '';
  export let showNpub: boolean = false;
  
  const dispatch = createEventDispatcher();
  
  let user: NDKUser | null = null;
  let displayName: string = '';
  let loading = true;
  
  // Generate a display name based on pubkey as fallback
  function generateDisplayName(pubkey: string): string {
    // Create a readable name based on pubkey hash
    const hash = pubkey.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    const adjectives = ['Cool', 'Smart', 'Creative', 'Bright', 'Swift', 'Bold', 'Sharp', 'Quick'];
    const nouns = ['Chef', 'Cook', 'Baker', 'Foodie', 'Gourmet', 'Epicure', 'Culinary', 'Kitchen'];
    
    const adjective = adjectives[Math.abs(hash) % adjectives.length];
    const noun = nouns[Math.abs(hash >> 8) % nouns.length];
    
    return `${adjective} ${noun}`;
  }
  
  function formatNpub(pubkey: string): string {
    // Format pubkey as npub (simplified version)
    return `npub1${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}`;
  }
  
  onMount(async () => {
    if (!pubkey) return;
    
    try {
      // First try to get from cache
      user = profileCacheManager.getCachedProfile(pubkey);
      
      if (user && user.profile) {
        displayName = user.profile.displayName || user.profile.name || generateDisplayName(pubkey);
        loading = false;
        return;
      }
      
      // If not in cache, fetch from relays
      user = await profileCacheManager.getProfile(pubkey, $ndk);
      
      if (user?.profile) {
        displayName = user.profile.displayName || user.profile.name || generateDisplayName(pubkey);
      } else {
        displayName = generateDisplayName(pubkey);
      }
    } catch (error) {
      console.warn('Failed to fetch profile for name:', error);
      displayName = generateDisplayName(pubkey);
    } finally {
      loading = false;
    }
  });
  
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
    color: #3b82f6;
  }
  
  .name:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
    border-radius: 2px;
  }
  
  .npub {
    font-size: 0.8em;
    opacity: 0.7;
    margin-left: 0.25rem;
  }
</style>
