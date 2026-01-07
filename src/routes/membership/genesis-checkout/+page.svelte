<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import { page } from '$app/stores';

  let loading = false;
  let error: string | null = null;

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
          customerEmail: undefined, // Can add email collection if needed
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
          <li>✓ Genesis Founder badge (#1-21)</li>
          <li>✓ Access to both members.zap.cooking and pro.zap.cooking relays</li>
          <li>✓ Name permanently displayed as a Genesis Founder</li>
          <li>✓ All future Pro Kitchen features included</li>
        </ul>
      </div>

      <button 
        class="checkout-button"
        on:click={proceedToCheckout}
        disabled={loading || !isLoggedIn}
      >
        {#if loading}
          Processing...
        {:else if !isLoggedIn}
          Please log in first
        {:else}
          Proceed to Checkout
        {/if}
      </button>

      <p class="checkout-note">
        🔒 Secure payment via Stripe
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

  html.dark .checkout-card {
    background: rgba(31, 41, 55, 0.7);
  }
</style>

