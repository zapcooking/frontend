<script lang="ts">
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { getScanResult, setScanResult } from '$lib/nourish/cache';
  import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
  import { ingredientStore } from '$lib/nourish/ingredientStore';
  import type { NourishScores, ScanResponse, IngredientSignal } from '$lib/nourish/types';
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
  let showCameraView = false;
  let videoEl: HTMLVideoElement;
  let cameraStream: MediaStream | null = null;

  const SCORE_COLORS = { gut: '#22c55e', protein: '#3b82f6', realFood: '#f97316' };

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
    reader.onload = () => {
      imageData = reader.result as string;
      imagePreview = imageData;
      scanError = '';
    };
    reader.onerror = () => { scanError = 'Failed to read image'; };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    imageData = null;
    imagePreview = null;
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
  }

  function togglePhotoMenu() {
    showPhotoMenu = !showPhotoMenu;
  }

  async function openCamera() {
    showPhotoMenu = false;

    // On mobile, the capture attribute opens the native camera directly
    // On desktop, try getUserMedia for a live camera view
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      cameraInput?.click();
      return;
    }

    // Desktop: try live camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraStream = stream;
      showCameraView = true;
      // Wait for DOM to render the video element
      await new Promise((r) => setTimeout(r, 50));
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
    } catch {
      // Camera not available — fall back to file picker
      cameraInput?.click();
    }
  }

  function capturePhoto() {
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d')?.drawImage(videoEl, 0, 0);
    imageData = canvas.toDataURL('image/jpeg', 0.85);
    imagePreview = imageData;
    closeCameraView();
  }

  function closeCameraView() {
    showCameraView = false;
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
  }

  function openFilePicker() {
    showPhotoMenu = false;
    fileInput?.click();
  }

  async function handleScan() {
    const text = scanText.trim();
    const hasText = text.length >= 3;
    const hasImage = !!imageData;

    if (!hasText && !hasImage) {
      scanError = 'Please enter some text or upload an image to analyze.';
      return;
    }

    // Check cache for text-only scans
    if (hasText && !hasImage) {
      const cached = getScanResult(text);
      if (cached && cached.scores) {
        scanResult = cached;
        improvements = mergeImprovements(
          generateSuggestions(cached.scores),
          cached.improvements || []
        );
        return;
      }
    }

    scanning = true;
    scanError = '';

    try {
      const requestBody: any = {
        pubkey: $userPublickey || '',
        text: hasText ? text : '',
        title: ''
      };
      if (hasImage) {
        requestBody.imageData = imageData;
      }

      const res = await fetch('/api/nourish/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data: ScanResponse = await res.json();

      if (!data.success) {
        scanError = data.error || 'Failed to analyze. Please try again.';
        return;
      }

      scanResult = data;
      setScanResult(text, data);

      // Merge rule-based + LLM suggestions
      if (data.scores) {
        improvements = mergeImprovements(
          generateSuggestions(data.scores),
          data.improvements || []
        );
      }

      // Fire-and-forget: save ingredient signals to IndexedDB
      if (data.ingredient_signals && data.ingredient_signals.length > 0) {
        ingredientStore.saveIngredients(data.ingredient_signals, 'scan').catch(() => {});
      }
    } catch {
      scanError = 'Could not connect. Please try again.';
    } finally {
      scanning = false;
    }
  }

  function resetScan() {
    scanResult = null;
    improvements = [];
    scanError = '';
    removeImage();
    scanText = '';
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    unsubMembership();
    closeCameraView();
  });
</script>

