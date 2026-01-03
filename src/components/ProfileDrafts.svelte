<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadDrafts, deleteDraft, formatDraftDate, draftsStore, type RecipeDraft } from '$lib/draftStore';
  import Button from './Button.svelte';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  let drafts: RecipeDraft[] = [];
  let loaded = false;

  onMount(() => {
    drafts = loadDrafts();
    loaded = true;
  });

  // Keep in sync with store
  $: drafts = $draftsStore;

  function editDraft(draftId: string) {
    goto(`/create?draft=${draftId}`);
  }

  function handleDeleteDraft(draftId: string, title: string) {
    if (confirm(`Delete draft "${title || 'Untitled'}"?`)) {
      deleteDraft(draftId);
      drafts = loadDrafts();
    }
  }
</script>

<div class="flex flex-col gap-4">
  {#if !loaded}
    <div class="flex justify-center py-8">
      <img class="w-32 dark:hidden" src="/pan-animated.svg" alt="Loading" />
      <img class="w-32 hidden dark:block" src="/pan-animated-dark.svg" alt="Loading" />
    </div>
  {:else if drafts.length === 0}
    <div class="flex flex-col items-center justify-center py-12 gap-4">
      <p class="text-caption">No drafts saved yet</p>
      <Button on:click={() => goto('/create')}>
        <span class="flex items-center gap-2">
          <PlusIcon size={18} />
          Create a Recipe
        </span>
      </Button>
    </div>
  {:else}
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each drafts as draft (draft.id)}
        <div 
          class="flex flex-col gap-3 p-4 rounded-xl transition-all hover:scale-[1.02]"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          <!-- Image preview -->
          {#if draft.images && draft.images.length > 0}
            <div 
              class="w-full h-32 rounded-lg bg-cover bg-center"
              style="background-image: url('{draft.images[0]}')"
              role="img"
              aria-label={`Preview image for ${draft.title || 'Untitled Draft'}`}
            />
          {:else}
            <div 
              class="w-full h-32 rounded-lg flex items-center justify-center"
              style="background-color: var(--color-input-border)"
            >
              <span class="text-caption text-sm">No image</span>
            </div>
          {/if}

          <!-- Title and meta -->
          <div class="flex-1">
            <h4 class="font-semibold text-lg line-clamp-2">
              {draft.title || 'Untitled Draft'}
            </h4>
            <p class="text-caption text-sm mt-1">
              Updated {formatDraftDate(draft.updatedAt)}
            </p>
            {#if draft.tags && draft.tags.length > 0}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each draft.tags.slice(0, 3) as tag}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-input">
                    {tag.emoji || ''} {tag.title}
                  </span>
                {/each}
                {#if draft.tags.length > 3}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-input text-caption">
                    +{draft.tags.length - 3} more
                  </span>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-2 border-t" style="border-color: var(--color-input-border)">
            <button
              on:click={() => editDraft(draft.id)}
              class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              <PencilSimpleIcon size={16} />
              Continue Editing
            </button>
            <button
              on:click={() => handleDeleteDraft(draft.id, draft.title)}
              class="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors cursor-pointer"
              title="Delete draft"
            >
              <TrashIcon size={20} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

