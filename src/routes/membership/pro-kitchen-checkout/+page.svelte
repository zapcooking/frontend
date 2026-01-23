<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import { page } from '$app/stores';
  import { lightningService } from '$lib/lightningService';

  type PaymentMethod = 'stripe' | 'lightning';
  
  let paymentMethod: PaymentMethod = 'stripe';
  let loading = false;
  let error: string | null = null;
  let lightningInvoice: string | null = null;
  let paymentHash: string | null = null;

  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;
  
  // Pro Kitchen pricing
  const PRO_KITCHEN_PRICE_USD = 89;
  
  // Dynamic Bitcoin pricing (fetched from API)
  let bitcoinPriceLoading = true;
  let bitcoinPriceError: string | null = null;
  let discountedUsdAmount: number | null = null;
  let amountSats: number | null = null;
  let discountPercent = 5;

  onMount(() => {
    if (!browser) return;
    
    // Redirect to login if not logged in
    if (!isLoggedIn) {
      goto('/login?redirect=/membership/pro-kitchen-checkout');
    }

    // Check for payment success (Stripe)
    const paymentStatus = $page.url.searchParams.get('payment');
    const sessionId = $page.url.searchParams.get('session_id');
    
    if (paymentStatus === 'success' && sessionId) {
      goto(`/membership/pro-kitchen-success?payment_method=stripe&session_id=${sessionId}`);
    }
    
    // Fetch Bitcoin price quote
    fetchBitcoinPriceQuote();
  });
  
  async function fetchBitcoinPriceQuote() {
    bitcoinPriceLoading = true;
    bitcoinPriceError = null;
    
    try {
      const response = await fetch('/api/membership/bitcoin-price-quote?tier=pro&period=annual');
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch Bitcoin price');
      }
      
      const data = await response.json();
      discountedUsdAmount = data.discountedUsdAmount;
      amountSats = data.amountSats;
      discountPercent = data.discountPercent;
      
    } catch (err) {
      console.error('[Pro Kitchen Checkout] Bitcoin price error:', err);
      bitcoinPriceError = err instanceof Error ? err.message : 'Failed to fetch Bitcoin price';
      // Set fallback values
      discountedUsdAmount = PRO_KITCHEN_PRICE_USD * 0.95;
      amountSats = null;
    } finally {
      bitcoinPriceLoading = false;
    }
  }

  async function proceedToCheckout() {
    if (!browser || !isLoggedIn) {
      error = 'Please log in to continue';
      return;
    }
    
    if (paymentMethod === 'stripe') {
      await proceedWithStripe();
    } else {
      await proceedWithLightning();
    }
  }

  async function proceedWithStripe() {
    loading = true;
    error = null;

    try {
      const baseUrl = window.location.origin;
      const successUrl = `${baseUrl}/membership/pro-kitchen-checkout?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/membership/pro-kitchen-checkout?payment=canceled`;

      console.log('[Pro Kitchen Checkout] Creating Stripe session...');
      const response = await fetch('/api/stripe/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: 'pro',
          period: 'annual',
          successUrl,
          cancelUrl,
          customerEmail: undefined,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to create checkout session';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
          if (data.hint) {
            errorMessage += ` (${data.hint})`;
          }
        } catch (parseError) {
          const text = await response.text();
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
          console.error('[Pro Kitchen Checkout] Error response:', text);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('[Pro Kitchen Checkout] Session created, redirecting to Stripe...');
      
      if (!data.url) {
        throw new Error('No checkout URL returned from server');
      }

      window.location.href = data.url;
      
    } catch (err) {
      console.error('[Pro Kitchen Checkout] Error:', err);
      error = err instanceof Error ? err.message : 'Failed to start checkout. Please try again.';
      loading = false;
    }
  }

  async function proceedWithLightning() {
    if (!$userPublickey) {
      error = 'Please log in to continue';
      return;
    }

    loading = true;
    error = null;
    lightningInvoice = null;
    paymentHash = null;

    try {
      console.log('[Pro Kitchen Checkout] Creating Lightning invoice...');
      const response = await fetch('/api/membership/create-lightning-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pubkey: $userPublickey,
          tier: 'pro',
          period: 'annual',
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to create Lightning invoice';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('[Pro Kitchen Checkout] Lightning invoice created');
      
      lightningInvoice = data.invoice;
      paymentHash = data.paymentHash;

      await lightningService.launchPayment({
        invoice: data.invoice,
        verify: undefined,
        onPaid: async (response) => {
          console.log('[Pro Kitchen Checkout] Lightning payment completed, verifying...');
          await verifyLightningPayment(response.preimage || '');
        },
        onCancelled: () => {
          console.log('[Pro Kitchen Checkout] Lightning payment cancelled');
          loading = false;
          error = 'Payment cancelled';
        }
      });

    } catch (err) {
      console.error('[Pro Kitchen Checkout] Error:', err);
      error = err instanceof Error ? err.message : 'Failed to create Lightning invoice. Please try again.';
      loading = false;
    }
  }

  async function verifyLightningPayment(preimage: string) {
    if (!lightningInvoice || !paymentHash || !$userPublickey) {
      error = 'Missing payment information';
      loading = false;
      return;
    }

    try {
      console.log('[Pro Kitchen Checkout] Verifying Lightning payment...');
      const response = await fetch('/api/membership/verify-lightning-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentHash,
          invoice: lightningInvoice,
          pubkey: $userPublickey,
          tier: 'pro',
          period: 'annual',
          preimage,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to verify payment';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (data.success) {
        // Build success URL with NIP-05 info if available
        const params = new URLSearchParams({
          payment_method: 'lightning',
          tier: 'pro'
        });
        if (data.nip05) {
          params.set('nip05', data.nip05);
        }
        if (data.nip05Username) {
          params.set('nip05_username', data.nip05Username);
        }
        goto(`/membership/pro-kitchen-success?${params.toString()}`);
      } else {
        throw new Error('Payment verification failed');
      }

    } catch (err) {
      console.error('[Pro Kitchen Checkout] Verification error:', err);
      error = err instanceof Error ? err.message : 'Failed to verify payment. Please contact support.';
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Pro Kitchen Membership Checkout - zap.cooking</title>
</svelte:head>

<div class="checkout-page">
  <div class="checkout-container">
    <h1>Join Pro Kitchen</h1>
    
    {#if error}
      <div class="error-message">
        {error}
      </div>
    {/if}

    <div class="checkout-card">
      <div class="checkout-header">
        <h2>Pro Kitchen Membership</h2>
        <div class="checkout-price">
          <div class="popular-badge">Most Popular</div>
          <div class="price-container">
            <span class="price">$89</span>
            <span class="period">/year</span>
          </div>
        </div>
      </div>

      <div class="checkout-benefits">
        <h3>What you get:</h3>
        
        <!-- Includes All Cook+ Features -->
        <div class="benefit-section">
          <h4 class="section-header">Includes All Cook+ Features</h4>
          <ul class="benefit-list">
            <li>
              <span class="checkmark">✓</span>
              <span class="feature-text muted-text">Everything in Cook+ (Sous Chef, NIP-05 identity, pantry relay access, collections, badge, early access, voting)</span>
            </li>
          </ul>
        </div>

        <!-- Section Divider -->
        <div class="section-divider"></div>

        <!-- Pro Kitchen Exclusive Features -->
        <div class="benefit-section">
          <h4 class="section-header">Pro Kitchen Exclusive Features</h4>
          <ul class="benefit-list">
            <li>
              <span class="checkmark">✓</span>
              <span class="feature-text">Lightning-gated recipes</span>
            </li>
            <li>
              <span class="checkmark">✓</span>
              <span class="feature-text">Priority recipe promotion</span>
            </li>
            <li>
              <span class="checkmark">✓</span>
              <span class="feature-text">Access to sell on Marketplace (coming soon)</span>
            </li>
          </ul>
        </div>

        <!-- Section Divider -->
        <div class="section-divider"></div>

        <!-- Kitchen Tools -->
        <div class="benefit-section">
          <h4 class="section-header">Kitchen Tools</h4>
          <ul class="benefit-list">
            <li>
              <span class="feature-icon">🤖</span>
              <div class="feature-content">
                <span class="feature-text">Zappy - Kitchen assistant to scan your fridge, generate recipes, and recommend what to make tonight</span>
                <span class="feature-subtext">Your personal kitchen companion</span>
              </div>
            </li>
            <li>
              <span class="checkmark">✓</span>
              <span class="feature-text">Sous Chef features</span>
            </li>
          </ul>
        </div>

      </div>

      <!-- Payment Method Selection -->
      <div class="payment-method-selection">
        <h3>Choose Payment Method</h3>
        <div class="payment-methods">
          <label class="payment-method-option {paymentMethod === 'stripe' ? 'selected' : ''}">
            <input 
              type="radio" 
              name="paymentMethod" 
              value="stripe" 
              bind:group={paymentMethod}
              disabled={loading}
            />
            <div class="payment-method-content">
              <div class="payment-method-header">
                <span class="payment-icon">💳</span>
                <span class="payment-name">Credit Card</span>
              </div>
              <span class="payment-provider">via Stripe</span>
            </div>
          </label>

          <label class="payment-method-option {paymentMethod === 'lightning' ? 'selected' : ''}">
            <input 
              type="radio" 
              name="paymentMethod" 
              value="lightning" 
              bind:group={paymentMethod}
              disabled={loading}
            />
            <div class="payment-method-content">
              <div class="payment-method-header">
                <span class="payment-icon">⚡</span>
                <span class="payment-name">Bitcoin Lightning</span>
                <span class="discount-badge">{discountPercent}% OFF</span>
              </div>
              <div class="payment-provider bitcoin-pricing">
                {#if bitcoinPriceLoading}
                  <span class="loading-price">Loading price...</span>
                {:else if amountSats}
                  <span class="sats-amount">{amountSats.toLocaleString()} sats</span>
                  <span class="usd-pricing">
                    <span class="original-price">${PRO_KITCHEN_PRICE_USD}</span>
                    <span class="discounted-price">${discountedUsdAmount?.toFixed(2)}</span>
                  </span>
                {:else}
                  <span class="usd-pricing">
                    <span class="original-price">${PRO_KITCHEN_PRICE_USD}</span>
                    <span class="discounted-price">${discountedUsdAmount?.toFixed(2)}</span>
                  </span>
                {/if}
              </div>
            </div>
          </label>
        </div>
      </div>

      <button 
        class="checkout-button"
        on:click={proceedToCheckout}
        disabled={loading || !isLoggedIn}
      >
        {#if loading}
          {#if paymentMethod === 'lightning' && lightningInvoice}
            Waiting for payment...
          {:else}
            Processing...
          {/if}
        {:else if !isLoggedIn}
          Please log in first
        {:else if paymentMethod === 'stripe'}
          Proceed to Checkout
        {:else}
          Pay with Lightning
        {/if}
      </button>

      <p class="checkout-note">
        {#if paymentMethod === 'stripe'}
          🔒 Secure payment via Stripe
        {:else}
          ⚡ Instant payment via Bitcoin Lightning Network
        {/if}
      </p>
    </div>
  </div>
</div>

<style>
  .checkout-page {
    min-height: 80vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .checkout-container {
    max-width: 600px;
    width: 100%;
  }

  .checkout-container h1 {
    text-align: center;
    font-size: 2.5rem;
    font-weight: 900;
    margin-bottom: 2rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .error-message {
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    color: #ef4444;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .checkout-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid;
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 50%, #ff4500 100%) 1;
    border-radius: 16px;
    padding: 2.5rem;
    box-shadow: 
      0 8px 32px rgba(236, 71, 0, 0.15),
      0 0 0 1px rgba(236, 71, 0, 0.1);
  }

  .checkout-header {
    text-align: center;
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid rgba(236, 71, 0, 0.2);
  }

  .checkout-header h2 {
    font-size: 1.75rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0 0 1rem 0;
  }

  .checkout-price {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .popular-badge {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, var(--color-primary), #ff6b00);
    color: white;
    padding: 0.25rem 1rem;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .price-container {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .price-container .price {
    font-size: 3rem;
    font-weight: 900;
    color: var(--color-primary);
  }

  .price-container .period {
    font-size: 1.2rem;
    color: #9ca3af;
  }

  .checkout-benefits {
    margin-bottom: 2rem;
  }

  .checkout-benefits h3 {
    font-size: 1.2rem;
    font-weight: 600;
    color: #f3f4f6;
    margin: 0 0 1.5rem 0;
  }

  .benefit-section {
    margin-bottom: 1.5rem;
  }

  .benefit-section:last-of-type {
    margin-bottom: 0;
  }

  .section-header {
    font-size: 1rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.875rem;
  }

  .section-divider {
    height: 1px;
    background: rgba(236, 71, 0, 0.15);
    margin: 1.5rem 0;
  }

  .benefit-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .benefit-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    color: #d1d5db;
    font-size: 1rem;
  }

  .checkmark {
    color: #22c55e;
    font-weight: bold;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .feature-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .feature-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .feature-text {
    color: #d1d5db;
    line-height: 1.5;
  }

  .muted-text {
    color: #9ca3af;
    opacity: 0.8;
  }

  .feature-subtext {
    color: #9ca3af;
    font-size: 0.875rem;
    font-style: italic;
  }

  /* Payment Method Selection */
  .payment-method-selection {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: rgba(236, 71, 0, 0.05);
    border-radius: 12px;
    border: 1px solid rgba(236, 71, 0, 0.2);
  }

  .payment-method-selection h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f3f4f6;
    margin: 0 0 1rem 0;
  }

  .payment-methods {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .payment-method-option {
    display: flex;
    align-items: center;
    padding: 1rem;
    background: rgba(17, 24, 39, 0.6);
    border: 2px solid rgba(236, 71, 0, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .payment-method-option:hover:not(:has(input:disabled)) {
    border-color: rgba(236, 71, 0, 0.4);
    background: rgba(17, 24, 39, 0.8);
  }

  .payment-method-option.selected {
    border-color: var(--color-primary);
    background: rgba(236, 71, 0, 0.1);
  }

  .payment-method-option input[type="radio"] {
    margin-right: 1rem;
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .payment-method-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .payment-method-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .payment-icon {
    font-size: 1.5rem;
  }

  .payment-name {
    font-size: 1rem;
    font-weight: 600;
    color: #f3f4f6;
  }

  .payment-provider {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-left: 2.25rem;
  }

  .bitcoin-pricing {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .sats-amount {
    font-weight: 600;
    color: #f59e0b;
    font-size: 0.95rem;
  }

  .usd-pricing {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .original-price {
    text-decoration: line-through;
    color: #6b7280;
    font-size: 0.85rem;
  }

  .discounted-price {
    color: #10b981;
    font-weight: 600;
    font-size: 0.9rem;
  }

  .discount-badge {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    font-size: 0.65rem;
    font-weight: 700;
    margin-left: auto;
  }

  .loading-price {
    color: #9ca3af;
    font-style: italic;
  }

  .payment-method-option:has(input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkout-button {
    width: 100%;
    padding: 1.25rem 2rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.3);
    margin-bottom: 1rem;
  }

  .checkout-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(236, 71, 0, 0.4);
    background: linear-gradient(135deg, #ff5722 0%, #ff8c42 100%);
  }

  .checkout-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkout-note {
    text-align: center;
    color: #9ca3af;
    font-size: 0.9rem;
    margin: 0;
  }

  html.dark .checkout-card {
    background: rgba(31, 41, 55, 0.7);
  }

  html.dark .payment-method-selection {
    background: rgba(255, 87, 34, 0.08);
    border-color: rgba(255, 87, 34, 0.2);
  }

  html.dark .payment-method-option {
    background: rgba(31, 41, 55, 0.7);
  }

  html.dark .payment-method-option.selected {
    background: rgba(255, 87, 34, 0.15);
  }
</style>
