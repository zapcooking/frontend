<script lang="ts">
  import { fly } from 'svelte/transition';
  import { pendingOps } from '$lib/stores/pendingOps';
</script>

{#if $pendingOps.length > 0}
  <div
    class="pending-indicator"
    transition:fly={{ y: 12, duration: 180 }}
    role="status"
    aria-atomic="true"
  >
    <svg class="spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="31.4 31.4" />
    </svg>
    <span class="label">{$pendingOps[$pendingOps.length - 1].label}</span>
    {#if $pendingOps.length > 1}
      <span class="badge">+{$pendingOps.length - 1}</span>
    {/if}
  </div>
{/if}

<style>
  .pending-indicator {
    position: fixed;
    bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px) + 0.75rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.875rem 0.375rem 0.625rem;
    border-radius: 9999px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    pointer-events: none;
    white-space: nowrap;
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    animation: spin 0.9s linear infinite;
    color: var(--color-primary);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .label {
    color: var(--color-text-primary);
  }

  .badge {
    padding: 0 0.375rem;
    border-radius: 9999px;
    background: var(--color-primary);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.25rem;
  }
</style>
