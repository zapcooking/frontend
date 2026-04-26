<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import {
    buildCookbookPdf,
    cookbookFilename,
    recipeEventToCookbookRecipe,
    type CookbookRecipe
  } from '$lib/cookbookExport';

  /** The pack event itself — needed for title/description/cover/creator. */
  export let packEvent: NDKEvent | null = null;
  /** Already-resolved recipe events from the pack page. */
  export let recipeEvents: NDKEvent[] = [];
  /** Total recipe count from the pack (may exceed recipeEvents.length on partial load). */
  export let totalRecipeCount: number = 0;
  /** Already-computed pack metadata (title etc) so we don't re-parse here. */
  export let packTitle: string = '';
  export let packDescription: string = '';
  export let packCoverImage: string | undefined = undefined;
  export let creatorPubkey: string = '';
  export let open = false;

  const dispatch = createEventDispatcher();

  // Form state
  let title = '';
  let subtitle = '';
  let includeCover = true;
  let includeToc = true;
  let includeImages = true;
  let includeIntroduction = true;
  let style: 'classic' | 'modern' | 'simple' = 'modern';

  // Stage state
  type Stage = 'form' | 'generating' | 'success' | 'error';
  let stage: Stage = 'form';
  let stageMessage = '';
  let resultBlob: Blob | null = null;
  let resultFilename = '';
  let resultIncluded = 0;
  let resultSkipped = 0;
  let usedAi = false;

  $: missingRecipes = Math.max(0, totalRecipeCount - recipeEvents.length);

  // Reset per-open
  $: if (open) initStateOnOpen();
  $: if (!open) {
    stage = 'form';
    stageMessage = '';
    resultBlob = null;
    resultFilename = '';
    resultIncluded = 0;
    resultSkipped = 0;
    usedAi = false;
  }

  function initStateOnOpen() {
    title = packTitle || 'My Recipe Pack';
    subtitle = packDescription || '';
  }

  /**
   * Look up the pack creator's display name via NDK on the client.
   * Best-effort — any failure returns undefined and the cover renders
   * without the "Curated by" line.
   */
  async function fetchCreatorName(): Promise<string | undefined> {
    if (!creatorPubkey) return undefined;
    try {
      const evt = await $ndk.fetchEvent({ kinds: [0], authors: [creatorPubkey] });
      if (!evt?.content) return undefined;
      const parsed = JSON.parse(evt.content);
      const name =
        typeof parsed.display_name === 'string' && parsed.display_name.trim()
          ? parsed.display_name.trim()
          : typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name.trim()
            : undefined;
      return name;
    } catch {
      return undefined;
    }
  }

  /**
   * Optional AI polish for the introduction. Best-effort: any failure
   * falls back to the raw pack description so the export still ships.
   */
  async function fetchPolishedIntroduction(
    creatorName: string | undefined,
    recipes: CookbookRecipe[]
  ): Promise<{ text: string; aiUsed: boolean }> {
    const fallback = packDescription || '';
    if (!includeIntroduction) return { text: fallback, aiUsed: false };
    if (!$userPublickey) return { text: fallback, aiUsed: false };
    try {
      const res = await fetch('/api/cookbook-intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey: $userPublickey,
          packTitle: title,
          packDescription: subtitle,
          creatorName,
          recipeCount: recipes.length,
          recipeTitles: recipes.slice(0, 10).map((r) => r.title)
        })
      });
      const data = (await res.json()) as { success: boolean; introduction?: string; error?: string };
      if (data.success && data.introduction) {
        return { text: data.introduction, aiUsed: true };
      }
    } catch (err) {
      console.warn('[ExportCookbookModal] intro polish failed', err);
    }
    return { text: fallback, aiUsed: false };
  }

  async function handleGenerate() {
    if (stage === 'generating') return;
    if (!packEvent) {
      showToast('error', 'Pack event not loaded yet.');
      return;
    }
    if (recipeEvents.length === 0) {
      showToast('error', 'No recipes available to export.');
      return;
    }
    if (!title.trim()) {
      showToast('error', 'Please enter a cookbook title.');
      return;
    }

    stage = 'generating';
    stageMessage = 'Formatting your cookbook…';

    try {
      // Resolve creator name (best-effort, parallel to the rest below).
      const creatorNamePromise = fetchCreatorName();

      // Convert each event into our normalized recipe shape. We don't
      // know per-recipe creator names without per-author profile fetches,
      // so we only resolve the pack-creator name and leave per-recipe
      // attribution unset for v1.
      const recipes: CookbookRecipe[] = recipeEvents.map((e) => recipeEventToCookbookRecipe(e));

      const creatorName = await creatorNamePromise;

      // AI polish (best-effort).
      const { text: introduction, aiUsed } = await fetchPolishedIntroduction(
        creatorName,
        recipes
      );
      usedAi = aiUsed;

      // Build the PDF.
      const result = await buildCookbookPdf({
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        coverImage: includeCover ? packCoverImage : undefined,
        creatorName,
        introduction,
        recipes,
        includeCover,
        includeToc,
        includeImages,
        includeIntroduction: !!introduction,
        style
      });

      resultBlob = result.blob;
      resultIncluded = result.included;
      resultSkipped = result.skipped.length + missingRecipes;
      resultFilename = cookbookFilename(title);
      stage = 'success';
    } catch (err: any) {
      console.error('[ExportCookbookModal] generate failed', err);
      stage = 'error';
      stageMessage = err?.message || 'Something went wrong while building the PDF.';
    }
  }

  function handleDownload() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    dispatch('downloaded');
  }

  function handleClose() {
    open = false;
  }

  function handleRetry() {
    stage = 'form';
    stageMessage = '';
  }
