<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { standardRelays } from '$lib/consts';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import RelayHealthDebug from '$components/RelayHealthDebug.svelte';
  
  let debugInfo = 'Loading...';
  let isConnected = false;
  let relayTests: Array<{
    url: string;
    status: 'testing' | 'success' | 'error' | 'timeout';
    responseTime?: number;
    eventsReceived?: number;
    error?: string;
  }> = [];
  let isTestingRelays = false;
  
  interface RelayTestResult {
    url: string;
    status: 'testing' | 'success' | 'error' | 'timeout';
    responseTime?: number;
    eventsReceived?: number;
    error?: string;
  }
  
  async function testRelaySpeed(url: string): Promise<RelayTestResult> {
    const result: RelayTestResult = {
      url,
      status: 'testing'
    };
    
    try {
      const startTime = Date.now();
      const testFilter = { kinds: [1], limit: 10 };
      
      // Create a relay set for this specific relay
      const relaySet = NDKRelaySet.fromRelayUrls([url], $ndk, true);
      
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      );
      
      const events = await Promise.race([
        $ndk.fetchEvents(testFilter, undefined, relaySet),
        timeoutPromise
      ]);
      
      const responseTime = Date.now() - startTime;
      
      result.status = 'success';
      result.responseTime = responseTime;
      result.eventsReceived = events.size;
      
    } catch (error: any) {
      if (error.message === 'Timeout') {
        result.status = 'timeout';
        result.error = '10s timeout';
      } else {
        result.status = 'error';
        result.error = error.message || 'Unknown error';
      }
    }
    
    return result;
  }
  
  async function testAllRelays() {
    if (!$ndk || isTestingRelays) return;
    
    isTestingRelays = true;
    relayTests = standardRelays.map(url => ({
      url,
      status: 'testing' as const
    }));
    
    console.log('🏃 Starting relay speed tests...');
    
    // Test all relays in parallel
    const testPromises = standardRelays.map(url => testRelaySpeed(url));
    const results = await Promise.allSettled(testPromises);
    
    relayTests = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          url: standardRelays[index],
          status: 'error' as const,
          error: result.reason?.message || 'Test failed'
        };
      }
    });
    
    // Sort by response time (fastest first)
    relayTests.sort((a, b) => {
      if (a.status === 'success' && b.status === 'success') {
        return (a.responseTime || 0) - (b.responseTime || 0);
      }
      if (a.status === 'success') return -1;
      if (b.status === 'success') return 1;
      return 0;
    });
    
    isTestingRelays = false;
    
    // Log summary
    const successful = relayTests.filter(r => r.status === 'success');
    const avgTime = successful.length > 0
      ? Math.round(successful.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successful.length)
      : 0;
    
    console.log(`✅ Relay speed test complete:`);
    console.log(`   ${successful.length}/${relayTests.length} relays successful`);
    console.log(`   Average response time: ${avgTime}ms`);
    relayTests.forEach(r => {
      if (r.status === 'success') {
        console.log(`   ${r.url}: ${r.responseTime}ms (${r.eventsReceived} events)`);
      } else {
        console.log(`   ${r.url}: ${r.status} (${r.error || ''})`);
      }
    });
  }
  
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
    <h2 class="font-semibold mb-4">Relay Speed Test</h2>
    
    <button
      on:click={testAllRelays}
      disabled={isTestingRelays || !isConnected}
      class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors mb-4"
    >
      {#if isTestingRelays}
        Testing Relays...
      {:else}
        Test All Relays
      {/if}
    </button>
    
    {#if relayTests.length > 0}
      <div class="space-y-2">
        {#each relayTests as test}
          <div class="border border-gray-200 rounded-lg p-3">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <div class="font-mono text-sm font-semibold">{test.url}</div>
                <div class="text-xs text-gray-600 mt-1">
                  {#if test.status === 'testing'}
                    <span class="text-blue-600">⏳ Testing...</span>
                  {:else if test.status === 'success'}
                    <span class="text-green-600">✅ {test.responseTime}ms • {test.eventsReceived} events</span>
                  {:else if test.status === 'timeout'}
                    <span class="text-red-600">⏱️ Timeout (10s)</span>
                  {:else}
                    <span class="text-red-600">❌ {test.error || 'Error'}</span>
                  {/if}
                </div>
              </div>
              {#if test.status === 'success' && test.responseTime}
                <div class="ml-4">
                  {#if test.responseTime < 500}
                    <span class="text-green-600 font-semibold">⚡ Fast</span>
                  {:else if test.responseTime < 1500}
                    <span class="text-yellow-600 font-semibold">🟡 Medium</span>
                  {:else}
                    <span class="text-red-600 font-semibold">🐌 Slow</span>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      
      {@const successful = relayTests.filter(r => r.status === 'success')}
      {@const avgTime = successful.length > 0 ? Math.round(successful.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successful.length) : 0}
      
      {#if successful.length > 0}
        <div class="mt-4 p-3 bg-gray-50 rounded-lg">
          <div class="text-sm">
            <div class="font-semibold">Summary:</div>
            <div class="mt-1">
              {successful.length}/{relayTests.length} relays successful
            </div>
            <div class="mt-1">
              Average response time: <span class="font-mono font-semibold">{avgTime}ms</span>
            </div>
            <div class="mt-1">
              Fastest: <span class="font-mono">{successful[0]?.responseTime}ms</span> ({successful[0]?.url})
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
  
  <!-- Relay Health Monitor -->
  <div class="mt-8">
    <h2 class="font-semibold mb-4">Relay Health Tracking</h2>
    <RelayHealthDebug />
  </div>
  
  <div class="mt-6">
    <h2 class="font-semibold mb-2">Test Links:</h2>
    <div class="space-y-2">
      <a href="/" class="block text-blue-600 hover:text-blue-800">Home</a>
      <a href="/community" class="block text-blue-600 hover:text-blue-800">Community</a>
      <a href="/create" class="block text-blue-600 hover:text-blue-800">Create Recipe</a>
    </div>
  </div>
</div>
