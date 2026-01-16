<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey, ndk } from '$lib/nostr';
  import { updateProfileWithNip05 } from '$lib/nip05Service';
  import Nip05ClaimModal from '../../../components/Nip05ClaimModal.svelte';

  let loading = true;
  let founderNumber: number | null = null;
  let error: string | null = null;
  let paymentMethod: string | null = null;
  
  // NIP-05 state
  let nip05: string | null = null;
  let nip05Username: string | null = null;
  let showNip05Modal = false;
  let nip05UpdateStatus: 'pending' | 'updating' | 'success' | 'error' = 'pending';
  let nip05Error: string | null = null;

  onMount(async () => {
    if (!browser) return;
    
    const sessionId = $page.url.searchParams.get('session_id');
    paymentMethod = $page.url.searchParams.get('payment_method');
    const nip05Param = $page.url.searchParams.get('nip05');
    const nip05UsernameParam = $page.url.searchParams.get('nip05_username');
    const founderParam = $page.url.searchParams.get('founder_number');
    
    // If coming from Lightning payment, data might be in URL
    if (paymentMethod === 'lightning') {
      nip05 = nip05Param;
      nip05Username = nip05UsernameParam;
      founderNumber = founderParam ? parseInt(founderParam, 10) : null;
      loading = false;
      
      // Auto-update profile with NIP-05 if available
      if (nip05 && $userPublickey) {
        autoUpdateProfileNip05(nip05);
      }
      return;
    }
    
    // Stripe flow - need session_id
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

      const responseText = await response.text();
      
      if (!response.ok) {
        let errorMessage = `Failed to complete payment (${response.status} ${response.statusText})`;
        try {
          const data = JSON.parse(responseText);
          errorMessage = data.error || errorMessage;
          console.error('[Genesis Success] Error response:', data);
        } catch (parseError) {
          console.error('[Genesis Success] Error response (text):', responseText);
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = JSON.parse(responseText);
      founderNumber = data.founderNumber;
      nip05 = data.nip05;
      nip05Username = data.nip05Username;
      loading = false;
      
      // Auto-update profile with NIP-05 if available
      if (nip05 && $userPublickey) {
        autoUpdateProfileNip05(nip05);
      }
    } catch (err) {
      console.error('Payment completion error:', err);
      error = err instanceof Error ? err.message : 'Failed to complete payment';
      loading = false;
    }
  });

  async function autoUpdateProfileNip05(nip05Address: string) {
    if (!$userPublickey || !$ndk) return;
    
    nip05UpdateStatus = 'updating';
    try {
      const success = await updateProfileWithNip05($ndk, $userPublickey, nip05Address);
      if (success) {
        nip05UpdateStatus = 'success';
        console.log('[Genesis Success] Profile updated with NIP-05:', nip05Address);
      } else {
        nip05UpdateStatus = 'error';
        nip05Error = 'Could not update profile automatically. You can add it manually in settings.';
      }
    } catch (err) {
      console.error('[Genesis Success] Failed to update profile with NIP-05:', err);
      nip05UpdateStatus = 'error';
      nip05Error = 'Could not update profile automatically. You can add it manually in settings.';
    }
  }

  function goToMembership() {
    goto('/membership');
  }

  function handleNip05Claimed(event: CustomEvent) {
    showNip05Modal = false;
    nip05 = event.detail.nip05;
    nip05UpdateStatus = 'success';
  }

  function handleNip05Skipped() {
    showNip05Modal = false;
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

        <!-- NIP-05 Verification Badge Section -->
        {#if nip05}
          <div class="nip05-badge-section">
            <div class="nip05-badge">
              <div class="badge-icon">✓</div>
              <div class="badge-content">
                <span class="badge-label">Verified Identity</span>
                <span class="badge-value">{nip05}</span>
              </div>
            </div>
            {#if nip05UpdateStatus === 'updating'}
              <p class="nip05-status updating">Updating your profile...</p>
            {:else if nip05UpdateStatus === 'success'}
              <p class="nip05-status success">✓ Your profile has been updated with your verified identity</p>
            {:else if nip05UpdateStatus === 'error'}
              <p class="nip05-status error">{nip05Error}</p>
            {/if}
            <button 
              type="button"
              class="change-username-button"
              on:click={() => showNip05Modal = true}
            >
              Change Username
            </button>
          </div>
        {:else}
          <div class="nip05-claim-section">
            <p class="nip05-claim-text">
              Claim your verified <strong>@zap.cooking</strong> identity
            </p>
            <button 
              type="button"
              class="claim-nip05-button"
              on:click={() => showNip05Modal = true}
            >
              Claim NIP-05 Identity
            </button>
          </div>
        {/if}

        <div class="success-benefits">
          <h2>Your membership includes:</h2>
          <ul>
            <li>✓ Lifetime Pro Kitchen access</li>
            <li>✓ Verified @zap.cooking NIP-05 identity</li>
            <li>✓ Genesis Founder badge</li>
            <li>✓ Access to pantry.zap.cooking and pro.zap.cooking relays</li>
            <li>✓ Your name permanently displayed as a Genesis Founder</li>
            <li>✓ All future Pro Kitchen features</li>
          </ul>
        </div>

        <button class="continue-button" on:click={goToMembership}>
          Continue to Membership
        </button>
      </div>
    {/if}

    <!-- NIP-05 Claim Modal -->
    {#if $userPublickey}
      <Nip05ClaimModal
        bind:open={showNip05Modal}
        pubkey={$userPublickey}
        tier="pro"
        currentNip05={nip05}
        on:claimed={handleNip05Claimed}
        on:skipped={handleNip05Skipped}
      />
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

  /* NIP-05 Badge Section */
  .nip05-badge-section {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%);
    border: 2px solid rgba(34, 197, 94, 0.4);
    border-radius: 16px;
    padding: 1.5rem;
    margin: 1.5rem 0;
    text-align: center;
  }

  .nip05-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    background: rgba(34, 197, 94, 0.2);
    border-radius: 50px;
    padding: 0.75rem 1.5rem;
    margin-bottom: 1rem;
  }

  .nip05-badge .badge-icon {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, #22c55e, #10b981);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    font-size: 1rem;
  }

  .nip05-badge .badge-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .nip05-badge .badge-label {
    font-size: 0.75rem;
    color: #22c55e;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .nip05-badge .badge-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: #f3f4f6;
  }

  .nip05-status {
    font-size: 0.9rem;
    margin: 0.5rem 0;
  }

  .nip05-status.updating {
    color: #fbbf24;
  }

  .nip05-status.success {
    color: #22c55e;
  }

  .nip05-status.error {
    color: #ef4444;
  }

  .change-username-button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid rgba(34, 197, 94, 0.5);
    border-radius: 8px;
    color: #22c55e;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .change-username-button:hover {
    background: rgba(34, 197, 94, 0.1);
    border-color: #22c55e;
  }

  /* NIP-05 Claim Section (when no auto-claim happened) */
  .nip05-claim-section {
    background: rgba(59, 130, 246, 0.1);
    border: 2px solid rgba(59, 130, 246, 0.3);
    border-radius: 16px;
    padding: 1.5rem;
    margin: 1.5rem 0;
    text-align: center;
  }

  .nip05-claim-text {
    color: #d1d5db;
    margin: 0 0 1rem 0;
    font-size: 1rem;
  }

  .nip05-claim-text strong {
    color: #60a5fa;
  }

  .claim-nip05-button {
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .claim-nip05-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
  }
</style>

