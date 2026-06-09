<script lang="ts">
  /**
   * Compact recipe card for the Cheffy messenger. A full structured
   * recipe is NEVER rendered as one long chat bubble — instead we parse
   * it down to title / time / servings / one-sentence summary and reveal
   * the full ingredients + steps behind a "View recipe" disclosure
   * (progressive disclosure). Fits the mobile message column with no
   * horizontal scroll.
   */
  import { goto } from '$app/navigation';
  import { parseMarkdownForEditing } from '$lib/parser';
  import { saveDraft } from '$lib/draftStore';
  import { closeCheffy } from '$lib/stores/cheffyChat';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import UsersIcon from 'phosphor-svelte/lib/Users';

  export let content: string;

  let expanded = false;
  let isSaving = false;

  function titleOf(md: string): string {
    const m = md.match(/^#{1,2}\s+(.+?)\s*$/m);
    return m ? m[1].trim() : 'Recipe';
  }

  // The 1–2 sentence summary sits between the title and the first
  // `## ` section; pull it out for the card's one-line teaser.
  function summaryOf(md: string): string {
    const afterTitle = md.replace(/^#{1,2}\s+.+?\r?\n/, '');
    const beforeSection = afterTitle.split(/\r?\n##\s/)[0];
    return beforeSection.replace(/\s+/g, ' ').trim();
  }

  $: parsed = parseMarkdownForEditing(content);
  $: title = titleOf(content);
  $: summary = summaryOf(content);
  $: prep = parsed.information?.prepTime || '';
  $: cook = parsed.information?.cookTime || '';
  $: servings = parsed.information?.servings || '';
  $: timeLabel = [prep && `${prep} prep`, cook && `${cook} cook`].filter(Boolean).join(' · ');

  async function save() {
    if (isSaving) return;
    isSaving = true;
    try {
      const looksGood = parsed.ingredients.length > 0 && parsed.directions.length > 0;
      const draftData: Parameters<typeof saveDraft>[0] = looksGood
        ? {
            title,
            images: [],
            tags: [],
            summary: '',
            chefsnotes: parsed.chefNotes || '',
            preptime: prep,
            cooktime: cook,
            servings,
            ingredients: parsed.ingredients,
            directions: parsed.directions,
            additionalMarkdown: parsed.additionalMarkdown || ''
          }
        : {
            title,
            images: [],
            tags: [],
            summary: '',
            chefsnotes: '',
            preptime: '',
            cooktime: '',
            servings: '',
            ingredients: [],
            directions: [],
            additionalMarkdown: content
          };
      const { draftId } = saveDraft(draftData, undefined, false);
      closeCheffy();
      await goto(`/create?draft=${draftId}`);
    } catch (e) {
      console.error('[Cheffy] recipe save failed:', e);
    } finally {
      isSaving = false;
    }
  }
</script>

<article class="recipe-card">
  <h3 class="recipe-title">{title}</h3>

  {#if timeLabel || servings}
    <div class="recipe-meta">
      {#if timeLabel}
        <span class="meta-chip"><ClockIcon size={13} weight="bold" />{timeLabel}</span>
      {/if}
      {#if servings}
        <span class="meta-chip"><UsersIcon size={13} weight="bold" />{servings}</span>
      {/if}
    </div>
  {/if}

  {#if summary}
    <p class="recipe-summary">{summary}</p>
  {/if}

  <button
    type="button"
    class="disclosure"
    aria-expanded={expanded}
    on:click={() => (expanded = !expanded)}
  >
    <CaretDownIcon size={14} weight="bold" class={expanded ? 'rot' : ''} />
    {expanded ? 'Hide recipe' : 'View recipe'}
  </button>

  {#if expanded}
    <div class="recipe-full">
      {#if parsed.ingredients.length > 0}
        <h4>Ingredients</h4>
        <ul>
          {#each parsed.ingredients as ing}
            <li>{ing}</li>
          {/each}
        </ul>
      {/if}
      {#if parsed.directions.length > 0}
        <h4>Steps</h4>
        <ol>
          {#each parsed.directions as step}
            <li>{step}</li>
          {/each}
        </ol>
      {/if}
      {#if parsed.ingredients.length === 0 && parsed.directions.length === 0}
        <p class="recipe-summary">{content}</p>
      {/if}
    </div>
  {/if}

  <div class="recipe-actions">
    <button type="button" class="save-btn" on:click={save} disabled={isSaving}>
      <FloppyDiskIcon size={15} weight="bold" />
      {isSaving ? 'Saving…' : 'Save'}
    </button>
  </div>
</article>

<style>
  .recipe-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 14px;
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    border-left: 3px solid var(--color-primary);
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .recipe-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .recipe-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background-color: var(--color-input-bg);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
  }
  .recipe-summary {
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--color-text-secondary);
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .disclosure {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 2px;
    background: transparent;
    border: 0;
    color: var(--color-primary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .disclosure :global(svg) {
    transition: transform 160ms ease;
  }
  .disclosure :global(svg.rot) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .disclosure :global(svg) {
      transition: none;
    }
  }
  .recipe-full {
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }
  .recipe-full h4 {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-primary);
    margin: 0.5rem 0 0.25rem;
  }
  .recipe-full ul,
  .recipe-full ol {
    margin: 0 0 0.5rem;
    padding-left: 1.2rem;
  }
  .recipe-full li {
    margin: 0.15rem 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .recipe-actions {
    display: flex;
    gap: 8px;
    margin-top: 2px;
  }
  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 16px;
    border-radius: 999px;
    border: 0;
    background-color: var(--color-primary);
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: filter 140ms ease;
  }
  .save-btn:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
