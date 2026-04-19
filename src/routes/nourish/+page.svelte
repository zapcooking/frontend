<script lang="ts">
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
  import { ingredientStore } from '$lib/nourish/ingredientStore';
  import type { ScanResponse } from '$lib/nourish/types';
  import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
  import { computeContentHash } from '$lib/nourish/nourishRelay';
  import type { FlagTarget } from '$lib/nourish/flagSubmit';
  import NourishInputTabs from '../../components/nourish/NourishInputTabs.svelte';
  import NourishResult from '../../components/nourish/NourishResult.svelte';
  import Button from '../../components/Button.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';

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

  // Flag target — text scans can be referenced by content hash. Image-only
  // scans don't have a stable identifier, so the flag affordance is
  // suppressed there.
  //
  // `computeContentHash` is async, and `scanText` can change before a
  // prior hash resolves. The request-seq guard + text re-check discard
  // any resolution that's no longer current — otherwise a slow earlier
  // hash would overwrite a fast newer one with a stale value.
  let flagTarget: FlagTarget | null = null;
  let flagTargetRequestSeq = 0;
  $: updateFlagTarget(scanResult, scanText);
  async function updateFlagTarget(_result: ScanResponse | null, text: string) {
    const trimmed = text.trim();
    const seq = ++flagTargetRequestSeq;

    if (!_result?.scores || !trimmed) {
      flagTarget = null;
      return;
    }

    const hash = await computeContentHash(trimmed);
    // If a newer request started while we were hashing, or the text has
    // changed, drop this result.
    if (seq !== flagTargetRequestSeq || trimmed !== scanText.trim()) return;
    flagTarget = { kind: 'scan', contentHash: hash };
  }

  $: hasInput = scanText.trim().length > 0 || imageData !== null;

  async function handleAnalyze() {
    const text = scanText.trim();

    if (!text && !imageData) {
      scanError = 'Add some ingredients, describe a dish, or upload a photo.';
      return;
    }

    // Scan results are no longer cached locally (PR 3 commit 6).
    // Scans are per-user and often personal; cross-user caching via a
    // weak text hash was a privacy + staleness risk. Every scan now
    // fires a fresh compute.
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

      // Save ingredient signals to build dataset over time
      if (data.ingredient_signals?.length) {
        ingredientStore
          .saveIngredients(data.ingredient_signals, 'scan', undefined, data.promptVersion)
          .catch(() => {});
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
    <p class="hero-subtitle">Get nutrition insights from your ingredients.</p>
    <p class="hero-note">Not a grade. Just guidance.</p>
    <a href="/nourish/explore" class="explore-link">
      Browse analyzed recipes
    </a>
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
      {flagTarget}
      promptVersion={scanResult.promptVersion ?? NOURISH_PROMPT_VERSION}
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
        <SparkleIcon size={18} weight="fill" />
        See what's inside
      {/if}
    </button>
  {/if}

  <!-- Member banner + disclaimer -->
  {#if !hasMembership}
    <div class="member-banner">
      <LockIcon size={14} weight="fill" />
      <span>Nourish is for <a href="/membership" class="banner-link">Zap Cooking members</a>.</span>
      <a href="/membership" class="banner-cta">Join</a>
    </div>
  {/if}
  <div class="page-footer">
    <p>Profiles are estimates based on ingredients. Not medical advice.</p>
  </div>
</div>

<style>
  .nourish-page {
    max-width: 480px;
    margin: 0 auto;
    padding: 1.5rem 1rem 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Hero — tighter spacing */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.125rem;
  }
  .hero-icon {
    color: #22c55e;
    margin-bottom: 0.125rem;
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
  .explore-link {
    font-size: 0.75rem;
    font-weight: 500;
    color: #22c55e;
    text-decoration: none;
    margin-top: 0.25rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid rgba(34, 197, 94, 0.2);
    transition: background 150ms, border-color 150ms;
  }
  .explore-link:hover {
    background: rgba(34, 197, 94, 0.08);
    border-color: rgba(34, 197, 94, 0.35);
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

  /* Member banner */
  .member-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }
  .banner-link {
    color: #22c55e;
    text-decoration: none;
  }
  .banner-link:hover {
    text-decoration: underline;
  }
  .banner-cta {
    margin-left: auto;
    font-size: 0.75rem;
    font-weight: 600;
    color: #22c55e;
    text-decoration: none;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid rgba(34, 197, 94, 0.3);
    transition: background 150ms;
    white-space: nowrap;
  }
  .banner-cta:hover {
    background: rgba(34, 197, 94, 0.1);
  }

  /* Footer */
  .page-footer {
    text-align: center;
    padding-top: 0.5rem;
  }
  .page-footer p {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.4;
    margin: 0;
  }
</style>
