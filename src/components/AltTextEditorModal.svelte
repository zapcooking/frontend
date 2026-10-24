<script lang="ts">
  /**
   * Shared per-image alt text editor. Used by the
   * post composer, the media uploader (recipes/articles), replies, and
   * the longform cover — anywhere an image can gain a description.
   *
   * Includes the Cook+ AI generator: the image is fetched, passed to
   * /api/zappy/ask-photo in alt mode (membership-gated server-side),
   * and the description lands in the field for the member to edit or
   * accept. The fetch step needs CORS on the image host — uploads to
   * nostr.build/Blossom have it; arbitrary pasted URLs may not.
   */
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import Modal from './Modal.svelte';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';

  export let url = '';
  /** Draft seed — reset every time the modal opens. */
  export let initialText = '';
  export let open = false;
  export let maxLength = 2000;

  const dispatch = createEventDispatcher<{ save: { text: string } }>();

  let draft = '';
  let generating = false;
  let genError = '';

  // Re-seed the draft each time the modal is opened for an image.
  $: if (open) {
    draft = initialText;
    genError = '';
    generating = false;
  }

  async function fetchImageAsBase64(imageUrl: string): Promise<string> {
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error('The image could not be loaded for analysis.');
    const blob = await resp.blob();
    const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const file = new File([blob], 'image', { type });
    const { fileToBase64 } = await import('$lib/photoAsk');
    return fileToBase64(file);
  }

  async function generateWithAI() {
    if (!url || generating) return;
    generating = true;
    genError = '';
    try {
      const [imageBase64, { askAboutPhoto }, { getAuthManager }, { ndk: ndkStore }] =
        await Promise.all([
          fetchImageAsBase64(url),
          import('$lib/photoAsk'),
          import('$lib/authManager'),
          import('$lib/nostr')
        ]);
      const authManager = getAuthManager();
      if (authManager) await authManager.ensureNip46SignerReady();
      const ndkInstance = get(ndkStore);
      if (!ndkInstance) throw new Error('Not connected.');

      const result = await askAboutPhoto({ ndk: ndkInstance, imageBase64, purpose: 'alt' });
      if (result.ok) {
        draft = result.output.trim().slice(0, maxLength);
      } else if (result.code === 'NOT_MEMBER') {
        genError = 'AI descriptions are a Cook+ feature. Upgrade to generate alt text automatically.';
      } else if (result.code === 'RATE_LIMITED') {
        genError = 'You have hit the AI limit for now — please try again a little later.';
      } else if (result.code === 'NOT_FOOD') {
        // Should not happen in alt mode; belt and braces.
        genError = 'The AI could not describe this image.';
      } else {
        genError = result.error || 'The AI could not describe this image. Please try again.';
      }
    } catch (err) {
      // CORS-blocked fetches surface as opaque TypeErrors here.
      console.warn('[AltEditor] generation failed:', err);
      genError = 'The image host blocked analysis (CORS). Describe it manually, or re-upload via a supported host.';
    } finally {
      generating = false;
    }
  }

  function save() {
    dispatch('save', { text: draft.trim() });
    open = false;
  }
</script>

{#if open}
  <Modal bind:open compact autoHeight>
    <span slot="title">Edit alt text</span>
    <div class="alt-editor">
      {#if url}
        <img src={url} alt="" class="alt-editor-preview" />
      {/if}
      <button type="button" class="alt-ai-button" on:click={generateWithAI} disabled={generating || !url}>
        <span class="alt-ai-icon" class:spinning={generating}>
          <SparkleIcon size={16} weight="fill" />
        </span>
        {#if generating}
          Describing the image…
        {:else}
          Generate with AI <span class="alt-ai-badge">Cook+</span>
        {/if}
      </button>
      {#if genError}
        <p class="alt-ai-error" role="alert">{genError}</p>
      {/if}
      <div class="alt-editor-banner" role="note">
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>A short description makes your photo accessible to screen reader users — and gives everyone context if the image doesn’t load.</span>
      </div>
      <label class="alt-editor-label" for="alt-editor-input">Descriptive alt text</label>
      <textarea
        id="alt-editor-input"
        class="alt-editor-textarea"
        bind:value={draft}
        maxlength={maxLength}
        placeholder="e.g. A bowl of tomato soup with a grilled cheese sandwich on a wooden table"
      ></textarea>
      <div class="alt-editor-footer">
        <span class="alt-editor-count" class:near-limit={maxLength - draft.length <= 100}>
          {maxLength - draft.length}
        </span>
        <button type="button" class="alt-editor-save" on:click={save}>Save</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .alt-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .alt-editor-preview {
    width: 100%;
    max-height: 16rem;
    object-fit: contain;
    border-radius: 0.625rem;
    background: var(--color-input, #1f2937);
  }
  .alt-ai-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    align-self: flex-start;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-primary);
    border-radius: 9999px;
    background: transparent;
    color: var(--color-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }
  .alt-ai-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
  .alt-ai-button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .alt-ai-badge {
    padding: 0 0.4rem;
    border-radius: 9999px;
    background: var(--color-primary);
    color: #fff;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .alt-ai-icon {
    display: inline-flex;
  }
  .spinning {
    animation: alt-spin 1.1s linear infinite;
  }
  @keyframes alt-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .alt-ai-error {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: #ef4444;
  }
  .alt-editor-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.625rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--color-caption);
  }
  .alt-editor-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-caption);
  }
  .alt-editor-textarea {
    width: 100%;
    min-height: 6rem;
    padding: 0.625rem 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.45;
    border: 1px solid var(--color-input-border);
    border-radius: 0.625rem;
    background: var(--color-input, transparent);
    color: var(--color-text-primary);
    resize: vertical;
  }
  .alt-editor-textarea:focus {
    outline: none;
    border-color: var(--color-primary);
  }
  .alt-editor-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .alt-editor-count {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .alt-editor-count.near-limit {
    color: #ef4444;
  }
  .alt-editor-save {
    flex: 1;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: 9999px;
    background: var(--color-primary, #f97316);
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s ease-out;
  }
  .alt-editor-save:hover {
    opacity: 0.9;
  }
</style>
