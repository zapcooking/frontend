<script lang="ts">
  import Modal from './Modal.svelte';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import XCircleIcon from 'phosphor-svelte/lib/XCircle';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import { checkRelayBackups as checkSparkRelayBackups, type RelayBackupStatus } from '$lib/spark';
  import { checkRelayBackups as checkNwcRelayBackups } from '$lib/wallet/nwcBackup';

  export let open = false;
  export let pubkey: string;
  export let walletType: 'spark' | 'nwc' = 'spark';

  let isLoading = false;
  let results: RelayBackupStatus[] = [];
  let errorMessage = '';

  // Check backups when modal opens
  $: if (open && pubkey && results.length === 0) {
    checkBackups();
  }

  async function checkBackups() {
    isLoading = true;
    errorMessage = '';
    results = [];

    try {
      const checkFn = walletType === 'nwc' ? checkNwcRelayBackups : checkSparkRelayBackups;
      results = await checkFn(pubkey);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to check relay backups';
    } finally {
      isLoading = false;
    }
  }

  function close() {
    open = false;
    results = [];
    errorMessage = '';
  }

  function formatTimestamp(timestamp: number | undefined): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  function getRelayDisplayName(relayUrl: string): string {
    try {
      const url = new URL(relayUrl);
      return url.hostname;
    } catch {
      return relayUrl;
    }
  }

  $: backupCount = results.filter(r => r.hasBackup).length;
  $: totalCount = results.length;
</script>

<Modal bind:open cleanup={close}>
  <span slot="title">Relay Backup Status</span>

  <div class="flex flex-col gap-4 text-sm" style="color: var(--color-text-primary);">
    <!-- Header info -->
    <div class="flex items-center gap-2 text-caption">
      <CloudCheckIcon size={18} />
      <span>Checking which relays have your wallet backup</span>
    </div>

    {#if isLoading}
      <div class="flex flex-col items-center justify-center py-8 gap-3">
        <div class="w-8 h-8 border-2 border-primary-color border-t-transparent rounded-full animate-spin"></div>
        <span class="text-caption">Checking relays...</span>
      </div>
    {:else if errorMessage}
      <div class="p-4 rounded-lg" style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);">
        <div class="flex items-center gap-2 text-red-500">
          <WarningIcon size={18} />
          <span>{errorMessage}</span>
        </div>
      </div>
    {:else if results.length > 0}
      <!-- Summary -->
      <div class="p-3 rounded-lg" style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);">
        <div class="flex items-center gap-2">
          {#if backupCount === totalCount}
            <CheckCircleIcon size={20} class="text-green-500" weight="fill" />
            <span class="font-medium text-green-600">Backup found on all {totalCount} relays</span>
          {:else if backupCount > 0}
            <WarningIcon size={20} class="text-amber-500" weight="fill" />
            <span class="font-medium" style="color: var(--color-text-primary);">
              Backup found on {backupCount} of {totalCount} relays
            </span>
          {:else}
            <XCircleIcon size={20} class="text-red-500" weight="fill" />
            <span class="font-medium text-red-500">No backup found on any relay</span>
          {/if}
        </div>
      </div>

      <!-- Relay list -->
      <div class="flex flex-col gap-2">
        {#each results as result}
          <div
            class="p-3 rounded-lg flex items-center justify-between"
            style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
          >
            <div class="flex items-center gap-2 min-w-0">
              {#if result.hasBackup}
                <CheckCircleIcon size={18} class="text-green-500 flex-shrink-0" weight="fill" />
              {:else if result.error}
                <WarningIcon size={18} class="text-amber-500 flex-shrink-0" weight="fill" />
              {:else}
                <XCircleIcon size={18} class="text-red-400 flex-shrink-0" weight="fill" />
              {/if}
              <span class="truncate font-mono text-xs">{getRelayDisplayName(result.relay)}</span>
            </div>
            <div class="text-xs text-caption flex-shrink-0 ml-2">
              {#if result.hasBackup && result.timestamp}
                {formatTimestamp(result.timestamp)}
              {:else if result.error}
                <span class="text-amber-500">{result.error}</span>
              {:else if !result.hasBackup}
                <span class="text-red-400">No backup</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Refresh button -->
      <button
        class="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:opacity-80"
        style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
        on:click={checkBackups}
        disabled={isLoading}
      >
        <ArrowClockwiseIcon size={16} class={isLoading ? 'animate-spin' : ''} />
        Refresh
      </button>

      <!-- Tip -->
      {#if backupCount < totalCount && backupCount > 0}
        <p class="text-xs text-caption">
          Tip: Use "Backup to Nostr" to ensure your backup is stored on all connected relays.
        </p>
      {:else if backupCount === 0}
        <p class="text-xs text-caption">
          Your wallet is not backed up to any relay. Use "Backup to Nostr" to create a backup.
        </p>
      {/if}
    {:else}
      <div class="flex flex-col items-center justify-center py-8 gap-3 text-caption">
        <CloudCheckIcon size={32} />
        <span>No relay data available</span>
      </div>
    {/if}
  </div>
</Modal>
