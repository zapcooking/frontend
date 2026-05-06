<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import { lightningService } from '$lib/lightningService';
  import { copyToClipboard } from '$lib/utils/share';
  import { COOKBOOK_EXPORT_SATS } from '$lib/cookbookPricing';
  import { get } from 'svelte/store';
  import {
    sendPayment as walletSendPayment,
    isWalletReady,
    refreshBalance as refreshWalletBalance,
    walletBalance
  } from '$lib/wallet/walletManager';
  import { activeWallet, getActiveWallet } from '$lib/wallet/walletStore';
  import {
    buildCookbookPdf,
    cookbookFilename,
    recipeEventToCookbookRecipe,
    type CookbookRecipe
  } from '$lib/cookbookExport';

  /** The pack event itself — needed for title/description/cover/creator. */
  export let packEvent: NDKEvent | null = null;
  /** Already-resolved recipe events from the pack page. */
  export let recipeEvents: NDKEvent[] = [];
  /** Total recipe count from the pack (may exceed recipeEvents.length on partial load). */
  export let totalRecipeCount: number = 0;
  /** Already-computed pack metadata (title etc) so we don't re-parse here. */
  export let packTitle: string = '';
  export let packDescription: string = '';
  export let packCoverImage: string | undefined = undefined;
  export let creatorPubkey: string = '';
  /** naddr1… for the pack — used to key the recently-paid cache. */
  export let packNaddr: string = '';
  /** Canonical pack URL for the success-state Share button. */
  export let packShareUrl: string = '';
  /** Pro Kitchen / Founders member. Cookbook export is paid for every
   *  account, but Pro members get the AI introduction polish; non-Pro
   *  users fall back to the raw pack description. */
  export let isProMember: boolean = false;
  /** Optional — passed through for debug logs only, not used in gating. */
  export let membershipTier: string | undefined = undefined;
  export let membershipActive: boolean | undefined = undefined;
  export let open = false;

  const dispatch = createEventDispatcher();

  // Form state
  let title = '';
  let subtitle = '';
  let includeCover = true;
  let includeToc = true;
  let includeImages = true;
  let includeIntroduction = true;
  let style: 'classic' | 'modern' | 'simple' = 'modern';

  // Stage machine
  type Stage = 'form' | 'invoice' | 'generating' | 'success' | 'error';
  let stage: Stage = 'form';
  let stageMessage = '';
  let resultBlob: Blob | null = null;
  let resultFilename = '';
  let resultIncluded = 0;
  let resultSkipped = 0;
  let usedAi = false;

  // ===== Payment state =====
  // Recently-paid cache so a refresh / retry inside ~15 minutes doesn't
  // re-charge. Keyed by naddr — buying export for one pack doesn't unlock
  // another.
  const RECENT_PAY_TTL_MS = 15 * 60 * 1000;
  const RECENT_PAY_KEY_PREFIX = 'zc:cookbook-export-paid:';

  let invoiceLoading = false;
  let invoiceError = '';
  let invoice = '';
  /** Server-returned price for the active invoice. The server is the
   *  authority on how many sats this invoice represents (promos can
   *  expire between client price computation and invoice creation), so
   *  the wallet payment + balance check use this exact value. */
  let invoiceAmountSats = 0;
  let exportId = '';
  let receiveRequestId = '';
  let invoicePollInterval: ReturnType<typeof setInterval> | null = null;
  let invoiceCopied = false;
  /** True once payment is confirmed in this session. */
  let paymentUnlocked = false;

  // ===== Built-in (Spark/Breez) wallet attempt state =====
  // Idle = haven't tried yet (or no built-in wallet present).
  // Attempting = an internal payment is in flight.
  // Insufficient = active built-in wallet doesn't have enough balance —
  //   user can switch to an external wallet via the footer button.
  // Failed = Spark SDK threw mid-payment — same recovery path.
  // Success = built-in payment returned ok; the existing server-poll
  //   verification path will pick it up and call onPaymentConfirmed.
  type BuiltInPayState = 'idle' | 'attempting' | 'insufficient' | 'failed' | 'success';
  let builtInPayState: BuiltInPayState = 'idle';
  let builtInPayError = '';

  // ===== Promo state =====
  let promoInput = '';
  let promoLoading = false;
  let promoError = '';
  let promoApplied: {
    code: string;
    label: string;
    originalSats: number;
    finalSats: number;
    free: boolean;
  } | null = null;

  $: missingRecipes = Math.max(0, totalRecipeCount - recipeEvents.length);
  /** Cookbook export is a paid feature for every account. The user can
   *  unlock it via Lightning payment OR by applying a 100%-off promo. */
  $: canExport = paymentUnlocked || (promoApplied?.free ?? false);
  /** Effective price the CTA should display. */
  $: priceSats = promoApplied?.finalSats ?? COOKBOOK_EXPORT_SATS;

  /**
   * Hint shown next to the unlock CTA so the user knows whether their
   * connected wallet can cover the price before they click. Three cases:
   *   - sufficient → "Pay from {wallet} (12,500 sats available)"
   *   - insufficient → "{wallet} has 1,000 sats — top up or pay from another wallet"
   *   - balance unknown → null (don't promise anything)
   * Returns null when no wallet is connected (the BC fallback handles it).
   */
  $: walletBalanceHint = (() => {
    const w = $activeWallet;
    if (!w) return null;
    const b = $walletBalance;
    const formatted = (n: number) => n.toLocaleString();
    if (b === null) return null;
    if (b < priceSats) {
      return {
        kind: 'insufficient' as const,
        label: `${w.name} has ${formatted(b)} sats — top up or pay from another wallet.`
      };
    }
    return {
      kind: 'sufficient' as const,
      label: `Pay from ${w.name} · ${formatted(b)} sats available.`
    };
  })();

  // Reset per-open
  $: if (open) initStateOnOpen();
  $: if (!open) {
    stopInvoicePolling();
    stage = 'form';
    stageMessage = '';
    resultBlob = null;
    resultFilename = '';
    resultIncluded = 0;
    resultSkipped = 0;
    usedAi = false;
    invoiceError = '';
    invoice = '';
    exportId = '';
    receiveRequestId = '';
    invoiceCopied = false;
    promoInput = '';
    promoApplied = null;
    promoError = '';
    promoLoading = false;
    builtInPayState = 'idle';
    builtInPayError = '';
    // Note: don't reset paymentUnlocked — let the user generate, fail,
    // and retry without re-paying.
  }

  function initStateOnOpen() {
    title = packTitle || 'My Recipe Pack';
    subtitle = packDescription || '';
    paymentUnlocked = isRecentlyPaid();

    // Kick off a wallet balance refresh so the unlock-card hint
    // reflects current state on first open. Best-effort only — the
    // hint just stays hidden if this fails.
    if (getActiveWallet() && isWalletReady()) {
      refreshWalletBalance().catch(() => {
        /* tolerate flaky balance fetches; the hint guards against null */
      });
    }

    // Dev-only membership snapshot. Helpful when iterating on tier
    // detection edge cases; silenced in production so signed-in users
    // don't see noisy console output or have their tier metadata
    // surfaced to whatever else listens to console.info.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const pkPreview = $userPublickey ? `${$userPublickey.slice(0, 8)}…` : '(anon)';
      console.info('[ExportCookbookModal] membership check', {
        pubkey: pkPreview,
        tier: membershipTier ?? '(not passed)',
        active: membershipActive ?? '(not passed)',
        isProMember,
        recentlyPaid: paymentUnlocked,
        canExport: paymentUnlocked || (promoApplied?.free ?? false)
      });
    }
  }

  // ===== Recently-paid cache =====
  function recentPayKey(): string {
    return `${RECENT_PAY_KEY_PREFIX}${packNaddr}`;
  }
  function isRecentlyPaid(): boolean {
    if (!packNaddr || typeof window === 'undefined') return false;
    try {
      const raw = window.sessionStorage.getItem(recentPayKey());
      if (!raw) return false;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < RECENT_PAY_TTL_MS;
    } catch {
      return false;
    }
  }
  function markRecentlyPaid() {
    if (!packNaddr || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(recentPayKey(), String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  // ===== Profile / AI helpers (unchanged) =====
  async function fetchCreatorName(): Promise<string | undefined> {
    if (!creatorPubkey) return undefined;
    try {
      const evt = await $ndk.fetchEvent({ kinds: [0], authors: [creatorPubkey] });
      if (!evt?.content) return undefined;
      const parsed = JSON.parse(evt.content);
      const name =
        typeof parsed.display_name === 'string' && parsed.display_name.trim()
          ? parsed.display_name.trim()
          : typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name.trim()
            : undefined;
      return name;
    } catch {
      return undefined;
    }
  }

  async function fetchPolishedIntroduction(
    creatorName: string | undefined,
    recipes: CookbookRecipe[]
  ): Promise<{ text: string; aiUsed: boolean }> {
    const fallback = packDescription || '';
    if (!includeIntroduction) return { text: fallback, aiUsed: false };
    if (!isProMember) {
      // Pay-per-use customers get the export but the AI intro endpoint
      // is gated to Pro. Use the raw description so they still get an
      // intro if they checked the toggle.
      return { text: fallback, aiUsed: false };
    }
    if (!$userPublickey) return { text: fallback, aiUsed: false };
    try {
      const res = await fetch('/api/cookbook-intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey: $userPublickey,
          packTitle: title,
          packDescription: subtitle,
          creatorName,
          recipeCount: recipes.length,
          recipeTitles: recipes.slice(0, 10).map((r) => r.title)
        })
      });
      const data = (await res.json()) as { success: boolean; introduction?: string; error?: string };
      if (data.success && data.introduction) {
        return { text: data.introduction, aiUsed: true };
      }
    } catch (err) {
      console.warn('[ExportCookbookModal] intro polish failed', err);
    }
    return { text: fallback, aiUsed: false };
  }

  // ===== Promo flow =====
  async function handleApplyPromo() {
    const code = promoInput.trim();
    if (!code || promoLoading) return;
    promoError = '';
    promoLoading = true;
    try {
      const res = await fetch('/api/cookbook-export/apply-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = (await res.json()) as
        | {
            success: true;
            code: string;
            label: string;
            originalSats: number;
            finalSats: number;
            free: boolean;
          }
        | { success: false; error: string };
      if (!('success' in data) || !data.success) {
        promoApplied = null;
        promoError = 'Promo code not valid';
        return;
      }
      promoApplied = {
        code: data.code,
        label: data.label,
        originalSats: data.originalSats,
        finalSats: data.finalSats,
        free: data.free
      };
    } catch (err) {
      console.error('[ExportCookbookModal] apply-promo failed', err);
      promoApplied = null;
      promoError = 'Promo code not valid';
    } finally {
      promoLoading = false;
    }
  }

  function handleClearPromo() {
    promoInput = '';
    promoApplied = null;
    promoError = '';
  }

  // ===== Pay-per-export flow =====
  async function handleUnlockClick() {
    if (invoiceLoading) return;
    if (!$userPublickey) {
      showToast('info', 'Sign in to unlock cookbook export.');
      return;
    }
    if (!packNaddr) {
      showToast('error', 'Missing pack reference. Please reload the page.');
      return;
    }
    invoiceError = '';
    invoiceLoading = true;
    try {
      const res = await fetch('/api/cookbook-export/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerPubkey: $userPublickey,
          packNaddr,
          packTitle: title.trim() || packTitle,
          promoCode: promoApplied?.code
        })
      });
      if (!res.ok) {
        let msg = 'Failed to create Lightning invoice.';
        try {
          const data = await res.json();
          msg = data?.error || msg;
        } catch {}
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        exportId: string;
        // Paid path
        invoice?: string;
        paymentHash?: string;
        receiveRequestId?: string;
        invoiceExpiresAt?: number;
        amountSats: number;
        // Free-promo path
        free?: boolean;
        promo?: unknown;
      };

      // 100%-off promo path: the server marked it paid; jump straight
      // to PDF generation, no Lightning round-trip.
      if (data.free) {
        exportId = data.exportId;
        await onPaymentConfirmed();
        return;
      }

      if (!data.invoice || !data.receiveRequestId) {
        throw new Error('Invoice response was missing fields.');
      }
      exportId = data.exportId;
      receiveRequestId = data.receiveRequestId;
      invoice = data.invoice;
      invoiceAmountSats = data.amountSats;
      stage = 'invoice';
      builtInPayState = 'idle';
      builtInPayError = '';

      // Server-side polling is the source of truth. Start it
      // immediately — works whether the user pays via built-in wallet,
      // an external wallet picker, or by copying the invoice manually.
      startInvoicePolling(null);

      // Prefer the user's connected Zap Cooking wallet (Breez/Spark)
      // before opening Bitcoin Connect. Silently no-ops when no
      // built-in wallet is connected; falls back gracefully on errors.
      const builtInOutcome = await tryBuiltInWalletPayment();

      if (builtInOutcome === 'no-wallet') {
        // No built-in wallet — go straight to Bitcoin Connect, the
        // pre-existing flow. User still sees the QR + manual invoice.
        await launchBitcoinConnect();
      }
      // For 'success' the verify-payment poll will auto-confirm.
      // For 'insufficient' / 'failed' the user clicks the
      // "Pay with another wallet" footer button to open BC manually.
    } catch (err: any) {
      console.error('[ExportCookbookModal] create-invoice failed', err);
      invoiceError = err?.message || 'Failed to create Lightning invoice.';
    } finally {
      invoiceLoading = false;
    }
  }

  /**
   * Try paying the active invoice from the user's connected Zap Cooking
   * wallet — Breez/Spark (kind 4), NWC (kind 3), or WebLN (kind 1).
   * Returns the outcome so the caller can decide whether to fall back
   * to Bitcoin Connect.
   *
   * Outcomes:
   *  - 'no-wallet'    — no connected wallet or wallet not ready
   *                     (caller falls through to Bitcoin Connect)
   *  - 'insufficient' — wallet exists, balance KNOWN, and < priceSats
   *  - 'failed'       — wallet SDK threw mid-payment
   *  - 'success'      — payment sent; server poll will confirm
   *
   * Balance pre-check is best-effort. Some WebLN extensions don't
   * expose getBalance and return null — in that case we attempt
   * payment anyway and let the SDK surface insufficient as 'failed'
   * (with a translated message). Better to try than to bail early.
   */
  async function tryBuiltInWalletPayment(): Promise<
    'no-wallet' | 'insufficient' | 'failed' | 'success'
  > {
    const active = getActiveWallet();
    if (!active) return 'no-wallet';
    if (!isWalletReady()) return 'no-wallet';

    // Pre-flight balance check uses the SERVER-returned invoice amount
    // (not the client-side priceSats) so a promo expiring between
    // CTA-render and invoice-create can't get us into a "balance was
    // enough for the discounted price but not the actual price" mess.
    // Best-effort: only block when balance is *known* and insufficient.
    // Refresh once if the cache is cold; tolerate fetch failures (some
    // WebLN providers don't implement getBalance).
    let balance = get(walletBalance);
    if (balance === null) {
      try {
        balance = await refreshWalletBalance();
      } catch (e) {
        console.warn('[ExportCookbookModal] balance refresh failed', e);
        // Don't bail — let the SDK try. Worst case we surface a
        // 'failed' state with the SDK's error message.
      }
    }
    if (balance !== null && balance < invoiceAmountSats) {
      builtInPayState = 'insufficient';
      return 'insufficient';
    }

    builtInPayState = 'attempting';
    builtInPayError = '';
    try {
      // For BOLT11 invoices the amount is encoded in the invoice itself.
      // Don't pass an `amount` to walletSendPayment — Spark/Breez forwards
      // it to prepareSendPayment which can reject when both invoice-
      // encoded and explicit amounts are present. The wallet pending-tx
      // metadata still wants a number for display, so we hand it the
      // server-authoritative value.
      const result = await walletSendPayment(invoice, {
        amount: invoiceAmountSats,
        description: `Cookbook export: ${title.trim() || packTitle || 'Recipe Pack'}`
      });
      if (!result.success) {
        const errMsg = result.error || 'Payment failed';
        // Map SDK insufficient-balance errors back to the dedicated
        // state so the user gets the right banner copy (and we don't
        // show a generic error for what's really a balance issue).
        if (/insufficient|not enough|balance/i.test(errMsg)) {
          builtInPayState = 'insufficient';
          return 'insufficient';
        }
        builtInPayState = 'failed';
        builtInPayError = errMsg;
        return 'failed';
      }
      // Wallet accepted the payment. Strike will see the invoice as
      // paid within a few seconds; the existing /verify-payment poll
      // we started above will pick it up and call onPaymentConfirmed.
      builtInPayState = 'success';
      return 'success';
    } catch (err: any) {
      console.error('[ExportCookbookModal] connected wallet payment threw', err);
      const errMsg = err?.message || 'Payment failed';
      if (/insufficient|not enough|balance/i.test(errMsg)) {
        builtInPayState = 'insufficient';
        return 'insufficient';
      }
      builtInPayState = 'failed';
      builtInPayError = errMsg;
      return 'failed';
    }
  }

  /** Open Bitcoin Connect's payment modal for the current invoice. */
  async function launchBitcoinConnect() {
    try {
      const { setPaid } = await lightningService.launchPayment({
        invoice,
        onPaid: async () => {
          stopInvoicePolling();
          await onPaymentConfirmed();
        },
        onCancelled: () => {
          // User dismissed BC — leave them on the invoice screen so
          // they can copy the invoice or click "Pay with another
          // wallet" again. Server poll keeps running.
        }
      });
      // Re-start the server poll so it can call setPaid on the BC
      // modal once Strike confirms — that auto-closes BC.
      startInvoicePolling(setPaid);
    } catch (err) {
      console.error('[ExportCookbookModal] launchPayment failed', err);
      // Polling is already running (started in handleUnlockClick); the
      // user can still pay manually via the copy-invoice path.
    }
  }

  /** Footer button: user opted out of built-in wallet, switch to BC. */
  async function handleSwitchToExternalWallet() {
    await launchBitcoinConnect();
  }

  function startInvoicePolling(setPaid: ((r: { preimage: string }) => void) | null) {
    stopInvoicePolling();
    invoicePollInterval = setInterval(async () => {
      if (!exportId || !receiveRequestId) return;
      try {
        const res = await fetch('/api/cookbook-export/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exportId, receiveRequestId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            stopInvoicePolling();
            // Tell Alby's modal we paid (it'll auto-close).
            if (setPaid) setPaid({ preimage: 'strike-confirmed' });
            await onPaymentConfirmed();
          }
        } else if (res.status !== 402) {
          // Permanent failure (404/500) — give up the poll.
          stopInvoicePolling();
        }
      } catch {
        /* network blip — keep polling */
      }
    }, 3000);
  }

  function stopInvoicePolling() {
    if (invoicePollInterval) {
      clearInterval(invoicePollInterval);
      invoicePollInterval = null;
    }
  }

  // Defensive cleanup — `open` flipping false also stops polling, but
  // an SPA route change can destroy this component while the invoice
  // poll is still active. Without this, the interval keeps firing
  // every 3s in the background and re-hits the verify endpoint.
  onDestroy(() => {
    stopInvoicePolling();
  });

  async function onPaymentConfirmed() {
    paymentUnlocked = true;
    markRecentlyPaid();
    showToast('success', 'Payment received ⚡ Generating your cookbook…');
    // Move directly into PDF generation — no extra click required.
    await runGenerate();
  }

  async function copyInvoice() {
    if (!invoice) return;
    const ok = await copyToClipboard(invoice);
    if (ok) {
      invoiceCopied = true;
      setTimeout(() => (invoiceCopied = false), 1800);
    }
  }

  function cancelInvoice() {
    stopInvoicePolling();
    invoice = '';
    exportId = '';
    receiveRequestId = '';
    stage = 'form';
  }

  // ===== Generate flow =====
  async function handleGenerateClick() {
    if (!canExport) {
      // Non-Pro and no recent pay — kick off the unlock flow.
      await handleUnlockClick();
      return;
    }
    await runGenerate();
  }

  async function runGenerate() {
    if (stage === 'generating') return;
    if (!packEvent) {
      showToast('error', 'Pack event not loaded yet.');
      return;
    }
    if (recipeEvents.length === 0) {
      showToast('error', 'No recipes available to export.');
      return;
    }
    if (!title.trim()) {
      showToast('error', 'Please enter a cookbook title.');
      return;
    }

    stage = 'generating';
    stageMessage = 'Formatting your cookbook…';

    try {
      const creatorNamePromise = fetchCreatorName();
      const recipes: CookbookRecipe[] = recipeEvents.map((e) => recipeEventToCookbookRecipe(e));
      const creatorName = await creatorNamePromise;
      // Skip the polish call entirely when the user unchecked the
      // introduction. Previously we always fetched (returning the pack
      // description as fallback) and then passed `!!introduction` to
      // the builder — which silently re-included the page.
      const { text: introduction, aiUsed } = includeIntroduction
        ? await fetchPolishedIntroduction(creatorName, recipes)
        : { text: '', aiUsed: false };
      usedAi = aiUsed;

      const result = await buildCookbookPdf({
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        coverImage: includeCover ? packCoverImage : undefined,
        creatorName,
        introduction,
        recipes,
        includeCover,
        includeToc,
        includeImages,
        includeIntroduction,
        style
      });

      resultBlob = result.blob;
      resultIncluded = result.included;
      resultSkipped = result.skipped.length + missingRecipes;
      resultFilename = cookbookFilename(title);
      stage = 'success';
    } catch (err: any) {
      console.error('[ExportCookbookModal] generate failed', err);
      stage = 'error';
      stageMessage = err?.message || 'Something went wrong while building the PDF.';
    }
  }

  function handleDownload() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    dispatch('downloaded');
  }

  async function copyShareUrl() {
    if (!packShareUrl) return;
    const ok = await copyToClipboard(packShareUrl);
    if (ok) showToast('success', 'Recipe Pack link copied');
  }

  function handleClose() {
    open = false;
  }

  function handleRetry() {
    stage = 'form';
    stageMessage = '';
  }
