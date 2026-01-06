<!--
  Debug component showing relay selector performance and stats.
  
  Demonstrates:
  1. Before/after connection count comparison
  2. Relay scoring breakdown
  3. Coverage optimization results
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    relaySelector,
    type RelayStats,
    type CoverageResult 
  } from '$lib/relaySelector';
  import { relayListCache } from '$lib/relayListCache';
  import { buildQueryPlan, buildSmartQueryPlan } from '$lib/followOutbox';
  
  // Example pubkeys for testing (replace with real ones)
  export let testPubkeys: string[] = [];
  
  let loading = false;
  let error: string | null = null;
  
  // Comparison results
  let naiveResult: { relayCount: number; authorsCovered: number } | null = null;
  let smartResult: { relayCount: number; authorsCovered: number; coverage: number } | null = null;
  let coverageResult: CoverageResult | null = null;
  
  // Stats
  let relayStats: Map<string, RelayStats> = new Map();
  let connectedRelays: string[] = [];
  
  async function runComparison() {
    if (testPubkeys.length === 0) {
      error = 'No pubkeys provided for testing';
      return;
    }
    
    loading = true;
    error = null;
    
    try {
      // 1. Naive approach: use all relays from NIP-65
      const relayLists = await relayListCache.getMany(testPubkeys);
      const allRelays = new Set<string>();
      let authorsWithRelays = 0;
      
      for (const [pubkey, relayList] of relayLists) {
        if (relayList.write.length > 0) {
          authorsWithRelays++;
          relayList.write.forEach(r => allRelays.add(r));
        }
      }
      
      naiveResult = {
        relayCount: allRelays.size,
        authorsCovered: authorsWithRelays
      };
      
      // 2. Smart approach: use relay selector
      const { plan, coverage } = await buildSmartQueryPlan(testPubkeys, {
        maxRelays: 15,
        maxRelaysPerAuthor: 2
      });
      
      const smartRelays = new Set(plan.map(p => p.relay));
      const smartAuthors = new Set(plan.flatMap(p => p.authors));
      
      smartResult = {
        relayCount: smartRelays.size,
        authorsCovered: smartAuthors.size,
        coverage
      };
      
      // 3. Get detailed coverage result
      coverageResult = await relaySelector.selectOptimalCoverage(testPubkeys, 2);
      
      // 4. Get stats
      relayStats = relaySelector.getAllStats();
      connectedRelays = relaySelector.getConnectedRelays();
      
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }
  
  async function clearStats() {
    await relaySelector.clearStats();
    relayStats = new Map();
  }
  
  onMount(() => {
    connectedRelays = relaySelector.getConnectedRelays();
    relayStats = relaySelector.getAllStats();
  });
  
  // Format latency
  function formatLatency(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  // Calculate success rate
  function getSuccessRate(stats: RelayStats): string {
    const total = stats.successCount + stats.failureCount;
    if (total === 0) return 'N/A';
    return `${((stats.successCount / total) * 100).toFixed(0)}%`;
  }
</script>

<div class="relay-selector-debug">
  <h2>🔌 Smart Relay Selection Debug</h2>
  
  <div class="section">
    <h3>Test with {testPubkeys.length} Authors</h3>
    <button on:click={runComparison} disabled={loading || testPubkeys.length === 0}>
      {loading ? 'Running...' : 'Run Comparison'}
    </button>
    <button on:click={clearStats}>Clear Stats</button>
  </div>
  
  {#if error}
    <div class="error">{error}</div>
  {/if}
  
  {#if naiveResult && smartResult}
    <div class="comparison">
      <h3>📊 Before/After Comparison</h3>
      
      <div class="comparison-grid">
        <div class="comparison-card naive">
          <h4>❌ Naive (All Relays)</h4>
          <div class="stat">
            <span class="value">{naiveResult.relayCount}</span>
            <span class="label">Relay Connections</span>
          </div>
          <div class="stat">
            <span class="value">{naiveResult.authorsCovered}</span>
            <span class="label">Authors with NIP-65</span>
          </div>
        </div>
        
        <div class="comparison-card smart">
          <h4>✅ Smart (Optimized)</h4>
          <div class="stat">
            <span class="value">{smartResult.relayCount}</span>
            <span class="label">Relay Connections</span>
          </div>
          <div class="stat">
            <span class="value">{(smartResult.coverage * 100).toFixed(0)}%</span>
            <span class="label">Coverage</span>
          </div>
        </div>
        
        <div class="comparison-card savings">
          <h4>💰 Savings</h4>
          <div class="stat">
            <span class="value highlight">
              {((1 - smartResult.relayCount / naiveResult.relayCount) * 100).toFixed(0)}%
            </span>
            <span class="label">Fewer Connections</span>
          </div>
          <div class="stat">
            <span class="value">
              -{naiveResult.relayCount - smartResult.relayCount}
            </span>
            <span class="label">Relays Avoided</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
  
  {#if coverageResult}
    <div class="section">
      <h3>🎯 Coverage Details</h3>
      <p>
        <strong>{coverageResult.totalRelays}</strong> relays cover 
        <strong>{coverageResult.totalAuthors}</strong> authors
        ({(coverageResult.coverage * 100).toFixed(0)}% coverage)
      </p>
      
      <div class="relay-list">
        {#each [...coverageResult.relayToAuthors.entries()].sort((a, b) => b[1].length - a[1].length) as [relay, authors]}
          <div class="relay-item">
            <span class="relay-url">{relay.replace('wss://', '')}</span>
            <span class="author-count">→ {authors.length} authors</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  
  <div class="section">
    <h3>📡 Connected Relays ({connectedRelays.length})</h3>
    {#if connectedRelays.length === 0}
      <p class="muted">No relays connected</p>
    {:else}
      <div class="relay-chips">
        {#each connectedRelays as relay}
          <span class="chip connected">{relay.replace('wss://', '')}</span>
        {/each}
      </div>
    {/if}
  </div>
  
  <div class="section">
    <h3>📈 Relay Performance Stats ({relayStats.size})</h3>
    {#if relayStats.size === 0}
      <p class="muted">No stats recorded yet. Query some relays first.</p>
    {:else}
      <table class="stats-table">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Success Rate</th>
            <th>Avg Latency</th>
            <th>Queries</th>
            <th>Last Success</th>
          </tr>
        </thead>
        <tbody>
          {#each [...relayStats.values()].sort((a, b) => b.successCount - a.successCount).slice(0, 20) as stats}
            <tr>
              <td class="relay-url">{stats.url.replace('wss://', '')}</td>
              <td class="center">
                <span class:good={stats.successCount > stats.failureCount} class:bad={stats.failureCount > stats.successCount}>
                  {getSuccessRate(stats)}
                </span>
              </td>
              <td class="center">{stats.avgLatencyMs > 0 ? formatLatency(stats.avgLatencyMs) : 'N/A'}</td>
              <td class="center">{stats.queryCount}</td>
              <td class="center">
                {#if stats.lastSuccess > 0}
                  {new Date(stats.lastSuccess).toLocaleTimeString()}
                {:else}
                  Never
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .relay-selector-debug {
    padding: 1rem;
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  h2 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
  }
  
  h3 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    color: var(--color-text-secondary, #666);
  }
  
  h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
  }
  
  .section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: var(--color-surface, #f8f9fa);
    border-radius: 0.5rem;
  }
  
  button {
    padding: 0.5rem 1rem;
    margin-right: 0.5rem;
    border: none;
    border-radius: 0.375rem;
    background: var(--color-primary, #007bff);
    color: white;
    cursor: pointer;
    font-size: 0.875rem;
  }
  
  button:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .error {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: #fee2e2;
    color: #dc2626;
    border-radius: 0.375rem;
  }
  
  .comparison-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .comparison-card {
    padding: 1rem;
    border-radius: 0.5rem;
    background: white;
    border: 1px solid var(--color-border, #e5e7eb);
  }
  
  .comparison-card.naive {
    border-color: #fca5a5;
  }
  
  .comparison-card.smart {
    border-color: #86efac;
  }
  
  .comparison-card.savings {
    border-color: #fde047;
    background: #fefce8;
  }
  
  .stat {
    margin-top: 0.75rem;
  }
  
  .stat .value {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
  }
  
  .stat .value.highlight {
    color: #16a34a;
  }
  
  .stat .label {
    font-size: 0.75rem;
    color: var(--color-text-muted, #9ca3af);
  }
  
  .relay-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.75rem;
  }
  
  .relay-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem;
    background: white;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
  }
  
  .relay-url {
    font-family: monospace;
    word-break: break-all;
  }
  
  .author-count {
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
    margin-left: 0.5rem;
  }
  
  .relay-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  
  .chip {
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-family: monospace;
    background: var(--color-surface, #e5e7eb);
  }
  
  .chip.connected {
    background: #dcfce7;
    color: #166534;
  }
  
  .muted {
    color: var(--color-text-muted, #9ca3af);
    font-style: italic;
  }
  
  .stats-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    margin-top: 0.75rem;
  }
  
  .stats-table th,
  .stats-table td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }
  
  .stats-table th {
    font-weight: 600;
    color: var(--color-text-secondary, #6b7280);
  }
  
  .stats-table td.center {
    text-align: center;
  }
  
  .stats-table td.relay-url {
    font-family: monospace;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .good {
    color: #16a34a;
  }
  
  .bad {
    color: #dc2626;
  }
</style>

