<script lang="ts">
  /**
   * Cheffy Note Photo Review modal.
   *
   * The member picks a mode, Cheffy drafts a comment or recipe from the
   * note's photo, the member edits in place, then posts it as their own
   * NIP-10 reply via postComment() (D1: mandatory edit-before-post, no
   * auto-publish). Publish failures keep the draft; a publish timeout
   * keeps the SIGNED event so retry never asks the signer twice.
   * Multi-image notes use the first image; the picker strip is Phase 4.
   *
   * All branching logic (phase transitions, error mapping, hedged
   * copy, publish outcomes) lives in $lib/noteReview so it stays
   * unit-testable.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { goto } from '$app/navigation';
  import Modal from './Modal.svelte';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { THINKING_LINES, COOKING_LINES, ERROR_LINES, pickLine } from '$lib/cheffy';
  import { onDestroy } from 'svelte';
  import { lightningService } from '$lib/lightningService';
  import { activeWallet, sendPayment } from '$lib/wallet';
  import {
    requestNoteReview,
    phaseForResult,
    publishNoteReviewReply,
    retryPublishSignedEvent,
    canPost,
    withDisclosureFooter,
    loadDisclosurePref,
    shouldSeedDisclosureFromPref,
    saveDisclosurePref,
    requestCreditInvoice,
    checkCreditStatus,
    pollActionForStatus,
    executeCreditPayment,
    isInAppWalletKind,
    storePendingInvoice,
    clearPendingInvoice,
    resumePendingInvoice,
    DISCLOSURE_FOOTER,
    CREDIT_PRICE_SATS,
    CREDITS_CROSS_DEVICE_LINE,
    PAYMENT_CARD_EXAMPLE_DRAFT,
    NOTE_REVIEW_POST_ENABLED,
    type NoteReviewMode,
    type NoteReviewPhase,
    type PublishOutcome
  } from '$lib/noteReview';

  export let open = false;
  export let event: NDKEvent;
  export let imageUrls: string[] = [];

  // Multi-image picker: defaults to the first image; selection persists
  // across Regenerate (only reset() clears it). One imageUrl per server
  // call — the picker is purely client-side selection.
  let selectedImageIndex = 0;
  $: imageUrl = imageUrls[selectedImageIndex] ?? imageUrls[0] ?? '';

  let phase: NoteReviewPhase = 'choose';
  let mode: NoteReviewMode = 'comment';
  let draft = '';
  let message = '';
  let loadingLine = '';
  let errorLine = '';
  let postError = '';
  let noteLink = '';
  let timeoutSignedEvent: NDKEvent | null = null;
  // Disclosure footer toggle — per-mode preference, applied at publish
  // time only (never part of the editable draft).
  let disclosureOn = false;
  // Paid-draft balance: from creditsRemaining on spends, credit-status
  // polls, and the resume flow. null until any signal arrives.
  let creditBalance: number | null = null;
  let resumeAck = false; // "payment received" banner after a resume credit
  let payError = '';
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resumeCheckedForOpen = false;
  // In-app payment failed/timed out — offer the bc modal with the SAME
  // invoice (a BOLT11 settles exactly once; no double-payment guard
  // needed, the poll credits whichever attempt lands).
  let inAppPayFailed = false;
  let currentBolt11 = '';
  // bc modal success-flip handle — shared by the primary external path
  // AND the fallback modal, so the poll's confirmation can flip
  // whichever modal is actually open (late-settle: fallback showing →
  // poll confirms → modal flips to success, then drafting starts).
  let paymentModalHandle: { setPaid: (r: { preimage: string }) => void } | null = null;

  // productPayment.ts pattern, verbatim semantics: NWC/Spark pay
  // inline; everyone else gets the bitcoin-connect modal.
  $: hasInAppWallet = isInAppWalletKind($activeWallet?.kind);

  $: signedIn = $userPublickey !== '';
  $: normalizedPk = $userPublickey.trim().toLowerCase();
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: hasMembership = Boolean($membershipStatusMap[normalizedPk]?.active);

  async function run(selected: NoteReviewMode) {
    mode = selected;
    // Seed the toggle from the stored pref only on initial mode
    // selection; Regenerate / try-again keep the in-session toggle.
    if (shouldSeedDisclosureFromPref(phase)) disclosureOn = loadDisclosurePref(selected);
    phase = 'signing';
    loadingLine = pickLine(selected === 'recipe' ? COOKING_LINES : THINKING_LINES, loadingLine);
    const result = await requestNoteReview({
      ndk: $ndk,
      imageUrl,
      noteText: event?.content,
      mode: selected,
      noteId: event?.id,
      onSigned: () => (phase = 'loading')
    });
    if (result.ok) {
      draft = result.output;
      if (typeof result.creditsRemaining === 'number') creditBalance = result.creditsRemaining;
    }
    const next = phaseForResult(result);
    phase = next.phase;
    message = next.message;
    if (phase === 'error') errorLine = pickLine(ERROR_LINES, errorLine);
  }

  function toggleDisclosure() {
    disclosureOn = !disclosureOn;
    saveDisclosurePref(mode, disclosureOn);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  onDestroy(stopPolling);

  // One-shot resume per modal open: a paid-but-unobserved invoice from a
  // previous session gets credited here (server metadata lives 48h).
  $: if (open && signedIn && !resumeCheckedForOpen) {
    resumeCheckedForOpen = true;
    void resumePendingInvoice({ ndk: $ndk }).then((r) => {
      if (r.outcome === 'paid') {
        creditBalance = r.balance;
        resumeAck = true;
      }
      // expired → cleared silently inside the helper; pending/absent → nothing.
    });
  }
  $: if (!open) {
    resumeCheckedForOpen = false;
    stopPolling();
  }

  async function startPayment() {
    payError = '';
    phase = 'paying';

    // Resolve any outstanding invoice BEFORE minting a new one — an
    // overwrite would orphan a just-paid invoice's credit client-side.
    let invoiceId = '';
    let bolt11 = '';
    const prior = await resumePendingInvoice({ ndk: $ndk });
    if (prior.outcome === 'paid') {
      // They already paid the earlier invoice — no new charge, straight
      // into drafting.
      creditBalance = prior.balance;
      void run(mode);
      return;
    }
    if (
      prior.outcome === 'pending' &&
      prior.invoice.bolt11 &&
      (prior.invoice.expiresAt ?? 0) > Date.now() + 30_000
    ) {
      // Still-live unpaid invoice: reuse it rather than minting another.
      invoiceId = prior.invoice.invoiceId;
      bolt11 = prior.invoice.bolt11;
    } else if (prior.outcome === 'pending' && !prior.invoice.bolt11) {
      // Legacy/opaque pending id we can't display and can't confirm
      // settled — never overwrite a possibly-paid invoice.
      phase = 'upsell';
      payError = 'Still checking an earlier payment — try again in a moment.';
      return;
    }

    if (!invoiceId) {
      const created = await requestCreditInvoice({ ndk: $ndk });
      if (!created.ok) {
        phase = 'upsell';
        payError =
          created.code === 'RATE_LIMITED'
            ? (created.error ?? 'Too many invoices — give the last one a moment.')
            : 'Could not set up the payment. Please try again.';
        return;
      }
      invoiceId = created.invoiceId;
      bolt11 = created.bolt11;
      storePendingInvoice({ invoiceId, bolt11, expiresAt: created.expiresAt });
    }

    currentBolt11 = bolt11;
    inAppPayFailed = false;
    paymentModalHandle = null;

    function beginPolling(id: string) {
      stopPolling();
      let pollInFlight = false; // 3s ticks must never overlap a slow check
      pollTimer = setInterval(async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        try {
          const status = await checkCreditStatus({ ndk: $ndk, invoiceId: id });
          if (!status.ok) return; // transient — keep polling until expiry
          const { action } = pollActionForStatus(status.status);
          if (action === 'continue') return;
          stopPolling();
          if (action === 'credited') {
            clearPendingInvoice();
            creditBalance = status.balance;
            paymentModalHandle?.setPaid({ preimage: 'strike-confirmed' });
            // Straight into drafting — they paid for this draft.
            void run(mode);
          } else {
            clearPendingInvoice();
            if (phase === 'paying') {
              phase = 'upsell';
              payError = 'That invoice expired — grab a fresh one below.';
            }
          }
        } finally {
          pollInFlight = false;
        }
      }, 3000);
    }

    async function launchExternal(invoiceToPay: string) {
      try {
        paymentModalHandle = await lightningService.launchPayment({
          invoice: invoiceToPay,
          onPaid: () => {
            // Wallet says paid — the server poll stays authoritative.
          },
          onCancelled: () => {
            // Modal closed. Keep the pending invoice stored — if they paid
            // right before closing, resolve-or-resume credits them.
            stopPolling();
            if (phase === 'paying') phase = 'upsell';
          }
        });
      } catch (err) {
        // No wallet UI ever appeared — don't strand the user on a timer.
        // The stored invoice stays put: the next tap reuses it.
        console.error('[NoteReview] payment modal failed:', err);
        stopPolling();
        phase = 'upsell';
        payError = "Couldn't open the payment window. Tap again to retry the same invoice.";
      }
    }

    // The poll starts FIRST on every path (inside executeCreditPayment);
    // wallet-side success is advisory — the poll is the sole crediting
    // authority regardless of how the sats travel.
    const path = await executeCreditPayment(bolt11, {
      hasInAppWallet,
      sendPayment: (b) =>
        sendPayment(b, { amount: CREDIT_PRICE_SATS, description: 'Cheffy note review draft' }),
      launchExternal,
      startPoll: () => beginPolling(invoiceId)
    });
    if (path === 'in-app-failed' && phase === 'paying') {
      // Fallback affordance: re-present the SAME bolt11 in the bc modal.
      inAppPayFailed = true;
    }
  }

  function openFallbackModal() {
    // Same invoice, never a fresh mint — a BOLT11 settles exactly once,
    // so even a race with a slow in-app payment cannot double-charge.
    inAppPayFailed = false;
    void lightningService
      .launchPayment({
        invoice: currentBolt11,
        onPaid: () => {},
        onCancelled: () => {
          stopPolling();
          if (phase === 'paying') phase = 'upsell';
        }
      })
      .then((handle) => {
        // The poll's confirmation must be able to flip THIS modal too.
        paymentModalHandle = handle;
      })
      .catch(() => {
        inAppPayFailed = true;
      });
  }

  function handlePublishOutcome(outcome: PublishOutcome) {
    if (outcome.ok) {
      noteLink = outcome.noteLink;
      phase = 'posted';
      return;
    }
    if (outcome.code === 'publish-timeout') {
      timeoutSignedEvent = outcome.signedEvent;
      message = outcome.message;
      phase = 'post-timeout';
      return;
    }
    // Draft is preserved — the member's edits are never lost to a
    // publish failure.
    postError = outcome.message;
    phase = 'draft';
  }

  async function post() {
    if (!canPost(phase)) return; // double-click guard (with the disabled attr)
    postError = '';
    phase = 'posting';
    handlePublishOutcome(
      await publishNoteReviewReply({
        ndk: $ndk,
        parentEvent: event,
        // Footer joins the content only here, at publish time — the
        // textarea's value (draft) never contains it.
        content: withDisclosureFooter(draft, disclosureOn)
      })
    );
  }

  async function retryPost() {
    if (!timeoutSignedEvent) return;
    phase = 'posting';
    handlePublishOutcome(
      await retryPublishSignedEvent({ ndk: $ndk, signedEvent: timeoutSignedEvent })
    );
  }

  function viewReply() {
    const target = noteLink;
    open = false;
    goto(target);
  }

  function reset() {
    phase = 'choose';
    draft = '';
    message = '';
    postError = '';
    noteLink = '';
    timeoutSignedEvent = null;
    selectedImageIndex = 0;
    payError = '';
    resumeAck = false;
    inAppPayFailed = false;
    currentBolt11 = '';
    paymentModalHandle = null;
    stopPolling();
  }

  function signIn() {
    open = false;
    goto('/login?redirect=' + encodeURIComponent(window.location.pathname));
  }

  function viewMembership() {
    open = false;
    goto('/membership');
  }
</script>

<Modal bind:open cleanup={reset}>
  <div slot="title" class="nr-title">
    <CheffyAvatar
      size={28}
      expression={phase === 'signing' || phase === 'loading' ? 'cooking' : 'happy'}
      animate={phase === 'signing' || phase === 'loading'}
    />
    <span>Ask Cheffy about this dish</span>
  </div>

  <div class="nr-body">
    {#if !signedIn}
      <div class="nr-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Sign in to ask Cheffy</h2>
        <p>Cheffy can draft a friendly reply or guess the recipe — you edit and sign it.</p>
        <button type="button" class="nr-primary" on:click={signIn}>Sign in</button>
      </div>
    {:else if phase === 'choose'}
      {#if imageUrl}
        <img class="nr-thumb" src={imageUrl} alt="Dish from the note" loading="lazy" />
      {/if}
      {#if imageUrls.length > 1}
        <div class="nr-picker" role="group" aria-label="Choose which photo Cheffy looks at">
          {#each imageUrls as url, i (url)}
            <button
              type="button"
              class="nr-picker-thumb"
              class:nr-picker-selected={i === selectedImageIndex}
              aria-pressed={i === selectedImageIndex}
              on:click={() => (selectedImageIndex = i)}
            >
              <img src={url} alt="Photo {i + 1} of {imageUrls.length}" loading="lazy" />
            </button>
          {/each}
        </div>
      {/if}
      {#if resumeAck}
        <p class="nr-resume-ack">
          ⚡ Payment received — you have {creditBalance === 1
            ? '1 draft'
            : `${creditBalance} drafts`}.
          {CREDITS_CROSS_DEVICE_LINE}
        </p>
      {/if}
      <p class="nr-hint">What should Cheffy draft? You'll edit it before anything is posted.</p>
      <div class="nr-choices">
        <button type="button" class="nr-choice" on:click={() => run('comment')}>
          <span class="nr-choice-title">Say something nice</span>
          <span class="nr-choice-sub">A short, warm reply about the dish</span>
        </button>
        <button type="button" class="nr-choice" on:click={() => run('recipe')}>
          <span class="nr-choice-title">Guess the recipe</span>
          <span class="nr-choice-sub">Reverse-engineer it from the photo</span>
        </button>
      </div>
    {:else if phase === 'signing'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="thinking" variant="character" animate />
        <p>Waiting for your signer to approve…</p>
        <p class="nr-sub">Using a remote signer? This can take a few seconds.</p>
      </div>
    {:else if phase === 'loading'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="cooking" variant="character" animate />
        <p>{loadingLine}</p>
      </div>
    {:else if phase === 'draft' || phase === 'posting'}
      {@const posting = phase === 'posting'}
      <div class="nr-draft-head">
        <p class="nr-hint">Cheffy's draft — make it yours, then post it as your own reply.</p>
        {#if creditBalance !== null}
          <span class="nr-credit-chip" title={CREDITS_CROSS_DEVICE_LINE}>
            ⚡ {creditBalance === 1 ? '1 draft' : `${creditBalance} drafts`}
          </span>
        {/if}
      </div>
      <textarea
        class="nr-draft"
        class:nr-draft-recipe={mode === 'recipe'}
        bind:value={draft}
        rows={mode === 'recipe' ? 16 : 5}
        aria-label="Cheffy's draft"
        disabled={posting}
      ></textarea>
      <label class="nr-disclosure">
        <input
          type="checkbox"
          checked={disclosureOn}
          on:change={toggleDisclosure}
          disabled={posting}
        />
        <span>Add a small "via Cheffy" note</span>
      </label>
      {#if disclosureOn}
        <!-- Publish-time footer preview — never part of the textarea. -->
        <div class="nr-footer-preview" aria-label="Footer added when posting">
          {DISCLOSURE_FOOTER}
        </div>
      {/if}
      {#if postError}
        <p class="nr-post-error">{postError}</p>
      {/if}
      <div class="nr-actions">
        <button type="button" class="nr-secondary" on:click={() => run(mode)} disabled={posting}>
          Regenerate
        </button>
        <button type="button" class="nr-ghost" on:click={reset} disabled={posting}>
          Start over
        </button>
        {#if NOTE_REVIEW_POST_ENABLED}
          <button
            type="button"
            class="nr-primary"
            on:click={post}
            disabled={posting || !draft.trim()}
          >
            {posting ? 'Posting…' : 'Post reply'}
          </button>
        {/if}
      </div>
    {:else if phase === 'post-timeout'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="thinking" variant="character" />
        <p>{message}</p>
        <div class="nr-actions">
          <button type="button" class="nr-primary" on:click={retryPost}>Give it another push</button
          >
          <button type="button" class="nr-ghost" on:click={() => (open = false)}>Close</button>
        </div>
      </div>
    {:else if phase === 'posted'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="excited" variant="character" />
        <p>Posted! Cheffy tips his toque to you.</p>
        <div class="nr-actions">
          <button type="button" class="nr-primary" on:click={viewReply}>View your reply</button>
          <button type="button" class="nr-ghost" on:click={() => (open = false)}>Done</button>
        </div>
      </div>
    {:else if phase === 'dead-end'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="concerned" variant="character" />
        <p>{message}</p>
        <button type="button" class="nr-ghost" on:click={reset}>Back</button>
      </div>
    {:else if phase === 'upsell'}
      <!-- Payment card: membership stays visually primary; sats is the
           impulse lane. -->
      <div class="nr-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Cheffy photo review comes with Cook+</h2>
        <p>Get a drafted reply or a recipe guess for any dish photo on the feed.</p>
        <div class="nr-example">
          <span class="nr-example-label">The kind of reply Cheffy drafts:</span>
          <p class="nr-example-text">"{PAYMENT_CARD_EXAMPLE_DRAFT}"</p>
        </div>
        {#if payError}<p class="nr-post-error">{payError}</p>{/if}
        <button type="button" class="nr-primary" on:click={viewMembership}>View membership</button>
        <button type="button" class="nr-secondary" on:click={startPayment}>
          ⚡ {CREDIT_PRICE_SATS} sats for one draft
        </button>
        <p class="nr-sub">{CREDITS_CROSS_DEVICE_LINE}</p>
      </div>
    {:else if phase === 'paying'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="excited" variant="character" animate />
        <p>Waiting for your {CREDIT_PRICE_SATS} sats…</p>
        {#if inAppPayFailed}
          <p class="nr-sub">
            Your wallet didn't answer. The invoice is still good — pay it another way.
          </p>
          <button type="button" class="nr-secondary" on:click={openFallbackModal}>
            Open payment window
          </button>
        {:else if hasInAppWallet}
          <p class="nr-sub">Paying from your wallet — drafting starts the moment it lands.</p>
        {:else}
          <p class="nr-sub">
            Pay the invoice in the wallet window — drafting starts the moment it lands.
          </p>
        {/if}
        <button
          type="button"
          class="nr-ghost"
          on:click={() => {
            stopPolling();
            phase = 'upsell';
          }}
        >
          Back
        </button>
      </div>
    {:else}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="concerned" variant="character" />
        <p>{errorLine}</p>
        {#if message}<p class="nr-sub">{message}</p>{/if}
        <div class="nr-actions">
          <button type="button" class="nr-secondary" on:click={() => run(mode)}>Try again</button>
          <button type="button" class="nr-ghost" on:click={reset}>Back</button>
        </div>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .nr-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nr-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0;
    max-width: 560px;
  }

  .nr-thumb {
    width: 100%;
    max-height: 220px;
    object-fit: cover;
    border-radius: 12px;
  }

  .nr-hint {
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .nr-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nr-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 12px 16px;
    min-height: 44px;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: transparent;
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .nr-choice:hover {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }

  .nr-choice-title {
    font-weight: 600;
  }

  .nr-choice-sub {
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .nr-wait,
  .nr-gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    padding: 24px 16px;
  }

  .nr-gate p,
  .nr-wait p {
    max-width: 32ch;
  }

  .nr-gate p {
    color: var(--color-text-secondary);
  }

  .nr-sub {
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .nr-post-error {
    color: var(--color-text-secondary);
    font-size: 0.9rem;
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .nr-picker {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .nr-picker-thumb {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 10px;
    overflow: hidden;
    background: none;
    cursor: pointer;
  }

  .nr-picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .nr-picker-selected {
    border-color: var(--color-primary);
  }

  .nr-draft-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .nr-credit-chip {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }

  .nr-example {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    max-width: 40ch;
  }

  .nr-example-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .nr-example-text {
    font-size: 0.9rem;
    font-style: italic;
    color: var(--color-text-primary);
    margin: 0;
  }

  .nr-resume-ack {
    font-size: 0.88rem;
    padding: 8px 12px;
    border-radius: 8px;
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }

  .nr-disclosure {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .nr-disclosure input {
    accent-color: var(--color-primary);
  }

  .nr-footer-preview {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px dashed var(--color-input-border);
    width: fit-content;
  }

  .nr-draft {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.45;
    resize: vertical;
  }

  .nr-draft-recipe {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .nr-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .nr-primary,
  .nr-secondary,
  .nr-ghost {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .nr-primary {
    background-color: var(--color-primary);
    color: #fff;
  }

  .nr-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .nr-secondary {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }

  .nr-ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }
</style>
