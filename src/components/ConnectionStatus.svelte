<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getRelayHealth, getConnectionMetrics, resetCircuitBreaker } from '$lib/nostr';
  
  let relayHealth: any[] = [];
  let connectionMetrics: any = null;
  let updateInterval: NodeJS.Timeout | null = null;
  let showDetails = false;
  
  function updateStatus() {
    relayHealth = getRelayHealth();
    connectionMetrics = getConnectionMetrics();
  }
  
  function handleResetCircuitBreaker(url: string) {
    resetCircuitBreaker(url);
    updateStatus();
  }
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'connected': return 'text-green-600 bg-green-100';
      case 'degraded': return 'text-yellow-600 bg-yellow-100';
      case 'disconnected': return 'text-gray-600 bg-gray-100';
      case 'circuit-open': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }
  
  function getStatusIcon(status: string): string {
    switch (status) {
      case 'connected': return '🟢';
      case 'degraded': return '🟡';
      case 'disconnected': return '⚪';
      case 'circuit-open': return '🔴';
      default: return '❓';
    }
  }
  
  function formatResponseTime(time?: number): string {
    if (!time) return 'N/A';
    return `${time}ms`;
  }
  
  function formatLastSeen(timestamp: number): string {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }
  
  onMount(() => {
    updateStatus();
    updateInterval = setInterval(updateStatus, 5000); // Update every 5 seconds
  });
  
  onDestroy(() => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
  });
</script>

<div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
  <div class="flex items-center justify-between mb-3">
    <h3 class="text-lg font-semibold text-gray-900">Connection Status</h3>
    <button
      on:click={() => showDetails = !showDetails}
      class="text-sm text-blue-600 hover:text-blue-800 transition-colors"
    >
      {showDetails ? 'Hide Details' : 'Show Details'}
    </button>
  </div>
  
  <!-- Summary Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
    <div class="text-center">
      <div class="text-2xl font-bold text-green-600">
        {relayHealth.filter(r => r.status === 'connected').length}
      </div>
      <div class="text-sm text-gray-600">Connected</div>
    </div>
    <div class="text-center">
      <div class="text-2xl font-bold text-yellow-600">
        {relayHealth.filter(r => r.status === 'degraded').length}
      </div>
      <div class="text-sm text-gray-600">Degraded</div>
    </div>
    <div class="text-center">
      <div class="text-2xl font-bold text-red-600">
        {relayHealth.filter(r => r.status === 'circuit-open').length}
      </div>
      <div class="text-sm text-gray-600">Circuit Open</div>
    </div>
    <div class="text-center">
      <div class="text-2xl font-bold text-gray-600">
        {relayHealth.length}
      </div>
      <div class="text-sm text-gray-600">Total Relays</div>
    </div>
  </div>
  
  <!-- Detailed View -->
  {#if showDetails}
    <div class="space-y-3">
      <h4 class="font-medium text-gray-900">Relay Details</h4>
      
      {#each relayHealth as relay}
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div class="flex items-center space-x-3">
            <span class="text-lg">{getStatusIcon(relay.status)}</span>
            <div>
              <div class="font-medium text-sm">{relay.url}</div>
              <div class="text-xs text-gray-600">
                Last seen: {formatLastSeen(relay.lastSeen)}
                {#if relay.responseTime}
                  • Response: {formatResponseTime(relay.responseTime)}
                {/if}
                {#if relay.failures > 0}
                  • Failures: {relay.failures}
                {/if}
              </div>
            </div>
          </div>
          
          <div class="flex items-center space-x-2">
            <span class="px-2 py-1 text-xs font-medium rounded-full {getStatusColor(relay.status)}">
              {relay.status}
            </span>
            
            {#if relay.status === 'circuit-open'}
              <button
                on:click={() => handleResetCircuitBreaker(relay.url)}
                class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Reset
              </button>
            {/if}
          </div>
        </div>
      {/each}
      
      <!-- Connection Metrics -->
      {#if connectionMetrics}
        <div class="mt-4 p-3 bg-blue-50 rounded-lg">
          <h4 class="font-medium text-blue-900 mb-2">Connection Metrics</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-blue-700">
            <div>
              <div class="font-medium">Total Connections</div>
              <div class="text-lg font-bold">{connectionMetrics.totalConnections}</div>
            </div>
            <div>
              <div class="font-medium">Successful</div>
              <div class="text-lg font-bold text-green-600">{connectionMetrics.successfulConnections}</div>
            </div>
            <div>
              <div class="font-medium">Failed</div>
              <div class="text-lg font-bold text-red-600">{connectionMetrics.failedConnections}</div>
            </div>
            <div>
              <div class="font-medium">Avg Response Time</div>
              <div class="text-lg font-bold">{Math.round(connectionMetrics.averageResponseTime)}ms</div>
            </div>
          </div>
          {#if connectionMetrics.circuitBreakerTrips > 0}
            <div class="mt-2 text-sm text-orange-700">
              <span class="font-medium">Circuit Breaker Trips:</span> {connectionMetrics.circuitBreakerTrips}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
