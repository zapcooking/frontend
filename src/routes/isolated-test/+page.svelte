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
  <title>Isolated Test - zap.cooking</title>
</svelte:head>

<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 16px;">Isolated JavaScript Test</h1>
  
  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px;">
    <h2 style="font-weight: 600; margin-bottom: 8px;">Status:</h2>
    <p style="font-family: monospace; font-size: 14px;">{message}</p>
    <p style="font-size: 14px; color: #6b7280; margin-top: 8px;">Counter: {counter}</p>
  </div>
  
  <div style="margin-top: 24px;">
    <h2 style="font-weight: 600; margin-bottom: 8px;">Test Links:</h2>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <a href="/" style="color: #2563eb; text-decoration: none;">Home</a>
      <a href="/feed" style="color: #2563eb; text-decoration: none;">Feed</a>
    </div>
  </div>
</div>
