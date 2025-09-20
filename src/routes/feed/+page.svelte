<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PostModal from '../../components/PostModal.svelte';
  import { userPublickey } from '$lib/nostr';
  import AddIcon from 'phosphor-svelte/lib/Plus';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let showPostModal = false;
</script>

<svelte:head>
  <title>Feed - Zap.Cooking</title>
  <meta name="description" content="Feed - Discover delicious food content from the Nostr network" />
</svelte:head>

<div class="container mx-auto px-4 max-w-2xl">
  <FoodstrFeedOptimized />
</div>

<!-- Floating + Button for writing notes -->
{#if $userPublickey !== ''}
  <button
    class="fixed bottom-6 right-6 w-14 h-14 bg-primary hover:bg-[#d64000] text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center z-50 print:hidden"
    on:click={() => showPostModal = true}
    title="Post to feed"
  >
    <AddIcon size={24} weight="bold" />
  </button>
{/if}

<!-- Post Modal -->
<PostModal bind:open={showPostModal} />
