<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import HeartIcon from 'phosphor-svelte/lib/Heart';

  export let event: NDKEvent;
  let loading = true;
  let totalLikeAmount: number = 0;
  let liked = false;

  (async () => {
    const sub = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id] // For regular notes, use the event ID instead of 'd' tag
    });

    sub.on('event', (e) => {
      if (e.pubkey == $userPublickey) liked = true;
      totalLikeAmount++;
    });

    sub.on('eose', () => {
      loading = false;
    });
  })();

  async function likePost() {
    if (liked) return;
    await event.react('+', true);
  }
</script>

<button
  on:click={likePost}
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
>
  <HeartIcon size={24} />
  {#if loading}...{:else}{totalLikeAmount}{/if}
</button>
