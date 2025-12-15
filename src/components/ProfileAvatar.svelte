<script lang="ts">
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';

  export let pubkey: string;
  export let showZapIndicator: boolean = false;

  function handleClick() {
    const npub = nip19.npubEncode(pubkey);
    goto(`/user/${npub}`);
  }
</script>

<button
  on:click={handleClick}
  type="button"
  class="flex flex-col items-center gap-2 flex-shrink-0 w-20 cursor-pointer group"
>
  <div class="relative">
    <CustomAvatar {pubkey} size={64} className="group-hover:scale-105 transition-transform" />
    {#if showZapIndicator}
      <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
        <span class="text-white text-xs">⚡</span>
      </div>
    {/if}
  </div>
  <div class="text-center w-full">
    <div class="text-xs font-medium truncate max-w-[80px] mx-auto">
      <CustomName {pubkey} className="text-xs" />
    </div>
  </div>
</button>

