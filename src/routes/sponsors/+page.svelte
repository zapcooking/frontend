<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import { lightningService } from '$lib/lightningService';
  import {
    SPONSOR_PRICING,
    SPONSOR_DURATION_KEYS,
    SPONSOR_TIERS,
    type SponsorTier,
    type SponsorDurationKey,
  } from '$lib/sponsorPricing';
  import ImageUploader from '../../components/ImageUploader.svelte';
  import SponsorBanner from '../../components/SponsorBanner.svelte';
  import SponsorFeedCard from '../../components/SponsorFeedCard.svelte';

  // ── Showcase state ──────────────────────────────────────────────────
  type ShowcaseSponsor = {
    id: string;
    title: string;
    description: string;
    imageUrl: string;
    linkUrl: string;
    tier: string;
    expiresAt: number | null;
  };

  let activeSponsors: ShowcaseSponsor[] = [];
  let loadingSponsors = true;
  let showForm = false;

  $: headlineSponsors = activeSponsors.filter((s) => s.tier === 'headline');
  $: cardSponsors = activeSponsors.filter((s) => s.tier === 'kitchen_card');

  onMount(() => {
    if (!browser) return;
    fetchActiveSponsors();
  });

  async function fetchActiveSponsors() {
    loadingSponsors = true;
    try {
      const res = await fetch('/api/sponsor/active');
      if (res.ok) {
        const data = await res.json();
        activeSponsors = data.sponsors || [];
      }
    } catch {
      activeSponsors = [];
    } finally {
      loadingSponsors = false;
    }
  }

  function openForm() {
    showForm = true;
  }

  function closeForm() {
    showForm = false;
    resetAll();
  }

  // ── Submission form state ───────────────────────────────────────────

  // Step 1: Tier selection
  let selectedTier: SponsorTier | null = null;

  // Step 2: Creative
  let adTitle = '';
  let adDescription = '';
  let adImageUrl = '';
  let adLinkUrl = '';

  // Step 3: Duration
  let selectedDuration: SponsorDurationKey = '7d';

  // Payment state
  let loading = false;
  let error: string | null = null;
  let sponsorId: string | null = null;
  let receiveRequestId: string | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let paymentConfirmed = false;

  // Derived
  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;
  $: creativeComplete =
    adTitle.trim().length > 0 &&
    adTitle.length <= 80 &&
    adImageUrl.length > 0 &&
    adLinkUrl.trim().length > 0 &&
    isValidUrl(adLinkUrl) &&
    (adDescription.length === 0 || adDescription.length <= 200);
  $: currentPricing = selectedTier ? SPONSOR_PRICING[selectedTier] : null;

  onDestroy(() => {
    stopPaymentPolling();
  });

  function isValidUrl(str: string): boolean {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function setImageUrl(url: string) {
    adImageUrl = url;
  }

  function resetAll() {
    selectedTier = null;
    adTitle = '';
    adDescription = '';
    adImageUrl = '';
    adLinkUrl = '';
    selectedDuration = '7d';
    error = null;
    paymentConfirmed = false;
    sponsorId = null;
    receiveRequestId = null;
  }

  // ── Payment ───────────────────────────────────────────────────────

  async function handlePay() {
    if (!isLoggedIn) {
      error = 'Please sign in to place a sponsor ad.';
      return;
    }

    if (!selectedTier || !creativeComplete) {
      error = 'Please complete all fields first.';
      return;
    }

    loading = true;
    error = null;

    try {
      const response = await fetch('/api/sponsor/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: adTitle.trim(),
          description: adDescription.trim(),
          imageUrl: adImageUrl,
          linkUrl: adLinkUrl.trim(),
          buyerPubkey: $userPublickey,
          tier: selectedTier,
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
      sponsorId = data.sponsorId;
      receiveRequestId = data.receiveRequestId;

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
      console.error('[Sponsor] Payment error:', err);
      error = err.message || 'Failed to create invoice. Please try again.';
      loading = false;
    }
  }

  async function verifyPayment() {
    if (!sponsorId || !receiveRequestId) return;

    try {
      const response = await fetch('/api/sponsor/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsorId, receiveRequestId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          paymentConfirmed = true;
          loading = false;
          stopPaymentPolling();
          // Refresh showcase
          fetchActiveSponsors();
        }
      }
    } catch (err) {
      console.error('[Sponsor] Verify error:', err);
    }
  }

  function startPaymentPolling(setPaid: (response: { preimage: string }) => void) {
    pollInterval = setInterval(async () => {
      if (paymentConfirmed || !sponsorId || !receiveRequestId) return;

      try {
        const response = await fetch('/api/sponsor/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sponsorId, receiveRequestId }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            paymentConfirmed = true;
            stopPaymentPolling();
            setPaid({ preimage: 'strike-confirmed' });
            loading = false;
            fetchActiveSponsors();
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
  <meta name="description" content="These brands and builders support zap.cooking and the community." />
</svelte:head>

<div class="sponsor-page">
  <!-- A. Hero Section -->
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2">Kitchen Sponsors</h1>
    <p class="text-sm mb-5" style="color: var(--color-caption);">
      These brands and builders support zap.cooking and the community. Want to join them?
    </p>
    <button type="button" class="sponsor-btn sponsor-btn--pay" on:click={openForm}>
      &#9889; Sponsor Zap.Cooking
    </button>
  </div>

  <!-- B. Sponsor Showcase -->
  {#if loadingSponsors}
    <div class="showcase-loading">
      <div class="showcase-skeleton"></div>
      <div class="showcase-grid">
        <div class="showcase-skeleton-card"></div>
        <div class="showcase-skeleton-card"></div>
      </div>
    </div>
  {:else if activeSponsors.length === 0}
    <!-- Empty state -->
    <div class="empty-state">
      <p class="text-lg font-semibold mb-2">The kitchen is looking for sponsors!</p>
      <p class="text-sm mb-4" style="color: var(--color-caption);">
        Be the first to support zap.cooking and get your brand in front of the community.
      </p>
      <button type="button" class="sponsor-btn sponsor-btn--pay" on:click={openForm}>
        &#9889; Sponsor Zap.Cooking
      </button>
    </div>
  {:else}
    <!-- Headline sponsors — prominent, full-width -->
    {#if headlineSponsors.length > 0}
      <section class="showcase-section">
        <div class="flex flex-col gap-3">
          {#each headlineSponsors as sponsor (sponsor.id)}
            <SponsorBanner
              title={sponsor.title}
              description={sponsor.description}
              imageUrl={sponsor.imageUrl}
              linkUrl={sponsor.linkUrl}
            />
          {/each}
        </div>
      </section>
    {/if}

    <!-- Kitchen Card sponsors — grid -->
    {#if cardSponsors.length > 0}
      <section class="showcase-section">
        <div class="showcase-grid">
          {#each cardSponsors as sponsor (sponsor.id)}
            <a
              href={sponsor.linkUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              class="showcase-card"
            >
              <div class="showcase-card-image">
                <img src={sponsor.imageUrl} alt={sponsor.title} loading="lazy" />
              </div>
              <div class="showcase-card-body">
                <span class="tier-badge">Kitchen Card</span>
                <h3 class="showcase-card-title">{sponsor.title}</h3>
                {#if sponsor.description}
                  <p class="showcase-card-desc">{sponsor.description}</p>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/if}

  <!-- C. Submission Form (expandable panel) -->
  {#if showForm}
    <div class="form-overlay" on:click|self={closeForm} on:keydown={(e) => { if (e.key === 'Escape') closeForm(); }}>
      <div class="form-panel">
        <div class="form-panel-header">
          <h2 class="text-lg font-bold">Sponsor Zap.Cooking</h2>
          <button type="button" class="form-close" on:click={closeForm} aria-label="Close">
            &times;
          </button>
        </div>

        <div class="form-panel-body">
          {#if paymentConfirmed}
            <!-- Success Screen -->
            <div class="success-card">
              <div class="text-4xl mb-3">&#9889;</div>
              <h2 class="text-xl font-bold mb-2">You're live!</h2>
              <p class="text-sm mb-4" style="color: var(--color-caption);">
                Your <strong>{selectedTier === 'headline' ? 'Headline Banner' : 'Kitchen Card'}</strong> ad is now active
                for {currentPricing ? currentPricing[selectedDuration].label.toLowerCase() : selectedDuration}.
              </p>
              <div class="mb-4" style="max-width: 400px; width: 100%;">
                {#if selectedTier === 'headline'}
                  <SponsorBanner
                    title={adTitle}
                    description={adDescription}
                    imageUrl={adImageUrl}
                    linkUrl={adLinkUrl}
                  />
                {:else}
                  <SponsorFeedCard
                    title={adTitle}
                    description={adDescription}
                    imageUrl={adImageUrl}
                    linkUrl={adLinkUrl}
                  />
                {/if}
              </div>
              <button type="button" on:click={closeForm} class="sponsor-btn">
                Done
              </button>
            </div>
          {:else}
            <!-- Step 1: Choose Tier -->
            <section class="sponsor-section">
              <h2 class="section-label">1. Choose placement</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {#each SPONSOR_TIERS as tier}
                  <button
                    type="button"
                    class="tier-card"
                    class:tier-card--selected={selectedTier === tier.key}
                    on:click={() => { selectedTier = tier.key; }}
                  >
                    <span class="text-sm font-bold">{tier.label}</span>
                    <span class="text-xs" style="color: var(--color-caption);">{tier.description}</span>
                  </button>
                {/each}
              </div>
            </section>

            {#if selectedTier}
              <!-- Step 2: Upload Creative -->
              <section class="sponsor-section">
                <h2 class="section-label">2. Create your ad</h2>

                {#if !isLoggedIn}
                  <p class="text-xs mb-3" style="color: var(--color-caption);">
                    Sign in with Nostr to upload an image.
                  </p>
                {/if}

                <div class="flex flex-col gap-3">
                  <div>
                    <label class="field-label" for="sponsor-title">Title <span class="required">*</span></label>
                    <input
                      id="sponsor-title"
                      type="text"
                      bind:value={adTitle}
                      placeholder="Your ad headline"
                      maxlength="80"
                      class="sponsor-input"
                    />
                    <span class="char-count">{adTitle.length}/80</span>
                  </div>

                  <div>
                    <label class="field-label" for="sponsor-desc">Description</label>
                    <input
                      id="sponsor-desc"
                      type="text"
                      bind:value={adDescription}
                      placeholder="Short description (optional)"
                      maxlength="200"
                      class="sponsor-input"
                    />
                    <span class="char-count">{adDescription.length}/200</span>
                  </div>

                  <div>
                    <label class="field-label" for="sponsor-link">Link URL <span class="required">*</span></label>
                    <input
                      id="sponsor-link"
                      type="url"
                      bind:value={adLinkUrl}
                      placeholder="https://example.com"
                      class="sponsor-input"
                    />
                  </div>

                  <div>
                    <label class="field-label">Image <span class="required">*</span></label>
                    {#if adImageUrl}
                      <div class="image-preview-wrap">
                        <img src={adImageUrl} alt="Ad preview" class="image-preview" />
                        <button
                          type="button"
                          class="text-xs font-medium"
                          style="color: var(--color-primary);"
                          on:click={() => { adImageUrl = ''; }}
                        >
                          Change image
                        </button>
                      </div>
                    {:else}
                      <ImageUploader setUrl={setImageUrl} name="ad image" />
                    {/if}
                  </div>
                </div>

                <!-- Live Preview -->
                {#if adTitle.trim() && adImageUrl}
                  <div class="mt-4">
                    <h3 class="text-xs font-semibold uppercase mb-2" style="color: var(--color-caption); letter-spacing: 0.06em;">
                      Preview
                    </h3>
                    {#if selectedTier === 'headline'}
                      <SponsorBanner
                        title={adTitle}
                        description={adDescription}
                        imageUrl={adImageUrl}
                        linkUrl={adLinkUrl || '#'}
                      />
                    {:else}
                      <SponsorFeedCard
                        title={adTitle}
                        description={adDescription}
                        imageUrl={adImageUrl}
                        linkUrl={adLinkUrl || '#'}
                      />
                    {/if}
                  </div>
                {/if}
              </section>

              {#if creativeComplete}
                <!-- Step 3: Choose Duration -->
                <section class="sponsor-section">
                  <h2 class="section-label">3. Choose duration</h2>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {#each SPONSOR_DURATION_KEYS as dKey}
                      {@const pricing = currentPricing ? currentPricing[dKey] : null}
                      {#if pricing}
                        <button
                          type="button"
                          class="duration-card"
                          class:duration-card--selected={selectedDuration === dKey}
                          on:click={() => { selectedDuration = dKey; }}
                        >
                          <span class="text-sm font-bold">{pricing.label}</span>
                          <span class="text-lg font-bold" style="color: var(--color-primary);">
                            &#9889; {formatSats(pricing.sats)}
                          </span>
                          <span class="text-xs" style="color: var(--color-caption);">sats</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                </section>

                <!-- Step 4: Payment -->
                <section class="sponsor-section">
                  <h2 class="section-label">4. Pay with Lightning</h2>

                  {#if !isLoggedIn}
                    <p class="text-sm mb-3" style="color: var(--color-caption);">
                      Sign in with Nostr to continue.
                    </p>
                  {/if}

                  <button
                    type="button"
                    on:click={handlePay}
                    class="sponsor-btn sponsor-btn--pay w-full"
                    disabled={loading || !isLoggedIn}
                  >
                    {#if loading}
                      Processing...
                    {:else if currentPricing}
                      &#9889; Pay {formatSats(currentPricing[selectedDuration].sats)} sats
                    {/if}
                  </button>

                  {#if error}
                    <p class="text-xs mt-2" style="color: #ef4444;">{error}</p>
                  {/if}
                </section>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .sponsor-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }

  /* ── Showcase ──────────────────────────────────────────────────── */

  .showcase-section {
    margin-bottom: 1.5rem;
  }

  .showcase-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }

  @media (min-width: 640px) {
    .showcase-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (min-width: 900px) {
    .showcase-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .showcase-card {
    display: flex;
    flex-direction: column;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .showcase-card:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .showcase-card-image {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
  }

  .showcase-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .showcase-card-body {
    padding: 0.625rem 0.75rem 0.75rem;
  }

  .tier-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 6px;
    border-radius: 9999px;
    background: rgba(236, 71, 0, 0.1);
    color: var(--color-primary);
    margin-bottom: 0.375rem;
  }

  .showcase-card-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.3;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .showcase-card-desc {
    font-size: 0.75rem;
    color: var(--color-caption);
    line-height: 1.35;
    margin: 0.25rem 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* ── Empty state ───────────────────────────────────────────────── */

  .empty-state {
    text-align: center;
    padding: 3rem 1.5rem;
    border-radius: 1rem;
    border: 1px dashed var(--color-input-border);
    background-color: var(--color-bg-secondary);
  }

  /* ── Loading skeletons ─────────────────────────────────────────── */

  .showcase-loading {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .showcase-skeleton {
    height: 96px;
    border-radius: 0.75rem;
    background-color: var(--color-bg-secondary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .showcase-skeleton-card {
    aspect-ratio: 16 / 14;
    border-radius: 0.75rem;
    background-color: var(--color-bg-secondary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* ── Form overlay / panel ──────────────────────────────────────── */

  .form-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  @media (min-width: 640px) {
    .form-overlay {
      align-items: center;
    }
  }

  .form-panel {
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    background-color: var(--color-bg-primary);
    border-radius: 1rem 1rem 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  @media (min-width: 640px) {
    .form-panel {
      border-radius: 1rem;
      max-height: 85vh;
    }
  }

  .form-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-input-border);
    flex-shrink: 0;
  }

  .form-close {
    font-size: 1.5rem;
    line-height: 1;
    background: none;
    border: none;
    color: var(--color-caption);
    cursor: pointer;
    padding: 0.25rem;
  }

  .form-close:hover {
    color: var(--color-text-primary);
  }

  .form-panel-body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  /* ── Shared form styles (same as before) ───────────────────────── */

  .sponsor-section {
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

  .field-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    margin-bottom: 0.375rem;
    color: var(--color-text-primary);
  }

  .required {
    color: #ef4444;
  }

  .char-count {
    display: block;
    text-align: right;
    font-size: 0.6875rem;
    color: var(--color-caption);
    margin-top: 0.125rem;
  }

  .sponsor-input {
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

  .sponsor-input:focus {
    border-color: var(--color-primary);
  }

  .sponsor-input::placeholder {
    color: var(--color-caption);
  }

  .image-preview-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .image-preview {
    max-width: 100%;
    max-height: 200px;
    border-radius: 0.5rem;
    object-fit: cover;
  }

  .tier-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 1.25rem 1rem;
    border-radius: 0.75rem;
    border: 1.5px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
    text-align: center;
  }

  .tier-card:hover {
    border-color: var(--color-primary);
  }

  .tier-card--selected {
    border-color: var(--color-primary);
    background: rgba(236, 71, 0, 0.06);
  }

  :global(html.dark) .tier-card--selected {
    background: rgba(236, 71, 0, 0.12);
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

  .sponsor-btn {
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

  .sponsor-btn:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .sponsor-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sponsor-btn--pay {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .sponsor-btn--pay:hover:not(:disabled) {
    filter: brightness(1.1);
    color: white;
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
