<!--
  Example component demonstrating the NIP-65 relay list cache usage.
  
  Shows how to:
  1. Get relay lists reactively for a single pubkey
  2. Prefetch relay lists for a feed
  3. Display relay information
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { 
    getRelayListStore, 
    prefetchRelayLists,
    getRelayListCacheStats
  } from '$lib/stores/relayListStore';
  
  export let pubkey: string;
  export let showStats = false;
  
  // Reactive store for this pubkey's relay list
  $: relayStore = getRelayListStore(pubkey);
  $: relayList = $relayStore;
  
  // Cache stats for debugging
  let stats: ReturnType<typeof getRelayListCacheStats> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  
  onMount(() => {
    if (showStats) {
      stats = getRelayListCacheStats();
      statsInterval = setInterval(() => {
        stats = getRelayListCacheStats();
      }, 2000);
    }
  });
  
  onDestroy(() => {
    if (statsInterval) {
      clearInterval(statsInterval);
    }
  });
</script>

<div class="relay-list-display">
  {#if relayList.loading}
    <div class="loading">
      <span class="loading-spinner" />
      Loading relay list...
    </div>
  {:else if relayList.error}
    <div class="error">
      Error: {relayList.error}
    </div>
  {:else if relayList.data}
    <div class="relay-info">
      {#if relayList.data.write.length > 0}
        <div class="relay-section">
          <h4>📤 Outbox (Write) Relays</h4>
          <ul>
            {#each relayList.data.write as relay}
              <li>{relay}</li>
            {/each}
          </ul>
        </div>
      {/if}
      
      {#if relayList.data.read.length > 0}
        <div class="relay-section">
          <h4>📥 Inbox (Read) Relays</h4>
          <ul>
            {#each relayList.data.read as relay}
              <li>{relay}</li>
            {/each}
          </ul>
        </div>
      {/if}
      
      {#if relayList.data.write.length === 0 && relayList.data.read.length === 0}
        <div class="no-relays">
          No NIP-65 relay list published
        </div>
      {/if}
      
      <div class="updated-at">
        Last updated: {new Date(relayList.data.updatedAt).toLocaleString()}
      </div>
    </div>
  {:else}
    <div class="no-data">
      No relay list available
    </div>
  {/if}
  
  {#if showStats && stats}
    <div class="cache-stats">
      <h4>📊 Cache Stats</h4>
      <ul>
        <li>Memory: {stats.memorySize} entries</li>
        <li>Stores: {stats.storeCount}</li>
        <li>In-flight: {stats.inFlightCount}</li>
        <li>Batch queue: {stats.batchQueueSize}</li>
      </ul>
    </div>
  {/if}
</div>

<style>
  .relay-list-display {
    padding: 1rem;
    border-radius: 0.5rem;
    background: var(--color-surface, #f5f5f5);
  }
  
  .loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--color-text-muted, #666);
  }
  
  .loading-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--color-border, #ddd);
    border-top-color: var(--color-primary, #007bff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error {
    color: var(--color-error, #dc3545);
  }
  
  .relay-section {
    margin-bottom: 1rem;
  }
  
  .relay-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  
  .relay-section ul {
    margin: 0;
    padding-left: 1.5rem;
    font-size: 0.8125rem;
    font-family: monospace;
  }
  
  .relay-section li {
    margin: 0.25rem 0;
    word-break: break-all;
  }
  
  .no-relays, .no-data {
    color: var(--color-text-muted, #666);
    font-style: italic;
  }
  
  .updated-at {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--color-text-muted, #999);
  }
  
  .cache-stats {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border, #ddd);
    font-size: 0.75rem;
  }
  
  .cache-stats h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.8125rem;
  }
  
  .cache-stats ul {
    margin: 0;
    padding-left: 1.5rem;
  }
</style>

