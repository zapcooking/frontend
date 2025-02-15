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

<a href="#comments" class="flex gap-1.5">
  <CommentIcon size={24} />
  {#if loading}...{:else}{totalCommentAmount}{/if}
</a>
