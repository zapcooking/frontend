<script lang="ts">
  /**
   * ClientAttribution Component
   * 
   * Displays NIP-89 client attribution for events, showing "via <client name>"
   * in a subtle format near the timestamp.
   * 
   * Supports both simplified tags ["client", "name"] and full NIP-89 format
   * ["client", "name", "31990:pubkey:d", "wss://relay"].
   * 
   * @see https://github.com/nostr-protocol/nips/blob/master/89.md
   */
  import { onMount } from 'svelte';
  import { parseClientTag, getClientDisplayName, type ClientTagInfo } from '$lib/clientTag';
  import { ndk } from '$lib/nostr';
  
  export let tags: string[][];
  export let enableEnrichment: boolean = true;
  
  let clientInfo: ClientTagInfo | null = null;
  let displayName: string = '';
  let loading = false;
  
  // Parse client tag on mount or when tags change
  $: {
    clientInfo = parseClientTag(tags);
    if (clientInfo) {
      displayName = clientInfo.name;
    } else {
      displayName = '';
    }
  }
  
  onMount(async () => {
    if (!clientInfo) return;
    
    // If there's a handler address and enrichment is enabled, try to fetch richer info
    if (clientInfo.handlerAddress && enableEnrichment && $ndk) {
      loading = true;
      try {
        displayName = await getClientDisplayName(clientInfo, $ndk);
      } catch {
        // Keep the original name on error
      } finally {
        loading = false;
      }
    }
  });
</script>

{#if clientInfo && displayName}
  <span class="client-attribution text-gray-400 text-xs" title="Posted via {displayName}">
    · via {displayName}
  </span>
{/if}

<style>
  .client-attribution {
    font-style: normal;
    opacity: 0.8;
  }
  
  .client-attribution:hover {
    opacity: 1;
  }
</style>

