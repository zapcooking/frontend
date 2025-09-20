<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import ConnectionStatus from '../../components/ConnectionStatus.svelte';
  import { getConnectionManager } from '$lib/connectionManager';
  
  let ndkInstance: any = null;
  let connectionManager: any = null;
  let testResults: any[] = [];
  let isRunningTest = false;
  let testStatus = 'Ready to test';
  
  $: if (ndkInstance) {
    connectionManager = getConnectionManager();
  }
  
  onMount(() => {
    // Get the NDK instance from the store
    const unsubscribe = ndk.subscribe(value => {
      ndkInstance = value;
    });
    
    return unsubscribe;
  });
  
  async function runBasicConnectivityTest() {
    if (!ndkInstance || !connectionManager) {
      testStatus = 'NDK not available';
      return;
    }
    
    isRunningTest = true;
    testStatus = 'Running basic connectivity test...';
    testResults = [];
    
    try {
      const startTime = Date.now();
      
      // Test basic event fetching
      const testFilter = { kinds: [1], limit: 5 };
      const events = await ndkInstance.fetchEvents(testFilter);
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      testResults.push({
        test: 'Basic Event Fetch',
        status: 'success',
        message: `Fetched ${events.size} events in ${responseTime}ms`,
        details: `Events from ${events.size} relays`
      });
      
      testStatus = 'Basic connectivity test completed successfully';
      
    } catch (error: any) {
      testResults.push({
        test: 'Basic Event Fetch',
        status: 'error',
        message: `Failed: ${error.message}`,
        details: error.toString()
      });
      
      testStatus = 'Basic connectivity test failed';
    }
    
    isRunningTest = false;
  }
  
  async function runSubscriptionTest() {
    if (!ndkInstance || !connectionManager) {
      testStatus = 'NDK not available';
      return;
    }
    
    isRunningTest = true;
    testStatus = 'Running subscription test...';
    
    try {
      let eventCount = 0;
      const startTime = Date.now();
      
      // Create a subscription
      const subscription = ndkInstance.subscribe(
        { kinds: [1], limit: 10 },
        {
          closeOnEose: true,
          timeout: 10000 // 10 second timeout
        }
      );
      
      // Listen for events
      subscription.on('event', (event: any) => {
        eventCount++;
        console.log(`Received event ${eventCount}:`, event);
      });
      
      // Wait for subscription to complete or timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscription.stop();
          reject(new Error('Subscription timeout'));
        }, 10000);
        
        subscription.on('eose', () => {
          clearTimeout(timeout);
          subscription.stop();
          resolve(null);
        });
        
        subscription.on('error', (error: any) => {
          clearTimeout(timeout);
          subscription.stop();
          reject(error);
        });
      });
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      testResults.push({
        test: 'Subscription Test',
        status: 'success',
        message: `Received ${eventCount} events in ${responseTime}ms`,
        details: `Real-time subscription working`
      });
      
      testStatus = 'Subscription test completed successfully';
      
    } catch (error: any) {
      testResults.push({
        test: 'Subscription Test',
        status: 'error',
        message: `Failed: ${error.message}`,
        details: error.toString()
      });
      
      testStatus = 'Subscription test failed';
    }
    
    isRunningTest = false;
  }
  
  async function runCircuitBreakerTest() {
    if (!connectionManager) {
      testStatus = 'Connection manager not available';
      return;
    }
    
    isRunningTest = true;
    testStatus = 'Testing circuit breaker functionality...';
    
    try {
      // Get current relay health
      const relayHealth = connectionManager.getRelayHealth();
      
      testResults.push({
        test: 'Circuit Breaker Status',
        status: 'info',
        message: `Monitoring ${relayHealth.length} relays`,
        details: relayHealth.map((r: any) => `${r.url}: ${r.status}`).join(', ')
      });
      
      // Test healthy relay selection
      const healthyRelays = connectionManager.getHealthyRelays();
      
      testResults.push({
        test: 'Healthy Relay Selection',
        status: healthyRelays.length > 0 ? 'success' : 'warning',
        message: `${healthyRelays.length} healthy relays available`,
        details: healthyRelays.join(', ')
      });
      
      // Test connection metrics
      const metrics = connectionManager.getConnectionMetrics();
      
      testResults.push({
        test: 'Connection Metrics',
        status: 'info',
        message: `Total connections: ${metrics.totalConnections}`,
        details: `Success: ${metrics.successfulConnections}, Failed: ${metrics.failedConnections}, Avg response: ${Math.round(metrics.averageResponseTime)}ms`
      });
      
      testStatus = 'Circuit breaker test completed';
      
    } catch (error: any) {
      testResults.push({
        test: 'Circuit Breaker Test',
        status: 'error',
        message: `Failed: ${error.message}`,
        details: error.toString()
      });
      
      testStatus = 'Circuit breaker test failed';
    }
    
    isRunningTest = false;
  }
  
  function clearResults() {
    testResults = [];
    testStatus = 'Ready to test';
  }
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-100';
      case 'error': return 'text-red-600 bg-red-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'info': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }
