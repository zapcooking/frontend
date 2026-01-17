<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    loadDrafts,
    deleteDraft,
    formatDraftDate,
    draftsStore,
    draftSyncState,
    syncDrafts,
    initializeDraftStore,
    updateSyncAvailability,
    forceRefreshFromRemote,
    type RecipeDraft
  } from '$lib/draftStore';
  import { userPublickey } from '$lib/nostr';
  import Button from './Button.svelte';
  import PanLoader from './PanLoader.svelte';
  import PullToRefresh from './PullToRefresh.svelte';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
  import CloudSlashIcon from 'phosphor-svelte/lib/CloudSlash';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  // Pull-to-refresh ref
  let pullToRefreshEl: PullToRefresh;

  let drafts: RecipeDraft[] = [];
  let loaded = false;

  async function handleRefresh() {
    try {
      if ($draftSyncState.syncAvailable) {
        await syncDrafts();
      } else {
        drafts = loadDrafts();
      }
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  async function handleForceSync() {
    if ($draftSyncState.syncAvailable && !$draftSyncState.isSyncing) {
      await forceRefreshFromRemote();
    }
  }

  onMount(() => {
    initializeDraftStore();
    drafts = loadDrafts();
    loaded = true;
  });

  // Update sync availability when user logs in/out
  $: if ($userPublickey !== undefined) {
    updateSyncAvailability();
  }

  // Keep in sync with store
  $: drafts = $draftsStore;

  function editDraft(draftId: string) {
    goto(`/create?draft=${draftId}`);
  }

  function handleDeleteDraft(draftId: string, title: string) {
    if (confirm(`Delete draft "${title || 'Untitled'}"?`)) {
      deleteDraft(draftId);
      drafts = loadDrafts();
    }
  }

  function getSyncIcon(syncStatus: string | undefined) {
    switch (syncStatus) {
      case 'synced':
        return CloudCheckIcon;
      case 'syncing':
        return ArrowsClockwiseIcon;
      case 'error':
        return WarningIcon;
      case 'local':
      default:
        return CloudArrowUpIcon;
    }
  }

  function getSyncTitle(syncStatus: string | undefined) {
    switch (syncStatus) {
      case 'synced':
        return 'Synced to cloud';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Sync failed';
      case 'local':
      default:
        return 'Saved locally';
    }
  }
</script>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="flex flex-col gap-4">
  <!-- Sync Status Banner -->
  {#if $draftSyncState.syncAvailable}
    <div
      class="flex items-center justify-between px-4 py-2 rounded-lg text-sm"
      style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
    >
      <div class="flex items-center gap-2">
        {#if $draftSyncState.isSyncing}
          <ArrowsClockwiseIcon size={16} class="animate-spin text-primary" />
          <span class="text-caption">Syncing drafts...</span>
        {:else if $draftSyncState.syncError}
          <WarningIcon size={16} class="text-red-500" />
          <span class="text-red-500">Sync failed: {$draftSyncState.syncError}</span>
        {:else if $draftSyncState.lastSyncAt}
          <CloudCheckIcon size={16} class="text-green-500" />
          <span class="text-caption">
            Last synced {formatDraftDate($draftSyncState.lastSyncAt)}
          </span>
        {:else}
          <CloudArrowUpIcon size={16} class="text-caption" />
          <span class="text-caption">Cloud sync enabled</span>
        {/if}
      </div>
      <button
        on:click={handleForceSync}
        disabled={$draftSyncState.isSyncing}
        class="p-1.5 rounded hover:bg-input transition-colors disabled:opacity-50 cursor-pointer"
        title="Refresh from cloud"
      >
        <ArrowsClockwiseIcon size={16} class={$draftSyncState.isSyncing ? 'animate-spin' : ''} />
      </button>
    </div>
  {:else if $userPublickey}
    <div
      class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
      style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
    >
      <CloudSlashIcon size={16} class="text-caption" />
      <span class="text-caption">
        Cloud sync requires encryption support. Log in with a private key or NIP-07 extension.
      </span>
    </div>
  {/if}

  {#if !loaded}
    <div class="flex justify-center py-8">
      <PanLoader size="sm" />
    </div>
  {:else if drafts.length === 0}
    <div class="flex flex-col items-center justify-center py-12 gap-4">
      <p class="text-caption">No drafts saved yet</p>
      <Button on:click={() => goto('/create')}>
        <span class="flex items-center gap-2">
          <PlusIcon size={18} />
          Create a Recipe
        </span>
      </Button>
    </div>
  {:else}
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each drafts as draft (draft.id)}
        {@const draftWithSync = /** @type {any} */ (draft)}
        {@const syncStatus = draftWithSync.syncStatus}
        {@const SyncIcon = getSyncIcon(syncStatus)}
        <div
          class="flex flex-col gap-3 p-4 rounded-xl transition-all hover:scale-[1.02]"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          <!-- Image preview -->
          {#if draft.images && draft.images.length > 0}
            <div class="relative">
              <div
                class="w-full h-32 rounded-lg bg-cover bg-center"
                style="background-image: url('{draft.images[0]}')"
                role="img"
                aria-label={`Preview image for ${draft.title || 'Untitled Draft'}`}
              />
              <!-- Sync status badge -->
              {#if $draftSyncState.syncAvailable}
                <div
                  class="absolute top-2 right-2 p-1.5 rounded-full"
                  style="background-color: var(--color-bg-secondary)"
                  title={getSyncTitle(syncStatus)}
                >
                  <svelte:component
                    this={SyncIcon}
                    size={14}
                    class={syncStatus === 'synced' ? 'text-green-500' : syncStatus === 'error' ? 'text-red-500' : syncStatus === 'syncing' ? 'animate-spin text-primary' : 'text-caption'}
                  />
                </div>
              {/if}
            </div>
          {:else}
            <div class="relative">
              <div
                class="w-full h-32 rounded-lg flex items-center justify-center"
                style="background-color: var(--color-input-border)"
              >
                <span class="text-caption text-sm">No image</span>
              </div>
              <!-- Sync status badge -->
              {#if $draftSyncState.syncAvailable}
                <div
                  class="absolute top-2 right-2 p-1.5 rounded-full"
                  style="background-color: var(--color-bg-secondary)"
                  title={getSyncTitle(syncStatus)}
                >
                  <svelte:component
                    this={SyncIcon}
                    size={14}
                    class={syncStatus === 'synced' ? 'text-green-500' : syncStatus === 'error' ? 'text-red-500' : syncStatus === 'syncing' ? 'animate-spin text-primary' : 'text-caption'}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- Title and meta -->
          <div class="flex-1">
            <h4 class="font-semibold text-lg line-clamp-2">
              {draft.title || 'Untitled Draft'}
            </h4>
            <p class="text-caption text-sm mt-1">
              Updated {formatDraftDate(draft.updatedAt)}
            </p>
            {#if draft.tags && draft.tags.length > 0}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each draft.tags.slice(0, 3) as tag}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-input">
                    {tag.emoji || ''} {tag.title}
                  </span>
                {/each}
                {#if draft.tags.length > 3}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-input text-caption">
                    +{draft.tags.length - 3} more
                  </span>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-2 border-t" style="border-color: var(--color-input-border)">
            <button
              on:click={() => editDraft(draft.id)}
              class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              <PencilSimpleIcon size={16} />
              Continue Editing
            </button>
            <button
              on:click={() => handleDeleteDraft(draft.id, draft.title)}
              class="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors cursor-pointer"
              title="Delete draft"
              aria-label={`Delete draft ${draft.title || 'Untitled Draft'}`}
            >
              <TrashIcon size={20} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
</PullToRefresh>