<svelte:head>
  <title>Nourish — Recipe Intelligence - zap.cooking</title>
  <meta
    name="description"
    content="Nourish looks at recipe ingredients and gives you three simple signals to help you make informed choices."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <a
    href="/community"
    class="inline-flex items-center gap-2 mb-4 text-sm hover:underline"
    style="color: var(--color-text-secondary)"
  >
    <ArrowLeftIcon size={16} />
    Back
  </a>

  <h1 class="text-3xl font-bold mb-1" style="color: var(--color-text-primary)">
    Nourish
  </h1>
  <p class="text-sm font-medium mb-6" style="color: var(--color-text-secondary)">
    Recipe Intelligence
  </p>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">

    <!-- 1. Intro -->
    <p class="text-lg">
      Understand what your food is doing for you.
    </p>
    <p>
      Nourish looks at recipe ingredients and gives you three simple signals to help you make
      informed choices — not perfect ones.
    </p>

    <!-- 2. Philosophy -->
    <p class="text-sm italic" style="color: var(--color-text-secondary)">
      Nourish helps you understand what a recipe leans toward — so you can adjust, not judge.
    </p>

    <!-- Scan Anything -->
    <div class="scan-section">
      <h2 class="section-heading" style="margin-top: 0;">Scan Anything</h2>
      <p class="text-sm mb-3" style="color: var(--color-text-secondary);">
        Paste an ingredient list, describe a restaurant dish, or type anything food-related.
      </p>

      {#if !hasMembership && !scanResult}
        <!-- Membership lock -->
        <div class="scan-lock">
          <LockIcon size={20} class="text-orange-500" />
          <div>
            <p class="text-sm font-medium" style="color: var(--color-text-primary);">Members Only</p>
            <p class="text-xs" style="color: var(--color-text-secondary);">Scan any food for instant Nourish scores.</p>
          </div>
          <a href="/membership">
            <Button primary>Join</Button>
          </a>
        </div>
      {:else if scanResult && scanResult.scores}
        <!-- Results -->
        <div class="scan-results">
          {#if scanResult.quick_take}
            <p class="text-sm font-medium mb-3" style="color: var(--color-text-primary);">
              {scanResult.quick_take}
            </p>
          {/if}

          <div class="flex flex-col">
            <NourishScoreCard
              label="Gut Score"
              subtitle="Digestive health potential"
              score={scanResult.scores.gut.score}
              scoreLabel={scanResult.scores.gut.label}
              reason={scanResult.scores.gut.reason}
              color={SCORE_COLORS.gut}
            />
            <NourishScoreCard
              borderTop
              label="Protein Score"
              subtitle="Protein source quality"
              score={scanResult.scores.protein.score}
              scoreLabel={scanResult.scores.protein.label}
              reason={scanResult.scores.protein.reason}
              color={SCORE_COLORS.protein}
            />
            <NourishScoreCard
              borderTop
              label="Real Food Score"
              subtitle="Whole food ingredients"
              score={scanResult.scores.realFood.score}
              scoreLabel={scanResult.scores.realFood.label}
              reason={scanResult.scores.realFood.reason}
              color={SCORE_COLORS.realFood}
            />
          </div>

          {#if scanResult.scores.summary}
            <p
              class="text-sm leading-relaxed mt-2 pt-3"
              style="color: var(--color-text-secondary); border-top: 1px solid var(--color-bg-tertiary, rgba(255,255,255,0.08));"
            >
              {scanResult.scores.summary}
            </p>
          {/if}

          {#if improvements.length > 0}
            <div class="mt-3 pt-3" style="border-top: 1px solid var(--color-bg-tertiary, rgba(255,255,255,0.08));">
              <p class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">Upgrade It</p>
              <ul class="text-sm pl-4 list-disc" style="color: var(--color-text-secondary);">
                {#each improvements as suggestion}
                  <li class="py-0.5">{suggestion}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <button
            class="mt-4 text-sm font-medium cursor-pointer"
            style="color: var(--color-accent, #f97316);"
            on:click={resetScan}
          >
            Scan something else
          </button>
        </div>
      {:else}
        <!-- Live camera view -->
        {#if showCameraView}
          <div class="camera-view">
            <!-- svelte-ignore a11y-media-has-caption -->
            <video bind:this={videoEl} autoplay playsinline class="camera-video"></video>
            <div class="camera-controls">
              <button class="camera-capture-btn" on:click={capturePhoto} aria-label="Take photo">
                <div class="capture-ring"></div>
              </button>
              <button
                class="camera-cancel-btn"
                on:click={closeCameraView}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}

        <!-- Input -->
        <textarea
          bind:value={scanText}
          class="scan-input"
          rows="4"
          placeholder="Paste ingredients, describe a dish, or type anything food-related..."
          disabled={scanning}
          style="background: var(--color-input-bg); border-color: var(--color-input-border); color: var(--color-text-primary);"
        ></textarea>

        <!-- Hidden file inputs -->
        <input
          bind:this={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          class="hidden"
          on:change={handleFileSelect}
        />
        <input
          bind:this={cameraInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          class="hidden"
          on:change={handleFileSelect}
        />

        {#if imagePreview}
          <div class="image-preview-row">
            <img src={imagePreview} alt="Upload preview" class="image-preview-thumb" />
            <button class="remove-image-btn" on:click={removeImage} aria-label="Remove image">
              <XCircleIcon size={18} />
            </button>
          </div>
        {/if}

        {#if scanError}
          <p class="text-sm mt-2" style="color: #ef4444;">{scanError}</p>
        {/if}

        <div class="mt-3 flex items-center gap-2">
          {#if scanning}
            <Button primary disabled>
              <span class="flex items-center gap-2">
                <SpinnerIcon size={16} class="animate-spin" />
                Analyzing...
              </span>
            </Button>
          {:else}
            <Button primary on:click={handleScan} disabled={!scanText.trim() && !imageData}>
              <span class="flex items-center gap-2">
                <LeafIcon size={16} />
                Scan
              </span>
            </Button>
            <div class="relative" use:clickOutside on:click_outside={() => showPhotoMenu = false}>
              <button
                class="photo-btn"
                on:click={togglePhotoMenu}
                aria-label="Add a photo"
                title="Add a photo"
              >
                <CameraIcon size={20} />
              </button>

              {#if showPhotoMenu}
                <div class="photo-menu">
                  <button class="photo-menu-item" on:click={openCamera}>
                    <CameraIcon size={16} />
                    Take Photo
                  </button>
                  <button class="photo-menu-item" on:click={openFilePicker}>
                    <UploadIcon size={16} />
                    Upload Image
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- 3. How to Read Scores -->
    <h2 class="section-heading">How to Read Scores</h2>

    <p>Nourish scores are not grades. They help you understand what a recipe leans toward.</p>

    <ul class="insight-list">
      <li>A high Gut Score may mean strong fiber and plant diversity</li>
      <li>A high Protein Score may mean better support for a full meal</li>
      <li>A high Real Food Score may mean simpler, less processed ingredients</li>
    </ul>

    <p>Most recipes won't score high in everything — and that's normal.</p>

    <!-- 4. Example -->
    <h2 class="section-heading">Example</h2>

    <div class="example-card">
      <div class="example-scores">
        <span class="example-score" style="color: #22c55e;">Gut: 8</span>
        <span class="example-score" style="color: #3b82f6;">Protein: 3</span>
        <span class="example-score" style="color: #f97316;">Real Food: 9</span>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Quick Take</p>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Light, gut-friendly, whole-food focused. Best as a side, not a full protein meal.
        </p>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Why</p>
        <ul class="example-list">
          <li>Fermented ingredients support gut health</li>
          <li>Simple, minimally processed ingredients</li>
          <li>Low protein density</li>
        </ul>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Upgrade It</p>
        <ul class="example-list">
          <li>Add chicken, eggs, or chickpeas for protein</li>
        </ul>
      </div>
    </div>

    <!-- 5. The Three Scores -->
    <h2 class="section-heading">The Three Scores</h2>

    <div class="flex flex-col gap-5">
      <!-- Gut Score -->
      <div class="score-explainer" style="border-left-color: #22c55e;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Gut Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how supportive a recipe may be for digestion and overall gut health.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>fiber-rich plants</li>
          <li>plant diversity</li>
          <li>fermented foods</li>
          <li>prebiotic ingredients</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Higher scores suggest more gut-supportive ingredients.
        </p>
      </div>

      <!-- Protein Score -->
      <div class="score-explainer" style="border-left-color: #3b82f6;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Protein Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how well a recipe contributes to your protein needs.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>protein-rich ingredients</li>
          <li>overall protein presence</li>
          <li>whether the recipe works as a main or a side</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Some recipes are naturally lower in protein — that's okay.
        </p>
      </div>

      <!-- Real Food Score -->
      <div class="score-explainer" style="border-left-color: #f97316;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Real Food Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how close ingredients are to whole, minimally processed foods.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>whole ingredients</li>
          <li>level of processing</li>
          <li>refined or ultra-processed components</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Higher scores suggest simpler, more recognizable ingredients.
        </p>
      </div>
    </div>

    <!-- How it Works -->
    <h2 class="section-heading">How it Works</h2>

    <p>
      Nourish reads the ingredient list of a recipe and uses AI to estimate three scores on a 0–10 scale.
    </p>
    <p>Each score includes a short explanation so you can see:</p>
    <ul class="insight-list">
      <li>what helped</li>
      <li>what held it back</li>
      <li>how to adjust if you want to</li>
    </ul>
    <p>
      These are rough estimates designed to help you compare recipes and spot patterns over time.
    </p>

    <!-- Score Scale -->
    <h2 class="section-heading">Score Scale</h2>

    <div class="scale-card">
      <div class="grid grid-cols-5 gap-2 text-center text-xs" style="color: var(--color-text-secondary);">
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">0–2</div>
          Low
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">3–4</div>
          Fair
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">5–6</div>
          Moderate
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">7–8</div>
          Strong
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">9–10</div>
          Excellent
        </div>
      </div>
    </div>

    <!-- Availability -->
    <h2 class="section-heading">Availability</h2>

    <p>Nourish is available to Zap Cooking members.</p>
    <p>Open any recipe and tap <strong>Nourish</strong> to see what it's doing for you.</p>
    <p>
      <a href="/membership" class="font-semibold underline hover:no-underline" style="color: var(--color-accent, #f97316);">
        View membership options
      </a>
    </p>

    <!-- Notes -->
    <div class="notes-card">
      <h3 class="text-xs font-semibold mb-2" style="color: var(--color-text-primary)">Notes</h3>
      <ul class="notes-list">
        <li>Scores are estimates based on ingredients and recipe structure</li>
        <li>Ingredient quality and preparation methods can change outcomes</li>
        <li>Some benefits depend on specific product types (for example, whether fermented foods contain live cultures)</li>
        <li>Nourish is for awareness, not diagnosis or treatment</li>
      </ul>
    </div>
  </div>
</article>

<style lang="postcss">
  @reference "../../app.css";

  .section-heading {
    @apply text-2xl font-bold mt-8;
    color: var(--color-text-primary);
  }

  .score-explainer {
    @apply pl-4 py-2;
    border-left-width: 3px;
    border-left-style: solid;
  }

  .detail-list {
    @apply text-sm mt-1 pl-4 list-disc;
    color: var(--color-text-secondary);
  }

  .detail-list li {
    @apply py-0.5;
  }

  .insight-list {
    @apply pl-4 list-disc;
    color: var(--color-text-primary);
  }

  .insight-list li {
    @apply py-0.5;
  }

  .example-card {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
  }

  .example-scores {
    @apply flex gap-4 flex-wrap text-sm font-bold;
  }

  .example-list {
    @apply text-sm mt-1 pl-4 list-disc;
    color: var(--color-text-secondary);
  }

  .example-list li {
    @apply py-0.5;
  }

  .scale-card {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
  }

  .notes-card {
    @apply mt-4 p-4 rounded-xl text-xs leading-relaxed;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-secondary);
  }

  .notes-list {
    @apply pl-4 list-disc flex flex-col gap-1;
  }

  .scan-section {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
  }

  .scan-lock {
    @apply flex items-center gap-3 p-3 rounded-lg;
    background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.05));
  }

  .scan-input {
    @apply w-full rounded-lg p-3 text-sm border resize-none;
    font-size: 16px; /* prevent iOS zoom */
  }

  .scan-input:focus {
    outline: none;
    border-color: var(--color-accent, #f97316);
    box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
  }

  .photo-btn {
    @apply p-2 rounded-lg transition-colors cursor-pointer;
    color: var(--color-text-secondary);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }

  .photo-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
  }

  .image-preview-row {
    @apply flex items-center gap-2 mt-2;
  }

  .image-preview-thumb {
    @apply w-16 h-16 rounded-lg object-cover;
  }

  .remove-image-btn {
    @apply cursor-pointer transition-opacity;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }

  .remove-image-btn:hover {
    opacity: 1;
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

  .camera-view {
    @apply rounded-xl overflow-hidden mb-3;
    background: #000;
  }

  .camera-video {
    @apply w-full rounded-t-xl;
    max-height: 300px;
    object-fit: cover;
  }

  .camera-controls {
    @apply flex items-center justify-center gap-6 py-3;
    background: #000;
  }

  .camera-capture-btn {
    @apply w-14 h-14 rounded-full bg-white flex items-center justify-center cursor-pointer;
    border: 3px solid rgba(255, 255, 255, 0.3);
  }

  .capture-ring {
    @apply w-10 h-10 rounded-full;
    background: white;
    border: 2px solid rgba(0, 0, 0, 0.1);
  }

  .camera-capture-btn:active .capture-ring {
    @apply w-9 h-9;
  }

  .camera-cancel-btn {
    @apply absolute right-4 text-sm text-white cursor-pointer;
    opacity: 0.8;
  }

  .camera-cancel-btn:hover {
    opacity: 1;
  }
</style>
