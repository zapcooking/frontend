<script lang="ts">
  import { onMount } from 'svelte';
  
  let message = 'Loading...';
  let counter = 0;
  
  onMount(() => {
    message = '✅ JavaScript is working!';
    
    // Test reactivity
    const interval = setInterval(() => {
      counter++;
      if (counter >= 5) {
        clearInterval(interval);
        message = '✅ JavaScript and reactivity working perfectly!';
      }
    }, 1000);
    
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>Minimal Test - Zap Cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto p-6">
  <h1 class="text-2xl font-bold mb-4">Minimal JavaScript Test</h1>
  
  <div class="bg-gray-100 p-4 rounded-lg">
    <h2 class="font-semibold mb-2">Status:</h2>
    <p class="font-mono text-sm">{message}</p>
    <p class="text-sm text-gray-600 mt-2">Counter: {counter}</p>
  </div>
  
  <div class="mt-6">
    <h2 class="font-semibold mb-2">Test Links:</h2>
    <div class="space-y-2">
      <a href="/" class="block text-blue-600 hover:text-blue-800">Home</a>
      <a href="/feed" class="block text-blue-600 hover:text-blue-800">Feed</a>
    </div>
  </div>
</div>
