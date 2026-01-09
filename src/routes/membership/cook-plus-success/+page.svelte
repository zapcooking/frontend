<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey } from '$lib/nostr';

  let loading = true;
  let subscriptionEnd: string | null = null;
  let error: string | null = null;
  let paymentMethod: string | null = null;

  onMount(async () => {
    if (!browser) return;
    
    const paymentMethodParam = $page.url.searchParams.get('payment_method');
    const sessionId = $page.url.searchParams.get('session_id');

    paymentMethod = paymentMethodParam || 'stripe';

    // If coming from Lightning payment, subscription info might be in URL or we need to verify
    if (paymentMethod === 'lightning') {
      // For Lightning, membership should already be activated
      // Just show success
      loading = false;
      return;
    }

    // Otherwise, verify Stripe payment
    if (!sessionId) {
      error = 'No session ID provided';
      loading = false;
      return;
    }

    if (!$userPublickey) {
      error = 'User not logged in';
      loading = false;
      return;
    }

    try {
      const response = await fetch('/api/membership/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          pubkey: $userPublickey,
        }),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        let errorMessage = `Failed to complete payment (${response.status} ${response.statusText})`;
        try {
          const data = JSON.parse(responseText);
          errorMessage = data.error || errorMessage;
          console.error('[Cook+ Success] Error response:', data);
        } catch (parseError) {
          console.error('[Cook+ Success] Error response (text):', responseText);
        }
        throw new Error(errorMessage);
      }

      const data = JSON.parse(responseText);
      subscriptionEnd = data.subscriptionEnd;
      loading = false;
    } catch (err) {
      console.error('Payment completion error:', err);
      error = err instanceof Error ? err.message : 'Failed to complete payment';
      loading = false;
    }
  });

  function goToMembership() {
    goto('/membership');
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
</script>

<svelte:head>
  <title>Welcome to Cook+! - zap.cooking</title>
</svelte:head>

<div class="success-page">
  <div class="success-container">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Completing your membership...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <h1>❌ Error</h1>
        <p>{error}</p>
        <button class="back-button" on:click={goToMembership}>
          Back to Membership
        </button>
      </div>
    {:else}
      <div class="success-state">
        <div class="success-icon">🎉</div>
        <h1>Welcome to Cook+!</h1>
        <p class="success-message">
          Your Cook+ membership is now active.
        </p>
        
        {#if subscriptionEnd}
          <div class="subscription-info">
            <p class="subscription-date">
              Your membership is active until <strong>{formatDate(subscriptionEnd)}</strong>
            </p>
          </div>
        {/if}

        <div class="success-benefits">
          <h2>Your membership includes:</h2>
          <ul>
            <li>✓ Custom Lightning address (you@zap.cooking)</li>
            <li>✓ Access to members.zap.cooking relay</li>
            <li>✓ Recipe collections</li>
            <li>✓ Member badge</li>
            <li>✓ Vote on features</li>
          </ul>
        </div>

        <button class="continue-button" on:click={goToMembership}>
          Continue to Membership
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .success-page {
    min-height: 80vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .success-container {
    max-width: 600px;
    width: 100%;
    text-align: center;
  }

  .loading-state {
    padding: 3rem;
  }

  .spinner {
    width: 60px;
    height: 60px;
    border: 4px solid rgba(236, 71, 0, 0.2);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    padding: 2rem;
  }

  .error-state h1 {
    font-size: 2rem;
    color: #ef4444;
    margin-bottom: 1rem;
  }

  .success-state {
    padding: 2rem;
  }

  .success-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .success-state h1 {
    font-size: 2.5rem;
    font-weight: 900;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 1rem;
  }

  .success-message {
    font-size: 1.2rem;
    color: #9ca3af;
    margin-bottom: 2rem;
  }

  .subscription-info {
    background: rgba(236, 71, 0, 0.1);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 2rem;
  }

  .subscription-date {
    margin: 0;
    color: #1f2937;
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5;
  }

  html.dark .subscription-date {
    color: #f3f4f6;
  }

  .subscription-date strong {
    color: var(--color-primary);
    font-weight: 700;
  }

  .success-benefits {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    border-radius: 16px;
    padding: 2rem;
    margin: 2rem 0;
    text-align: left;
  }

  .success-benefits h2 {
    font-size: 1.5rem;
    color: #f3f4f6;
    margin-bottom: 1rem;
    text-align: center;
  }

  .success-benefits ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .success-benefits li {
    padding: 0.75rem 0;
    color: #d1d5db;
    font-size: 1rem;
    border-bottom: 1px solid rgba(236, 71, 0, 0.1);
  }

  .success-benefits li:last-child {
    border-bottom: none;
  }

  .continue-button,
  .back-button {
    padding: 1rem 2rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.3);
    margin-top: 1rem;
  }

  .continue-button:hover,
  .back-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(236, 71, 0, 0.4);
  }

</style>