</script>

<Modal cleanup={handleClose} bind:open>
  <h1 slot="title">Export as Cookbook</h1>

  {#if stage === 'form'}
    <div class="flex flex-col gap-4">
      <p class="text-sm text-caption">
        Turn this Recipe Pack into a printable cookbook PDF.
      </p>

      <div class="flex flex-col gap-2">
        <label
          for="cookbook-title"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Cookbook title <span class="text-red-500">*</span>
        </label>
        <input
          id="cookbook-title"
          type="text"
          class="input"
          bind:value={title}
          maxlength="120"
          placeholder="e.g., Weeknight Dinners"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label
          for="cookbook-subtitle"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Subtitle / description
        </label>
        <textarea
          id="cookbook-subtitle"
          class="input"
          rows="3"
          bind:value={subtitle}
          maxlength="500"
          placeholder="A short description of your cookbook…"
        />
      </div>

      <fieldset class="flex flex-col gap-2 pt-1">
        <legend class="text-sm font-medium pb-2" style="color: var(--color-text-primary)">
          Include
        </legend>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeCover} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Cover page</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeToc} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Table of contents</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" bind:checked={includeImages} class="w-4 h-4 accent-orange-500" />
          <span style="color: var(--color-text-primary)">Recipe images</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            bind:checked={includeIntroduction}
            class="w-4 h-4 accent-orange-500"
          />
          <span style="color: var(--color-text-primary)">Introduction</span>
          <span class="text-xs text-caption">— polished automatically when possible</span>
        </label>
      </fieldset>

      <div class="flex flex-col gap-2">
        <label for="cookbook-style" class="text-sm font-medium" style="color: var(--color-text-primary)">
          Style
        </label>
        <select id="cookbook-style" class="input" bind:value={style}>
          <option value="modern">Modern</option>
          <option value="classic">Classic (coming soon)</option>
          <option value="simple">Simple (coming soon)</option>
        </select>
      </div>

      {#if missingRecipes > 0}
        <p class="text-xs text-caption">
          {recipeEvents.length} of {totalRecipeCount} recipes are loaded. The remaining
          {missingRecipes} weren't reachable on the connected relays and won't be in the PDF.
        </p>
      {/if}

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={handleClose} primary={false}>Cancel</Button>
        <Button on:click={handleGenerate} disabled={!packEvent || recipeEvents.length === 0}>
          Generate Cookbook
        </Button>
      </div>
    </div>
  {:else if stage === 'generating'}
    <div class="flex flex-col items-center justify-center gap-4 py-10">
      <div class="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin"></div>
      <p class="text-sm" style="color: var(--color-text-primary)">
        {stageMessage || 'Formatting your cookbook…'}
      </p>
      <p class="text-xs text-caption text-center max-w-sm">
        Generation runs in your browser. Depending on the number of recipes and image
        sizes, this can take 10–30 seconds.
      </p>
    </div>
  {:else if stage === 'success'}
    <div class="flex flex-col gap-4">
      <div
        class="flex items-start gap-3 p-3 rounded-lg"
        style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
      >
        <div
          class="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0 text-white text-lg"
          aria-hidden="true"
        >
          ✓
        </div>
        <div class="flex flex-col">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">
            Cookbook ready
          </p>
          <p class="text-xs text-caption">
            {resultIncluded} {resultIncluded === 1 ? 'recipe' : 'recipes'} included
            {#if resultSkipped > 0}
              · {resultSkipped} couldn't be loaded
            {/if}
            {#if usedAi}
              · introduction polished
            {/if}
          </p>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={handleClose} primary={false}>Close</Button>
        <Button on:click={handleDownload}>Download PDF</Button>
      </div>
    </div>
  {:else if stage === 'error'}
    <div class="flex flex-col gap-4">
      <p class="text-sm" style="color: var(--color-text-primary)">
        {stageMessage || 'Something went wrong while building the PDF.'}
      </p>
      <div class="flex justify-end gap-2">
        <Button on:click={handleClose} primary={false}>Close</Button>
        <Button on:click={handleRetry}>Try again</Button>
      </div>
    </div>
  {/if}
</Modal>
