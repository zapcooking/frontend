<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { profileCacheManager } from '$lib/profileCache';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  
  export let pubkey: string;
  export let size: number = 40;
  export let className: string = '';
  
  const dispatch = createEventDispatcher();
  
  let user: NDKUser | null = null;
  let profilePicture: string | null = null;
  let loading = true;
  
  // Generate a simple avatar based on pubkey
  function generateAvatar(pubkey: string): string {
    // Create a simple colored circle based on pubkey hash
    const hash = pubkey.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    const hue = Math.abs(hash) % 360;
    const saturation = 70;
    const lightness = 50;
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
  
  function getInitials(pubkey: string): string {
    // Use first 2 characters of pubkey as initials
    return pubkey.substring(0, 2).toUpperCase();
  }
  
  onMount(async () => {
    if (!pubkey) return;
    
    try {
      // First try to get from cache
      user = profileCacheManager.getCachedProfile(pubkey);
      
      if (user && user.profile?.image) {
        profilePicture = user.profile.image;
        loading = false;
        return;
      }
      
      // If not in cache or no image, fetch from relays
      user = await profileCacheManager.getProfile(pubkey, $ndk);
      
      if (user?.profile?.image) {
        profilePicture = user.profile.image;
      }
    } catch (error) {
      console.warn('Failed to fetch profile for avatar:', error);
    } finally {
      loading = false;
    }
  });
  
  $: avatarColor = generateAvatar(pubkey);
  $: initials = getInitials(pubkey);
</script>

<div 
  class="avatar {className}"
  style="
    width: {size}px; 
    height: {size}px; 
    background-color: {profilePicture ? 'transparent' : avatarColor}; 
    border-radius: 50%; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    color: white; 
    font-weight: bold; 
    font-size: {size * 0.4}px;
    cursor: pointer;
    overflow: hidden;
  "
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
  {#if profilePicture}
    <img 
      src={profilePicture} 
      alt="Avatar"
      style="
        width: 100%; 
        height: 100%; 
        object-fit: cover; 
        border-radius: 50%;
      "
      on:error={() => {
        profilePicture = null;
      }}
    />
  {:else}
    {initials}
  {/if}
</div>

<style>
  .avatar {
    transition: transform 0.2s ease;
  }
  
  .avatar:hover {
    transform: scale(1.05);
  }
  
  .avatar:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
</style>
