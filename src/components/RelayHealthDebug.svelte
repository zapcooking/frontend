<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { 
    relayHealthTracker, 
    type RelayHealthStats, 
    type RelayStatus 
  } from '$lib/relayHealthTracker';
  
  let healthStats: RelayHealthStats[] = [];
  let summary = { total: 0, healthy: 0, degraded: 0, dead: 0, unknown: 0 };
  let updateInterval: ReturnType<typeof setInterval>;
  let showAll = false;
  
  function refreshStats() {
    if (!browser) return;
    
    const allStats = relayHealthTracker.getAllStats();
    healthStats = [...allStats.values()]
      .sort((a, b) => {
        // Sort by status priority (dead first, then by success rate)
        const statusOrder = { dead: 0, degraded: 1, unknown: 2, healthy: 3 };
        if (statusOrder[a.status] !== statusOrder[b.status]) {
          return statusOrder[a.status] - statusOrder[b.status];
        }
        return b.successRate - a.successRate;
      });
    
    summary = relayHealthTracker.getSummary();
  }
  
  function getStatusEmoji(status: RelayStatus): string {
    switch (status) {
      case 'healthy': return '✅';
      case 'degraded': return '⚠️';
      case 'dead': return '☠️';
      case 'unknown': return '❓';
    }
  }
  
  function getStatusColor(status: RelayStatus): string {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'degraded': return 'text-yellow-400';
      case 'dead': return 'text-red-400';
      case 'unknown': return 'text-neutral-400';
    }
  }
  
  function formatTime(timestamp: number): string {
    if (!timestamp) return 'never';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  }
  
  function formatRecovery(stats: RelayHealthStats): string {
    if (stats.status !== 'dead') return '-';
    if (!stats.nextRecoveryAt) return 'never';
    
    const now = Date.now();
    if (now >= stats.nextRecoveryAt) return 'now';
    
    const diff = stats.nextRecoveryAt - now;
    if (diff < 60000) return `in ${Math.round(diff / 1000)}s`;
    if (diff < 3600000) return `in ${Math.round(diff / 60000)}m`;
    return `in ${Math.round(diff / 3600000)}h`;
  }
  
  function shortenUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url;
    }
  }
  
  async function resetRelay(url: string) {
    relayHealthTracker.resetStats(url);
    refreshStats();
  }
  
  async function resetAll() {
    if (confirm('Reset all relay health stats?')) {
      await relayHealthTracker.resetAll();
      refreshStats();
    }
  }
  
  function logToConsole() {
    relayHealthTracker.logHealthReport();
  }
  
  onMount(() => {
    refreshStats();
    updateInterval = setInterval(refreshStats, 5000);
  });
  
  onDestroy(() => {
    if (updateInterval) clearInterval(updateInterval);
  });
  
  $: displayedStats = showAll ? healthStats : healthStats.slice(0, 20);
</script>

<div class="bg-neutral-900 rounded-lg p-4 text-sm font-mono">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-lg font-semibold text-neutral-100">Relay Health Monitor</h3>
    <div class="flex gap-2">
      <button
        onclick={logToConsole}
        class="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 text-xs"
      >
        📊 Console
      </button>
      <button
        onclick={resetAll}
        class="px-3 py-1 bg-red-900 hover:bg-red-800 rounded text-red-200 text-xs"
      >
        🗑️ Reset All
      </button>
    </div>
  </div>
  
  <!-- Summary -->
  <div class="grid grid-cols-5 gap-2 mb-4 text-center">
    <div class="bg-neutral-800 rounded p-2">
      <div class="text-2xl font-bold text-neutral-100">{summary.total}</div>
      <div class="text-xs text-neutral-400">Total</div>
    </div>
    <div class="bg-neutral-800 rounded p-2">
      <div class="text-2xl font-bold text-green-400">{summary.healthy}</div>
      <div class="text-xs text-neutral-400">Healthy</div>
    </div>
    <div class="bg-neutral-800 rounded p-2">
      <div class="text-2xl font-bold text-yellow-400">{summary.degraded}</div>
      <div class="text-xs text-neutral-400">Degraded</div>
    </div>
    <div class="bg-neutral-800 rounded p-2">
      <div class="text-2xl font-bold text-red-400">{summary.dead}</div>
      <div class="text-xs text-neutral-400">Dead</div>
    </div>
    <div class="bg-neutral-800 rounded p-2">
      <div class="text-2xl font-bold text-neutral-400">{summary.unknown}</div>
      <div class="text-xs text-neutral-400">Unknown</div>
    </div>
  </div>
  
  <!-- Relay Table -->
  {#if healthStats.length > 0}
    <div class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr class="text-left text-neutral-400 text-xs border-b border-neutral-700">
            <th class="pb-2 pr-2">Status</th>
            <th class="pb-2 pr-2">Relay</th>
            <th class="pb-2 pr-2 text-right">Success</th>
            <th class="pb-2 pr-2 text-right">Latency</th>
            <th class="pb-2 pr-2 text-right">Fails</th>
            <th class="pb-2 pr-2">Last OK</th>
            <th class="pb-2 pr-2">Recovery</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each displayedStats as stats}
            <tr class="border-b border-neutral-800 hover:bg-neutral-800/50">
              <td class="py-2 pr-2">
                <span class="{getStatusColor(stats.status)} font-medium">
                  {getStatusEmoji(stats.status)} {stats.status}
                </span>
              </td>
              <td class="py-2 pr-2 text-neutral-300" title={stats.url}>
                {shortenUrl(stats.url)}
              </td>
              <td class="py-2 pr-2 text-right">
                <span class="{stats.successRate >= 0.5 ? 'text-green-400' : 'text-red-400'}">
                  {(stats.successRate * 100).toFixed(0)}%
                </span>
                <span class="text-neutral-500 text-xs">
                  ({stats.successCount}/{stats.successCount + stats.failureCount})
                </span>
              </td>
              <td class="py-2 pr-2 text-right text-neutral-300">
                {stats.avgResponseTimeMs > 0 ? `${stats.avgResponseTimeMs.toFixed(0)}ms` : '-'}
              </td>
              <td class="py-2 pr-2 text-right">
                <span class="{stats.consecutiveFailures >= 3 ? 'text-red-400' : 'text-neutral-400'}">
                  {stats.consecutiveFailures}
                </span>
              </td>
              <td class="py-2 pr-2 text-neutral-400 text-xs">
                {formatTime(stats.lastSuccessAt)}
              </td>
              <td class="py-2 pr-2 text-neutral-400 text-xs">
                {formatRecovery(stats)}
              </td>
              <td class="py-2">
                <button
                  onclick={() => resetRelay(stats.url)}
                  class="text-xs text-neutral-500 hover:text-neutral-300"
                  title="Reset stats"
                >
                  ↺
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    
    {#if healthStats.length > 20}
      <div class="mt-3 text-center">
        <button
          onclick={() => showAll = !showAll}
          class="text-xs text-neutral-400 hover:text-neutral-200"
        >
          {showAll ? 'Show less' : `Show all ${healthStats.length} relays`}
        </button>
      </div>
    {/if}
  {:else}
    <div class="text-center text-neutral-500 py-8">
      No relay health data yet. Make some queries first.
    </div>
  {/if}
  
  <div class="mt-4 text-xs text-neutral-500">
    <strong>Legend:</strong>
    ✅ Healthy (&gt;50% success, &lt;5s latency) |
    ⚠️ Degraded (below thresholds) |
    ☠️ Dead (5+ consecutive failures) |
    ❓ Unknown (&lt;3 attempts)
  </div>
</div>

