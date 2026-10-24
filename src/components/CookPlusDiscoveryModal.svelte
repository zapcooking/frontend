<script lang="ts">
  /**
   * Cook+ discovery modal — a light, once-in-a-while introduction to
   * Sous Chef, Nourish and Cheffy for signed-in non-members.
   *
   * It sends people to /membership; it never opens checkout. All of the
   * "should this show right now" rules live in $lib/cookPlusDiscovery
   * (pure, unit-tested); this component only wires stores, storage, timers
   * and the DOM to them, and renders the card inside the shared Modal
   * (focus trap, Escape, focus restore, reduced motion).
   */
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { postComposerOpen } from '$lib/postComposerStore';
  import { longformEditorOpen } from './reads/articleDraftStore';
  import { walletModalOpen } from '$lib/wallet/walletModalStore';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { cheffyOpen } from '$lib/stores/cheffyChat';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { cookPlusDiscoveryModalOpen } from '$lib/stores/cookPlusDiscoveryModal';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import MagicWandIcon from 'phosphor-svelte/lib/MagicWand';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import XIcon from 'phosphor-svelte/lib/X';
  import { COOK_PLUS_HEADLINE, COOK_PLUS_TOOLS } from '$lib/cookPlusCopy';
  import { annualMonthlyEquivalent, MEMBERSHIP_PATH } from '$lib/cookPlusPricing';
  import {
    DISCOVERY_SHOW_DELAY_MS,
    createEngagementTracker,
    evaluateDiscoveryEligibility,
    isMembershipRoute,
    markShownThisSession,
    readDiscoveryRecord,
    wasShownThisSession,
    writeDiscoveryRecord,
    type DiscoveryAction,
    type EligibilityInput,
    type IneligibleReason
  } from '$lib/cookPlusDiscovery';

  /** PUBLIC_MEMBERSHIP_ENABLED, resolved by the root layout. */
  export let membershipEnabled = false;

  let open = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingForVisibility = false;
  let lastPathname: string | null = null;

  const monthlyEquivalent = annualMonthlyEquivalent();

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

  // Eligible-view count is kept in session storage so it survives full loads.
  const tracker = createEngagementTracker(sessionStore());

  $: pathname = $page.url.pathname;
  $: signedIn = Boolean($userPublickey);
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: membership = normalizedPk ? $membershipStatusMap[normalizedPk] : undefined;
  // The lookup is deduplicated and cached in the store, so asking here costs
  // nothing when another surface (header, explore) has already asked.
  $: if (browser && signedIn) queueMembershipLookup($userPublickey);
  $: storeOverlayOpen =
    $postComposerOpen ||
    $longformEditorOpen ||
    $walletModalOpen ||
    $loginOverlayOpen ||
    $cheffyOpen ||
    $mobileSearchOpen;

  // Overlays that don't go through a store (PostModal variants, sheets).
  function domOverlayOpen(): boolean {
    if (!browser) return false;
    return Boolean(document.querySelector('dialog[open], [aria-modal="true"], [role="dialog"]'));
  }

  function input(now: number, overlayOpen: boolean): EligibilityInput {
    return {
      membershipEnabled,
      pathname,
      signedIn,
      membership,
      overlayOpen,
      shownThisSession: wasShownThisSession(sessionStore()),
      record: readDiscoveryRecord(localStore()),
      now
    };
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Reasons that should close an already-open card. Opening it sets the
  // session flag and the 30-day record, so 'session' and 'cooldown' are
  // always true while it is up and must not count; 'route' is handled by
  // the navigation block, which closes on any path change.
  const CLOSE_WHILE_OPEN: ReadonlySet<IneligibleReason> = new Set([
    'disabled',
    'signed-out',
    'member',
    'overlay'
  ]);

  /** Decide whether anything needs to be scheduled from the current state. */
  function schedule() {
    if (!browser) return;
    clearTimer();
    const now = Date.now();
    // Store overlays only: the DOM check would find this modal's own dialog.
    const verdict = evaluateDiscoveryEligibility(input(now, storeOverlayOpen));
    if (open) {
      // Re-evaluate while up: logging out, the lookup resolving active, or
      // another overlay opening ends the pitch rather than stacking on it.
      if (!verdict.eligible && CLOSE_WHILE_OPEN.has(verdict.reason)) finish('close');
      return;
    }
    if (!verdict.eligible) return;
    if (tracker.isEngaged(now)) {
      timer = setTimeout(tryOpen, DISCOVERY_SHOW_DELAY_MS);
      return;
    }
    // Not engaged yet. The interaction listener re-schedules on first
    // input; the dwell rule needs a timer to be re-checked on time. Once
    // the deadline has passed, the only thing missing is an interaction,
    // so there is nothing to wait for — re-arming here would spin.
    const deadline = tracker.dwellDeadline();
    if (deadline !== null && now < deadline) {
      timer = setTimeout(schedule, deadline - now + 50);
    }
  }

  function tryOpen() {
    timer = null;
    if (!browser || open) return;
    if (document.visibilityState !== 'visible') {
      // Don't open into a background tab; retry when it is looked at.
      waitingForVisibility = true;
      return;
    }
    const now = Date.now();
    if (!tracker.isEngaged(now)) {
      schedule();
      return;
    }
    const verdict = evaluateDiscoveryEligibility(input(now, storeOverlayOpen || domOverlayOpen()));
    if (!verdict.eligible) return;
    // Persist first: if the 30-day record cannot be written, showing the
    // modal would mean showing it every visit, which is worse than never.
    const record = readDiscoveryRecord(localStore());
    if (!writeDiscoveryRecord(localStore(), { ...record, lastShownAt: now })) return;
    markShownThisSession(sessionStore());
    open = true;
  }

  function finish(action: DiscoveryAction) {
    if (!open) return;
    const record = readDiscoveryRecord(localStore());
    writeDiscoveryRecord(localStore(), {
      ...record,
      lastDismissedAt: Date.now(),
      lastAction: action
    });
    open = false;
  }

  function explore() {
    finish('explore');
    goto(MEMBERSHIP_PATH);
  }
  function later() {
    finish('later');
  }
  /** Escape, backdrop click and the X all land here via Modal's cleanup. */
  function dismissed() {
    finish('close');
  }

  // Navigation: count eligible views, treat a membership-page visit as
  // "already introduced" for the session, and never keep the card open
  // across a route change.
  $: if (browser && pathname !== lastPathname) {
    lastPathname = pathname;
    tracker.noteNavigation(pathname, Date.now());
    if (isMembershipRoute(pathname)) markShownThisSession(sessionStore());
    if (open) finish('close');
    schedule();
  }

  // Auth / membership / overlay changes can open or close the window of
  // eligibility, so re-plan on each. (Reading the values keeps this block
  // subscribed to them.)
  $: if (browser) {
    void signedIn;
    void membership;
    void storeOverlayOpen;
    schedule();
  }

  function onFirstInteraction() {
    tracker.noteInteraction();
    removeInteractionListeners();
    schedule();
  }
  const interactionEvents = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const;
  function removeInteractionListeners() {
    for (const evt of interactionEvents) {
      window.removeEventListener(evt, onFirstInteraction, { capture: true });
    }
  }
  function onVisibilityChange() {
    if (waitingForVisibility && document.visibilityState === 'visible') {
      waitingForVisibility = false;
      tryOpen();
    }
  }

  onMount(() => {
    // Capture phase so scrolls inside #app-scroll (which don't bubble)
    // still count; passive so nothing here can delay scrolling.
    for (const evt of interactionEvents) {
      window.addEventListener(evt, onFirstInteraction, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      removeInteractionListeners();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  // Mirror the open flag so the promotional bar can yield to the modal.
  $: cookPlusDiscoveryModalOpen.set(open);

  onDestroy(() => {
    clearTimer();
    cookPlusDiscoveryModalOpen.set(false);
  });
</script>

<Modal bind:open cleanup={dismissed} noHeader compact autoHeight maxWidth="26rem">
  <div class="discovery" data-testid="cook-plus-discovery">
    <p class="discovery-eyebrow">Cook+</p>
    <h2 id="title" class="discovery-title">{COOK_PLUS_HEADLINE}</h2>
    <p class="discovery-lede">
      Three tools that take the tedious parts out of cooking, included with one membership.
    </p>

    <ul class="discovery-tools">
      {#each COOK_PLUS_TOOLS as tool (tool.key)}
        <li class="discovery-tool tool-{tool.key}">
          <span class="discovery-icon" aria-hidden="true">
            {#if tool.key === 'souschef'}
              <MagicWandIcon size={20} weight="fill" />
            {:else if tool.key === 'nourish'}
              <LeafIcon size={20} weight="fill" />
            {:else}
              <CheffyAvatar size={36} variant="character" expression="happy" />
            {/if}
          </span>
          <span class="discovery-text">
            <span class="discovery-name">{tool.name}</span>
            <span class="discovery-short">{tool.short}</span>
          </span>
        </li>
      {/each}
    </ul>

    <p class="discovery-price">
      From ${monthlyEquivalent}/month, billed yearly. Bitcoin or card.
    </p>

    <div class="discovery-actions">
      <Button on:click={explore} class="w-full" data-testid="discovery-explore"
        >Explore Cook+</Button
      >
      <Button variant="ghost" on:click={later} class="w-full" data-testid="discovery-later">
        Maybe later
      </Button>
    </div>

    <button type="button" class="discovery-close" aria-label="Close" on:click={dismissed}>
      <XIcon size={20} />
    </button>
  </div>
</Modal>

<style>
  .discovery {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.25rem 0.25rem max(0.25rem, env(safe-area-inset-bottom, 0px));
    /* Room for the X in the corner. */
    padding-right: 2.5rem;
  }

  .discovery-eyebrow {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-primary);
  }

  .discovery-title {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.15;
    letter-spacing: -0.01em;
    font-weight: 800;
    color: var(--color-text-primary);
  }

  .discovery-lede {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  .discovery-tools {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .discovery-tool {
    --tool-accent: var(--color-primary);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    border-radius: 12px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
  }
  .tool-souschef {
    --tool-accent: #a855f7;
  }
  .tool-nourish {
    --tool-accent: #22c55e;
  }

  .discovery-icon {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    color: var(--tool-accent);
    background: color-mix(in srgb, var(--tool-accent) 14%, transparent);
  }
  .tool-cheffy .discovery-icon {
    background: transparent;
  }

  .discovery-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .discovery-name {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }
  .discovery-short {
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .discovery-price {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .discovery-actions {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.25rem;
    /* The actions are the last thing before the safe area on a phone. */
    margin-right: -2.25rem;
  }

  .discovery-close {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .discovery-close:hover {
    color: var(--color-text-primary);
    background: var(--color-input-bg);
  }
  .discovery-close:focus-visible,
  .discovery :global(button:focus-visible) {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
</style>