</script>

<Modal cleanup={handleClose} bind:open>
  <h1 slot="title">Export as Cookbook</h1>

  {#if stage === 'form'}
    <div class="flex flex-col flex-1 min-h-0">
      <!-- Scroll area: form fields. flex-1 + min-h-0 lets it shrink within
           the dialog's max-h, instead of pushing the footer off-screen. -->
      <div
        class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 -mx-4 md:-mx-8 px-4 md:px-8"
      >
      <p class="text-sm text-caption">Turn this Recipe Pack into a printable cookbook PDF.</p>

      {#if !canExport}
        <!-- Unlock hint — cookbook export is a paid feature for every
             account. Compact so it doesn't dominate the form. Surfaces
             the connected-wallet balance so the user knows whether the
             internal payment will succeed before clicking. -->
        <div
          class="flex items-start gap-3 p-3 rounded-lg"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
        >
          <div
            class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0 text-white font-bold"
            aria-hidden="true"
          >
            ⚡
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            <p class="text-sm" style="color: var(--color-text-primary)">
              <span class="font-medium">Unlock this cookbook for {priceSats} sats</span>
              <span class="text-caption"> — one-time Lightning payment.</span>
            </p>
            {#if walletBalanceHint}
              <p
                class="text-xs"
                class:text-red-500={walletBalanceHint.kind === 'insufficient'}
                style={walletBalanceHint.kind === 'sufficient'
                  ? 'color: var(--color-text-secondary)'
                  : ''}
              >
                {walletBalanceHint.label}
              </p>
            {/if}
          </div>
        </div>

        <!-- Promo code -->
        <div class="flex flex-col gap-1">
          <label
            for="cookbook-promo"
            class="text-xs font-medium"
            style="color: var(--color-text-secondary)"
          >
            Promo code
          </label>
          {#if promoApplied}
            <div
              class="flex items-center justify-between gap-2 p-2 rounded-lg"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            >
              <p class="text-sm" style="color: var(--color-text-primary)">
                <span class="font-semibold">{promoApplied.code}</span>
                <span class="text-caption"> — promo applied: {promoApplied.label}</span>
              </p>
              <button
                type="button"
                on:click={handleClearPromo}
                class="text-xs underline"
                style="color: var(--color-text-secondary)"
              >
                Remove
              </button>
            </div>
          {:else}
            <div class="flex items-center gap-2">
              <input
                id="cookbook-promo"
                type="text"
                class="input flex-1"
                bind:value={promoInput}
                placeholder="e.g., LAUNCH"
                maxlength="32"
                autocomplete="off"
                on:keydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyPromo();
                  }
                }}
              />
              <button
                type="button"
                on:click={handleApplyPromo}
                disabled={promoLoading || !promoInput.trim()}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
              >
                {promoLoading ? 'Checking…' : 'Apply'}
              </button>
            </div>
            {#if promoError}
              <p class="text-xs text-red-500">{promoError}</p>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="flex flex-col gap-2">
        <label
          for="cookbook-title"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Cookbook title <span class="text-red-500">*</span>
        </label>
        <input
          id="cookbook-title"
          type="text"
          class="input"
          bind:value={title}
          maxlength="120"
          placeholder="e.g., Weeknight Dinners"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label
          for="cookbook-subtitle"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Subtitle / description
        </label>
        <textarea
          id="cookbook-subtitle"
          class="input"
          rows="3"
          bind:value={subtitle}
          maxlength="500"
          placeholder="A short description of your cookbook…"
        />
      </div>

      <fieldset class="flex flex-col gap-2 pt-1">
        <legend class="text-sm font-medium pb-2" style="color: var(--color-text-primary)">
          Include
        </legend>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeCover} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Cover page</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeToc} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Table of contents</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeImages} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Recipe images</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            bind:checked={includeIntroduction}
            class="w-4 h-4 accent-orange-500"
          />
          <span style="color: var(--color-text-primary)">Introduction</span>
          {#if isProMember}
            <span class="text-xs text-caption">— polished automatically when possible</span>
          {/if}
        </label>
      </fieldset>

      <div class="flex flex-col gap-2">
        <label
          for="cookbook-style"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Style
        </label>
        <select id="cookbook-style" class="input" bind:value={style}>
          <option value="modern">Modern</option>
          <option value="classic">Classic (coming soon)</option>
          <option value="simple">Simple (coming soon)</option>
        </select>
      </div>

      {#if missingRecipes > 0}
        <p class="text-xs text-caption">
          {recipeEvents.length} of {totalRecipeCount} recipes are loaded. The remaining
          {missingRecipes} weren't reachable on the connected relays and won't be in the PDF.
        </p>
      {/if}

      {#if invoiceError}
        <p class="text-sm text-red-500">{invoiceError}</p>
      {/if}
      </div>

      <!-- Sticky footer: stays visible regardless of form scroll. Stacks
           on mobile (primary on top via flex-col-reverse) and rows on sm+. -->
      <div
        class="flex-none pt-3 mt-3 -mx-4 md:-mx-8 px-4 md:px-8"
        style="border-top: 1px solid var(--color-input-border); padding-bottom: env(safe-area-inset-bottom);"
      >
        <!-- Primary first in DOM so keyboard focus order matches the
             visual order on both mobile (stacked, primary on top) and
             desktop (row, primary on left). flex-col-reverse would
             flip visuals without flipping tab order — bad for a11y. -->
        <div class="flex flex-col sm:flex-row sm:justify-end gap-2">
          <Button
            on:click={handleGenerateClick}
            disabled={invoiceLoading || !packEvent || recipeEvents.length === 0}
            class="w-full sm:w-auto"
          >
            {#if invoiceLoading}
              Creating invoice…
            {:else if canExport}
              Generate Cookbook
            {:else}
              Unlock for {priceSats} sats ⚡
            {/if}
          </Button>
          <Button on:click={handleClose} primary={false} class="w-full sm:w-auto">Cancel</Button>
        </div>
      </div>
    </div>
  {:else if stage === 'invoice'}
    <div class="flex flex-col flex-1 min-h-0">
      <div
        class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 -mx-4 md:-mx-8 px-4 md:px-8"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          Pay <span class="font-semibold">{priceSats} sats</span> to unlock cookbook export for this
          pack.
          {#if promoApplied}
            <span class="text-caption">(Promo {promoApplied.code} applied — {promoApplied.label}.)</span>
          {/if}
        </p>

        {#if builtInPayState === 'attempting'}
          <!-- Built-in wallet attempt overlay — keeps the user on this screen
               with a clear explanation of what's happening. -->
          <div class="flex items-center gap-3 text-sm">
            <div
              class="w-5 h-5 rounded-full border-2 border-orange-200 border-t-orange-500 animate-spin"
            ></div>
            <span style="color: var(--color-text-primary)"
              >Paying from your Zap Cooking wallet…</span
            >
          </div>
        {:else}
          {#if builtInPayState === 'insufficient'}
            <p class="text-sm" style="color: var(--color-text-primary)">
              Your Zap Cooking wallet doesn't have enough balance. You can still pay with another
              wallet.
            </p>
          {:else if builtInPayState === 'failed' && builtInPayError}
            <p class="text-sm text-red-500">
              Built-in wallet payment failed: {builtInPayError}
            </p>
          {/if}

          <p class="text-xs text-caption">
            {#if builtInPayState === 'insufficient' || builtInPayState === 'failed'}
              Copy the invoice and pay from any Lightning wallet, or click "Pay with another
              wallet" to open the picker.
            {:else}
              A wallet picker should have opened in another window. If not, copy the invoice and
              pay from any Lightning wallet.
            {/if}
          </p>

          <div
            class="flex items-center gap-2 p-2 rounded-lg overflow-hidden"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            <code
              class="text-xs flex-1 truncate"
              style="color: var(--color-text-secondary); font-family: monospace;"
              title={invoice}
            >
              {invoice}
            </code>
            <button
              type="button"
              on:click={copyInvoice}
              class="flex-shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors"
              style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
            >
              {invoiceCopied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div class="flex items-center gap-2 text-sm">
            <div
              class="w-4 h-4 rounded-full border-2 border-orange-200 border-t-orange-500 animate-spin"
            ></div>
            <span class="text-caption">Waiting for payment…</span>
          </div>
        {/if}
      </div>

      <div
        class="flex-none pt-3 mt-3 -mx-4 md:-mx-8 px-4 md:px-8"
        style="border-top: 1px solid var(--color-input-border); padding-bottom: env(safe-area-inset-bottom);"
      >
        <div class="flex flex-col sm:flex-row sm:justify-end gap-2">
          {#if builtInPayState === 'insufficient' || builtInPayState === 'failed'}
            <Button on:click={handleSwitchToExternalWallet} class="w-full sm:w-auto">
              Pay with another wallet
            </Button>
          {/if}
          <Button on:click={cancelInvoice} primary={false} class="w-full sm:w-auto">Cancel</Button>
        </div>
      </div>
    </div>
  {:else if stage === 'generating'}
    <div class="flex flex-col items-center justify-center gap-4 py-10">
      <div
        class="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin"
      ></div>
      <p class="text-sm" style="color: var(--color-text-primary)">
        {stageMessage || 'Formatting your cookbook…'}
      </p>
      <p class="text-xs text-caption text-center max-w-sm">
        Generation runs in your browser. Depending on the number of recipes and image sizes, this
        can take 10–30 seconds.
      </p>
    </div>
  {:else if stage === 'success'}
    <div class="flex flex-col flex-1 min-h-0">
      <div
        class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 -mx-4 md:-mx-8 px-4 md:px-8"
      >
        <div
          class="flex items-start gap-3 p-3 rounded-lg"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
        >
          <div
            class="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0 text-white text-lg"
            aria-hidden="true"
          >
            📚
          </div>
          <div class="flex flex-col">
            <p class="text-sm font-medium" style="color: var(--color-text-primary)">
              {paymentUnlocked
                ? 'Payment received ⚡ Your cookbook is ready.'
                : '📚 Your cookbook is ready'}
            </p>
            <p class="text-xs text-caption">
              Turned your Recipe Pack into a printable cookbook. {resultIncluded}
              {resultIncluded === 1 ? 'recipe' : 'recipes'} included{#if resultSkipped > 0}
                · {resultSkipped} couldn't be loaded
              {/if}{#if usedAi}
                · introduction polished
              {/if}.
            </p>
          </div>
        </div>
      </div>

      <div
        class="flex-none pt-3 mt-3 -mx-4 md:-mx-8 px-4 md:px-8"
        style="border-top: 1px solid var(--color-input-border); padding-bottom: env(safe-area-inset-bottom);"
      >
        <div class="flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2">
          <Button on:click={handleDownload} class="w-full sm:w-auto">Download PDF</Button>
          {#if packShareUrl}
            <Button on:click={copyShareUrl} primary={false} class="w-full sm:w-auto">
              Share Recipe Pack
            </Button>
          {/if}
          <Button on:click={handleClose} primary={false} class="w-full sm:w-auto">Close</Button>
        </div>
      </div>
    </div>
  {:else if stage === 'error'}
    <div class="flex flex-col flex-1 min-h-0">
      <div
        class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 -mx-4 md:-mx-8 px-4 md:px-8"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          {stageMessage || 'Something went wrong while building the PDF.'}
        </p>
        {#if paymentUnlocked}
          <p class="text-xs text-caption">
            Your payment is still valid — retry won't charge again.
          </p>
        {/if}
      </div>
      <div
        class="flex-none pt-3 mt-3 -mx-4 md:-mx-8 px-4 md:px-8"
        style="border-top: 1px solid var(--color-input-border); padding-bottom: env(safe-area-inset-bottom);"
      >
        <div class="flex flex-col sm:flex-row sm:justify-end gap-2">
          <Button on:click={handleRetry} class="w-full sm:w-auto">Try again</Button>
          <Button on:click={handleClose} primary={false} class="w-full sm:w-auto">Close</Button>
        </div>
      </div>
    </div>
  {/if}
</Modal>
