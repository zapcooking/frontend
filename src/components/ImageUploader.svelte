<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';

  export let setUrl: (url: string) => void;
  export let name = 'file';
  let input: HTMLInputElement;
  let url = '';

  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const body = new FormData();
      body.append('file[]', target.files[0]);
      const result = await uploadToNostrBuild(body);
      if (result && result.data && result.data[0].url) {
        setUrl(result.data[0].url);
        url = result.data[0].url;
      }
    }
  }

  function triggerFileInput() {
    input?.click();
  }

  export async function uploadToNostrBuild(body: any) {
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

    return Fetch.fetchJson(url, {
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
  </div>
</div>
