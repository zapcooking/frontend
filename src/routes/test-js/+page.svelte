<script lang="ts">
  import { onMount } from 'svelte';
  
  let status = 'Loading...';
  let counter = 0;
  
  onMount(() => {
    status = 'JavaScript is executing!';
    console.log('Test JS page mounted, JavaScript is running.');
    
    const interval = setInterval(() => {
      counter++;
    }, 1000);
    
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>JavaScript Test - Zap Cooking</title>
</svelte:head>

<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 16px;">JavaScript Execution Test</h1>
  
  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px;">
    <h2 style="font-weight: 600; margin-bottom: 8px;">Status:</h2>
    <p style="font-family: monospace; font-size: 14px;">{status}</p>
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
