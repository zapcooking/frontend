<script lang="ts">
  import { onMount } from 'svelte';
  
  let message = 'Loading...';
  
  onMount(() => {
    message = '✅ JavaScript is working!';
  });
</script>

<svelte:head>
  <title>Simple Test - Zap Cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto p-6">
  <h1 class="text-2xl font-bold mb-4">Simple Test Page</h1>
  
  <div class="bg-gray-100 p-4 rounded-lg">
    <h2 class="font-semibold mb-2">Status:</h2>
    <p class="font-mono text-sm">{message}</p>
  </div>
  
  <div class="mt-6">
    <h2 class="font-semibold mb-2">Test Links:</h2>
    <div class="space-y-2">
      <a href="/" class="block text-blue-600 hover:text-blue-800">Home</a>
      <a href="/feed" class="block text-blue-600 hover:text-blue-800">Feed</a>
      <a href="/debug" class="block text-blue-600 hover:text-blue-800">Debug Page</a>
    </div>
  </div>
</div>