</script>

<svelte:head>
  <title>Connection Test - Nostr Cooking</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 py-8">
  <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Connection Test Dashboard</h1>
      <p class="text-gray-600">Test and monitor WebSocket connections with circuit breaker functionality</p>
    </div>
    
    <!-- Status Overview -->
    <div class="mb-8">
      <ConnectionStatus />
    </div>
    
    <!-- Test Controls -->
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">Connection Tests</h2>
      
      <div class="flex flex-wrap gap-4 mb-4">
        <button
          on:click={runBasicConnectivityTest}
          disabled={isRunningTest || !ndkInstance}
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Basic Connectivity Test
        </button>
        
        <button
          on:click={runSubscriptionTest}
          disabled={isRunningTest || !ndkInstance}
          class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Subscription Test
        </button>
        
        <button
          on:click={runCircuitBreakerTest}
          disabled={isRunningTest || !connectionManager}
          class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Circuit Breaker Test
        </button>
        
        <button
          on:click={clearResults}
          disabled={isRunningTest}
          class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Clear Results
        </button>
      </div>
      
      <div class="text-sm text-gray-600">
        <strong>Status:</strong> {testStatus}
      </div>
      
      {#if !ndkInstance}
        <div class="mt-2 text-sm text-red-600">
          ⚠️ NDK instance not available. Make sure the connection is established.
        </div>
      {/if}
      
      {#if !connectionManager}
        <div class="mt-2 text-sm text-yellow-600">
          ⚠️ Connection manager not available. Make sure NDK is connected.
        </div>
      {/if}
    </div>
    
    <!-- Test Results -->
    {#if testResults.length > 0}
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 class="text-xl font-semibold text-gray-900 mb-4">Test Results</h2>
        
        <div class="space-y-3">
          {#each testResults as result}
            <div class="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <span class="text-lg">
                {#if result.status === 'success'}✅
                {:else if result.status === 'error'}❌
                {:else if result.status === 'warning'}⚠️
                {:else}ℹ️
                {/if}
              </span>
              
              <div class="flex-1">
                <div class="font-medium text-gray-900">{result.test}</div>
                <div class="text-sm text-gray-600 mb-1">{result.message}</div>
                {#if result.details}
                  <div class="text-xs text-gray-500 font-mono bg-white p-2 rounded border">
                    {result.details}
                  </div>
                {/if}
              </div>
              
              <span class="px-2 py-1 text-xs font-medium rounded-full {getStatusColor(result.status)}">
                {result.status}
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
    
    <!-- Debug Information -->
    <div class="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">Debug Information</h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 class="font-medium text-gray-900 mb-2">NDK Status</h3>
          <div class="text-sm text-gray-600 space-y-1">
            <div><strong>Instance:</strong> {ndkInstance ? 'Available' : 'Not Available'}</div>
            <div><strong>Connection Manager:</strong> {connectionManager ? 'Available' : 'Not Available'}</div>
          </div>
        </div>
        
        <div>
          <h3 class="font-medium text-gray-900 mb-2">Browser Environment</h3>
          <div class="text-sm text-gray-600 space-y-1">
            <div><strong>User Agent:</strong> {typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 50) + '...' : 'N/A'}</div>
            <div><strong>WebSocket Support:</strong> {typeof WebSocket !== 'undefined' ? 'Yes' : 'No'}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
