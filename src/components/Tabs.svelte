<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let tabs: { id: string; label: string }[] = [];
  export let activeTab: string = '';

  const dispatch = createEventDispatcher();

  function selectTab(tabId: string) {
    activeTab = tabId;
    dispatch('change', tabId);
  }
</script>

<div class="flex border-b border-[var(--color-input-border)] overflow-x-auto">
  {#each tabs as tab}
    <button
      type="button"
      class="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors -mb-px
        {activeTab === tab.id
          ? 'border-b-2 border-primary text-primary'
          : 'text-caption hover:text-primary'}"
      on:click={() => selectTab(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>
