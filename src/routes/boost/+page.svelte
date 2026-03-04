<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { lightningService } from '$lib/lightningService';
  import { BOOST_PRICING, BOOST_DURATION_KEYS, type BoostDurationKey } from '$lib/boostPricing';
  import BoostedRecipeCard from '../../components/BoostedRecipeCard.svelte';

  // ── State ─────────────────────────────────────────────────────────
  let recipeInput = '';
  let fetchingRecipe = false;
  let fetchError: string | null = null;

  // Recipe data (populated after fetch)
  let recipeNaddr: string = '';
  let recipeTitle: string = '';
  let recipeImage: string = '';
  let authorPubkey: string = '';

  // Duration selection
  let selectedDuration: BoostDurationKey = '7d';

  // Payment state
  let loading = false;
  let error: string | null = null;
  let boostId: string | null = null;
  let receiveRequestId: string | null = null;
  let paymentHash: string | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let paymentConfirmed = false;

  // Step tracking
  $: recipeFetched = recipeNaddr.length > 0;
  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;

  onDestroy(() => {
    stopPaymentPolling();
  });

  // ── Auto-populate from ?recipe= query param ──────────────────────
  onMount(async () => {
    if (!browser) return;
    const recipeParam = $page.url.searchParams.get('recipe');
    if (recipeParam) {
      recipeInput = recipeParam;
      await ensureNdkConnected();
      fetchRecipe();
    }
  });

  // ── Step 1: Parse recipe input ────────────────────────────────────

  function extractNaddr(input: string): string | null {
    const trimmed = input.trim();

    // Direct naddr
    if (trimmed.startsWith('naddr1')) {
      return trimmed;
    }

    // URL: extract naddr from /recipe/{naddr} path
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/recipe\/(naddr1[a-zA-Z0-9]+)/);
      if (match) return match[1];
    } catch {
      // not a URL
    }

    return null;
  }

  async function fetchRecipe() {
    fetchError = null;
    const naddr = extractNaddr(recipeInput);

    if (!naddr) {
      fetchError = 'Please enter a valid zap.cooking recipe URL or naddr.';
      return;
    }

    fetchingRecipe = true;

    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== 'naddr') {
        throw new Error('Invalid naddr format');
      }

      const data = decoded.data;
      const event = await Promise.race([
        $ndk.fetchEvent({
          '#d': [data.identifier],
          authors: [data.pubkey],
          kinds: [data.kind as number],
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout fetching recipe')), 10000)
        ),
      ]);

      if (!event) {
        throw new Error('Recipe not found. Check the URL and try again.');
      }

      recipeNaddr = naddr;
      recipeTitle =
        event.tags.find((t: string[]) => t[0] === 'title')?.[1] ||
        event.tags.find((t: string[]) => t[0] === 'd')?.[1] ||
        'Untitled Recipe';
      recipeImage = event.tags.find((t: string[]) => t[0] === 'image')?.[1] || '';
      authorPubkey = event.author?.pubkey || data.pubkey;
    } catch (err: any) {
      fetchError = err.message || 'Failed to fetch recipe.';
    } finally {
      fetchingRecipe = false;
    }
  }

  function resetRecipe() {
    stopPaymentPolling();
    recipeNaddr = '';
    recipeTitle = '';
    recipeImage = '';
    authorPubkey = '';
    recipeInput = '';
    fetchError = null;
    error = null;
    paymentConfirmed = false;
    boostId = null;
    receiveRequestId = null;
    paymentHash = null;
    loading = false;
  }

  // ── Step 4: Payment ───────────────────────────────────────────────

  async function handlePay() {
    if (!isLoggedIn) {
      error = 'Please sign in to boost a recipe.';
      return;
    }

    if (!recipeNaddr) {
      error = 'Please select a recipe first.';
      return;
    }

    loading = true;
    error = null;

    try {
      const response = await fetch('/api/boost/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          naddr: recipeNaddr,
          recipeTitle,
          recipeImage,
          authorPubkey,
          buyerPubkey: $userPublickey,
          durationKey: selectedDuration,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to create invoice';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `Server error: ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      boostId = data.boostId;
      receiveRequestId = data.receiveRequestId;
      paymentHash = data.paymentHash;

      const { setPaid } = await lightningService.launchPayment({
        invoice: data.invoice,
        onPaid: async () => {
          stopPaymentPolling();
          if (!paymentConfirmed) {
            await verifyPayment();
          }
        },
        onCancelled: () => {
          stopPaymentPolling();
          loading = false;
          error = 'Payment cancelled.';
        },
      });

      // Start polling as backup
      startPaymentPolling(setPaid);
    } catch (err: any) {
      console.error('[Boost] Payment error:', err);
      error = err.message || 'Failed to create invoice. Please try again.';
      loading = false;
    }
  }

  async function verifyPayment() {
    if (!boostId || !receiveRequestId) return;

    try {
      const response = await fetch('/api/boost/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boostId, receiveRequestId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          paymentConfirmed = true;
          loading = false;
          stopPaymentPolling();
        }
      }
    } catch (err) {
      console.error('[Boost] Verify error:', err);
    }
  }

  function startPaymentPolling(setPaid: (response: { preimage: string }) => void) {
    pollInterval = setInterval(async () => {
      if (paymentConfirmed || !boostId || !receiveRequestId) return;

      try {
        const response = await fetch('/api/boost/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boostId, receiveRequestId }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            paymentConfirmed = true;
            stopPaymentPolling();
            setPaid({ preimage: 'strike-confirmed' });
            loading = false;
          }
        } else if (response.status !== 402) {
          stopPaymentPolling();
        }
      } catch {
        // Network error, keep polling
      }
    }, 3000);
  }

  function stopPaymentPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function formatSats(sats: number): string {
    return sats.toLocaleString('en-US');
  }
