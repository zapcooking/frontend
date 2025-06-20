<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';
  import Button from './Button.svelte';
  import Comment from './Comment.svelte';

  export let event: NDKEvent;
  let events = [];

async function subscribe() {
  const sub = $ndk.subscribe({
    kinds: [1],
    '#a': [`${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`]
  }, { closeOnEose: false });

  sub.on('event', (event) => {
    events.push(event);
    console.log(event);
    events = events;
  });
}

  $: {
    subscribe();
  }

  let commentText = '';
  async function postComment() {
    const ev = new NDKEvent($ndk);
    ev.kind = 1;
    ev.content = commentText;
    ev.tags = [
      ['a', `${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`]
    ];

    await ev.publish();
  }
</script>

<div class="flex flex-col gap-6">
  <h1>Comments</h1>
  <ul class="flex flex-col gap-4">
    {#if events}
      {#if events.length == 0}
        No comments yet!
      {/if}
      {#each events.filter((e) => e.getMatchingTags('e').length === 0) as ev, i}
        <li>
          <Comment
            replies={events.filter((e) =>
              e.getMatchingTags('e').find((v) => v[1] === ev.id)
            )}
            event={ev}
            refresh={fetch}
          />
          {#if events[i + 1]}
            <hr />
          {/if}
        </li>
      {/each}
    {:else}
      Loading...
    {/if}
  </ul>
  <div class="flex flex-col gap-6 print:hidden">
    <h2>Reply</h2>
  <textarea
    bind:value={commentText}
    class="bg-input border-input focus:ring-primary focus:border-primary rounded-3xl px-8 py-6 transition duration-300"
    rows="6"
    placeholder="This tastes..."
  />
  <Button on:click={postComment} class="self-end">Post Reply</Button>
  </div>
</div>
