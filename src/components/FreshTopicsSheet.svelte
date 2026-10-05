<script lang="ts">
  /**
   * The full topic list ("More" in the chip row): every group and topic by
   * full name, topics within each group by recent activity
   * ($lib/freshFeed/topicChips sheetGroups). A group's name opens all its
   * topics.
   *
   * Laid out inside the shared Modal with its own header: the header never
   * scrolls and the list scrolls within a height capped to the small
   * viewport (svh), so on iOS Safari the title and close button stay
   * visible and the list ends above the browser's bottom bar.
   */
  import { createEventDispatcher } from 'svelte';
  import CloseIcon from 'phosphor-svelte/lib/X';
  import type { Topic, TopicGroup } from '$lib/freshFeed/topicList';
  import { sheetGroups } from '$lib/freshFeed/topicChips';
  import Modal from './Modal.svelte';

  export let open = false;
  export let groups: TopicGroup[] = [];
  export let loading = false;

  const dispatch = createEventDispatcher<{ pick: Topic }>();

  $: sorted = sheetGroups(groups);

  function pick(t: Topic) {
    open = false;
    dispatch('pick', t);
  }
</script>

<Modal bind:open compact noHeader autoHeight allowOverflow>
  <div class="topics-sheet flex flex-col min-h-0">
    <div class="flex items-center justify-between flex-shrink-0 pb-2">
      <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">Topics</h2>
      <button
        type="button"
        class="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2"
        style="color: var(--color-text-primary)"
        aria-label="Close"
        on:click={() => (open = false)}
      >
        <CloseIcon size={24} />
      </button>
    </div>
    <div class="topics-sheet-list overflow-y-auto overscroll-contain min-h-0 flex-1">
      {#if loading}
        <p class="text-sm" style="color: var(--color-caption)">Loading topics…</p>
      {:else if sorted.length === 0}
        <p class="text-sm" style="color: var(--color-caption)">
          Topics aren't available right now. Please try again later.
        </p>
      {:else}
        <div class="flex flex-col gap-4 pb-1">
          {#each sorted as g (g.slug)}
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
    </div>
  </div>
</Modal>

<style>
  /* Fits the smallest visible viewport (iOS Safari with both bars shown),
     minus the dialog's own margins and padding and the safe areas. */
  .topics-sheet {
    max-height: min(
      80dvh,
      calc(100svh - 6rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
    );
  }
</style>
