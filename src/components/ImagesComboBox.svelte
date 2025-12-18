<script lang="ts">
  import type { Writable } from 'svelte/store';
  import ImageUploader from './ImageUploader.svelte';

  export let uploadedImages: Writable<string[]>;
  // 0 is unlimited, and anything above that has a hard limit.
  export let limit = 0;

  function removeImage(index: number) {
    let nSelected = $uploadedImages;
    if (index < 0 || index >= nSelected.length) {
      return; // Index out of bounds
    }

    nSelected = [...nSelected.slice(0, index), ...nSelected.slice(index + 1)];
    uploadedImages.set(nSelected);
  }

  function addImage(url: string) {
    if (limit > 0 && $uploadedImages.length > limit) return; // forbid if limit is hit.
    let nSelected = $uploadedImages;
    nSelected.push(url);
    uploadedImages.set(nSelected);
    return true;
  }

  let refresh = {};
</script>

{#key refresh}
  <div class="sm:col-span-6">
    <div class="mt-1">
      <ImageUploader setUrl={(a) => addImage(a) && (refresh = {})} />
    </div>
  </div>
{/key}

<div class="mb-2">
  {#if $uploadedImages.length > 0}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
      {#each $uploadedImages as image, index}
        <div class="relative group">
          <img class="rounded-lg w-full h-auto object-cover" src={image} alt="Uploaded" />
          <button
            type="button"
            class="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 shadow-lg transition-all duration-200 opacity-90 hover:opacity-100"
            on:click={() => removeImage(index)}
            aria-label="Remove image"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
