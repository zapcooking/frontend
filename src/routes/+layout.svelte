<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import Header from '../components/Header.svelte';
  import { browser } from '$app/environment';
  import { derived } from 'svelte/store';
  import { page, updated } from '$app/stores';
  import { goto, beforeNavigate } from '$app/navigation';
  import { userPublickey, ndk } from '$lib/nostr';
  import BottomNav from '../components/BottomNav.svelte';
  import DesktopSideNav from '../components/DesktopSideNav.svelte';
  import NotificationSubscriber from '../components/NotificationSubscriber.svelte';
  import Footer from '../components/Footer.svelte';
  import CreateMenuButton from '../components/CreateMenuButton.svelte';
  import ScrollToTopButton from '../components/ScrollToTopButton.svelte';
  import PostModal from '../components/PostModal.svelte';
  import WalletModal from '../components/wallet/WalletModal.svelte';
  import ToastContainer from '../components/ToastContainer.svelte';
  import PendingIndicator from '../components/PendingIndicator.svelte';
  import LoginOverlay from '../components/LoginOverlay.svelte';
  import PasskeyEnrollPrompt from '../components/PasskeyEnrollPrompt.svelte';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';

  // Soft-launch gate for the passkey migration prompt. While false, existing
  // plaintext-key users are never prompted — enrollment is reachable only
  // via Settings → Security. Flip to true to start actively migrating users.
  const PASSKEY_ENROLL_PROMPT_ENABLED = false;
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { stopMessageSubscription, clearMessages } from '$lib/stores/messages';
  import { clearDecryptCache } from '$lib/encryptionService';
  import { clearUnwrapCache } from '$lib/nip17';
  import { stopGroupSubscription, clearGroups } from '$lib/stores/groups';
  import { preconnectPantry } from '$lib/nip29';
  import { installNsecPasteGuard } from '$lib/nsecPasteGuard';
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
  import {
    disconnectWallet as disconnectSparkWallet,
    clearAllSparkWallets,
    sweepLegacyMnemonic
  } from '$lib/spark';
  import { loadOneTapZapSettings } from '$lib/autoZapSettings';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { postComposerOpen } from '$lib/postComposerStore';
  import { longformEditorOpen, closeEditor } from '../components/reads/articleDraftStore';
  import LongformEditorLoadError from '../components/reads/LongformEditorLoadError.svelte';
  import LazyLoadErrorDialog from '../components/LazyLoadErrorDialog.svelte';
  import { createLazyLoader, bindLazyLoaderToOpenState } from '$lib/lazyComponentLoader';
  import { trackLoadingPendingOp } from '$lib/lazyLoadFeedback';
  import { isCheffyRoute, cheffyMessengerWanted } from '$lib/cheffyRoutes';
  import CookingToolsWidget from '../components/CookingToolsWidget.svelte';
  import UserSidePanel from '../components/UserSidePanel.svelte';
  import MobileNavDrawer from '../components/MobileNavDrawer.svelte';
  import MobileSearchOverlay from '../components/MobileSearchOverlay.svelte';
  import { cheffyOpen, closeCheffy } from '$lib/stores/cheffyChat';
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
  import { refreshActiveEngagement, clearAllEngagementCaches } from '$lib/engagementCache';
  import { scrollActiveSurfaceToTop } from '$lib/activeScrollSurface';

  // ── Lazy-loaded overlays ──────────────────────────────────────────
  // Heavy overlay components load on first open instead of shipping in
  // the layout chunk every page pays for. Each has its own loader (see
  // $lib/lazyComponentLoader): one import attempt in flight, no automatic
  // retries, and a failed import surfaces an error dialog with Retry/Close
  // instead of latching shut. A failed chunk import also dispatches
  // vite:preloadError, which the recovery handler below turns into at most
  // one reload per session; the dialogs are what users see once that
  // reload has been used (or didn't help). Once loaded, a component stays
  // mounted for the session (each renders nothing while closed) so later
  // opens are instant and close transitions keep working.

  // Longform editor: the TipTap/ProseMirror stack. The selected draft lives
  // in articleDraftStore, so a retry only re-imports the chunk and never
  // creates a new draft.
  const longformEditorLoader = createLazyLoader(
    () => import('../components/reads/LongformEditorModal.svelte'),
    { enabled: browser, label: 'longform-editor' }
  );

  // Cheffy messenger: markdown-it. Wanted only while all three hold —
  // browser (loader is inert during SSR), route eligibility (the same
  // isCheffyRoute predicate as showCheffy) and $cheffyOpen. Opening Cheffy
  // on an excluded route (/login, /onboarding, /cheffy, …) therefore never
  // fetches the chunk, and navigating to one while loading releases the
  // request so a late-resolving import shows no UI there. Conversation,
  // composer draft and preview/membership state live in stores, so they
  // survive a failed import.
  const cheffyMessengerLoader = createLazyLoader(
    () => import('../components/CheffyMessenger.svelte'),
    { enabled: browser, label: 'cheffy-messenger' }
  );
  const cheffyMessengerRequested = cheffyMessengerWanted(
    derived(page, ($page) => $page.url.pathname),
    cheffyOpen
  );

  onMount(() => {
    const cleanups = [
      bindLazyLoaderToOpenState(longformEditorLoader, longformEditorOpen),
      trackLoadingPendingOp(longformEditorLoader, longformEditorOpen, 'Loading editor…'),
      bindLazyLoaderToOpenState(cheffyMessengerLoader, cheffyMessengerRequested),
      trackLoadingPendingOp(cheffyMessengerLoader, cheffyMessengerRequested, 'Loading Cheffy…')
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  });

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
  const ogTitle = 'Zap Cooking - Food is Open Source';
  const description =
    'A place where food culture can live openly and grow naturally. Share recipes, support creators directly, no algorithms or ads.';
  const ogImage = `${siteUrl}/social-share.png`;
  $: canonical = `${siteUrl}${$page.url.pathname === '/' ? '' : $page.url.pathname}`;

  // Cheffy’s Table owns its compact HUD; shared authentication stays mounted.
  $: kitchenMode = $page.url.pathname.replace(/\/$/, '') === '/cheffys-table';

  // Skip layout OG tags on pages that set their own (recipe pages, note pages,
  // pack pages). When a page provides custom OG tags AND the layout also
  // emits its generic ones, scrapers see two `og:title` etc. and most pick
  // the first occurrence — which would be the layout's generic tags. Adding
  // a path here ensures the page's own SSR OG meta is the only set scrapers
  // see.
  $: pathSegment = $page.url.pathname.split('/')[1] || '';
  // The persistent Cheffy messenger is hidden on the full Cheffy page
  // (redundant), the chrome-less messaging surfaces, and auth flows.
  $: showCheffy = isCheffyRoute($page.url.pathname);
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

  // Tap the header's empty padding area → smooth-scroll back to top. Only
  // fires on |self (the wrapper), so real header interactions (search, logo,
  // buttons) are unaffected. Mirrors the iOS/Twitter "tap status bar" habit.
  function scrollToTop() {
    if (!browser) return;
    scrollActiveSurfaceToTop(document.getElementById('app-scroll'));
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
      // Block accidental nsec pastes everywhere except the login/key-import
      // field (the one place a secret key belongs). Idempotent.
      installNsecPasteGuard();
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

      // Locked passkey vault (record present, no plaintext key, no bunker):
      // surface the unlock overlay once on startup. The user can dismiss it
      // and browse anonymously; the Login button re-opens it. Guarded on the
      // other restore inputs so an in-flight plaintext/NIP-46 restore doesn't
      // flash the overlay.
      if (
        browser &&
        !authState.isAuthenticated &&
        authManager.getVaultStatus?.() === 'locked' &&
        !localStorage.getItem('nostrcooking_privateKey') &&
        localStorage.getItem('nostrcooking_authMethod') !== 'nip46'
      ) {
        loginOverlayOpen.set(true);
      }

      // Subscribe to auth state changes
      unsubscribe = authManager.subscribe((state: AuthState) => {
        authState = state;

        // Sync with legacy userPublickey store for compatibility
        if (state.isAuthenticated && state.publicKey) {
          userPublickey.set(state.publicKey);
          // Upgrade a legacy V1 Spark mnemonic (key = sha256(pubkey), so
          // readable by anyone with localStorage access) without waiting
          // for the user to open the wallet. Deferred so it never competes
          // with first paint; no-ops when there's nothing to migrate.
          setTimeout(() => void sweepLegacyMnemonic(state.publicKey), 2500);
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
          // Release every note's engagement subscriptions/dedupe sets and
          // wipe the engagement localStorage cache — the next user must
          // not inherit any of it.
          clearAllEngagementCaches();
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
    {#if !kitchenMode}<OfflineIndicator />{/if}
    <div class="flex flex-col h-full overflow-hidden">
      {#if $feedInitialLoadDone}
        <NotificationSubscriber />
      {/if}
      <!-- Fixed sidebar -->
      {#if !kitchenMode}
        <DesktopSideNav />
        <!-- Header with blur. Fixed to the viewport (not sticky inside the
           scroll container) so it stays put while the page content scrolls
           and rubber-band-bounces behind it. -->
        <div
          class="header-blur fixed top-0 left-0 right-0 lg:left-[calc(14rem_+_5px)] xl:left-[calc(20rem_+_5px)] z-30 py-3 px-4"
          on:click|self={scrollToTop}
        >
          <Header />
          <!-- Decorative connector (desktop): a vertical line just left of
             the search box that curves into the header's bottom divider. -->
          <span class="header-pipe" aria-hidden="true"></span>
        </div>
      {/if}
      <!-- Full-page scroll container: clip horizontal overflow to prevent Safari horizontal scroll/gap.
           Top padding clears the fixed header via the CSS-deterministic
           --header-h (defined in app.css); the same var lets sticky
           sub-headers sit directly below it. -->
      <div
        id="app-scroll"
        class:kitchen-scroll={kitchenMode}
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden {kitchenMode
          ? ''
          : 'lg:ml-[calc(14rem_+_5px)] xl:ml-[calc(20rem_+_5px)]'}"
        style="background-color: var(--color-bg-primary); padding-top: {kitchenMode
          ? '0px'
          : 'var(--header-h)'};"
      >
        <div
          class="{kitchenMode
            ? ''
            : 'px-4 lg:pl-[26px]'} min-w-0 max-w-full flex flex-col min-h-full {kitchenMode ||
          $page.url.pathname.startsWith('/messages') ||
          $page.url.pathname.startsWith('/groups')
            ? ''
            : 'pb-16 lg:pb-8'}"
        >
          <!-- Grow the page content so the footer is pushed to the bottom on
               short pages instead of floating mid-viewport. -->
          <div class="flex-1 min-w-0 max-w-full">
            <slot />
          </div>
          {#if !kitchenMode && !$page.url.pathname.startsWith('/messages') && !$page.url.pathname.startsWith('/groups')}
            <Footer />
          {/if}
        </div>
      </div>
      {#if !kitchenMode && !$page.url.pathname.startsWith('/messages') && !$page.url.pathname.startsWith('/groups') && !$postComposerOpen}
        <CreateMenuButton variant="floating" />
      {/if}
      {#if !kitchenMode && !$page.url.pathname.startsWith('/messages') && !$page.url.pathname.startsWith('/groups')}
        <ScrollToTopButton />
      {/if}
      {#if !kitchenMode}<BottomNav />
        <CookingToolsWidget />{/if}
      {#if showCheffy && $cheffyMessengerLoader.component}
        <!-- The floating launcher was retired (A2); Cheffy opens from the
             header Intelligence menu's "Ask Cheffy" item. The messenger
             stays gated here and on /explore's own entry points. -->
        <svelte:component this={$cheffyMessengerLoader.component} />
      {:else if $cheffyMessengerRequested && $cheffyMessengerLoader.status === 'failed'}
        <LazyLoadErrorDialog
          title="Couldn't load Cheffy"
          message="The Cheffy messenger didn't download. Check your connection and try again. Your conversation so far is kept. If this keeps happening, reload the page."
          error={$cheffyMessengerLoader.error}
          onRetry={cheffyMessengerLoader.retry}
          onClose={closeCheffy}
        />
      {/if}
      <MobileNavDrawer />
      <UserSidePanel />
      <MobileSearchOverlay />
      <PostModal bind:open={$postComposerOpen} />
      {#if $longformEditorLoader.component}
        <svelte:component this={$longformEditorLoader.component} />
      {:else if $longformEditorOpen && $longformEditorLoader.status === 'failed'}
        <LongformEditorLoadError
          error={$longformEditorLoader.error}
          onRetry={longformEditorLoader.retry}
          onClose={closeEditor}
        />
      {/if}
      <WalletModal />
      {#if $loginOverlayOpen}
        <LoginOverlay />
      {/if}
      {#if PASSKEY_ENROLL_PROMPT_ENABLED && authManager}
        <PasskeyEnrollPrompt />
      {/if}
      <ToastContainer />
      <PendingIndicator />
    </div>
  </div>
</ErrorBoundary>

<style>
  .kitchen-scroll {
    scrollbar-width: none;
  }
  .kitchen-scroll::-webkit-scrollbar {
    display: none;
  }
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
  @media (min-width: 1024px) {
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
