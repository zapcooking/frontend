<script lang="ts">
  import type { Writable } from 'svelte/store';
  import { writable } from 'svelte/store';
  import { ndk } from '$lib/nostr';
  import { uploadToNostrBuild } from '$lib/mediaUpload';
  import XIcon from 'phosphor-svelte/lib/X';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import AltTextEditorModal from './AltTextEditorModal.svelte';

  export let uploadedImages: Writable<string[]>;
  /**
   * Optional per-URL alt text (NIP-92 imeta). Pass a writable from the
   * editor so the publish step can emit imeta tags; defaults to an
   * internal store so the badges work even in hosts that don't publish
   * alt yet.
   */
  export let altTexts: Writable<Record<string, string>> | null = null;
  export let limit = 0; // 0 = unlimited

  const alts = altTexts ?? writable<Record<string, string>>({});

  let altModalOpen = false;
  let altModalUrl = '';
  let altModalInitial = '';

  function openAltEditor(url: string) {
    altModalUrl = url;
    altModalInitial = $alts[url] || '';
    altModalOpen = true;
  }

  function saveAltEditor(e: CustomEvent<{ text: string }>) {
    const url = altModalUrl;
    if (!url) return;
    alts.update((map) => {
      const next = { ...map };
      if (e.detail.text) next[url] = e.detail.text;
      else delete next[url];
      return next;
    });
  }

  function removeAlt(url: string) {
    alts.update((map) => {
      if (!(url in map)) return map;
      const next = { ...map };
      delete next[url];
      return next;
    });
  }

  let fileInput: HTMLInputElement;
  let isDragging = false;
  let isUploading = false;
  let uploadProgress = '';

  let urlInput = '';
  let urlError = '';
  let urlSectionOpen = false;

  function addByUrl() {
    urlError = '';
    const value = urlInput.trim();
    if (!value) return;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      urlError = 'Enter a valid URL (including https://).';
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      urlError = 'URL must start with http:// or https://.';
      return;
    }
    // Normalize via URL so `example.com` vs `example.com/` (or different
    // casing/encoding) collapse to the same entry for the dedupe check.
    const normalizedUrl = parsed.toString();
    if (limit > 0 && $uploadedImages.length >= limit) {
      urlError = `Limit of ${limit} media reached.`;
      return;
    }
    if ($uploadedImages.includes(normalizedUrl)) {
      urlError = 'That URL is already added.';
      return;
    }

    uploadedImages.update((imgs) => [...imgs, normalizedUrl]);
    urlInput = '';
  }

  function handleUrlKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addByUrl();
    }
  }

  // Check if URL is a video
  function isVideo(url: string): boolean {
    return /\.(mp4|webm|mov|avi)$/i.test(url);
  }

  // Upload a single file to nostr.build (shared NIP-98 helper handles auth +
  // remote-signer retry). Returns the URL, or null on failure.
  async function uploadFile(file: File): Promise<string | null> {
    try {
      const body = new FormData();
      body.append('file[]', file);
      const result = await uploadToNostrBuild($ndk, body);
      if (result?.data?.[0]?.url) {
        return result.data[0].url;
      }
    } catch (error) {
      console.error('Upload failed:', error);
    }
    return null;
  }

  async function handleFiles(files: FileList) {
    if (files.length === 0) return;

    isUploading = true;
    const totalFiles = files.length;
    let uploaded = 0;

    for (const file of Array.from(files)) {
      // Check file type
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        continue;
      }

      // Check limit
      if (limit > 0 && $uploadedImages.length >= limit) {
        break;
      }

      uploadProgress = `Uploading ${uploaded + 1} of ${totalFiles}...`;
      const url = await uploadFile(file);

      if (url) {
        uploadedImages.update(imgs => [...imgs, url]);
        uploaded++;
      }
    }

    isUploading = false;
    uploadProgress = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      handleFiles(target.files);
    }
  }

  function removeImage(index: number) {
    uploadedImages.update(imgs => {
      const newImgs = [...imgs];
      const [removed] = newImgs.splice(index, 1);
      if (removed) removeAlt(removed);
      return newImgs;
    });
  }

  function makeCover(index: number) {
    if (index === 0) return; // Already the cover
    uploadedImages.update(imgs => {
      const newImgs = [...imgs];
      const [item] = newImgs.splice(index, 1);
      newImgs.unshift(item);
      return newImgs;
    });
  }

  $: coverImage = $uploadedImages[0] || null;
  $: additionalMedia = $uploadedImages.slice(1);
