<!--
  Demo component showing query batching efficiency.
  
  Demonstrates:
  1. Naive vs batched query count comparison
  2. Real-time efficiency analysis
  3. Relay coverage visualization
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { 
    fetchFollowList,
    fetchEventsBatched,
    type OutboxFetchResult 
  } from '$lib/followOutbox';
  import { 
    createQueryBatcher, 
    analyzeQueryEfficiency,
    type QueryMetrics,
    type RelayQueryPlan
  } from '$lib/queryBatcher';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  
  // State
  let loading = false;
  let analyzing = false;
  let followedPubkeys: string[] = [];
  let analysisResult: Awaited<ReturnType<typeof analyzeQueryEfficiency>> | null = null;
  let queryPlan: RelayQueryPlan[] = [];
  let fetchResult: { events: NDKEvent[]; metrics: QueryMetrics } | null = null;
  let progress = { completed: 0, total: 0, events: 0 };
  
  // Load followed pubkeys
  async function loadFollows() {
    if (!$userPublickey || !$ndk) return;
    
    loading = true;
    try {
      const follows = await fetchFollowList($ndk, $userPublickey);
      followedPubkeys = follows.map(f => f.pubkey);
    } catch (err) {
      console.error('Failed to load follows:', err);
    } finally {
      loading = false;
    }
  }
  
  // Analyze efficiency without executing
  async function analyzeEfficiency() {
    if (followedPubkeys.length === 0) return;
    
    analyzing = true;
    try {
      analysisResult = await analyzeQueryEfficiency(followedPubkeys, 2);
      
      // Also create query plan for visualization
      const batcher = createQueryBatcher($ndk);
      queryPlan = await batcher.createQueryPlan(
        followedPubkeys,
        { kinds: [1], limit: 20 },
        { maxRelaysPerAuthor: 2, minCoverage: 1 }
      );
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      analyzing = false;
    }
  }
  
  // Execute batched fetch
  async function executeBatchedFetch() {
    if (followedPubkeys.length === 0 || !$ndk) return;
    
    loading = true;
    progress = { completed: 0, total: 0, events: 0 };
    
    try {
      fetchResult = await fetchEventsBatched($ndk, followedPubkeys, {
        kinds: [1],
        limit: 20,
        maxRelays: 15,
        onProgress: (p) => {
          progress = p;
        }
      });
    } catch (err) {
      console.error('Fetch failed:', err);
    } finally {
      loading = false;
    }
  }
  
  onMount(() => {
    if ($userPublickey) {
      loadFollows();
    }
  });
  
  // Reactive: analyze when follows change
  $: if (followedPubkeys.length > 0 && !analysisResult) {
    analyzeEfficiency();
  }
</script>

