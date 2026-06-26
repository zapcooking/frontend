<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import Header from '../components/Header.svelte';
  import { browser } from '$app/environment';
  import { page, updated } from '$app/stores';
  import { goto, beforeNavigate } from '$app/navigation';
  import { userPublickey, ndk } from '$lib/nostr';
  import BottomNav from '../components/BottomNav.svelte';
  import DesktopSideNav from '../components/DesktopSideNav.svelte';
  import NotificationSubscriber from '../components/NotificationSubscriber.svelte';
  import Footer from '../components/Footer.svelte';
  import CreateMenuButton from '../components/CreateMenuButton.svelte';
  import PostModal from '../components/PostModal.svelte';
  import LongformEditorModal from '../components/reads/LongformEditorModal.svelte';
  import WalletModal from '../components/wallet/WalletModal.svelte';
  import ToastContainer from '../components/ToastContainer.svelte';
  import LoginOverlay from '../components/LoginOverlay.svelte';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { stopMessageSubscription, clearMessages } from '$lib/stores/messages';
  import { clearDecryptCache } from '$lib/encryptionService';
  import { clearUnwrapCache } from '$lib/nip17';
  import { stopGroupSubscription, clearGroups } from '$lib/stores/groups';
  import { preconnectPantry } from '$lib/nip29';
  import type { LayoutData } from './$types';
  import ErrorBoundary from '../components/ErrorBoundary.svelte';
  import OfflineIndicator from '../components/OfflineIndicator.svelte';
  import { theme } from '$lib/themeStore';
  import {
    initializeWalletManager,
    walletConnected,
    clearAllWallets,
    openWallet
  } from '$lib/wallet';
  import { disconnectWallet as disconnectSparkWallet, clearAllSparkWallets } from '$lib/spark';
  import { loadOneTapZapSettings } from '$lib/autoZapSettings';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { postComposerOpen } from '$lib/postComposerStore';
  import CookingToolsWidget from '../components/CookingToolsWidget.svelte';
  import UserSidePanel from '../components/UserSidePanel.svelte';
  import MobileSearchOverlay from '../components/MobileSearchOverlay.svelte';
  import CheffyLauncher from '../components/CheffyLauncher.svelte';
  import CheffyMessenger from '../components/CheffyMessenger.svelte';
  // Import sync service to initialize offline sync functionality
  import '$lib/syncService';
  // Import platform detection to initialize early
  import { detectPlatform } from '$lib/platform';
  // Startup coordination — defer non-critical services until feed renders
  import { feedInitialLoadDone } from '$lib/startupState';
  // Prewarm outbox relay list cache early (on login, regardless of page)
  import { prewarmOutboxCache } from '$lib/followOutbox';
  // Refresh engagement counts when the tab returns from background
  import { tabVisibleAfterHide } from '$lib/tabVisibility';
  import { refreshActiveEngagement } from '$lib/engagementCache';

  // Version-skew guard: when a new deploy is detected (kit.version
  // pollInterval in svelte.config.js), turn the next client-side navigation
  // into a full-page load. Cloudflare Pages removes the previous deploy's
  // immutable assets, so stale clients otherwise 404 on chunk imports when
  // navigating (broken tabs until a hard refresh).
  beforeNavigate(({ willUnload, to, cancel }) => {
    if ($updated && !willUnload && to?.url) {
      // Cancel the client-side navigation first so SvelteKit doesn't start
      // resolving (stale) route chunks before the full-page load takes over.
      cancel();
      location.href = to.url.href;
    }
  });

  // Recovery for chunk-load failures (stale deploy assets): reload AT MOST
  // ONCE per browser session. The previous design re-armed after 10s of
  // health, which produced a reload roughly every 10s on clients where the
  // failure recurs indefinitely (e.g. iOS Safari with a content blocker or
  // poisoned HTML cache). sessionStorage survives reloads in the same tab,
  // so a recovery reload that didn't fix the problem can never repeat —
  // further failures are only counted and logged.
  const RECOVERY_RELOAD_KEY = 'zc:recovery-reload';

  interface RecoveryReloadRecord {
    /** Set when the one recovery reload of this session was triggered. */
    reloadedAt?: number;
    /** Total vite:preloadError events this session, including suppressed ones. */
    errors: number;
    /** Message of the most recent preload error (failing chunk URL when available). */
    lastError?: string;
    lastErrorAt?: number;
  }

  onMount(() => {
    const readRecord = (): RecoveryReloadRecord => {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(RECOVERY_RELOAD_KEY) ?? '');
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Partial<RecoveryReloadRecord>;
          return { ...rec, errors: typeof rec.errors === 'number' ? rec.errors : 0 };
        }
      } catch {
        // Missing or corrupt record — start fresh.
      }
      return { errors: 0 };
    };

    const onPreloadError = (event: Event) => {
      // Vite attaches the underlying error as `payload` on the event.
      const payload = (event as Event & { payload?: unknown }).payload;
      const message =
        payload instanceof Error ? payload.message : String(payload ?? 'unknown preload error');

      const record = readRecord();
      record.errors += 1;
      record.lastError = message;
      record.lastErrorAt = Date.now();

      if (record.reloadedAt) {
        // Already used this session's one recovery reload — never reload
        // again. Persist the counter for diagnostics and let the failure
        // surface normally (SvelteKit error handling / console).
        try {
          sessionStorage.setItem(RECOVERY_RELOAD_KEY, JSON.stringify(record));
        } catch {
          // ignore storage errors
        }
        console.warn(
          `[recovery] Chunk preload failed again after recovery reload (error #${record.errors}); suppressing further reloads.`,
          message
        );
        return;
      }

      record.reloadedAt = Date.now();
      try {
        // sessionStorage writes are synchronous — the record is durably in
        // place before reload() below, so the post-reload page always sees
        // reloadedAt and cannot reload a second time.
        sessionStorage.setItem(RECOVERY_RELOAD_KEY, JSON.stringify(record));
      } catch {
        // No storage means no loop protection — never reload in that case.
        return;
      }
      event.preventDefault();
      location.reload();
    };
    window.addEventListener('vite:preloadError', onPreloadError);

    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  });

  // Accept props from SvelteKit to prevent warnings
  export let data: LayoutData = {} as LayoutData;
  // Also reference it to satisfy svelte-check (it can be unused in markup)
  $: data;

  // Site-wide meta tag defaults
  const siteUrl = 'https://zap.cooking';
  const title = 'Zap Cooking';
  const ogTitle = 'Zap Cooking - Food. Friends. Freedom.';
  const description =
    'A place where food culture can live openly and grow naturally. Share recipes, support creators directly, no algorithms or ads.';
  const ogImage = `${siteUrl}/social-share.png`;
  $: canonical = `${siteUrl}${$page.url.pathname === '/' ? '' : $page.url.pathname}`;

  // Skip layout OG tags on pages that set their own (recipe pages, note pages,
  // pack pages). When a page provides custom OG tags AND the layout also
  // emits its generic ones, scrapers see two `og:title` etc. and most pick
  // the first occurrence — which would be the layout's generic tags. Adding
  // a path here ensures the page's own SSR OG meta is the only set scrapers
  // see.
  $: pathSegment = $page.url.pathname.split('/')[1] || '';
  // The persistent Cheffy messenger is hidden on the full Cheffy page
  // (redundant), the chrome-less messaging surfaces, and auth flows.
  $: showCheffy =
    !$page.url.pathname.startsWith('/messages') &&
    !$page.url.pathname.startsWith('/groups') &&
    !$page.url.pathname.startsWith('/cheffy') &&
    !$page.url.pathname.startsWith('/zappy') &&
    !$page.url.pathname.startsWith('/login') &&
    !$page.url.pathname.startsWith('/onboarding');
  $: hasCustomOgTags =
    $page.url.pathname.startsWith('/recipe/') ||
    $page.url.pathname.startsWith('/r/') ||
    $page.url.pathname.startsWith('/pack/') ||
    pathSegment.startsWith('note1') ||
    pathSegment.startsWith('nevent1');

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
  let feedInitialLoadTimeout: ReturnType<typeof setTimeout> | null = null;
  let walletWelcomeSeen = false;
  let walletWelcomeForce = false;
  let oneTapZapLoadedForPubkey = '';
  const WALLET_WELCOME_KEY = 'zapcooking_wallet_welcome_seen';
  const WALLET_WELCOME_FORCE_KEY = 'zapcooking_wallet_welcome_force';
  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  // Open the wallet modal directly when the user is logged in but has
  // no wallet — the picker view inside the modal already serves as the
  // welcome screen, so we don't need a separate intro modal.
  function promptWalletSetup() {
    walletWelcomeSeen = true;
    if (browser) localStorage.setItem(WALLET_WELCOME_KEY, '1');
    openWallet('setup');
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
          // Message subscriptions are lazy — initialized when user navigates to /messages.
          // This avoids flooding browser signers with NIP-44 decrypt requests on login.
          // Pre-connect pantry relay shortly after login so groups load instantly
          // when user navigates to /groups (auth signing is only ~35ms, no contention risk)
          setTimeout(() => preconnectPantry($ndk), 1000);
          // Prewarm outbox relay list cache so feed loads faster regardless of which page user lands on
          setTimeout(() => prewarmOutboxCache($ndk, state.publicKey).catch(() => {}), 2000);
        } else {
          userPublickey.set('');
          stopMessageSubscription();
          clearMessages();
          clearDecryptCache();
          clearUnwrapCache();
          stopGroupSubscription();
          clearGroups();
          disconnectSparkWallet().catch(() => {});
          clearAllWallets();
          clearAllSparkWallets();
        }

        if (browser && state.isAuthenticated && state.publicKey) {
          if (oneTapZapLoadedForPubkey !== state.publicKey) {
            oneTapZapLoadedForPubkey = state.publicKey;
            // Defer non-critical settings load to avoid competing with feed for relay bandwidth
            setTimeout(() => loadOneTapZapSettings(), 3000);
          }
        } else {
          oneTapZapLoadedForPubkey = '';
        }

        if (browser) {
          walletWelcomeForce = localStorage.getItem(WALLET_WELCOME_FORCE_KEY) === '1';
        }

        const isOnboardingFlow =
          $page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/onboarding');
        if (
          browser &&
          state.isAuthenticated &&
          state.publicKey &&
          !hasWallet &&
          !isOnboardingFlow
        ) {
          if (walletWelcomeForce || !walletWelcomeSeen) {
            promptWalletSetup();
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

      // Safety timeout: if user never visits the feed (e.g. lands on /recipe/*),
      // ensure notifications and other deferred services still start after 10s
      feedInitialLoadTimeout = setTimeout(() => feedInitialLoadDone.set(true), 10000);

      console.log('Layout mounted - auth manager initialized');
    } catch (error) {
      console.error('Failed to initialize auth manager:', error);
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
    if (feedInitialLoadTimeout !== null) {
      clearTimeout(feedInitialLoadTimeout);
    }
  });

  onMount(() => {
    if (browser) {
      walletWelcomeSeen = localStorage.getItem(WALLET_WELCOME_KEY) === '1';
      walletWelcomeForce = localStorage.getItem(WALLET_WELCOME_FORCE_KEY) === '1';
    }
  });

  // One-shot pass to clear legacy nourish_scan_* localStorage entries
  // left behind when scan caching was removed in PR 3 commit 6. Runs
  // via requestIdleCallback so it doesn't block initial paint; sentinel
  // flag ensures single-run per browser. Wrapped so a dynamic-import
  // failure (chunk not yet cached, network blip) can't surface as an
  // unhandled rejection during app boot.
  onMount(async () => {
    try {
      const { cleanupLegacyScanCache } = await import('$lib/nourish/scanCacheCleanup');
      cleanupLegacyScanCache();
    } catch (err) {
      console.warn('[nourish.scan-cleanup.import-failed]', err);
    }
  });

  // Drop the Garden feed's IndexedDB cache, orphaned when the garden
  // relay was decommissioned. Fire-and-forget: a failed or blocked
  // delete must never delay app init — it simply runs again on a
  // future load (deleting a nonexistent database is a no-op).
  onMount(() => {
    if (browser) {
      try {
        indexedDB.deleteDatabase('zapcooking-garden-cache');
      } catch {
        // ignore — implicitly retried on the next app load
      }
    }
  });

  // Open the wallet modal automatically once after leaving login/
  // onboarding when the user has no wallet (e.g. after suggested
  // follows completes).
  $: {
    const onboardingFlow =
      $page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/onboarding');
    if (browser && !onboardingFlow && authState.isAuthenticated && !hasWallet) {
      const forceFlag = localStorage.getItem(WALLET_WELCOME_FORCE_KEY) === '1';
      if (forceFlag || !walletWelcomeSeen) {
        promptWalletSetup();
        if (forceFlag) {
          localStorage.removeItem(WALLET_WELCOME_FORCE_KEY);
        }
      }
    }
  }

  // When the tab returns from background (hidden ≥1s), refresh the
  // most-recently-touched engagement counts. batchFetchEngagement has its
  // own 5-min TTL so a near-zero-gap return is cheap.
  //
  // Edge-trigger on the counter increment — without this latch, an
  // unrelated change to userPublickey/ndk (login, reconnect) while the
  // counter is already > 0 would re-fire the refresh.
  let lastSeenTabVisible = 0;
  $: if ($tabVisibleAfterHide > lastSeenTabVisible) {
    lastSeenTabVisible = $tabVisibleAfterHide;
    if ($userPublickey && $ndk) {
      refreshActiveEngagement($ndk, $userPublickey).catch((err) =>
        console.warn('[tab-visible] engagement refresh failed:', err)
      );
    }
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
    class="h-screen scroll-smooth overflow-hidden transition-colors duration-200 safe-area-container"
  >
    <OfflineIndicator />
    <div class="flex flex-col h-full overflow-hidden">
      {#if $feedInitialLoadDone}
        <NotificationSubscriber />
      {/if}
      <!-- Fixed sidebar -->
      <DesktopSideNav />
      <!-- Header with blur. Fixed to the viewport (not sticky inside the
           scroll container) so it stays put while the page content scrolls
           and rubber-band-bounces behind it. -->
      <div class="header-blur fixed top-0 left-0 right-0 xl:left-[calc(20rem_+_5px)] z-30 py-3 px-4">
        <Header />
        <!-- Decorative connector (desktop): a vertical line just left of
             the search box that curves into the header's bottom divider. -->
        <span class="header-pipe" aria-hidden="true"></span>
      </div>
      <!-- Full-page scroll container: clip horizontal overflow to prevent Safari horizontal scroll/gap.
           Top padding clears the fixed header via the CSS-deterministic
           --header-h (defined in app.css); the same var lets sticky
           sub-headers sit directly below it. -->
      <div
        id="app-scroll"
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden xl:ml-[calc(20rem_+_5px)]"
        style="background-color: var(--color-bg-primary); padding-top: var(--header-h);"
      >
        <div
          class="px-4 min-w-0 max-w-full {$page.url.pathname.startsWith('/messages') ||
          $page.url.pathname.startsWith('/groups')
            ? ''
            : 'pb-16 xl:pb-8'}"
        >
          <slot />
          {#if !$page.url.pathname.startsWith('/messages') && !$page.url.pathname.startsWith('/groups')}
            <Footer />
          {/if}
        </div>
      </div>
      {#if !$page.url.pathname.startsWith('/messages') && !$page.url.pathname.startsWith('/groups')}
        <CreateMenuButton variant="floating" />
      {/if}
      <BottomNav />
      <CookingToolsWidget />
      {#if showCheffy}
        <CheffyLauncher />
        <CheffyMessenger />
      {/if}
      <UserSidePanel />
      <MobileSearchOverlay />
      <PostModal bind:open={$postComposerOpen} />
      <LongformEditorModal />
      <WalletModal />
      {#if $loginOverlayOpen}
        <LoginOverlay />
      {/if}
      <ToastContainer />
    </div>
  </div>
</ErrorBoundary>

<style>
  /* Safe area support for Android/iOS edge-to-edge displays */
  .safe-area-container {
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }

  /* Extra bottom padding on mobile to account for bottom nav + safe area */
  @media (max-width: 1023px) {
    .safe-area-content {
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }

  /* Header with frosted glass effect. The bottom divider is drawn by
     ::after (not border-bottom) so it can be cleanly swapped for the pipe
     connector at xl without leaving a leftover full-width line behind. */
  .header-blur {
    /* Fallback for browsers that don't support color-mix */
    background-color: var(--color-bg-primary);
    background-color: color-mix(in srgb, var(--color-bg-primary) 70%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .header-blur::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: color-mix(in srgb, var(--color-input-border) 60%, transparent);
    pointer-events: none;
  }

  /* Dark-mode header gets a subtle navy lean; the divider uses a faint
     white line. */
  :global(.dark) .header-blur {
    background-color: rgba(14, 21, 41, 0.78);
    background-image: linear-gradient(to bottom, rgba(33, 39, 73, 0.45), rgba(14, 21, 41, 0.65));
  }
  :global(.dark) .header-blur::after {
    background: rgba(255, 255, 255, 0.06);
  }

  /* Safe-area-aware top padding, applied at ALL widths so the painted header
     height always equals the CSS-computed --header-h (single source of truth
     in app.css — same max() expression). `env(safe-area-inset-top, 0px)` alone
     would collapse to 0 on non-notched browsers (regular Chrome/Safari/Firefox
     on mobile and desktop), making the avatar touch the viewport top; `max()`
     keeps the baseline 0.75rem (matching the wrapper's `py-3`) and grows for
     devices with a real notch inset. */
  .header-blur {
    padding-top: max(env(safe-area-inset-top, 0px), 0.75rem);
  }

  /* Left edge gradient for smooth transition from sidebar (desktop only) */
  @media (min-width: 1024px) {
    .header-blur::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 10%;
      background: linear-gradient(to right, var(--color-bg-primary) 0%, transparent 100%);
      pointer-events: none;
    }
  }

  /* Decorative pipe connector — only on xl, where the logo lives in the
     sidebar and the search box sits at the content's left edge. ONE element
     draws the vertical line (from the very top of the header), the rounded
     elbow, and the full-width horizontal divider, so all three share the
     same color/weight and meet by construction. The header's own
     border-bottom (and dark-mode glow) are removed at xl so there's no
     second, misaligned line. */
  .header-pipe {
    display: none;
  }
  @media (min-width: 1280px) {
    /* Swap the full-width divider for the pipe: one element draws the
       vertical line (from the top), the rounded elbow, and the horizontal
       divider running right from the elbow — nothing to the left of it. */
    .header-blur::after {
      display: none;
    }
    .header-pipe {
      display: block;
      position: absolute;
      top: 0;
      bottom: 0;
      left: 16px;
      right: 0;
      border-left: 1px solid color-mix(in srgb, var(--color-input-border) 60%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--color-input-border) 60%, transparent);
      border-bottom-left-radius: 16px;
      pointer-events: none;
    }
    :global(.dark) .header-pipe {
      border-left-color: rgba(255, 255, 255, 0.06);
      border-bottom-color: rgba(255, 255, 255, 0.06);
    }
  }
</style>
