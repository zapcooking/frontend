<script lang="ts">
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';

  export let event: NDKEvent;
  let loading = true;
  let totalCommentAmount: number = 0;

{
  (async () => {
    const sub = $ndk.subscribe(
      {
        kinds: [1],
        '#a': [
          `${event.kind}:${event.author.hexpubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`
        ]
      },
    );

    sub.on('event', (event) => {
      totalCommentAmount++;
    });

    sub.on('eose', () => {
      loading = false;
    });
  })();
}
</script>

<button 
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  on:click={() => {
    // Find the InlineComments component for this recipe and trigger toggleComments
    const inlineCommentsComponent = document.querySelector(`[data-event-id="${event.id}"]`)?.closest('.inline-comments');
    if (inlineCommentsComponent) {
      // Dispatch a custom event to trigger the toggleComments function
      inlineCommentsComponent.dispatchEvent(new CustomEvent('toggleComments'));
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} class="text-gray-500" />
  {#if loading}...{:else}{totalCommentAmount}{/if}
</button>
