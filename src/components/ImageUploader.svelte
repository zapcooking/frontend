<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';

  export let setUrl: (url: string) => void;
  export let name = 'file';
  let input: HTMLInputElement;
  let uploading = false;
  let uploadError = '';

  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      uploading = true;
      uploadError = '';
      try {
        const body = new FormData();
        body.append('file[]', target.files[0]);
        const result = await uploadToNostrBuild(body);
        if (result && result.data && result.data[0].url) {
          setUrl(result.data[0].url);
        } else {
          uploadError = 'Upload failed — no URL returned. Please try again.';
        }
      } catch (err: any) {
        console.error('[ImageUploader] Upload failed:', err);
        uploadError = err.message || 'Upload failed. Please try again.';
      } finally {
        uploading = false;
        // Reset input so the same file can be re-selected
        if (input) input.value = '';
      }
    }
  }

  function triggerFileInput() {
    if (uploading) return;
    input?.click();
  }

  export async function uploadToNostrBuild(body: any) {
    const uploadUrl = 'https://nostr.build/api/v2/upload/files';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', uploadUrl],
      ['method', 'POST']
    ];

    // Sign with a timeout — extension popups can get blocked in overlays
    const signResult = await Promise.race([
      template.sign().then(() => true).catch(() => { throw new Error('Signing failed — are you signed in?'); }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Signing timed out — check your Nostr extension popup.')), 30000))
    ]);

    // Ensure all fields are properly formatted according to NIP-98
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    return Fetch.fetchJson(uploadUrl, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });
  }
</script>

<div
  class="flex justify-center bg-input rounded-lg border border-dashed px-6 py-10"
  style="border-color: var(--color-input-border)"
>
  <div class="text-center">
    <input
      bind:this={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      on:change={handleFileChange}
      class="hidden"
    />
    {#if uploading}
      <div class="flex flex-col items-center gap-2 py-2">
        <div class="upload-spinner"></div>
        <p class="text-sm text-caption">Uploading...</p>
        <p class="text-xs text-caption" style="opacity: 0.6;">Check for a signing popup from your Nostr extension</p>
      </div>
    {:else}
      <div class="flex gap-0.5 text-sm leading-6 items-center">
        <button
          type="button"
          on:click={triggerFileInput}
          class="relative cursor-pointer rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 hover:opacity-80 text-primary"
        >
          Upload {name}
        </button>
        <p class="pl-1 text-caption">or drag and drop</p>
      </div>
      <p class="text-xs leading-5 text-caption">JPG, PNG, WEBP, or GIF</p>
      {#if uploadError}
        <p class="text-xs mt-2" style="color: #ef4444;">{uploadError}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .upload-spinner {
    width: 24px;
    height: 24px;
    border: 2.5px solid var(--color-input-border);
    border-top-color: var(--color-primary, #f97316);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
