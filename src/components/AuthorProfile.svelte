<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
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
    <CustomAvatar className="self-center" {pubkey} size={56} />
    <CustomName className="self-center" {pubkey} />
  </a>
  
  {#if user}
    <div class="flex items-center gap-2 print:hidden">
      <ZapButton {user} size="sm" variant="minimal" />
    </div>
  {/if}
</div>
