<script lang="ts">
  /**
   * Top zappers strip: ranked senders with avatar + sats, above the chat
   * panel. It is part of the stream's zap story (zap bar → goal → zappers),
   * not chat content, so it lives beside the zap bar rather than inside the
   * chat window.
   */
  import Avatar from '../Avatar.svelte';
  import { fetchChatProfiles, type ChatProfile } from '$lib/streams/chat';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { pseudonym } from '$lib/streams/parse';
  import { openProfilePreview } from '$lib/stores/profilePreview';
  import type { SimplePool } from 'nostr-tools/pool';

  export let topZappers: { pubkey: string; sats: number }[] = [];
  export let pool: SimplePool;

  let profiles = new Map<string, ChatProfile>();
  let fetchedFor = '';
  $: {
    const keys = topZappers.map((z) => z.pubkey);
    const sig = [...keys].sort().join(',');
    if (pool && keys.length && sig !== fetchedFor) {
      fetchedFor = sig;
      fetchChatProfiles({ pool, sources: DISCOVERY_RELAYS, keys })
        .then((found) => (profiles = new Map([...profiles, ...found])))
        .catch(() => {});
    }
  }

  function name(pubkey: string): string {
    return profiles.get(pubkey)?.displayName || profiles.get(pubkey)?.name || pseudonym(pubkey);
  }

  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  }
</script>

{#if topZappers.length}
  <div
    class="flex gap-1.5 overflow-x-auto"
    role="group"
    aria-label="Top zappers"
  >
    {#each topZappers as zapper, i (zapper.pubkey)}
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs transition-colors hover:bg-accent-gray cursor-pointer"
        style="background-color: var(--color-bg-secondary);"
        title={'#' + (i + 1) + ' ' + name(zapper.pubkey) + ' — ' + zapper.sats.toLocaleString() + ' sats'}
        on:click={() => openProfilePreview(zapper.pubkey)}
      >
        <span
          class="overflow-hidden rounded-full"
          style="width:20px;height:20px"
        >
          <Avatar
            pubkey={zapper.pubkey}
            src={profiles.get(zapper.pubkey)?.picture || null}
            size={20}
            alt={name(zapper.pubkey)}
            interactive={false}
          />
        </span>
        <span class="max-w-24 truncate" style="color: var(--color-text-primary);">{name(zapper.pubkey)}</span>
        <span class="font-semibold tabular-nums text-amber-500">
          {compact(zapper.sats)}
        </span>
      </button>
    {/each}
  </div>
{/if}
