<script lang="ts">
  import { userPublickey } from '$lib/nostr';
  import { membershipStore } from '$lib/membershipStore';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';

  export let enabled: boolean = false;
  export let costSats: number = 100; // Default 100 sats
  export let preview: string = '';

  // For testing, always allow gating. TODO: Re-enable membership check
  // $: isProKitchen = browser && membershipStore.getActiveTier($userPublickey || '') === 'pro';
  $: isProKitchen = true; // Temporary: allow anyone to test
  $: canGate = isProKitchen;

  function handleToggle() {
    if (!canGate) {
      // Redirect to membership page
      goto('/membership');
      return;
    }
    enabled = !enabled;
  }

  function formatCost(sats: number | null): string {
    if (sats === null || sats === undefined || isNaN(sats)) {
      return '0 sats';
    }
    return `${sats.toLocaleString()} sat${sats === 1 ? '' : 's'}`;
  }
</script>

<div class="flex flex-col gap-3 p-4 rounded-xl border" style="border-color: var(--color-input-border); background-color: var(--color-input-bg);">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <LightningIcon size={20} class="text-orange-500" />
      <h3 class="font-semibold">Lightning Gate Recipe</h3>
      {#if !canGate}
        <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
          Pro Kitchen
        </span>
      {/if}
    </div>
    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={enabled}
        on:change={handleToggle}
        disabled={!canGate}
        class="sr-only peer"
      />
      <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 dark:peer-focus:ring-orange-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"></div>
    </label>
  </div>

  {#if enabled && canGate}
    <div class="flex flex-col gap-3 pl-8">
      <p class="text-sm text-caption">
        Charge a small Lightning payment to unlock your recipe. Perfect for premium content!
      </p>
      
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Cost (sats)</label>
        <div class="flex items-center gap-2">
          <input
            type="number"
            bind:value={costSats}
            min="1"
            step="1"
            placeholder="100"
            class="input flex-1"
          />
          <span class="text-sm text-caption whitespace-nowrap">
            {formatCost(costSats)}
          </span>
        </div>
        <span class="text-xs text-caption">
          Recommended: 10-500 sats for recipes
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Preview Text (Optional)</label>
        <textarea
          bind:value={preview}
          placeholder="Give readers a taste of what they'll get..."
          rows="3"
          class="input text-sm"
        />
        <span class="text-xs text-caption">
          This text will be shown before payment. Leave empty to use recipe summary.
        </span>
      </div>
    </div>
  {:else if !canGate}
    <div class="pl-8">
      <p class="text-sm text-caption mb-3">
        Lightning-gated recipes are a Pro Kitchen feature. Upgrade to create premium recipes!
      </p>
      <button
        type="button"
        on:click={() => goto('/membership')}
        class="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
      >
        Upgrade to Pro Kitchen
      </button>
    </div>
  {/if}
</div>
