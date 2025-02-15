<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';
  import { decode } from '@gandlaf21/bolt11-decode';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let didSigs = new Map();
  let hasUserZapped = false;

  async function fetch() {
    const sub = await $ndk.subscribe({
      kinds: [9735],
      '#a': [`${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`]
    });
    sub.on("event", (event: NDKEvent) => {
      let bolt11 = event.tags.find((e) => e[0] == 'bolt11')?.[1];
      if (bolt11 && event.sig) {
        if (!didSigs.has(event.sig)) {
          let decoded = decode(bolt11);
          totalZapAmount =
            totalZapAmount + Number(decoded.sections.find((e) => e.name == 'amount').value);
          didSigs.set(event.sig, event.sig);

          if (event.tags.some(tag => tag[0] === 'P' && tag[1] === $userPublickey)) {
            hasUserZapped = true;
          }
        }
      }
    });
  }

  $: {
    fetch();
  }
  loading = false;
</script>

<div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
  <LightningIcon size={24} color={hasUserZapped ? '#facc15' : ''} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount / 1000)} sats{/if}
</div>
