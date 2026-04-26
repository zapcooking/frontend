<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import { lightningService } from '$lib/lightningService';
  import { copyToClipboard } from '$lib/utils/share';
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
  /** Whether the current user is a Pro Kitchen / Founders member. Free unlimited exports if true. */
  export let isProMember: boolean = false;
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
  const COOKBOOK_EXPORT_SATS = 2100;

  let invoiceLoading = false;
  let invoiceError = '';
  let invoice = '';
  let exportId = '';
  let receiveRequestId = '';
  let invoicePollInterval: ReturnType<typeof setInterval> | null = null;
  let invoiceCopied = false;
  /** True once payment is confirmed in this session. */
  let paymentUnlocked = false;

  $: missingRecipes = Math.max(0, totalRecipeCount - recipeEvents.length);
  /** Either the user is a Pro member OR they've already paid for this pack. */
  $: canExport = isProMember || paymentUnlocked;

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
    // Note: don't reset paymentUnlocked — let the user generate, fail,
    // and retry without re-paying.
  }

  function initStateOnOpen() {
    title = packTitle || 'My Recipe Pack';
    subtitle = packDescription || '';
    paymentUnlocked = isRecentlyPaid();
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
          packTitle: title.trim() || packTitle
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
        invoice: string;
        paymentHash: string;
        receiveRequestId: string;
        invoiceExpiresAt: number;
        amountSats: number;
      };
      exportId = data.exportId;
      receiveRequestId = data.receiveRequestId;
      invoice = data.invoice;
      stage = 'invoice';

      // Hand the invoice to Bitcoin Connect / Alby's modal — gives us
      // the QR + copy + WebLN button without us having to draw it.
      try {
        const { setPaid } = await lightningService.launchPayment({
          invoice,
          onPaid: async () => {
            stopInvoicePolling();
            await onPaymentConfirmed();
          },
          onCancelled: () => {
            stopInvoicePolling();
            // User dismissed the modal without paying — leave them on
            // the invoice screen so they can retry / copy the invoice.
          }
        });
        startInvoicePolling(setPaid);
      } catch (err) {
        console.error('[ExportCookbookModal] launchPayment failed', err);
        // Still allow polling — the user can copy the invoice manually
        // from the screen and pay from any wallet.
        startInvoicePolling(null);
      }
    } catch (err: any) {
      console.error('[ExportCookbookModal] create-invoice failed', err);
      invoiceError = err?.message || 'Failed to create Lightning invoice.';
    } finally {
      invoiceLoading = false;
    }
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
      const { text: introduction, aiUsed } = await fetchPolishedIntroduction(creatorName, recipes);
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
        includeIntroduction: !!introduction,
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
    <div class="flex flex-col gap-4">
      <p class="text-sm text-caption">Turn this Recipe Pack into a printable cookbook PDF.</p>

      {#if !canExport}
        <!-- Pay-per-use hint for non-Pro users. Kept compact so it doesn't
             dominate the form. -->
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
          <div class="flex flex-col gap-1">
            <p class="text-sm" style="color: var(--color-text-primary)">
              <span class="font-medium">Free with Pro Kitchen membership</span>
              <span class="text-caption"> — or unlock once for {COOKBOOK_EXPORT_SATS} sats.</span>
            </p>
            <a href="/membership" class="text-xs text-primary hover:underline">
              See Pro Kitchen
            </a>
          </div>
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

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={handleClose} primary={false}>Cancel</Button>
        <Button
          on:click={handleGenerateClick}
          disabled={invoiceLoading || !packEvent || recipeEvents.length === 0}
        >
          {#if invoiceLoading}
            Creating invoice…
          {:else if canExport}
            Generate Cookbook
          {:else}
            Unlock Cookbook for {COOKBOOK_EXPORT_SATS} sats ⚡
          {/if}
        </Button>
      </div>
    </div>
  {:else if stage === 'invoice'}
    <div class="flex flex-col gap-4">
      <p class="text-sm" style="color: var(--color-text-primary)">
        Pay <span class="font-semibold">{COOKBOOK_EXPORT_SATS} sats</span> to unlock cookbook export
        for this pack.
      </p>
      <p class="text-xs text-caption">
        A wallet picker should have opened in another window. If not, copy the invoice and pay from
        any Lightning wallet.
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

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={cancelInvoice} primary={false}>Cancel</Button>
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
    <div class="flex flex-col gap-4">
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
            Your cookbook is ready
          </p>
          <p class="text-xs text-caption">
            {resultIncluded} {resultIncluded === 1 ? 'recipe' : 'recipes'} included
            {#if resultSkipped > 0}
              · {resultSkipped} couldn't be loaded
            {/if}
            {#if usedAi}
              · introduction polished
            {/if}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        {#if packShareUrl}
          <Button on:click={copyShareUrl} primary={false}>Share Recipe Pack</Button>
        {/if}
        <Button on:click={handleClose} primary={false}>Close</Button>
        <Button on:click={handleDownload}>Download PDF</Button>
      </div>
    </div>
  {:else if stage === 'error'}
    <div class="flex flex-col gap-4">
      <p class="text-sm" style="color: var(--color-text-primary)">
        {stageMessage || 'Something went wrong while building the PDF.'}
      </p>
      {#if paymentUnlocked && !isProMember}
        <p class="text-xs text-caption">
          Your payment is still valid — retry won't charge again.
        </p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button on:click={handleClose} primary={false}>Close</Button>
        <Button on:click={handleRetry}>Try again</Button>
      </div>
    </div>
  {/if}
</Modal>
