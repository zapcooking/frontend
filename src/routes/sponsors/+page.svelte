<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
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
    status?: string;
    buyerPubkey?: string;
  };

  let activeSponsors: ShowcaseSponsor[] = [];
  let loadingSponsors = true;
  let showForm = false;
  let showInfoModal = false;
  let adminActionLoading: string | null = null;

  $: isAdminUser = isAdmin($userPublickey);
  $: headlineSponsors = activeSponsors.filter((s) => s.tier === 'headline');
  $: cardSponsors = activeSponsors.filter((s) => s.tier === 'kitchen_card');

  let prevIsAdmin = false;
  onMount(() => {
    if (!browser) return;
    fetchActiveSponsors();
  });

  // Re-fetch when admin status changes (e.g. user logs in)
  $: if (browser && isAdminUser !== prevIsAdmin) {
    prevIsAdmin = isAdminUser;
    fetchActiveSponsors();
  }

  async function fetchActiveSponsors() {
    loadingSponsors = true;
    try {
      let url = '/api/sponsor/active';
      if (isAdminUser) {
        url += `?admin=true&pubkey=${$userPublickey}`;
      }
      const res = await fetch(url);
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

  async function adminAction(sponsorId: string, action: 'hide' | 'unhide') {
    if (action === 'hide' && !confirm('Hide this sponsor? It will be removed from public view.')) return;
    adminActionLoading = sponsorId;
    try {
      const res = await fetch('/api/sponsor/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sponsorId, adminPubkey: $userPublickey }),
      });
      if (res.ok) {
        await fetchActiveSponsors();
      }
    } catch (err) {
      console.error('[Sponsor Admin] Action failed:', err);
    } finally {
      adminActionLoading = null;
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

  // Launch promotional pricing — 69% off
  function promoPrice(sats: number): number {
    return Math.floor(sats * 0.31);
  }

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
  <meta name="description" content="Get your brand in front of the Nostr food community. Direct sponsorship via Lightning — no tracking, no algorithms." />
</svelte:head>

<div class="sponsor-page">
  <!-- A. Hero Section -->
  <div class="text-center mb-10">
    <h1 class="text-3xl font-bold mb-3">Kitchen Sponsors</h1>
    <p class="text-sm mb-2" style="color: var(--color-caption); max-width: 480px; margin-left: auto; margin-right: auto;">
      Get your brand in front of the Nostr food community. Sponsor zap.cooking and align with an open, Bitcoin-native platform built by and for real people.
    </p>
    <p class="text-xs mb-5" style="color: var(--color-caption); max-width: 440px; margin-left: auto; margin-right: auto;">
      No tracking. No algorithms. Direct support for an open food network built on Nostr.
    </p>
    <button type="button" class="sponsor-btn sponsor-btn--pay" on:click={openForm}>
      &#9889; Sponsor Zap.Cooking
    </button>
    <div class="mt-3">
      <button
        type="button"
        class="info-link"
        on:click={() => { showInfoModal = true; }}
      >
        What do sponsors get?
      </button>
    </div>
  </div>

  <!-- B. Current Sponsors -->
  <section>
    <h2 class="text-lg font-semibold mb-3">Current Sponsors</h2>
    {#if loadingSponsors}
      <div class="showcase-loading">
        <div class="showcase-skeleton"></div>
        <div class="showcase-grid">
          <div class="showcase-skeleton-card"></div>
          <div class="showcase-skeleton-card"></div>
        </div>
      </div>
    {:else if activeSponsors.length === 0}
      <div class="empty-state">
        <span class="launching-badge">Launching Now</span>
        <p class="text-sm mt-3" style="color: var(--color-caption); max-width: 360px; margin-left: auto; margin-right: auto;">
          Be the first to support zap.cooking and get your brand in front of the community.
        </p>
      </div>
    {:else}
      {#if headlineSponsors.length > 0}
        <div class="flex flex-col gap-3 mb-4">
          {#each headlineSponsors as sponsor (sponsor.id)}
            <div class="admin-card-wrap" class:admin-hidden={sponsor.status === 'hidden'}>
              {#if isAdminUser && sponsor.status === 'hidden'}
                <span class="hidden-badge">Hidden</span>
              {/if}
              <SponsorBanner
                title={sponsor.title}
                description={sponsor.description}
                imageUrl={sponsor.imageUrl}
                linkUrl={sponsor.linkUrl}
              />
              {#if isAdminUser}
                <div class="admin-controls">
                  {#if sponsor.status === 'hidden'}
                    <button
                      type="button"
                      class="admin-btn admin-btn--unhide"
                      disabled={adminActionLoading === sponsor.id}
                      on:click={() => adminAction(sponsor.id, 'unhide')}
                    >
                      {adminActionLoading === sponsor.id ? '...' : 'Unhide'}
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="admin-btn admin-btn--hide"
                      disabled={adminActionLoading === sponsor.id}
                      on:click={() => adminAction(sponsor.id, 'hide')}
                    >
                      {adminActionLoading === sponsor.id ? '...' : 'Hide'}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if cardSponsors.length > 0}
        <div class="showcase-grid">
          {#each cardSponsors as sponsor (sponsor.id)}
            <div class="admin-card-wrap" class:admin-hidden={sponsor.status === 'hidden'}>
              {#if isAdminUser && sponsor.status === 'hidden'}
                <span class="hidden-badge">Hidden</span>
              {/if}
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
              {#if isAdminUser}
                <div class="admin-controls">
                  {#if sponsor.status === 'hidden'}
                    <button
                      type="button"
                      class="admin-btn admin-btn--unhide"
                      disabled={adminActionLoading === sponsor.id}
                      on:click={() => adminAction(sponsor.id, 'unhide')}
                    >
                      {adminActionLoading === sponsor.id ? '...' : 'Unhide'}
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="admin-btn admin-btn--hide"
                      disabled={adminActionLoading === sponsor.id}
                      on:click={() => adminAction(sponsor.id, 'hide')}
                    >
                      {adminActionLoading === sponsor.id ? '...' : 'Hide'}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
    <p class="text-xs mt-4" style="color: var(--color-caption);">
      <a href="/disclosure" class="hover:underline" style="color: var(--color-caption);">Disclosure</a>
      <span style="opacity: 0.4;"> &middot; </span>
      <a href="/sponsor-terms" class="hover:underline" style="color: var(--color-caption);">Sponsor Terms</a>
    </p>
  </section>

  <!-- B2. "What do sponsors get?" Modal -->
  {#if showInfoModal}
    <div class="info-overlay" on:click|self={() => { showInfoModal = false; }} on:keydown={(e) => { if (e.key === 'Escape') showInfoModal = false; }}>
      <div class="info-panel">
        <div class="info-panel-header">
          <h2 class="text-lg font-bold">What do sponsors get?</h2>
          <button type="button" class="form-close" on:click={() => { showInfoModal = false; }} aria-label="Close">
            &times;
          </button>
        </div>
        <div class="info-panel-body">
          <ul class="info-list">
            <li class="info-item">
              <span class="info-icon">&#9889;</span>
              <div>
                <h3 class="info-item-title">Brand Placement</h3>
                <p class="info-item-desc">Your logo and link visible to every visitor on the sponsors page and across the platform.</p>
              </div>
            </li>
            <li class="info-item">
              <span class="info-icon">&#127860;</span>
              <div>
                <h3 class="info-item-title">Community Feed Feature</h3>
                <p class="info-item-desc">Highlighted to active community members who are passionate about food and open tech.</p>
              </div>
            </li>
            <li class="info-item">
              <span class="info-icon">&#8383;</span>
              <div>
                <h3 class="info-item-title">Bitcoin-Native Alignment</h3>
                <p class="info-item-desc">Associate your brand with the values of the Nostr ecosystem — open, permissionless, sovereign.</p>
              </div>
            </li>
            <li class="info-item">
              <span class="info-icon">&#128279;</span>
              <div>
                <h3 class="info-item-title">No Middlemen</h3>
                <p class="info-item-desc">Direct sponsorship via Lightning. No ad networks, no invoices, no tracking.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
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
                  {@const tierStartPrice = promoPrice(SPONSOR_PRICING[tier.key]['24h'].sats)}
                  <button
                    type="button"
                    class="tier-card"
                    class:tier-card--selected={selectedTier === tier.key}
                    on:click={() => { selectedTier = tier.key; }}
                  >
                    <span class="text-sm font-bold">{tier.label}</span>
                    <span class="text-xs" style="color: var(--color-caption);">{tier.description}</span>
                    <span class="text-xs font-semibold mt-1" style="color: var(--color-primary);">
                      From &#9889; {formatSats(tierStartPrice)} sats
                    </span>
                  </button>
                {/each}
              </div>

              <!-- Pricing table for selected tier -->
              {#if selectedTier && currentPricing}
                <div class="pricing-table mt-4">
                  <h3 class="text-xs font-semibold uppercase mb-2" style="color: var(--color-caption); letter-spacing: 0.06em;">
                    {selectedTier === 'headline' ? 'Headline Banner' : 'Kitchen Card'} — Pricing
                  </h3>
                  <div class="pricing-grid">
                    {#each SPONSOR_DURATION_KEYS as dKey}
                      {@const pricing = currentPricing[dKey]}
                      {#if pricing}
                        <div class="pricing-row">
                          <span class="text-sm" style="color: var(--color-text-primary);">{pricing.label}</span>
                          <span class="pricing-price">
                            <span class="pricing-original">{formatSats(pricing.sats)}</span>
                            <span class="pricing-promo">&#9889; {formatSats(promoPrice(pricing.sats))} sats</span>
                          </span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                  <p class="text-xs mt-2" style="color: var(--color-caption); opacity: 0.7;">
                    Launch pricing — 69% off all placements
                  </p>
                </div>
              {/if}
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
                          <span class="text-xs line-through" style="color: var(--color-caption);">{formatSats(pricing.sats)}</span>
                          <span class="text-lg font-bold" style="color: var(--color-primary);">
                            &#9889; {formatSats(promoPrice(pricing.sats))}
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

                  <div class="flow-disclosure">
                    <p class="text-xs" style="color: var(--color-caption); line-height: 1.5;">
                      Zap Cooking may feature paid partnerships, sponsored placements, and boosted recipes.
                      We aim to label paid visibility clearly and keep the experience transparent, simple, and aligned with the community.
                    </p>
                    <p class="text-xs mt-1.5" style="color: var(--color-caption);">
                      <a href="/disclosure" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Disclosure</a>
                      <span style="opacity: 0.5;"> &middot; </span>
                      <a href="/sponsor-terms" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Sponsor Terms</a>
                    </p>
                  </div>

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
                      &#9889; Pay {formatSats(promoPrice(currentPricing[selectedDuration].sats))} sats
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

  /* ── Hero extras ──────────────────────────────────────────────── */

  .info-link {
    background: none;
    border: none;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    padding: 0;
  }

  .info-link:hover {
    filter: brightness(1.15);
  }

  .launching-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 10px;
    border-radius: 9999px;
    background-color: var(--color-primary);
    color: white;
  }

  /* ── Info modal ──────────────────────────────────────────────── */

  .info-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .info-panel {
    width: 100%;
    max-width: 440px;
    background-color: var(--color-bg-primary);
    border-radius: 1rem;
    border: 1px solid var(--color-input-border);
    overflow: hidden;
  }

  .info-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-input-border);
  }

  .info-panel-body {
    padding: 1.25rem;
  }

  .info-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .info-item {
    display: flex;
    gap: 0.875rem;
    align-items: flex-start;
  }

  .info-icon {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    border-radius: 0.5rem;
    background: rgba(236, 71, 0, 0.1);
  }

  .info-item-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.125rem;
  }

  .info-item-desc {
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.4;
    margin: 0;
  }

  /* ── Showcase ──────────────────────────────────────────────────── */

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

  /* ── Flow disclosure ──────────────────────────────────────────── */

  .flow-disclosure {
    padding: 0.75rem;
    margin-bottom: 1rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
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

  /* ── Pricing table ─────────────────────────────────────────── */

  .pricing-table {
    padding: 0.875rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
  }

  .pricing-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pricing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0;
    border-bottom: 1px solid var(--color-input-border);
  }

  .pricing-row:last-child {
    border-bottom: none;
  }

  .pricing-price {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .pricing-original {
    font-size: 0.8125rem;
    color: var(--color-caption);
    text-decoration: line-through;
    opacity: 0.6;
  }

  .pricing-promo {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-primary);
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

  /* ── Admin moderation controls ──────────────────────────────────── */

  .admin-card-wrap {
    position: relative;
  }

  .admin-hidden {
    opacity: 0.5;
  }

  .hidden-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 9999px;
    background: #ef4444;
    color: white;
  }

  .admin-controls {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }

  .admin-btn {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-secondary);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .admin-btn:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .admin-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .admin-btn--hide:hover:not(:disabled) {
    border-color: #ef4444;
    color: #ef4444;
  }

  .admin-btn--unhide:hover:not(:disabled) {
    border-color: #22c55e;
    color: #22c55e;
  }
</style>
