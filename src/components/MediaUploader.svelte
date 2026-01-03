<script lang="ts">
  import type { Writable } from 'svelte/store';
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';
  import XIcon from 'phosphor-svelte/lib/X';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';

  export let uploadedImages: Writable<string[]>;
  export let limit = 0; // 0 = unlimited

  let fileInput: HTMLInputElement;
  let isDragging = false;
  let isUploading = false;
  let uploadProgress = '';

  // Check if URL is a video
  function isVideo(url: string): boolean {
    return /\.(mp4|webm|mov|avi)$/i.test(url) || url.includes('video');
  }

  // Upload to nostr.build
  async function uploadToNostrBuild(file: File): Promise<string | null> {
    const body = new FormData();
    body.append('file[]', file);
    
    const url = 'https://nostr.build/api/v2/upload/files';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();
    
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    try {
      const result = await Fetch.fetchJson(url, {
        body,
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
        }
      });
      
      if (result && result.data && result.data[0]?.url) {
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
      const url = await uploadToNostrBuild(file);
      
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
      newImgs.splice(index, 1);
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
          <div 
            class="relative group aspect-square rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
            on:click={() => makeCover(actualIndex)}
            on:keypress={(e) => e.key === 'Enter' && makeCover(actualIndex)}
            role="button"
            tabindex="0"
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
              <img src={media} alt="Media {actualIndex}" class="w-full h-full object-cover" />
            {/if}
            
            <!-- Number badge -->
            <div class="absolute bottom-1 left-1 bg-black/60 text-white text-xs font-bold w-5 h-5 rounded flex items-center justify-center">
              {actualIndex}
            </div>
            
            <!-- Remove button -->
            <button
              type="button"
              class="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white rounded-full p-1 transition-all duration-200 opacity-0 group-hover:opacity-100 cursor-pointer"
              on:click|stopPropagation={() => removeImage(actualIndex)}
              aria-label="Remove media"
            >
              <XIcon size={12} weight="bold" />
            </button>
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
</div>

