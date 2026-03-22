<script lang="ts">
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { getScanResult, setScanResult } from '$lib/nourish/cache';
  import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
  import { ingredientStore } from '$lib/nourish/ingredientStore';
  import type { ScanResponse } from '$lib/nourish/types';
  import NourishScoreCard from '../../components/nourish/NourishScoreCard.svelte';
  import Button from '../../components/Button.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import { clickOutside } from '$lib/clickOutside';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
  import XCircleIcon from 'phosphor-svelte/lib/XCircle';

  // Membership check
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => { membershipMap = v; });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '').trim().toLowerCase();
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  // Scan state
  let scanText = '';
  let scanning = false;
  let scanError = '';
  let scanResult: ScanResponse | null = null;
  let improvements: string[] = [];
  let imageData: string | null = null;
  let imagePreview: string | null = null;
  let fileInput: HTMLInputElement;
  let cameraInput: HTMLInputElement;
  let showPhotoMenu = false;

  const SCORE_COLORS = { gut: '#22c55e', protein: '#3b82f6', realFood: '#f97316' };

  const EXAMPLES = [
    'Greek yogurt, berries, walnuts, chia seeds',
    'Chipotle bowl with rice, beans, chicken, salsa',
    'Eggs, sourdough toast, avocado'
  ];

  function useExample(text: string) {
    scanText = text;
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files?.length) return;
    const file = target.files[0];
    if (!file.type.startsWith('image/')) {
      scanError = 'Please upload an image file (JPG, PNG, WEBP, or GIF)';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      scanError = 'Image is too large. Please use an image under 20MB.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { imageData = reader.result as string; imagePreview = imageData; scanError = ''; };
    reader.onerror = () => { scanError = 'Failed to read image'; };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    imageData = null;
    imagePreview = null;
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
  }

  function togglePhotoMenu() { showPhotoMenu = !showPhotoMenu; }
  function openCamera() { showPhotoMenu = false; cameraInput?.click(); }
  function openFilePicker() { showPhotoMenu = false; fileInput?.click(); }

  async function handleScan() {
    const text = scanText.trim();
    const hasText = text.length >= 3;
    const hasImage = !!imageData;
    if (!hasText && !hasImage) { scanError = 'Please enter some text or upload an image to analyze.'; return; }

    if (hasText && !hasImage) {
      const cached = getScanResult(text);
      if (cached && cached.scores) {
        scanResult = cached;
        improvements = mergeImprovements(generateSuggestions(cached.scores), cached.improvements || []);
        return;
      }
    }

    scanning = true;
    scanError = '';
    try {
      const requestBody: any = { pubkey: $userPublickey || '', text: hasText ? text : '', title: '' };
      if (hasImage) requestBody.imageData = imageData;

      const res = await fetch('/api/nourish/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data: ScanResponse = await res.json();
      if (!data.success) { scanError = data.error || 'Failed to analyze. Please try again.'; return; }

      scanResult = data;
      if (hasText) { setScanResult(text, data); }
      if (data.scores) { improvements = mergeImprovements(generateSuggestions(data.scores), data.improvements || []); }
      if (data.ingredient_signals?.length) { ingredientStore.saveIngredients(data.ingredient_signals, 'scan').catch(() => {}); }
    } catch { scanError = 'Could not connect. Please try again.'; }
    finally { scanning = false; }
  }

  function resetScan() {
    scanResult = null;
    improvements = [];
    scanError = '';
    removeImage();
    scanText = '';
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => { unsubMembership(); });
</script>

<svelte:head>
  <title>Nourish — Recipe Intelligence - zap.cooking</title>
  <meta name="description" content="Analyze any food with three simple signals: Real Food, Gut, and Protein." />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <a href="/community" class="back-link">
    <ArrowLeftIcon size={16} />
    Back
  </a>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- HERO -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div class="hero">
    <div class="hero-title-row">
      <LeafIcon size={28} weight="fill" class="text-green-500" />
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Nourish</h1>
        <p class="text-xs font-medium" style="color: var(--color-text-secondary)">Recipe Intelligence</p>
      </div>
    </div>
    <h2 class="hero-heading">Understand what your food leans toward.</h2>
    <p class="hero-sub">Three simple signals to help you make informed choices: Real Food, Gut, and Protein.</p>
    <p class="hero-muted">Not a grade. Just guidance.</p>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- SCAN CARD -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div class="scan-card">
    {#if !hasMembership && !scanResult}
      <div class="scan-lock">
        <LockIcon size={22} class="text-orange-500" />
        <div class="flex-1">
          <p class="text-sm font-semibold" style="color: var(--color-text-primary);">Members Only</p>
          <p class="text-xs" style="color: var(--color-text-secondary);">Analyze any food for instant Nourish scores.</p>
        </div>
        <a href="/membership"><Button primary>Join</Button></a>
      </div>

    {:else if scanResult && scanResult.scores}
      <!-- ── Results ── -->
      {#if scanResult.quick_take}
        <p class="text-sm font-medium mb-4" style="color: var(--color-text-primary);">{scanResult.quick_take}</p>
      {/if}

      {#if scanResult.scores.overall}
        <NourishScoreCard
          label="Nourish Score"
          subtitle="Overall food quality"
          score={scanResult.scores.overall.score}
          scoreLabel={scanResult.scores.overall.label}
          reason={scanResult.scores.overall.reason}
          color="#a855f7"
        />
      {/if}

      <div class="flex flex-col">
        <NourishScoreCard borderTop label="Real Food" subtitle="Whole food ingredients" score={scanResult.scores.realFood.score} scoreLabel={scanResult.scores.realFood.label} reason={scanResult.scores.realFood.reason} color={SCORE_COLORS.realFood} />
        <NourishScoreCard borderTop label="Gut" subtitle="Digestive health potential" score={scanResult.scores.gut.score} scoreLabel={scanResult.scores.gut.label} reason={scanResult.scores.gut.reason} color={SCORE_COLORS.gut} />
        <NourishScoreCard borderTop label="Protein" subtitle="Protein source quality" score={scanResult.scores.protein.score} scoreLabel={scanResult.scores.protein.label} reason={scanResult.scores.protein.reason} color={SCORE_COLORS.protein} />
      </div>

      {#if scanResult.scores.summary}
        <p class="result-summary">{scanResult.scores.summary}</p>
      {/if}

      {#if improvements.length > 0}
        <div class="result-upgrades">
          <p class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">Upgrade It</p>
          <ul class="text-sm pl-4 list-disc" style="color: var(--color-text-secondary);">
            {#each improvements as s}<li class="py-0.5">{s}</li>{/each}
          </ul>
        </div>
      {/if}

      <button class="scan-again-btn" on:click={resetScan}>Analyze something else</button>

    {:else}
      <!-- ── Input ── -->
      <p class="input-helper">Paste ingredients, describe a dish, or type anything food-related.</p>

      <textarea
        bind:value={scanText}
        class="scan-input"
        rows="4"
        placeholder="e.g. chicken thighs, sweet potato, kale, olive oil, garlic..."
        disabled={scanning}
      ></textarea>

      <!-- Hidden file inputs -->
      <input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" on:change={handleFileSelect} />
      <input bind:this={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="hidden" on:change={handleFileSelect} />

      {#if imagePreview}
        <div class="image-preview-row">
          <img src={imagePreview} alt="Upload preview" class="image-preview-thumb" />
          <button class="remove-image-btn" on:click={removeImage} aria-label="Remove image"><XCircleIcon size={18} /></button>
        </div>
      {/if}

      {#if scanError}
        <p class="text-sm mt-2" style="color: #ef4444;">{scanError}</p>
      {/if}

      <!-- CTA row -->
      <div class="cta-row">
        {#if scanning}
          <Button primary disabled>
            <span class="flex items-center gap-2"><SpinnerIcon size={16} class="animate-spin" />Analyzing...</span>
          </Button>
        {:else}
          <Button primary on:click={handleScan} disabled={!scanText.trim() && !imageData}>
            <span class="flex items-center gap-2"><LeafIcon size={16} />Analyze with Nourish</span>
          </Button>
          <div class="relative" use:clickOutside on:click_outside={() => showPhotoMenu = false}>
            <button class="photo-btn" on:click={togglePhotoMenu} aria-label="Add a photo" title="Add a photo">
              <CameraIcon size={20} />
            </button>
            {#if showPhotoMenu}
              <div class="photo-menu">
                <button class="photo-menu-item" on:click={openCamera}><CameraIcon size={16} />Take Photo</button>
                <button class="photo-menu-item" on:click={openFilePicker}><UploadIcon size={16} />Upload Image</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Example prompts -->
      <div class="examples">
        <p class="text-xs mb-2" style="color: var(--color-text-secondary);">Try an example:</p>
        <div class="example-chips">
          {#each EXAMPLES as ex}
            <button class="example-chip" on:click={() => useExample(ex)}>{ex}</button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- SCORE PREVIEW (static mock) -->
  <!-- ════════════════════════════════════════════════════════════ -->
  {#if !scanResult}
    <div class="preview-section">
      <p class="text-xs font-medium mb-3" style="color: var(--color-text-secondary);">What you'll see:</p>
      <div class="preview-grid">
        <div class="preview-item">
          <span class="preview-dot" style="background: #f97316;"></span>
          <span class="preview-label">Real Food</span>
          <span class="preview-score">8</span>
        </div>
        <div class="preview-item">
          <span class="preview-dot" style="background: #22c55e;"></span>
          <span class="preview-label">Gut</span>
          <span class="preview-score">6</span>
        </div>
        <div class="preview-item">
          <span class="preview-dot" style="background: #3b82f6;"></span>
          <span class="preview-label">Protein</span>
          <span class="preview-score">7</span>
        </div>
        <div class="preview-item">
          <span class="preview-dot" style="background: #a855f7;"></span>
          <span class="preview-label">Overall</span>
          <span class="preview-score">7</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- SCORE CARDS -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div class="info-section">
    <h2 class="info-heading">How Scores Work</h2>
    <p class="info-muted">Scores help you understand what a recipe leans toward — so you can adjust, not judge.</p>

    <div class="score-cards-grid">
      <div class="score-card-info" style="border-color: #f97316;">
        <h3 class="score-card-title" style="color: #f97316;">Real Food</h3>
        <p class="score-card-desc">How close a meal is to whole, recognizable ingredients.</p>
        <p class="score-card-weight">45% of overall</p>
      </div>
      <div class="score-card-info" style="border-color: #22c55e;">
        <h3 class="score-card-title" style="color: #22c55e;">Gut</h3>
        <p class="score-card-desc">Fiber, plant diversity, fermented foods, and prebiotic support.</p>
        <p class="score-card-weight">35% of overall</p>
      </div>
      <div class="score-card-info" style="border-color: #3b82f6;">
        <h3 class="score-card-title" style="color: #3b82f6;">Protein</h3>
        <p class="score-card-desc">Protein density and contribution to fullness and recovery.</p>
        <p class="score-card-weight">20% of overall</p>
      </div>
      <div class="score-card-info" style="border-color: #a855f7;">
        <h3 class="score-card-title" style="color: #a855f7;">Overall</h3>
        <p class="score-card-desc">A weighted signal based on Real Food, Gut, and Protein.</p>
        <p class="score-card-weight">0–10 scale</p>
      </div>
    </div>

    <!-- Scale -->
    <div class="scale-row">
      <div class="scale-item"><span class="scale-num">0–2</span><span class="scale-label">Low</span></div>
      <div class="scale-item"><span class="scale-num">3–4</span><span class="scale-label">Fair</span></div>
      <div class="scale-item"><span class="scale-num">5–6</span><span class="scale-label">Moderate</span></div>
      <div class="scale-item"><span class="scale-num">7–8</span><span class="scale-label">Strong</span></div>
      <div class="scale-item"><span class="scale-num">9–10</span><span class="scale-label">Excellent</span></div>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- FOOTER -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div class="page-footer">
    <p>Nourish is available to <a href="/membership" class="footer-link">Zap Cooking members</a>.</p>
    <p class="footer-notes">Scores are estimates based on ingredients. Not medical advice. Nourish is for awareness, not diagnosis.</p>
  </div>
</article>

<style lang="postcss">
  @reference "../../app.css";

  /* ── Back link ── */
  .back-link {
    @apply inline-flex items-center gap-2 mb-6 text-sm;
    color: var(--color-text-secondary);
  }
  .back-link:hover { text-decoration: underline; }

  /* ── Hero ── */
  .hero {
    @apply mb-8;
  }
  .hero-title-row {
    @apply flex items-center gap-3 mb-4;
  }
  .hero-heading {
    @apply text-xl font-bold mb-2;
    color: var(--color-text-primary);
  }
  .hero-sub {
    @apply text-sm leading-relaxed mb-1;
    color: var(--color-text-secondary);
  }
  .hero-muted {
    @apply text-xs;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }

  /* ── Scan card ── */
  .scan-card {
    @apply p-5 rounded-2xl mb-8;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }
  .scan-lock {
    @apply flex items-center gap-4 p-4 rounded-xl;
    background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
  }
  .input-helper {
    @apply text-sm mb-3;
    color: var(--color-text-secondary);
  }
  .scan-input {
    @apply w-full rounded-xl p-4 text-sm border resize-none;
    font-size: 16px;
    background: var(--color-input-bg);
    border-color: var(--color-input-border);
    color: var(--color-text-primary);
  }
  .scan-input::placeholder {
    color: var(--color-text-secondary);
    opacity: 0.5;
  }
  .scan-input:focus {
    outline: none;
    border-color: var(--color-accent, #f97316);
    box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.15);
  }
  .cta-row {
    @apply mt-4 flex items-center gap-2;
  }
  .scan-again-btn {
    @apply mt-4 text-sm font-medium cursor-pointer;
    color: var(--color-accent, #f97316);
  }
  .scan-again-btn:hover { text-decoration: underline; }

  .result-summary {
    @apply text-sm leading-relaxed mt-3 pt-3;
    color: var(--color-text-secondary);
    border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
  }
  .result-upgrades {
    @apply mt-3 pt-3;
    border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
  }

  /* ── Examples ── */
  .examples {
    @apply mt-4 pt-4;
    border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
  }
  .example-chips {
    @apply flex flex-wrap gap-2;
  }
  .example-chip {
    @apply text-xs px-3 py-1.5 rounded-full cursor-pointer transition-colors;
    background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.05));
    color: var(--color-text-secondary);
    border: 1px solid transparent;
  }
  .example-chip:hover {
    color: var(--color-text-primary);
    border-color: var(--color-input-border);
  }

  /* ── Image ── */
  .image-preview-row { @apply flex items-center gap-2 mt-3; }
  .image-preview-thumb { @apply w-16 h-16 rounded-lg object-cover; }
  .remove-image-btn {
    @apply cursor-pointer transition-opacity;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
  .remove-image-btn:hover { opacity: 1; }

  /* ── Photo menu ── */
  .photo-btn {
    @apply p-2.5 rounded-xl transition-colors cursor-pointer;
    color: var(--color-text-secondary);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .photo-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
  }
  .photo-menu {
    @apply absolute bottom-full left-0 mb-2 rounded-xl py-1 z-50;
    min-width: 160px;
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  .photo-menu-item {
    @apply w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer;
    color: var(--color-text-primary);
  }
  .photo-menu-item:hover {
    background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.05));
  }

  /* ── Preview ── */
  .preview-section {
    @apply mb-8;
  }
  .preview-grid {
    @apply grid grid-cols-4 gap-3;
  }
  .preview-item {
    @apply flex flex-col items-center gap-1 p-3 rounded-xl text-center;
    background-color: var(--color-bg-secondary);
  }
  .preview-dot {
    @apply w-2 h-2 rounded-full;
  }
  .preview-label {
    @apply text-xs;
    color: var(--color-text-secondary);
  }
  .preview-score {
    @apply text-lg font-bold;
    color: var(--color-text-primary);
  }

  /* ── Score info cards ── */
  .info-section {
    @apply mb-8;
  }
  .info-heading {
    @apply text-lg font-bold mb-1;
    color: var(--color-text-primary);
  }
  .info-muted {
    @apply text-sm mb-5;
    color: var(--color-text-secondary);
  }
  .score-cards-grid {
    @apply grid grid-cols-2 gap-3 mb-5;
  }
  .score-card-info {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
    border-left: 3px solid;
  }
  .score-card-title {
    @apply text-sm font-bold mb-1;
  }
  .score-card-desc {
    @apply text-xs leading-relaxed;
    color: var(--color-text-secondary);
  }
  .score-card-weight {
    @apply text-xs mt-2 font-medium;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }

  /* ── Scale ── */
  .scale-row {
    @apply grid grid-cols-5 gap-2 p-3 rounded-xl;
    background-color: var(--color-bg-secondary);
  }
  .scale-item {
    @apply flex flex-col items-center gap-0.5;
  }
  .scale-num {
    @apply text-sm font-bold;
    color: var(--color-text-primary);
  }
  .scale-label {
    @apply text-xs;
    color: var(--color-text-secondary);
  }

  /* ── Footer ── */
  .page-footer {
    @apply py-6 text-center text-xs;
    color: var(--color-text-secondary);
    opacity: 0.7;
  }
  .footer-link {
    color: var(--color-accent, #f97316);
    font-weight: 500;
  }
  .footer-link:hover { text-decoration: underline; }
  .footer-notes {
    @apply mt-1;
    opacity: 0.6;
  }
</style>
