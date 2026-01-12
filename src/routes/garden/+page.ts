import { nip19 } from 'nostr-tools';
import type { TreeNodeData } from '$lib/gardenData';
import { fallbackTreeData } from '$lib/gardenData';

export interface PageData {
  treeData: TreeNodeData[] | null;
}

// Server-side load function
// Note: Relay queries require browser environment (NDK/WebSocket),
// so we return fallback data here and let the client-side code
// in +page.svelte handle the actual relay querying
export async function load(): Promise<{ data: PageData }> {
  // Return fallback data - client-side will attempt to fetch from relay
  return {
    data: {
      treeData: fallbackTreeData
    }
  };
}
