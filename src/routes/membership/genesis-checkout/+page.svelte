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

  // Genesis pricing: $210 = ~210,000 sats
  const GENESIS_PRICE_USD = 210;
  const GENESIS_PRICE_SATS = 210000;

  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;

  onMount(() => {
    if (!browser) return;
    
    // Redirect to login if not logged in
    if (!isLoggedIn) {
      goto('/login?redirect=/membership/genesis-checkout');
    }

    // Check for payment success
    const paymentStatus = $page.url.searchParams.get('payment');
    const sessionId = $page.url.searchParams.get('session_id');
    
    if (paymentStatus === 'success' && sessionId) {
      // Redirect to success page
      goto(`/membership/genesis-success?session_id=${sessionId}`);
    }
  });

  async function proceedToCheckout() {
    if (!browser || !isLoggedIn) return;
    
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
      const successUrl = `${baseUrl}/membership/genesis-checkout?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/membership/genesis-checkout?payment=canceled`;

      const response = await fetch('/api/stripe/create-genesis-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          successUrl,
          cancelUrl,
          customerEmail: undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const { url } = await response.json();
      
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      error = err instanceof Error ? err.message : 'Failed to start checkout';
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
      console.log('[Genesis Checkout] Creating Lightning invoice...');
      const response = await fetch('/api/genesis/create-lightning-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pubkey: $userPublickey,
          amountSats: GENESIS_PRICE_SATS,
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
      console.log('[Genesis Checkout] Lightning invoice created');
      
      lightningInvoice = data.invoice;
      paymentHash = data.paymentHash;

      await lightningService.launchPayment({
        invoice: data.invoice,
        verify: undefined,
        onPaid: async (response) => {
          console.log('[Genesis Checkout] Lightning payment completed, verifying...');
          await verifyLightningPayment(response.preimage || '');
        },
        onCancelled: () => {
          console.log('[Genesis Checkout] Lightning payment cancelled');
          loading = false;
          error = 'Payment cancelled';
        }
      });

    } catch (err) {
      console.error('[Genesis Checkout] Error:', err);
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
      console.log('[Genesis Checkout] Verifying Lightning payment...');
      const response = await fetch('/api/genesis/verify-lightning-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentHash,
          invoice: lightningInvoice,
          pubkey: $userPublickey,
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
      
      if (data.verified) {
        // Build success URL with NIP-05 info if available
        const params = new URLSearchParams({
          payment_method: 'lightning',
          founder_number: data.founderNumber?.toString() || ''
        });
        if (data.nip05) {
          params.set('nip05', data.nip05);
        }
        if (data.nip05Username) {
          params.set('nip05_username', data.nip05Username);
        }
        goto(`/membership/genesis-success?${params.toString()}`);
      } else {
        throw new Error('Payment verification failed');
      }

    } catch (err) {
      console.error('[Genesis Checkout] Verification error:', err);
      error = err instanceof Error ? err.message : 'Failed to verify payment. Please contact support.';
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Genesis Founder Checkout - zap.cooking</title>
</svelte:head>

<div class="checkout-page">
  <div class="checkout-container">
    <h1>Become a Genesis Founder</h1>
    
    {#if error}
      <div class="error-message">
        {error}
      </div>
    {/if}

    <div class="checkout-card">
      <div class="checkout-header">
        <h2>Genesis Founder Membership</h2>
        <div class="checkout-price">
          <span class="price">$210</span>
          <span class="period">lifetime</span>
        </div>
      </div>

      <div class="checkout-benefits">
        <h3>What you get:</h3>
        <ul>
          <li>✓ Lifetime Pro Kitchen membership (never expires)</li>
          <li>✓ Verified @zap.cooking NIP-05 identity</li>
          <li>✓ Genesis Founder badge (#1-21)</li>
          <li>✓ Access to both pantry.zap.cooking and pro.zap.cooking relays</li>
          <li>✓ Name permanently displayed as a Genesis Founder</li>
          <li>✓ All future Pro Kitchen features included</li>
        </ul>
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
              </div>
              <span class="payment-provider">{GENESIS_PRICE_SATS.toLocaleString()} sats (~${GENESIS_PRICE_USD})</span>
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
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
  }

  .checkout-price .price {
    font-size: 3rem;
    font-weight: 900;
    color: var(--color-primary);
  }

  .checkout-price .period {
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
    margin: 0 0 1rem 0;
  }

  .checkout-benefits ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .checkout-benefits li {
    padding: 0.75rem 0;
    color: #d1d5db;
    font-size: 1rem;
    border-bottom: 1px solid rgba(236, 71, 0, 0.1);
  }

  .checkout-benefits li:last-child {
    border-bottom: none;
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

  .payment-method-option:has(input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
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

