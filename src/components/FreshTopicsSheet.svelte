<script lang="ts">
  /**
   * The Fresh topic picker: the feed relay's groups and topics (from its
   * NIP-11, $lib/freshFeed/topicList). Everyone can browse it; picking one
   * opens the topic feed, which is for members (the feed shows the
   * membership card otherwise). A group's name opens all its topics.
   */
  import { createEventDispatcher } from 'svelte';
  import type { Topic, TopicGroup } from '$lib/freshFeed/topicList';
  import Modal from './Modal.svelte';

  export let open = false;
  export let groups: TopicGroup[] = [];
  export let loading = false;

  const dispatch = createEventDispatcher<{ pick: Topic }>();

  function pick(t: Topic) {
    open = false;
    dispatch('pick', { slug: t.slug, name: t.name });
  }
</script>

<Modal bind:open compact>
  <h1 slot="title">Topics</h1>
  {#if loading}
    <p class="text-sm" style="color: var(--color-caption)">Loading topics…</p>
  {:else if groups.length === 0}
    <p class="text-sm" style="color: var(--color-caption)">
      Topics aren't available right now. Please try again later.
    </p>
  {:else}
    <div class="flex flex-col gap-4">
      {#each groups as g (g.slug)}
        <section>
          <button
            type="button"
            class="text-sm font-semibold mb-2 hover:underline"
            style="color: var(--color-text-primary)"
            on:click={() => pick(g)}
          >
            {g.name}
            <span class="text-xs font-normal" style="color: var(--color-caption)">· all</span>
          </button>
          <div class="flex flex-wrap gap-2">
            {#each g.topics as t (t.slug)}
              <button
                type="button"
                class="px-3 py-1.5 rounded-full text-sm hover:bg-accent-gray"
                style="color: var(--color-text-primary); background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                on:click={() => pick(t)}
              >
                {t.name}
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</Modal>
