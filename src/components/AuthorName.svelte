<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { Name } from '@nostr-dev-kit/ndk-svelte-components';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  export let event: NDKEvent;
  export let className: string = 'font-semibold text-sm text-gray-900';

  let pubkey: string = '';

  // Get pubkey from event
  $: {
    pubkey = event.author?.hexpubkey || '';
  }

  // Handle click to navigate to profile
  function handleClick() {
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      window.location.href = `/user/${npub}`;
    }
  }
</script>

<button
  class="{className} hover:text-blue-600 hover:underline cursor-pointer"
  on:click={handleClick}
  disabled={!pubkey}
>
  <Name ndk={$ndk} pubkey={pubkey} />
</button>

<style>
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