</script>

<div class="flex flex-col gap-4">
  <!-- Upload Area -->
  <div
    class="relative flex justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-all duration-200 cursor-pointer"
    class:border-primary={isDragging}
    style="border-color: {isDragging ? 'var(--color-primary)' : 'var(--color-input-border)'}; background-color: var(--color-input-bg)"
    on:drop={handleDrop}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:click={() => fileInput.click()}
    role="button"
    tabindex="0"
    on:keypress={(e) => e.key === 'Enter' && fileInput.click()}
  >
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*,video/mp4,video/webm"
      multiple
      class="hidden"
      on:change={handleFileSelect}
    />
    
    <div class="text-center">
      {#if isUploading}
        <div class="flex flex-col items-center gap-2">
          <ArrowsClockwiseIcon size={32} class="animate-spin text-primary" />
          <p class="text-sm text-caption">{uploadProgress}</p>
        </div>
      {:else}
        <UploadIcon size={32} class="mx-auto text-caption mb-2" />
        <div class="flex gap-1 text-sm leading-6 items-center justify-center">
          <span class="font-semibold text-primary">Upload files</span>
          <span class="text-caption">or drag and drop</span>
        </div>
        <p class="text-xs leading-5 text-caption mt-1">JPG, PNG, WEBP, GIF, MP4</p>
      {/if}
    </div>
  </div>

  <!-- Cover Photo Preview -->
  {#if coverImage}
    <div class="flex flex-col gap-2">
      <div class="relative group">
        {#if isVideo(coverImage)}
          <video
            src={coverImage}
            class="w-full max-h-[300px] object-cover rounded-xl"
            controls
          />
        {:else}
          <img
            src={coverImage}
            alt="Cover"
            class="w-full max-h-[300px] object-cover rounded-xl"
          />
        {/if}
        
        <!-- Remove button -->
        <button
          type="button"
          class="absolute top-3 right-3 bg-black/60 hover:bg-red-500 text-white rounded-full p-2 transition-all duration-200 cursor-pointer"
          on:click|stopPropagation={() => removeImage(0)}
          aria-label="Remove cover"
        >
          <XIcon size={16} weight="bold" />
        </button>

        <!-- Alt text badge -->
        {#if !isVideo(coverImage)}
          <button
            type="button"
            class="mu-alt-toggle"
            class:has-alt={!!$alts[coverImage]?.trim()}
            on:click|stopPropagation={() => openAltEditor(coverImage)}
            aria-label={$alts[coverImage]?.trim() ? 'Edit alt text' : 'Add alt text'}
          >
            {$alts[coverImage]?.trim() ? '✓ ALT' : '+ ALT'}
          </button>
        {/if}
        
        <!-- Cover badge -->
        <div class="absolute bottom-3 left-3 bg-black/60 text-white text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1">
          <ImageIcon size={14} />
          Cover Photo
        </div>
      </div>
    </div>
  {/if}

  <!-- Additional Media -->
  {#if coverImage}
    <div class="flex flex-col gap-2">
      <p class="text-sm text-caption font-medium">Additional Media {#if additionalMedia.length > 0}(tap to make cover){/if}</p>
      <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
        {#each additionalMedia as media, idx}
          {@const actualIndex = idx + 1}
          <!-- Tile is a plain container; make-cover, remove and alt are
               sibling controls so no button nests inside another. -->
          <div
            class="relative group aspect-square rounded-lg overflow-hidden hover:ring-2 hover:ring-primary focus-within:ring-2 focus-within:ring-primary transition-all"
          >
            {#if isVideo(media)}
              <div class="absolute inset-0 bg-black/20 flex items-center justify-center">
                <PlayIcon size={24} class="text-white" weight="fill" />
              </div>
              <video
                src={media}
                class="w-full h-full object-cover"
                aria-label={`Additional media video ${actualIndex + 1}`}
                title={`Additional media video ${actualIndex + 1}`}
              />
            {:else}
              <img
                src={media}
                alt={$alts[media]?.trim() || `Media ${actualIndex}`}
                class="w-full h-full object-cover"
              />
            {/if}

            <!-- Make-cover control: transparent hit target over the media -->
            <button
              type="button"
              class="absolute inset-0 w-full h-full cursor-pointer focus:outline-none"
              on:click={() => makeCover(actualIndex)}
              aria-label="Make media {actualIndex} the cover"
            ></button>
            
            <!-- Number badge -->
            <div class="absolute bottom-1 left-1 bg-black/60 text-white text-xs font-bold w-5 h-5 rounded flex items-center justify-center pointer-events-none">
              {actualIndex}
            </div>
            
            <!-- Remove button -->
            <button
              type="button"
              class="absolute top-1 right-1 z-10 bg-black/60 hover:bg-red-500 text-white rounded-full p-1 transition-all duration-200 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
              on:click={() => removeImage(actualIndex)}
              aria-label="Remove media {actualIndex}"
            >
              <XIcon size={12} weight="bold" />
            </button>

            <!-- Alt text badge (images only) -->
            {#if !isVideo(media)}
              <button
                type="button"
                class="mu-alt-toggle mu-alt-toggle--small"
                class:has-alt={!!$alts[media]?.trim()}
                on:click={() => openAltEditor(media)}
                aria-label={$alts[media]?.trim() ? `Edit alt text for media ${actualIndex}` : `Add alt text for media ${actualIndex}`}
              >
                {$alts[media]?.trim() ? '✓' : '+'}
              </button>
            {/if}
          </div>
        {/each}
        
        <!-- Show placeholders for empty slots -->
        {#if additionalMedia.length < 5}
          {#each Array(5 - additionalMedia.length) as _, idx}
            {@const slotNumber = additionalMedia.length + idx + 1}
            <button
              type="button"
              class="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
              style="border-color: var(--color-input-border)"
              on:click={() => fileInput.click()}
            >
              <UploadIcon size={20} class="text-caption" />
              <span class="text-xs text-caption">{slotNumber}</span>
            </button>
          {/each}
        {:else}
          <!-- Add more placeholder (only show if we have 5+ additional items) -->
          <button
            type="button"
            class="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
            style="border-color: var(--color-input-border)"
            on:click={() => fileInput.click()}
          >
            <UploadIcon size={20} class="text-caption" />
            <span class="text-xs text-caption">Add</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Empty state hint -->
  {#if $uploadedImages.length === 0}
    <p class="text-sm text-caption text-center">
      Add photos and videos to showcase your recipe
    </p>
  {/if}

  <!-- Subtle: add media by URL -->
  <div>
    <button
      type="button"
      class="flex items-center gap-1 text-xs text-caption hover:opacity-80 transition-opacity cursor-pointer"
      aria-expanded={urlSectionOpen}
      aria-controls="media-url-panel"
      on:click={() => (urlSectionOpen = !urlSectionOpen)}
    >
      <CaretDownIcon
        size={12}
        class="transition-transform duration-200 {urlSectionOpen ? 'rotate-180' : ''}"
      />
      <span>Add images by URL</span>
    </button>

    {#if urlSectionOpen}
      <div id="media-url-panel" class="flex flex-col gap-1.5 mt-2">
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            bind:value={urlInput}
            on:keydown={handleUrlKeydown}
            placeholder="https://example.com/photo.jpg"
            class="flex-1 rounded-md px-2.5 py-1.5 text-xs border focus:outline-none focus:ring-1 focus:ring-primary/40"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border-color: var(--color-input-border)"
          />
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-accent-gray disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            style="color: var(--color-text-primary); border-color: var(--color-input-border)"
            disabled={!urlInput.trim()}
            on:click={addByUrl}
          >
            Add
          </button>
        </div>
        {#if urlError}
          <p class="text-xs text-red-500">{urlError}</p>
        {/if}
      </div>
    {/if}
  </div>

  <AltTextEditorModal
    url={altModalUrl}
    initialText={altModalInitial}
    bind:open={altModalOpen}
    on:save={saveAltEditor}
  />
</div>

<style>
  .mu-alt-toggle {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 5;
    padding: 2px 8px;
    border: none;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }
  .mu-alt-toggle--small {
    top: 1.75rem;
    left: 0.25rem;
    padding: 1px 5px;
  }
  .mu-alt-toggle:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .mu-alt-toggle.has-alt {
    background: var(--color-primary, #f97316);
  }
</style>

