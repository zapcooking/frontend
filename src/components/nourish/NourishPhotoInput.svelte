<script lang="ts">
  /**
   * NourishPhotoInput — visual photo upload/capture card.
   *
   * Large drop zone with camera/gallery options.
   * Shows preview with remove button when image is selected.
   */

  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
  import XIcon from 'phosphor-svelte/lib/X';
  import ImageIcon from 'phosphor-svelte/lib/Image';

  export let imageData: string | null = null;
  export let disabled: boolean = false;

  let fileInput: HTMLInputElement;
  let cameraInput: HTMLInputElement;
  let dragOver = false;

  const MAX_SIZE = 20 * 1024 * 1024; // 20MB
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_SIZE) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      imageData = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) handleFile(input.files[0]);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (disabled) return;
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) dragOver = true;
  }

  function clear() {
    imageData = null;
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
  }
</script>

{#if imageData}
  <!-- Preview state -->
  <div class="photo-preview">
    <img src={imageData} alt="Food to analyze" class="preview-image" />
    <button class="preview-remove" on:click={clear} aria-label="Remove image" {disabled}>
      <XIcon size={16} weight="bold" />
    </button>
  </div>
{:else}
  <!-- Upload state -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="photo-dropzone"
    class:dragOver
    class:disabled
    on:drop={handleDrop}
    on:dragover={handleDragOver}
    on:dragleave={() => { dragOver = false; }}
  >
    <div class="dropzone-icon">
      <ImageIcon size={32} weight="light" />
    </div>
    <p class="dropzone-text">Take a photo or upload an image of your meal</p>
    <div class="dropzone-actions">
      <button class="dropzone-btn" on:click={() => cameraInput?.click()} {disabled}>
        <CameraIcon size={16} />
        Camera
      </button>
      <button class="dropzone-btn" on:click={() => fileInput?.click()} {disabled}>
        <UploadIcon size={16} />
        Upload
      </button>
    </div>
  </div>
{/if}

<input
  bind:this={cameraInput}
  type="file"
  accept={ACCEPT}
  capture="environment"
  on:change={handleFileInput}
  class="hidden"
/>
<input
  bind:this={fileInput}
  type="file"
  accept={ACCEPT}
  on:change={handleFileInput}
  class="hidden"
/>

<style>
  .hidden { display: none; }

  /* Drop zone */
  .photo-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1.5rem;
    border-radius: 0.75rem;
    border: 2px dashed var(--color-input-border, rgba(255, 255, 255, 0.1));
    background: var(--color-input-bg, rgba(255, 255, 255, 0.02));
    transition: border-color 150ms, background 150ms;
    cursor: pointer;
  }
  .photo-dropzone.dragOver {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.04);
  }
  .photo-dropzone.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dropzone-icon {
    color: var(--color-text-secondary);
    opacity: 0.3;
  }

  .dropzone-text {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    text-align: center;
    margin: 0;
  }

  .dropzone-actions {
    display: flex;
    gap: 0.5rem;
  }

  .dropzone-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.1));
    background: var(--color-input-bg, rgba(255, 255, 255, 0.04));
    color: var(--color-text-primary);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, border-color 150ms;
  }
  .dropzone-btn:hover {
    background: rgba(34, 197, 94, 0.06);
    border-color: rgba(34, 197, 94, 0.3);
  }

  /* Preview */
  .photo-preview {
    position: relative;
    border-radius: 0.75rem;
    overflow: hidden;
    max-height: 240px;
  }

  .preview-image {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    display: block;
    border-radius: 0.75rem;
  }

  .preview-remove {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border: none;
    cursor: pointer;
    transition: background 150ms;
  }
  .preview-remove:hover {
    background: rgba(0, 0, 0, 0.8);
  }
</style>
