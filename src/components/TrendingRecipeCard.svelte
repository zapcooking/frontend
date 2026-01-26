<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from './CustomAvatar.svelte';
  import { goto } from '$app/navigation';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';

  export let event: NDKEvent | null = null;

  let imageUrl = '';
  let title = '';
  let link = '';
  let authorPubkey: string | null = null;

  $: {
    if (event && event.tags) {
      const d = event.tags.find((t) => Array.isArray(t) && t[0] == 'd')?.[1];
      if (d && event.author?.pubkey) {
        try {
          const naddr = nip19.naddrEncode({
            identifier: d,
            kind: event.kind || 30023,
            pubkey: event.author.pubkey
          });
          link = `/recipe/${naddr}`;
        } catch (e) {
          console.warn('Failed to encode naddr:', e);
        }
      }

      const rawImageUrl = event.tags.find((e) => Array.isArray(e) && e[0] == 'image')?.[1] || '';
      imageUrl = getImageOrPlaceholder(rawImageUrl, event.id);
      title =
        event.tags.find((e) => Array.isArray(e) && e[0] == 'title')?.[1] ||
        event.tags.find((e) => Array.isArray(e) && e[0] == 'd')?.[1] ||
        'Untitled Recipe';
      authorPubkey = event.author?.pubkey || null;
    } else {
      imageUrl = getImageOrPlaceholder('');
      title = 'Untitled Recipe';
      link = '';
      authorPubkey = null;
    }
  }

  function handleClick() {
    if (link) {
      goto(link);
    }
  }
</script>

{#if event}
  <button
    on:click={handleClick}
    type="button"
    class="flex-shrink-0 w-56 h-72 rounded-xl overflow-hidden relative group cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
  >
    <!-- Recipe Image -->
    <div
      class="absolute inset-0"
      style="background-image: url('{imageUrl}'); background-size: cover; background-position: center;"
    >
      <div class="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors"></div>
    </div>

    <!-- Author Avatar Overlay -->
    {#if authorPubkey}
      <div class="absolute top-3 left-3">
        <CustomAvatar pubkey={authorPubkey} size={32} className="ring-2 ring-white" />
      </div>
    {/if}

    <!-- Content -->
    <div
      class="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/60 to-transparent"
    >
      <h3 class="!text-white font-semibold text-sm line-clamp-2">{title}</h3>
    </div>
  </button>
{/if}
