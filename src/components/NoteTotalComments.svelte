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
        '#e': [event.id] // For regular notes, use the event ID instead of 'd' tag
      },
    );

    sub.on('event', (event) => {
      loading = false;
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
  style="color: var(--color-text-primary)"
  on:click={() => {
    // Find the InlineComments component for this event and trigger toggleComments
    const inlineCommentsComponent = document.querySelector(`[data-event-id="${event.id}"]`)?.closest('.inline-comments');
    if (inlineCommentsComponent) {
      // Dispatch a custom event to trigger the toggleComments function
      inlineCommentsComponent.dispatchEvent(new CustomEvent('toggleComments'));
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} />
  {#if loading}...{:else}{totalCommentAmount}{/if}
</button>
