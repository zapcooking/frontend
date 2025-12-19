<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import Header from '../components/Header.svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { userPublickey, ndk } from '$lib/nostr';
  import BottomNav from '../components/BottomNav.svelte';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import type { LayoutData } from './$types';
  import ErrorBoundary from '../components/ErrorBoundary.svelte';
  import OfflineIndicator from '../components/OfflineIndicator.svelte';

  // Accept props from SvelteKit to prevent warnings
  export let data: LayoutData = {} as LayoutData;
  export let params: Record<string, string> = {};

  // Site-wide meta tag defaults
  const siteUrl = 'https://zap.cooking';
  const title = 'Zap Cooking';
  const ogTitle = 'Zap Cooking - A place to share food with friends';
  const description = 'A place to share food with friends';
  const ogImage = `${siteUrl}/social-share.png`;
  $: canonical = `${siteUrl}${$page.url.pathname === '/' ? '' : $page.url.pathname}`;

  let authManager: any = null;
  let authState: AuthState = {
    isAuthenticated: false,
    user: null,
    publicKey: '',
    authMethod: null,
    isLoading: false,
    error: null
  };
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    try {
      // Initialize auth manager
      authManager = createAuthManager($ndk);
      authState = authManager.getState();
      
      // Subscribe to auth state changes
      unsubscribe = authManager.subscribe((state: AuthState) => {
        authState = state;
        
        // Sync with legacy userPublickey store for compatibility
        if (state.isAuthenticated && state.publicKey) {
          userPublickey.set(state.publicKey);
        } else {
          userPublickey.set('');
        }
      });
      
      console.log('Layout mounted - auth manager initialized');
    } catch (error) {
      console.error('Failed to initialize auth manager:', error);
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />

  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={ogImage} />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={ogTitle} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImage} />
</svelte:head>

<ErrorBoundary fallback="Something went wrong with the page layout. Please refresh the page.">
  <div class="h-[100%] scroll-smooth overflow-x-hidden">
    <OfflineIndicator />
    <div class="flex h-full">
      <div class="mx-auto flex-1 pt-2 print:pt-[0] px-4 max-w-full">
        <Header />
        <div class="w-full mt-6 pb-24">
          <slot />
        </div>
        <!-- Mobile-only footer with Why link (at bottom of content, not fixed) -->
        <footer class="lg:hidden text-center py-6 mb-16 print:hidden">
          <a href="/why" class="text-gray-400 hover:text-gray-600 text-sm transition duration-300">Why</a>
        </footer>
        <BottomNav />
      </div>
    </div>
  </div>
</ErrorBoundary>
