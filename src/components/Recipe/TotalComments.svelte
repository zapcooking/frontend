<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
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
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer self-center"
  on:click={() => {
    // Scroll to comments section
    const commentsSection = document.getElementById('comments-section');
    if (commentsSection) {
      commentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Auto-focus the comment input after scroll completes
      setTimeout(() => {
        const commentInput = document.getElementById('comment-input');
        if (commentInput) {
          commentInput.focus();
        }
      }, 500); // Wait for smooth scroll to complete
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} />
  {#if loading}...{:else}{totalCommentAmount}{/if}
</button>
