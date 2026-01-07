<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey } from '$lib/nostr';

  let loading = true;
  let founderNumber: number | null = null;
  let error: string | null = null;

  onMount(async () => {
    if (!browser) return;
    
    const sessionId = $page.url.searchParams.get('session_id');
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
      // Verify payment and register member
      const response = await fetch('/api/genesis/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          pubkey: $userPublickey,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete payment');
      }

      const data = await response.json();
      founderNumber = data.founderNumber;
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
</script>

<svelte:head>
  <title>Welcome, Genesis Founder! - zap.cooking</title>
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
    {:else if founderNumber}
      <div class="success-state">
        <div class="success-icon">🎉</div>
        <h1>Welcome, Genesis Founder #{founderNumber}!</h1>
        <p class="success-message">
          Your lifetime membership is now active. Thank you for being one of the first 21 founders!
        </p>
        
        <div class="founder-badge">
          <div class="badge-number">#{founderNumber}</div>
          <div class="badge-text">Genesis Founder</div>
        </div>

        <div class="success-benefits">
          <h2>Your membership includes:</h2>
          <ul>
            <li>✓ Lifetime Pro Kitchen access</li>
            <li>✓ Genesis Founder badge</li>
            <li>✓ Access to members.zap.cooking and pro.zap.cooking relays</li>
            <li>✓ Your name permanently displayed as a Genesis Founder</li>
            <li>✓ All future Pro Kitchen features</li>
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

  .founder-badge {
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 100%);
    border-radius: 16px;
    padding: 2rem;
    margin: 2rem auto;
    max-width: 300px;
    box-shadow: 0 8px 32px rgba(236, 71, 0, 0.3);
  }

  .badge-number {
    font-size: 4rem;
    font-weight: 900;
    color: white;
    margin-bottom: 0.5rem;
  }

  .badge-text {
    font-size: 1.5rem;
    font-weight: 700;
    color: white;
    text-transform: uppercase;
    letter-spacing: 2px;
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

  html.dark .success-benefits {
    background: rgba(31, 41, 55, 0.7);
  }
</style>

