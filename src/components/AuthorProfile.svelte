<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';

  export let pubkey: string;
</script>

<div class="flex gap-4 items-center">
  <a href="/user/{nip19.npubEncode(pubkey)}" class="flex gap-4 self-center">
    <CustomAvatar className="self-center" {pubkey} size={56} />
    <CustomName className="self-center" {pubkey} />
  </a>
</div>
