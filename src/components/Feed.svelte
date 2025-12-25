<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import RecipeCard from './RecipeCard.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';

  export let events: NDKEvent[];
  export let hideHide = false;
  export let lists = false;
  export let loaded = false;

  // Simple filtering - same as original Feed.svelte
  if (!lists) {
    events = events.filter((e) => typeof validateMarkdownTemplate(e.content) !== 'string');
  }
</script>


{#if events.length > 0}
  <div
    class="grid gap-x-2 gap-y-10 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 justify-items-center"
  >
    {#each events as event (event.id)}
      {#if !(hideHide == true && event.tags.find((t) => t[0] == 't' && t[1] == 'nostrcooking-hide'))}
        <RecipeCard list={lists} {event} />
      {/if}
    {/each}
  </div>
{:else if !loaded}
  <!-- Loading skeletons -->
  <div
    class="grid gap-x-2 gap-y-10 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 justify-items-center"
  >
    {#each new Array(24) as i}
      <div
        class="flex flex-col gap-4 w-full max-w-[160px] justify-self-center"
      >
        <div
          class="rounded-3xl w-[160px] h-[237px] transition relative overflow-hidden bg-cover bg-center animate-pulse image-placeholder"
        />
      </div>
    {/each}
  </div>
{:else}
  <!-- Empty state -->
  <div class="text-center py-12 text-caption">
    <p class="text-lg">No {lists ? 'lists' : 'recipes'} found</p>
  </div>
{/if}