</script>

<svelte:head>
  <title>Kitchen Sponsors - zap.cooking</title>
  <meta name="description" content="Boost a recipe to the top of the zap.cooking homepage." />
</svelte:head>

<div class="boost-page">
  <!-- Hero -->
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2">Kitchen Sponsors</h1>
    <p class="text-sm" style="color: var(--color-caption);">
      Boost any recipe to the top of the homepage. Pay with Lightning, show up instantly.
    </p>
  </div>

  {#if paymentConfirmed}
    <!-- Success Screen -->
    <div class="success-card">
      <div class="text-4xl mb-3">&#9889;</div>
      <h2 class="text-xl font-bold mb-2">You're boosted!</h2>
      <p class="text-sm mb-4" style="color: var(--color-caption);">
        <strong>{recipeTitle}</strong> is now featured on the homepage for {BOOST_PRICING[selectedDuration].label.toLowerCase()}.
      </p>
      <div class="mb-4">
        <BoostedRecipeCard
          naddr={recipeNaddr}
          title={recipeTitle}
          imageUrl={recipeImage}
          authorPubkey={authorPubkey}
        />
      </div>
      <button
        type="button"
        on:click={() => goto('/explore')}
        class="boost-btn"
      >
        View Homepage
      </button>
    </div>
  {:else}
    <!-- Step 1: Recipe Input -->
    <section class="boost-section">
      <h2 class="section-label">1. Pick a recipe</h2>

      {#if recipeFetched}
        <div class="flex items-center gap-3 mb-2">
          <span class="text-sm font-medium" style="color: var(--color-text-primary);">
            {recipeTitle}
          </span>
          <button
            type="button"
            on:click={resetRecipe}
            class="text-xs font-medium"
            style="color: var(--color-primary);"
          >
            Change
          </button>
        </div>
      {:else}
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={recipeInput}
            placeholder="Paste a zap.cooking URL or naddr1..."
            class="boost-input flex-1"
            on:keydown={(e) => { if (e.key === 'Enter') fetchRecipe(); }}
          />
          <button
            type="button"
            on:click={fetchRecipe}
            class="boost-btn"
            disabled={fetchingRecipe || !recipeInput.trim()}
          >
            {fetchingRecipe ? 'Loading...' : 'Fetch'}
          </button>
        </div>
        {#if fetchError}
          <p class="text-xs mt-2" style="color: #ef4444;">{fetchError}</p>
        {/if}
      {/if}
    </section>

    <!-- Step 2: Live Preview -->
    {#if recipeFetched}
      <section class="boost-section">
        <h2 class="section-label">2. Preview</h2>
        <div class="flex justify-center">
          <BoostedRecipeCard
            naddr={recipeNaddr}
            title={recipeTitle}
            imageUrl={recipeImage}
            authorPubkey={authorPubkey}
          />
        </div>
      </section>

      <!-- Step 3: Duration Selection -->
      <section class="boost-section">
        <h2 class="section-label">3. Choose duration</h2>
        <div class="grid grid-cols-3 gap-3">
          {#each BOOST_DURATION_KEYS as dKey}
            <button
              type="button"
              class="duration-card"
              class:duration-card--selected={selectedDuration === dKey}
              on:click={() => { selectedDuration = dKey; }}
            >
              <span class="text-sm font-bold">{BOOST_PRICING[dKey].label}</span>
              <span class="text-lg font-bold" style="color: var(--color-primary);">
                &#9889; {formatSats(BOOST_PRICING[dKey].sats)}
              </span>
              <span class="text-xs" style="color: var(--color-caption);">sats</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- Step 4: Payment -->
      <section class="boost-section">
        <h2 class="section-label">4. Pay with Lightning</h2>

        {#if !isLoggedIn}
          <p class="text-sm mb-3" style="color: var(--color-caption);">
            Sign in with Nostr to continue.
          </p>
        {/if}

        <button
          type="button"
          on:click={handlePay}
          class="boost-btn boost-btn--pay w-full"
          disabled={loading || !isLoggedIn}
        >
          {#if loading}
            Processing...
          {:else}
            &#9889; Pay {formatSats(BOOST_PRICING[selectedDuration].sats)} sats
          {/if}
        </button>

        {#if error}
          <p class="text-xs mt-2" style="color: #ef4444;">{error}</p>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .boost-page {
    max-width: 480px;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }

  .boost-section {
    margin-bottom: 1.5rem;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.75rem;
    color: var(--color-text-secondary);
  }

  .boost-input {
    width: 100%;
    padding: 0.625rem 0.875rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  .boost-input:focus {
    border-color: var(--color-primary);
  }

  .boost-input::placeholder {
    color: var(--color-caption);
  }

  .boost-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem 1.25rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    border: 1.5px solid var(--color-input-border);
    color: var(--color-text-primary);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    min-height: 44px;
  }

  .boost-btn:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .boost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .boost-btn--pay {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .boost-btn--pay:hover:not(:disabled) {
    filter: brightness(1.1);
    color: white;
  }

  .duration-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1rem 0.5rem;
    border-radius: 0.75rem;
    border: 1.5px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
  }

  .duration-card:hover {
    border-color: var(--color-primary);
  }

  .duration-card--selected {
    border-color: var(--color-primary);
    background: rgba(236, 71, 0, 0.06);
  }

  :global(html.dark) .duration-card--selected {
    background: rgba(236, 71, 0, 0.12);
  }

  .success-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 2rem 1.5rem;
    border-radius: 1rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
  }
</style>
