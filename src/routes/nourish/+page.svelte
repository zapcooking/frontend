<script lang="ts">
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { getScanResult, setScanResult } from '$lib/nourish/cache';
  import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
  import { ingredientStore } from '$lib/nourish/ingredientStore';
  import type { ScanResponse } from '$lib/nourish/types';
  import NourishInputTabs from '../../components/nourish/NourishInputTabs.svelte';
  import NourishResult from '../../components/nourish/NourishResult.svelte';
  import Button from '../../components/Button.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';

  // Membership check
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => { membershipMap = v; });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '').trim().toLowerCase();
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  // Input state (bound to NourishInputTabs)
  let scanText = '';
  let imageData: string | null = null;
  let activeTab: 'ingredients' | 'describe' | 'photo' = 'ingredients';

  // Analysis state
  let scanning = false;
  let scanError = '';
  let scanResult: ScanResponse | null = null;
  let improvements: string[] = [];

  $: hasInput = scanText.trim().length > 0 || imageData !== null;

  async function handleAnalyze() {
    const text = scanText.trim();

    if (!text && !imageData) {
      scanError = 'Add some ingredients, describe a dish, or upload a photo.';
      return;
    }

    // Check scan cache (text-only, not images)
    if (text && !imageData) {
      const cached = getScanResult(text);
      if (cached?.scores) {
        scanResult = cached;
        buildImprovements(cached);
        return;
      }
    }

    scanning = true;
    scanError = '';

    try {
      const body: any = {
        pubkey: $userPublickey || '',
        text: text || 'Analyze this food image'
      };

      if (imageData) {
        body.imageData = imageData;
      }

      const res = await fetch('/api/nourish/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data: ScanResponse = await res.json();

      if (!data.success) {
        scanError = data.error || "Couldn't analyze this one. Try again or rephrase.";
        return;
      }

      scanResult = data;
      buildImprovements(data);

      // Cache text-based results (not image-based — different images same text)
      if (text && !imageData) {
        setScanResult(text, data);
      }

      // Save ingredient signals to build dataset over time
      if (data.ingredient_signals?.length) {
        ingredientStore.saveIngredients(data.ingredient_signals, 'scan').catch(() => {});
      }
    } catch {
      scanError = "Couldn't analyze this one. Try again or rephrase.";
    } finally {
      scanning = false;
    }
  }

  function buildImprovements(data: ScanResponse) {
    if (!data.scores) return;
    improvements = mergeImprovements(
      generateSuggestions(data.scores),
      data.improvements || []
    );
  }

  function resetScan() {
    scanResult = null;
    improvements = [];
    scanError = '';
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => { unsubMembership(); });
</script>

<svelte:head>
  <title>Nourish | Zap Cooking</title>
</svelte:head>

<div class="nourish-page">
  <!-- Hero -->
  <div class="hero">
    <div class="hero-icon">
      <LeafIcon size={24} weight="fill" />
    </div>
    <h1 class="hero-title">Nourish</h1>
    <p class="hero-subtitle">See what your food brings to the table.</p>
    <p class="hero-note">Not a grade. Just guidance.</p>
  </div>

  {#if !hasMembership && !scanResult}
    <!-- Lock state -->
    <div class="lock-card">
      <LockIcon size={22} weight="fill" class="text-orange-500" />
      <div class="lock-content">
        <p class="lock-title">Members Only</p>
        <p class="lock-desc">Explore what your meals are made of with instant Nourish profiles.</p>
      </div>
      <a href="/membership"><Button primary>Join</Button></a>
    </div>

  {:else if scanResult?.scores}
    <!-- Results -->
    <NourishResult
      scores={scanResult.scores}
      quickTake={scanResult.quick_take || ''}
      {improvements}
      ingredientSignals={scanResult.ingredient_signals || []}
      onReset={resetScan}
    />

  {:else}
    <!-- Input -->
    <NourishInputTabs
      bind:text={scanText}
      bind:imageData
      bind:activeTab
      disabled={scanning}
    />

    {#if scanError}
      <p class="error-text">{scanError}</p>
    {/if}

    <!-- CTA -->
    <button
      class="analyze-btn"
      on:click={handleAnalyze}
      disabled={scanning || !hasInput}
    >
      {#if scanning}
        <SpinnerIcon size={18} class="animate-spin" />
        Looking at your food...
      {:else}
        <LeafIcon size={18} weight="fill" />
        See what's inside
      {/if}
    </button>
  {/if}

  <!-- Footer -->
  <div class="page-footer">
    <p>
      Nourish is for <a href="/membership" class="footer-link">Zap Cooking members</a>.
      Profiles are estimates based on ingredients. Not medical advice.
    </p>
  </div>
</div>

<style>
  .nourish-page {
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Hero */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.25rem;
  }
  .hero-icon {
    color: #22c55e;
    margin-bottom: 0.25rem;
  }
  .hero-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0;
  }
  .hero-subtitle {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .hero-note {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
    margin: 0;
  }

  /* Lock */
  .lock-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 2rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .lock-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .lock-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }
  .lock-desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Error */
  .error-text {
    font-size: 0.8125rem;
    color: #ef4444;
    text-align: center;
    margin: 0;
  }

  /* CTA button */
  .analyze-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem 1.5rem;
    border-radius: 0.625rem;
    border: none;
    background: #22c55e;
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 150ms, opacity 150ms;
  }
  .analyze-btn:hover:not(:disabled) {
    background: #16a34a;
  }
  .analyze-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Footer */
  .page-footer {
    text-align: center;
    padding-top: 1rem;
  }
  .page-footer p {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
    margin: 0;
  }
  .footer-link {
    color: #22c55e;
    text-decoration: none;
  }
  .footer-link:hover {
    text-decoration: underline;
  }
</style>
