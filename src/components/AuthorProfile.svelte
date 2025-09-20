<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr.js';
  import { Avatar, Name } from '@nostr-dev-kit/ndk-svelte-components';
  import ZapButton from './ZapButton.svelte';
  import ZapDisplay from './ZapDisplay.svelte';
  import { onMount } from 'svelte';

  export let pubkey: string;
  
  let user: any = null;
  
  onMount(async () => {
    user = await $ndk.getUser({ pubkey });
  });
</script>

<div class="flex gap-4 items-center justify-between">
  <a href="/user/{nip19.npubEncode(pubkey)}" class="flex gap-4 self-center">
    <Avatar class="w-14 h-14 rounded-full self-center" ndk={$ndk} {pubkey} />
    <Name class="self-center" ndk={$ndk} {pubkey} />
  </a>
  
  {#if user}
    <div class="flex items-center gap-2">
      <ZapDisplay {user} size="sm" />
      <ZapButton {user} size="sm" variant="minimal" />
    </div>
  {/if}
</div>