<div class="query-batcher-demo">
  <h2>🚀 Query Batching Demo</h2>
  
  <div class="section">
    <h3>Authors to Query</h3>
    <p class="info">
      {#if followedPubkeys.length > 0}
        <strong>{followedPubkeys.length}</strong> followed authors loaded
      {:else if loading}
        Loading follows...
      {:else if !$userPublickey}
        Log in to see your followed authors
      {:else}
        <button on:click={loadFollows}>Load Follows</button>
      {/if}
    </p>
  </div>
  
  {#if analysisResult}
    <div class="section highlight">
      <h3>📊 Efficiency Analysis</h3>
      
      <div class="comparison">
        <div class="comparison-item naive">
          <div class="label">Naive Approach</div>
          <div class="value">{analysisResult.naiveQueries}</div>
          <div class="sublabel">queries</div>
          <div class="note">
            ({followedPubkeys.length} authors × 2 relays each)
          </div>
        </div>
        
        <div class="comparison-item arrow">→</div>
        
        <div class="comparison-item optimized">
          <div class="label">Batched Approach</div>
          <div class="value">{analysisResult.optimizedQueries}</div>
          <div class="sublabel">queries</div>
          <div class="note">
            (grouped by shared relays)
          </div>
        </div>
        
        <div class="comparison-item savings">
          <div class="label">Savings</div>
          <div class="value">{analysisResult.savingsPercent}%</div>
          <div class="sublabel">fewer connections</div>
          <div class="note">
            ({analysisResult.naiveQueries - analysisResult.optimizedQueries} queries saved)
          </div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <h3>🔗 Relay Coverage Breakdown</h3>
      <p class="info">Each relay covers multiple authors:</p>
      
      <div class="relay-breakdown">
        {#each analysisResult.relayBreakdown.slice(0, 10) as { relay, authorCount }}
          <div class="relay-row">
            <span class="relay-name">{relay.replace('wss://', '')}</span>
            <div class="bar-container">
              <div 
                class="bar" 
                style="width: {(authorCount / followedPubkeys.length) * 100}%"
              ></div>
            </div>
            <span class="author-count">{authorCount} authors</span>
          </div>
        {/each}
        {#if analysisResult.relayBreakdown.length > 10}
          <p class="muted">...and {analysisResult.relayBreakdown.length - 10} more relays</p>
        {/if}
      </div>
    </div>
  {/if}
  
  {#if queryPlan.length > 0}
    <div class="section">
      <h3>📋 Query Plan ({queryPlan.length} queries)</h3>
      
      <div class="query-plan">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Relay</th>
              <th>Authors</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {#each queryPlan.slice(0, 15) as plan, i}
              <tr>
                <td class="center">{i + 1}</td>
                <td class="relay">{plan.relay.replace('wss://', '')}</td>
                <td class="center">{plan.authors.length}</td>
                <td class="center score">{(plan.score * 100).toFixed(0)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if queryPlan.length > 15}
          <p class="muted">...and {queryPlan.length - 15} more queries</p>
        {/if}
      </div>
    </div>
  {/if}
  
  <div class="section">
    <h3>⚡ Execute Batched Fetch</h3>
    
    <button 
      on:click={executeBatchedFetch} 
      disabled={loading || followedPubkeys.length === 0}
      class="execute-btn"
    >
      {loading ? 'Fetching...' : 'Run Batched Query'}
    </button>
    
    {#if loading && progress.total > 0}
      <div class="progress">
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            style="width: {(progress.completed / progress.total) * 100}%"
          ></div>
        </div>
        <span class="progress-text">
          {progress.completed}/{progress.total} queries, {progress.events} events
        </span>
      </div>
    {/if}
  </div>
  
  {#if fetchResult}
    <div class="section results">
      <h3>✅ Results</h3>
      
      <div class="metrics-grid">
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.uniqueEvents}</span>
          <span class="metric-label">Events Found</span>
        </div>
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.actualQueryCount}</span>
          <span class="metric-label">Queries Made</span>
        </div>
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.connectionsSaved}</span>
          <span class="metric-label">Connections Saved</span>
        </div>
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.totalTimeMs}ms</span>
          <span class="metric-label">Total Time</span>
        </div>
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.coveragePercent}%</span>
          <span class="metric-label">Author Coverage</span>
        </div>
        <div class="metric">
          <span class="metric-value">{fetchResult.metrics.duplicatesFiltered}</span>
          <span class="metric-label">Duplicates Filtered</span>
        </div>
      </div>
      
      <div class="relay-results">
        <p>
          <span class="success-icon">✓</span> 
          <strong>{fetchResult.metrics.relaysSucceeded.length}</strong> relays succeeded
        </p>
        {#if fetchResult.metrics.relaysFailed.length > 0}
          <p>
            <span class="fail-icon">✗</span> 
            <strong>{fetchResult.metrics.relaysFailed.length}</strong> relays failed
          </p>
        {/if}
        {#if fetchResult.metrics.relaysTimedOut.length > 0}
          <p>
            <span class="timeout-icon">⏱</span> 
            <strong>{fetchResult.metrics.relaysTimedOut.length}</strong> relays timed out
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .query-batcher-demo {
    padding: 1rem;
    font-family: system-ui, -apple-system, sans-serif;
    max-width: 800px;
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
  
  .section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: var(--color-surface, #f8f9fa);
    border-radius: 0.5rem;
  }
  
  .section.highlight {
    background: linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%);
    border: 1px solid #86efac;
  }
  
  .section.results {
    background: linear-gradient(135deg, #fef3c7 0%, #fef9c3 100%);
    border: 1px solid #fde047;
  }
  
  .info {
    margin: 0;
    color: var(--color-text-secondary, #6b7280);
  }
  
  .comparison {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }
  
  .comparison-item {
    text-align: center;
    flex: 1;
    min-width: 120px;
  }
  
  .comparison-item.arrow {
    flex: 0;
    font-size: 2rem;
    color: #9ca3af;
    min-width: auto;
  }
  
  .comparison-item .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    margin-bottom: 0.25rem;
  }
  
  .comparison-item .value {
    font-size: 2rem;
    font-weight: 700;
  }
  
  .comparison-item .sublabel {
    font-size: 0.875rem;
    color: #6b7280;
  }
  
  .comparison-item .note {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-top: 0.25rem;
  }
  
  .comparison-item.naive .value {
    color: #dc2626;
  }
  
  .comparison-item.optimized .value {
    color: #16a34a;
  }
  
  .comparison-item.savings .value {
    color: #2563eb;
  }
  
  .relay-breakdown {
    margin-top: 0.75rem;
  }
  
  .relay-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 0.8125rem;
  }
  
  .relay-name {
    width: 180px;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .bar-container {
    flex: 1;
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
  }
  
  .bar {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #16a34a);
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  
  .author-count {
    width: 80px;
    text-align: right;
    color: #6b7280;
  }
  
  .query-plan table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    margin-top: 0.5rem;
  }
  
  .query-plan th,
  .query-plan td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
  }
  
  .query-plan th {
    font-weight: 600;
    color: #6b7280;
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  
  .query-plan td.center {
    text-align: center;
  }
  
  .query-plan td.relay {
    font-family: monospace;
  }
  
  .query-plan td.score {
    color: #16a34a;
  }
  
  .muted {
    color: #9ca3af;
    font-style: italic;
    font-size: 0.8125rem;
    margin-top: 0.5rem;
  }
  
  button {
    padding: 0.5rem 1rem;
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
  
  .execute-btn {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    padding: 0.75rem 1.5rem;
    font-weight: 600;
  }
  
  .progress {
    margin-top: 1rem;
  }
  
  .progress-bar {
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }
  
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #2563eb);
    transition: width 0.2s ease;
  }
  
  .progress-text {
    font-size: 0.8125rem;
    color: #6b7280;
  }
  
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 1rem;
    margin: 1rem 0;
  }
  
  .metric {
    text-align: center;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.5);
    border-radius: 0.375rem;
  }
  
  .metric-value {
    display: block;
    font-size: 1.25rem;
    font-weight: 700;
    color: #1f2937;
  }
  
  .metric-label {
    font-size: 0.75rem;
    color: #6b7280;
  }
  
  .relay-results {
    margin-top: 1rem;
    font-size: 0.875rem;
  }
  
  .relay-results p {
    margin: 0.25rem 0;
  }
  
  .success-icon {
    color: #16a34a;
  }
  
  .fail-icon {
    color: #dc2626;
  }
  
  .timeout-icon {
    color: #f59e0b;
  }
</style>

