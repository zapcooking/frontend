<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
</script>

<svelte:head>
  <title>Feed - Nostr.Cooking</title>
  <meta name="description" content="Feed - Discover delicious food content from the Nostr network" />
</svelte:head>

<div class="container mx-auto px-4 max-w-2xl">
  <div class="mb-6 sm:mb-8">
    <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Feed Me 🍴</h1>
    <p class="text-sm sm:text-base text-gray-600">Explore what the Nostr food community is cooking up</p>
  </div>
  
  <FoodstrFeedOptimized />
</div>
