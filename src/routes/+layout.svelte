<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import Header from '../components/Header.svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { userPublickey, ndk } from '$lib/nostr';
  import BottomNav from '../components/BottomNav.svelte';
  import Footer from '../components/Footer.svelte';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import type { LayoutData } from './$types';
  import ErrorBoundary from '../components/ErrorBoundary.svelte';
  import OfflineIndicator from '../components/OfflineIndicator.svelte';
  import { theme } from '$lib/themeStore';

  // Accept props from SvelteKit to prevent warnings
  export let data: LayoutData = {} as LayoutData;

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

  // Handle deep links from Capacitor (for NIP-46 pairing)
  async function handleDeepLink(url: string) {
    console.log('[DeepLink] Received:', url);
    
    if (!authManager) {
      console.warn('[DeepLink] Auth manager not initialized');
      return;
    }

    // Check if we have a pending NIP-46 pairing
    if (authManager.hasPendingNip46Pairing()) {
      console.log('[DeepLink] Has pending NIP-46 pairing, restarting listener...');
      await authManager.restartNip46ListenerIfPending();
      goto('/login');
      return;
    }

    // Handle bunker:// URLs for direct NIP-46 auth
    if (url.startsWith('bunker://') || url.startsWith('nostrconnect://')) {
      try {
        await authManager.authenticateWithNIP46(url);
        goto('/explore');
      } catch (e) {
        console.error('[DeepLink] NIP-46 auth failed:', e);
        goto('/login');
      }
    }
  }

  // Setup Capacitor deep link listeners
  async function setupCapacitorListeners() {
    if (!browser) return;

    try {
      const { App } = await import('@capacitor/app');

      // Listen for deep links when app is open
      App.addListener('appUrlOpen', (event) => {
        console.log('[Capacitor] appUrlOpen:', event.url);
        handleDeepLink(event.url);
      });

      // Listen for app state changes (resume)
      App.addListener('appStateChange', async (state) => {
        console.log('[Capacitor] appStateChange:', state.isActive ? 'active' : 'inactive');
        
        if (state.isActive && authManager?.hasPendingNip46Pairing()) {
          console.log('[Capacitor] App resumed with pending NIP-46 pairing');
          await authManager.restartNip46ListenerIfPending();
        }
      });

      // Check for launch URL (app opened via deep link)
      const launchUrl = await App.getLaunchUrl();
      if (launchUrl?.url) {
        console.log('[Capacitor] Launch URL:', launchUrl.url);
        handleDeepLink(launchUrl.url);
      }

      console.log('[Capacitor] Deep link listeners initialized');
    } catch (e) {
      // Capacitor not available (web environment)
      console.log('[Capacitor] Not available (web environment)');
    }
  }

  onMount(() => {
    try {
      // Initialize theme first to prevent FOUC
      theme.initialize();

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

      // Setup Capacitor deep link listeners
      setupCapacitorListeners();

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
  <div class="h-[100%] scroll-smooth overflow-x-hidden transition-colors duration-200 safe-area-container">
    <OfflineIndicator />
    <div class="flex h-full">
      <div class="mx-auto flex-1 pt-2 print:pt-[0] px-4 max-w-full safe-area-content">
        <Header />
        <div class="w-full mt-6 pb-24 lg:pb-8">
          <slot />
        </div>
        <Footer />
        <BottomNav />
      </div>
    </div>
  </div>
</ErrorBoundary>

<style>
  /* Safe area support for Android/iOS edge-to-edge displays */
  .safe-area-container {
    padding-top: env(safe-area-inset-top, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }
  
  /* Extra bottom padding on mobile to account for bottom nav + safe area */
  @media (max-width: 1023px) {
    .safe-area-content {
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
</style>
