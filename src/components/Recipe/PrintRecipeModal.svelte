<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import { parseMarkdown, type DirectionPhase } from '$lib/parser';
  import {
    recipeTags,
    RECIPE_TAG_PREFIX_NEW,
    RECIPE_TAG_PREFIX_LEGACY
  } from '$lib/consts';

  export let open = false;
  export let event: NDKEvent;
  export let images: string[];
  export let recipeDetails: {
    prepTime: string | null;
    cookTime: string | null;
    servings: string | null;
  };
  export let directionsPhases: DirectionPhase[];
  export let markdownBeforeDirections: string;
  export let markdownAfterDirections: string;

  // Toggle state — all default to true
  let showImage = true;
  let showSummary = true;
  let showDetails = true;
  let showChefNotes = true;
  let showIngredients = true;
  let showDirections = true;
  let showTags = true;

  // Extract title
  $: title =
    event.tags.find((t) => t[0] === 'title')?.[1] ||
    event.tags.find((t) => t[0] === 'd')?.[1] ||
    'Recipe';

  // Extract summary
  $: summary = event.tags.find((t) => t[0] === 'summary')?.[1] || '';

  // Extract tags (same logic as TagLinks)
  $: recipeCategoryTags = (() => {
    const tags: Array<{ title: string; emoji?: string }> = [];
    let nameTagFound = false;
    const dTag = event.tags.find((a) => a[0] === 'd')?.[1];

    event.tags.forEach((t) => {
      if (t[0] === 't' && t[1]) {
        const isLegacyPrefix = t[1].startsWith(`${RECIPE_TAG_PREFIX_LEGACY}-`);
        const isNewPrefix = t[1].startsWith(`${RECIPE_TAG_PREFIX_NEW}-`);

        if ((isLegacyPrefix || isNewPrefix) && !nameTagFound) {
          const tagName = isNewPrefix
            ? t[1].slice(RECIPE_TAG_PREFIX_NEW.length + 1)
            : t[1].slice(RECIPE_TAG_PREFIX_LEGACY.length + 1);
          if (tagName === dTag) {
            nameTagFound = true;
          }
        } else if (isLegacyPrefix || isNewPrefix) {
          const tagName = isNewPrefix
            ? t[1].slice(RECIPE_TAG_PREFIX_NEW.length + 1)
            : t[1].slice(RECIPE_TAG_PREFIX_LEGACY.length + 1);
          const matchingTag = recipeTags.find(
            (rt) => rt.title.toLowerCase().replaceAll(' ', '-') === tagName
          );
          if (matchingTag) {
            tags.push(matchingTag);
          } else {
            tags.push({ title: tagName.replaceAll('-', ' ') });
          }
        }
      }
    });
    return tags;
  })();

  // Split markdownBeforeDirections into chef's notes and ingredients
  $: chefNotesHtml = (() => {
    const match = event.content.match(/## Chef's notes\s*\n([\s\S]*?)(?=\n## |$)/i);
    if (match) return parseMarkdown(`## Chef's notes\n${match[1].trim()}`);
    return '';
  })();

  $: ingredientsHtml = (() => {
    const match = event.content.match(/## Ingredients\s*\n([\s\S]*?)(?=\n## |$)/i);
    if (match) return parseMarkdown(`## Ingredients\n${match[1].trim()}`);
    return '';
  })();

  // Check which sections have content
  $: hasImage = images.length > 0;
  $: hasSummary = summary.length > 0;
  $: hasDetails =
    recipeDetails.prepTime || recipeDetails.cookTime || recipeDetails.servings;
  $: hasChefNotes = chefNotesHtml.length > 0;
  $: hasIngredients = ingredientsHtml.length > 0;
  $: hasDirections = directionsPhases.length > 0;
  $: hasTags = recipeCategoryTags.length > 0;

  function buildDetailsHtml(): string {
    const parts: string[] = [];
    if (recipeDetails.prepTime) parts.push(`<span>Prep: ${recipeDetails.prepTime}</span>`);
    if (recipeDetails.cookTime) parts.push(`<span>Cook: ${recipeDetails.cookTime}</span>`);
    if (recipeDetails.servings) parts.push(`<span>Servings: ${recipeDetails.servings}</span>`);
    return parts.join('<span class="print-detail-sep"> | </span>');
  }

  function buildPrintHtml(): string {
    let html = `<h1 class="print-title">${escapeHtml(title)}</h1>`;

    if (showImage && hasImage) {
      html += `<div class="print-image"><img src="${escapeHtml(images[0])}" alt="${escapeHtml(title)}" /></div>`;
    }

    if (showSummary && hasSummary) {
      html += `<p class="print-summary">${escapeHtml(summary)}</p>`;
    }

    if (showDetails && hasDetails) {
      html += `<div class="print-details">${buildDetailsHtml()}</div>`;
    }

    if (showChefNotes && hasChefNotes) {
      html += `<div class="print-section">${chefNotesHtml}</div>`;
    }

    if (showIngredients && hasIngredients) {
      html += `<div class="print-section">${ingredientsHtml}</div>`;
    }

    if (showDirections && hasDirections) {
      html += `<div class="print-section"><h2>Directions</h2><ol class="print-directions">`;
      for (const phase of directionsPhases) {
        if (directionsPhases.length > 1) {
          html += `<li class="print-phase-title"><strong>${escapeHtml(phase.title)}</strong></li>`;
        }
        for (const step of phase.steps) {
          html += `<li>${escapeHtml(step.text)}</li>`;
        }
      }
      html += `</ol></div>`;
    }

    if (showTags && hasTags) {
      html += `<div class="print-tags">`;
      for (const tag of recipeCategoryTags) {
        html += `<span class="print-tag">${escapeHtml(tag.title)}</span>`;
      }
      html += `</div>`;
    }

    return html;
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function handlePrint() {
    const printHtml = buildPrintHtml();

    // Create temporary container
    const printDiv = document.createElement('div');
    printDiv.id = 'print-recipe';
    printDiv.innerHTML = printHtml;

    // Create print-only style
    const printStyle = document.createElement('style');
    printStyle.id = 'print-recipe-style';
    printStyle.textContent = `
      @media print {
        body > *:not(#print-recipe) { display: none !important; }
        #print-recipe { display: block !important; }
      }
    `;

    document.body.appendChild(printStyle);
    document.body.appendChild(printDiv);

    // Close modal before printing so it doesn't interfere
    open = false;

    // Small delay to allow modal to close and DOM to update
    requestAnimationFrame(() => {
      window.print();

      // Cleanup after print dialog closes
      const cleanup = () => {
        printDiv.remove();
        printStyle.remove();
        window.removeEventListener('afterprint', cleanup);
      };

      window.addEventListener('afterprint', cleanup);
      // Fallback cleanup in case afterprint doesn't fire
      setTimeout(cleanup, 5000);
    });
  }
</script>

<Modal bind:open>
  <span slot="title">Print Recipe</span>

  <div class="flex flex-col gap-5">
    <!-- Toggle controls -->
    <div class="flex flex-col gap-1">
      <p class="text-sm font-medium mb-1" style="color: var(--color-text-secondary);">
        Include in printout:
      </p>

      {#if hasImage}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showImage} />
          <span>Photo</span>
        </label>
      {/if}

      {#if hasSummary}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showSummary} />
          <span>Summary</span>
        </label>
      {/if}

      {#if hasDetails}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showDetails} />
          <span>Details (prep, cook, servings)</span>
        </label>
      {/if}

      {#if hasChefNotes}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showChefNotes} />
          <span>Chef's Notes</span>
        </label>
      {/if}

      {#if hasIngredients}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showIngredients} />
          <span>Ingredients</span>
        </label>
      {/if}

      {#if hasDirections}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showDirections} />
          <span>Directions</span>
        </label>
      {/if}

      {#if hasTags}
        <label class="print-toggle">
          <input type="checkbox" bind:checked={showTags} />
          <span>Tags</span>
        </label>
      {/if}
    </div>

    <!-- Live preview -->
    <div class="print-preview-container">
      <p class="text-xs font-medium mb-2" style="color: var(--color-text-secondary);">Preview</p>
      <div class="print-preview">
        <h3 class="text-lg font-bold mb-2" style="color: var(--color-text-primary);">
          {title}
        </h3>

        {#if showImage && hasImage}
          <img
            class="w-full max-h-40 object-cover rounded-lg mb-3"
            src={images[0]}
            alt={title}
          />
        {/if}

        {#if showSummary && hasSummary}
          <p class="text-sm mb-3" style="color: var(--color-text-secondary);">
            {summary}
          </p>
        {/if}

        {#if showDetails && hasDetails}
          <div class="flex flex-wrap gap-3 text-xs mb-3 pb-3" style="border-bottom: 1px solid var(--color-input-border); color: var(--color-text-secondary);">
            {#if recipeDetails.prepTime}
              <span>Prep: {recipeDetails.prepTime}</span>
            {/if}
            {#if recipeDetails.cookTime}
              <span>Cook: {recipeDetails.cookTime}</span>
            {/if}
            {#if recipeDetails.servings}
              <span>Servings: {recipeDetails.servings}</span>
            {/if}
          </div>
        {/if}

        {#if showChefNotes && hasChefNotes}
          <div class="prose prose-sm max-w-none mb-3">
            {@html chefNotesHtml}
          </div>
        {/if}

        {#if showIngredients && hasIngredients}
          <div class="prose prose-sm max-w-none mb-3">
            {@html ingredientsHtml}
          </div>
        {/if}

        {#if showDirections && hasDirections}
          <div class="mb-3">
            <h4 class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">Directions</h4>
            <ol class="text-xs list-decimal list-inside space-y-1" style="color: var(--color-text-secondary);">
              {#each directionsPhases as phase}
                {#if directionsPhases.length > 1}
                  <li class="font-semibold list-none mt-2" style="color: var(--color-text-primary);">
                    {phase.title}
                  </li>
                {/if}
                {#each phase.steps as step}
                  <li>{step.text}</li>
                {/each}
              {/each}
            </ol>
          </div>
        {/if}

        {#if showTags && hasTags}
          <div class="flex flex-wrap gap-1">
            {#each recipeCategoryTags as tag}
              <span
                class="text-[10px] rounded-full px-2 py-0.5"
                style="background-color: var(--color-input-bg); color: var(--color-text-secondary);"
              >
                {tag.title}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Print button -->
    <div class="flex justify-center">
      <Button on:click={handlePrint}>Print Recipe</Button>
    </div>
  </div>
</Modal>

<style>
  .print-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }

  .print-toggle input[type='checkbox'] {
    accent-color: var(--color-primary);
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  .print-preview-container {
    max-height: 300px;
    overflow-y: auto;
  }

  .print-preview {
    border: 1px solid var(--color-input-border);
    border-radius: 0.75rem;
    padding: 1rem;
    background-color: var(--color-bg-primary);
  }

  /* Ensure prose inside preview respects theme colors */
  .print-preview :global(h2) {
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--color-text-primary);
  }

  .print-preview :global(ul),
  .print-preview :global(ol) {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .print-preview :global(p) {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }
</style>
