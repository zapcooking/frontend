<script lang="ts">
  /**
   * Cook+ promotional bottom bar — a quiet, dismissible reminder for
   * signed-in non-members on the main feed and recipe detail pages.
   *
   * It sends people to /membership; it never opens checkout. All of the
   * "should this show right now" rules live in $lib/cookPlusPromoBar
   * (pure, unit-tested), including the bottom-dock handshake that hides
   * the floating create and scroll-to-top buttons while the bar is up.
   * This component only wires stores and storage to the controller and
   * draws the bar in the membership page's sticky-CTA language.
   */
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { setBottomDockClaim } from '$lib/stores/bottomDock';
  import { postComposerOpen } from '$lib/postComposerStore';
  import { longformEditorOpen } from './reads/articleDraftStore';
  import { walletModalOpen } from '$lib/wallet/walletModalStore';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { cheffyOpen } from '$lib/stores/cheffyChat';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { mobileNavOpen } from '$lib/stores/mobileNav';
  import { userSidePanelOpen } from '$lib/stores/userSidePanel';
  import { cookPlusDiscoveryModalOpen } from '$lib/stores/cookPlusDiscoveryModal';
  import XIcon from 'phosphor-svelte/lib/X';
  import {
    PROMO_BAR_COPY,
    PROMO_BAR_CTA_HREF,
    PROMO_BAR_DOCK_OWNER,
    createPromoBarController,
    isPromoBarRoute,
    type PromoBarState
  } from '$lib/cookPlusPromoBar';

  /** PUBLIC_MEMBERSHIP_ENABLED, resolved by the root layout. */
  export let membershipEnabled = false;

  function localStore(): Storage | null {
    try {
      return browser ? window.localStorage : null;
    } catch {
      return null;
    }
  }
  function sessionStore(): Storage | null {
    try {
      return browser ? window.sessionStorage : null;
    } catch {
      return null;
    }
  }

  const controller = createPromoBarController({
    dock: { set: (occupied) => setBottomDockClaim(PROMO_BAR_DOCK_OWNER, occupied) },
    storage: localStore(),
    session: sessionStore()
  });

  let state: PromoBarState = { visible: false, surface: null };

  $: signedIn = Boolean($userPublickey);
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: membership = normalizedPk ? $membershipStatusMap[normalizedPk] : undefined;
  // Deduplicated and cached in the store, so this is free when another
  // surface (header, discovery modal) has already asked.
  $: if (browser && signedIn) queueMembershipLookup($userPublickey);
  $: storeOverlayOpen =
    $postComposerOpen ||
    $longformEditorOpen ||
    $walletModalOpen ||
    $loginOverlayOpen ||
    $cheffyOpen ||
    $mobileSearchOpen ||
    $mobileNavOpen ||
    $userSidePanelOpen ||
    $cookPlusDiscoveryModalOpen;

  // Overlays that don't go through a store (recipe picker, add-to-list,
  // image lightbox, …) are found in the DOM. They open and close without
  // touching any reactive dependency here, so while the bar is on an
  // eligible route a MutationObserver keeps `domOverlay` current; the
  // observer is off everywhere else so the feed's constant DOM churn costs
  // nothing where the bar can never show.
  const OVERLAY_SELECTOR = 'dialog[open], [aria-modal="true"], [role="dialog"]';
  let domOverlay = false;
  let observer: MutationObserver | null = null;

  function sampleDomOverlay() {
    const next = Boolean(document.querySelector(OVERLAY_SELECTOR));
    // Only assign on a change so the reactive re-plan runs on transitions.
    if (next !== domOverlay) domOverlay = next;
  }

  function observeOverlays(on: boolean) {
    if (!browser || typeof MutationObserver === 'undefined') return;
    if (on && !observer) {
      observer = new MutationObserver(sampleDomOverlay);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'aria-modal', 'role']
      });
      sampleDomOverlay();
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
      domOverlay = false;
    }
  }

  let mounted = false;
  $: if (mounted) observeOverlays(isPromoBarRoute($page.url));

  $: if (browser) {
    state = controller.update({
      membershipEnabled,
      url: $page.url,
      signedIn,
      membership,
      overlayOpen: storeOverlayOpen || domOverlay,
      now: Date.now()
    });
  }

  $: copy = state.surface ? PROMO_BAR_COPY[state.surface] : null;

  function dismiss() {
    controller.dismiss(Date.now());
    state = controller.state();
  }

  /** The anchor itself performs the navigation; this only records it. */
  function accept() {
    controller.accept(Date.now());
    state = controller.state();
  }

  onMount(() => {
    mounted = true;
  });

  onDestroy(() => {
    observeOverlays(false);
    controller.destroy();
  });
</script>

{#if state.visible && copy}
  <!-- Sits above the bottom nav (and any timer bar) and hides the floating
       create/scroll buttons via bottomDockOccupied so nothing overlaps it.
       On desktop it becomes a compact centred card instead of a full bar. -->
  <div
    class="promo-bar"
    role="region"
    aria-label="Cook+ membership"
    data-testid="cook-plus-promo-bar"
    data-surface={state.surface}
  >
    <div class="promo-text">
      <span class="promo-title">{copy.title}</span>
      <span class="promo-body">{copy.body}</span>
    </div>
    <a
      href={PROMO_BAR_CTA_HREF}
      class="promo-cta"
      data-testid="cook-plus-promo-cta"
      on:click={accept}
    >
      {copy.cta}
    </a>
    <button
      type="button"
      class="promo-dismiss"
      aria-label="Dismiss"
      data-testid="cook-plus-promo-dismiss"
      on:click={dismiss}
    >
      <XIcon size={16} />
    </button>
  </div>
{/if}

<style>
  /* Mirrors .sticky-cta on the membership page: same offsets, surface and
     rise, so the two read as one control. */
  .promo-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--bottom-nav-height, 56px) + var(--timer-widget-offset, 0px));
    z-index: 39;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem max(0.75rem, env(safe-area-inset-right, 0px)) 0.625rem
      max(1rem, env(safe-area-inset-left, 0px));
    background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--color-input-border);
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.08);
    animation: promo-rise 0.2s ease-out;
  }

  @keyframes promo-rise {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .promo-bar {
      animation: none;
    }
  }

  .promo-text {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  .promo-title {
    font-weight: 800;
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }

  .promo-body {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .promo-cta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.6rem 1.1rem;
    border-radius: 9999px;
    background: var(--color-primary);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
    transition: background-color 0.15s ease;
  }
  .promo-cta:hover {
    background: #d63a00;
    color: #fff;
  }

  .promo-dismiss {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    margin-right: -0.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .promo-dismiss:hover {
    color: var(--color-text-primary);
    background: var(--color-input-bg);
  }

  .promo-cta:focus-visible,
  .promo-dismiss:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  /* Desktop: no bottom nav, so a full-width bar would read as a banner.
     Shrink to a compact card centred in the content column (the offsets
     match the root layout's sidebar margins). */
  @media (min-width: 1024px) {
    .promo-bar {
      left: calc(14rem + 5px);
      right: 0;
      bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
      width: min(30rem, calc(100% - 14rem - 5px - 2rem));
      margin: 0 auto;
      padding: 0.5rem 0.5rem 0.5rem 1rem;
      border: 1px solid var(--color-input-border);
      border-radius: 9999px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    }
    .promo-dismiss {
      margin-right: 0;
    }
  }

  @media (min-width: 1280px) {
    .promo-bar {
      left: calc(20rem + 5px);
      width: min(30rem, calc(100% - 20rem - 5px - 2rem));
    }
  }
</style>
