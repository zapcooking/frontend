<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  
  let debugInfo = 'Loading...';
  let isConnected = false;
  
  onMount(async () => {
    try {
      debugInfo = 'Checking NDK connection...';
      
      if ($ndk) {
        debugInfo = 'NDK instance found, checking relay pool...';
        
        // Check if NDK has a pool
        if ($ndk.pool) {
          debugInfo = 'NDK pool found, checking relay status...';
          
          // Get relay URLs
          const relayUrls = $ndk.explicitRelayUrls || [];
          debugInfo = `Found ${relayUrls.length} relays configured: ${relayUrls.join(', ')}`;
          
          // Wait a bit for connection to establish
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          debugInfo = 'Attempting to fetch events with short timeout...';
          
          // Test basic connectivity with shorter timeout
          const filter = { kinds: [1], limit: 1 };
          const fetchPromise = $ndk.fetchEvents(filter);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
          );
          
          const events = await Promise.race([fetchPromise, timeoutPromise]);
          
          debugInfo = `✅ Success! Found ${events.size} events. NDK is working.`;
          isConnected = true;
        } else {
          debugInfo = '❌ NDK pool not found';
        }
      } else {
        debugInfo = '❌ NDK instance not found';
      }
    } catch (error) {
      debugInfo = `❌ Error: ${error.message}`;
      console.error('Debug error:', error);
      
      // Try to get more info about the error
      if (error.message.includes('timeout')) {
        debugInfo += ' - This suggests the relays are not responding.';
      } else if (error.message.includes('WebSocket')) {
        debugInfo += ' - WebSocket connection failed.';
      }
    }
  });
</script>

<svelte:head>
  <title>Debug - zap.cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto p-6">
  <h1 class="text-2xl font-bold mb-4">Debug Page</h1>
  
  <div class="bg-gray-100 p-4 rounded-lg">
    <h2 class="font-semibold mb-2">Connection Status:</h2>
    <p class="font-mono text-sm">{debugInfo}</p>
    
    {#if isConnected}
      <div class="mt-4 p-2 bg-green-100 text-green-800 rounded">
        ✅ NDK is connected and working!
      </div>
    {:else}
      <div class="mt-4 p-2 bg-red-100 text-red-800 rounded">
        ❌ NDK connection failed
      </div>
    {/if}
  </div>
  
  <div class="mt-6">
    <h2 class="font-semibold mb-2">Test Links:</h2>
    <div class="space-y-2">
      <a href="/" class="block text-blue-600 hover:text-blue-800">Home</a>
      <a href="/feed" class="block text-blue-600 hover:text-blue-800">Feed</a>
      <a href="/create" class="block text-blue-600 hover:text-blue-800">Create Recipe</a>
    </div>
  </div>
</div>
