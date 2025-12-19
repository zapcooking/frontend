<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { profileCacheManager } from '$lib/profileCache';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  
  export let pubkey: string;
  export let size: number = 40;
  export let className: string = '';
  
  const dispatch = createEventDispatcher();
  
  let user: NDKUser | null = null;
  let profilePicture: string | null = null;
  let loading = true;
  let imageError = false;
  let imageCandidates: string[] = []; // Ordered list of URLs to try
  let currentCandidateIndex = 0; // Index of current candidate being tried
  
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


  // Strip protocol from URL for proxy usage
  function stripProtocol(url: string): string {
    return url.replace(/^https?:\/\//i, '');
  }

  // Unsigned, reliable image proxy. Good for avatars.
  function toWeserv(url: string): string {
    const u = stripProtocol(url);
    const w = Math.max(16, Math.round(size));
    const h = Math.max(16, Math.round(size));
    // fit=cover gives "avatar style" cropping
    return `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&h=${h}&fit=cover&a=attention`;
  }

  // Normalize URL: convert protocol-relative and domain/path strings to https://
  // Passes through http(s)://, data:, blob:, returns null for invalid URLs
  function normalizeUrl(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      return null;
    }
    
    // Pass through data: and blob: URLs
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return trimmed;
    }
    
    // Pass through http:// and https:// URLs
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    
    // Convert protocol-relative URLs (//example.com) to https://
    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }
    
    // Convert domain/path strings (void.cat/path) to https://
    // Check if it looks like a domain (starts with alphanumeric, contains a dot, optionally has a path)
    // Matches: void.cat, void.cat/path, example.com/image.jpg
    // More permissive: any string that looks like it could be a domain/path
    if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9][a-zA-Z0-9.-]*/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    
    // Invalid or unrecognized format
    return null;
  }

  // Check if URL is an imgproxy.snort.social URL (known to have 500 errors)
  function isSnortProxy(url: string): boolean {
    return url.includes('imgproxy.snort.social');
  }

  // Check if URL is from a host with known DNS/connectivity issues
  function isBlockedHost(url: string): boolean {
    try {
      const urlObj = new URL(url);
      // void.cat has DNS issues for many users
      return urlObj.hostname === 'void.cat' || urlObj.hostname.endsWith('.void.cat');
    } catch {
      return false;
    }
  }

  // Try to extract original URL from imgproxy.snort.social URL
  // Format: https://imgproxy.snort.social/{sig}/{options}/{base64url_encoded_original}
  function extractFromSnortProxy(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const segments = urlObj.pathname.split('/').filter(s => s);
      if (segments.length === 0) return null;
      
      // The last segment is the base64url-encoded original URL
      const encoded = segments[segments.length - 1];
      if (!encoded || encoded.length < 10) return null;
      
      // Decode base64url
      let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padding = (4 - (base64.length % 4)) % 4;
      base64 += '='.repeat(padding);
      
      const decoded = atob(base64);
      
      // Validate it looks like a URL
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        return decoded;
      }
    } catch (e) {
      // Decoding failed
    }
    return null;
  }

  // Build ordered fallback list
  // Skips blocked hosts (void.cat) and imgproxy, uses weserv proxy
  function buildImageCandidates(imageUrl: string): string[] {
    const candidates: string[] = [];
    let raw = normalizeUrl(imageUrl);
    if (!raw) return candidates;

    // If the raw URL is an imgproxy.snort.social URL, try to extract the original
    if (isSnortProxy(raw)) {
      const extracted = extractFromSnortProxy(raw);
      if (extracted) {
        raw = extracted;
      } else {
        // Can't extract original - just return empty (will show initials)
        return candidates;
      }
    }

    // If host is blocked (void.cat), skip direct URL and use proxy only
    if (isBlockedHost(raw)) {
      candidates.push(toWeserv(raw));
      return candidates;
    }

    // Normal case: try raw URL first, then weserv proxy fallback
    candidates.push(raw);
    candidates.push(toWeserv(raw));

    return [...new Set(candidates)];
  }

  onMount(async () => {
    if (!pubkey) return;
    
    try {
      // First try to get from cache
      user = profileCacheManager.getCachedProfile(pubkey);
      
      if (user && user.profile?.image) {
        imageCandidates = buildImageCandidates(user.profile.image);
        console.debug('[avatar] candidates', pubkey.slice(0, 8), imageCandidates);
        if (imageCandidates.length > 0) {
          currentCandidateIndex = 0;
          profilePicture = imageCandidates[0];
        }
        loading = false;
        return;
      }
      
      // If not in cache or no image, fetch from relays (waits for NDK ready)
      user = await profileCacheManager.getProfile(pubkey);
      
      if (user?.profile?.image) {
        imageCandidates = buildImageCandidates(user.profile.image);
        console.debug('[avatar] candidates', pubkey.slice(0, 8), imageCandidates);
        if (imageCandidates.length > 0) {
          currentCandidateIndex = 0;
          profilePicture = imageCandidates[0];
        }
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
  {#if profilePicture && !imageError}
    <img 
      src={profilePicture} 
      alt="Avatar"
      loading="lazy"
      decoding="async"
      style="
        width: 100%; 
        height: 100%; 
        object-fit: cover; 
        border-radius: 50%;
      "
      on:error={() => {
        // Index-based fallback: advance to next candidate, skip imgproxy.snort.social
        while (currentCandidateIndex < imageCandidates.length - 1) {
          currentCandidateIndex++;
          const next = imageCandidates[currentCandidateIndex];
          if (!next.includes('imgproxy.snort.social')) {
            profilePicture = next;
            imageError = false;
            return;
          }
        }
        // All candidates exhausted - show initials
        imageError = true;
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
