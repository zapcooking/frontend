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
  import CreateMenuButton from '../components/CreateMenuButton.svelte';
  import PostModal from '../components/PostModal.svelte';
  import WalletWelcomeModal from '../components/WalletWelcomeModal.svelte';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import type { LayoutData } from './$types';
  import ErrorBoundary from '../components/ErrorBoundary.svelte';
  import OfflineIndicator from '../components/OfflineIndicator.svelte';
  import { theme } from '$lib/themeStore';
  import { initializeWalletManager, walletConnected } from '$lib/wallet';
  import { loadOneTapZapSettings } from '$lib/autoZapSettings';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { postComposerOpen } from '$lib/postComposerStore';
  // Import sync service to initialize offline sync functionality
  import '$lib/syncService';
  // Import platform detection to initialize early
  import { detectPlatform } from '$lib/platform';

  // Accept props from SvelteKit to prevent warnings
  export let data: LayoutData = {} as LayoutData;

  // Site-wide meta tag defaults
  const siteUrl = 'https://zap.cooking';
  const title = 'Zap Cooking';
  const ogTitle = 'Zap Cooking - Food. Friends. Freedom.';
  const description =
    'A place where food culture can live openly and grow naturally. Share recipes, support creators directly, no algorithms or ads.';
  const ogImage = `${siteUrl}/social-share.png`;
  $: canonical = `${siteUrl}${$page.url.pathname === '/' ? '' : $page.url.pathname}`;

  // Skip layout OG tags on pages that set their own (recipe pages)
  $: hasCustomOgTags =
    $page.url.pathname.startsWith('/recipe/') || $page.url.pathname.startsWith('/r/');

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
  let walletWelcomeOpen = false;
  let walletWelcomeSeen = false;
  let walletWelcomeForce = false;
  let oneTapZapLoadedForPubkey = '';
  const WALLET_WELCOME_KEY = 'zapcooking_wallet_welcome_seen';
  const WALLET_WELCOME_FORCE_KEY = 'zapcooking_wallet_welcome_force';
  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  function markWalletWelcomeSeen() {
    walletWelcomeOpen = false;
    walletWelcomeSeen = true;
    if (browser) {
      localStorage.setItem(WALLET_WELCOME_KEY, '1');
    }
  }

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
    // Note: nostrconnect:// is NOT handled here - it's for signers to scan, not direct input
    if (url.startsWith('bunker://')) {
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

    console.log('[Capacitor] Setting up listeners...');

    try {
      // Import Capacitor core to check if we're in a native environment
      const { Capacitor } = await import('@capacitor/core');

      if (!Capacitor.isNativePlatform()) {
        console.log('[Capacitor] Not a native platform, skipping listener setup');
        return;
      }

      console.log('[Capacitor] Native platform detected:', Capacitor.getPlatform());

      const { App } = await import('@capacitor/app');

      // Listen for deep links when app is open
      await App.addListener('appUrlOpen', (event) => {
        console.log('[Capacitor] appUrlOpen:', event.url);
        handleDeepLink(event.url);
      });
      console.log('[Capacitor] appUrlOpen listener registered');

      // Listen for app state changes (resume)
      await App.addListener('appStateChange', async (state) => {
        console.log('[Capacitor] appStateChange:', state.isActive ? 'active' : 'inactive');

        if (state.isActive) {
          console.log('[Capacitor] App became active, checking for pending NIP-46 pairing...');
          if (authManager?.hasPendingNip46Pairing()) {
            console.log('[Capacitor] Found pending NIP-46 pairing, restarting listener');
            try {
              await authManager.restartNip46ListenerIfPending();
            } catch (e) {
              console.error('[Capacitor] Error restarting NIP-46 listener:', e);
            }
          } else {
            console.log('[Capacitor] No pending NIP-46 pairing found');
          }
        }
      });
      console.log('[Capacitor] appStateChange listener registered');

      // Also listen for resume event as backup
      await App.addListener('resume', async () => {
        console.log('[Capacitor] resume event received');
        if (authManager?.hasPendingNip46Pairing()) {
          console.log('[Capacitor] Resume with pending NIP-46 pairing, restarting listener');
          try {
            await authManager.restartNip46ListenerIfPending();
          } catch (e) {
            console.error('[Capacitor] Error restarting NIP-46 listener on resume:', e);
          }
        }
      });
      console.log('[Capacitor] resume listener registered');

      // Check for launch URL (app opened via deep link)
      const launchUrl = await App.getLaunchUrl();
      if (launchUrl?.url) {
        console.log('[Capacitor] Launch URL:', launchUrl.url);
        handleDeepLink(launchUrl.url);
      }

      console.log('[Capacitor] All listeners initialized successfully');
    } catch (e) {
      // Capacitor not available (web environment) or error during setup
      console.log('[Capacitor] Setup error or not available:', e);
    }
  }

  onMount(async () => {
    try {
      // Detect platform first (iOS, Android, or web)
      detectPlatform();

      // Initialize theme first to prevent FOUC
      theme.initialize();

      // Request notification permissions on app launch (first time only)
      // This is for general app notifications (zaps, replies, etc.)
      // Timer notifications have their own permission flow
      if (browser) {
        try {
          const { requestPermissionsOnAppLaunch } = await import('$lib/native/notifications');
          await requestPermissionsOnAppLaunch();
        } catch (error) {
          console.error('[Layout] Error requesting notification permissions:', error);
        }
      }

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

        if (browser && state.isAuthenticated && state.publicKey) {
          if (oneTapZapLoadedForPubkey !== state.publicKey) {
            oneTapZapLoadedForPubkey = state.publicKey;
            void loadOneTapZapSettings();
          }
        } else {
          oneTapZapLoadedForPubkey = '';
        }

        if (browser) {
          walletWelcomeForce = localStorage.getItem(WALLET_WELCOME_FORCE_KEY) === '1';
        }

        if (browser && state.isAuthenticated && state.publicKey && !hasWallet) {
          if (walletWelcomeForce || !walletWelcomeSeen) {
            walletWelcomeOpen = true;
            if (walletWelcomeForce) {
              walletWelcomeForce = false;
              localStorage.removeItem(WALLET_WELCOME_FORCE_KEY);
            }
          }
        }
      });

      // Initialize wallet manager to restore saved wallets
      initializeWalletManager();

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

  onMount(() => {
    if (browser) {
      walletWelcomeSeen = localStorage.getItem(WALLET_WELCOME_KEY) === '1';
      walletWelcomeForce = localStorage.getItem(WALLET_WELCOME_FORCE_KEY) === '1';
    }
  });

  $: if (walletWelcomeOpen && hasWallet) {
    markWalletWelcomeSeen();
  }
</script>

<svelte:head>
  {#if !hasCustomOgTags}
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
  {/if}
</svelte:head>

<ErrorBoundary fallback="Something went wrong with the page layout. Please refresh the page.">
  <div
    class="h-[100%] scroll-smooth overflow-x-hidden transition-colors duration-200 safe-area-container"
  >
    <OfflineIndicator />
    <div class="flex h-full">
      <div class="mx-auto flex-1 pt-2 print:pt-[0] px-4 max-w-full safe-area-content">
        <Header />
        <div class="w-full mt-6 pb-24 lg:pb-8">
          <slot />
        </div>
        <Footer />
        <CreateMenuButton variant="floating" />
        <BottomNav />
        <PostModal bind:open={$postComposerOpen} />
        <WalletWelcomeModal bind:open={walletWelcomeOpen} onDismiss={markWalletWelcomeSeen} />
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
