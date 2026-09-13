<script lang="ts">
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';

  export let pubkey: string;
  export let size = 30;

  $: href = `/user/${nip19.npubEncode(pubkey)}`;

  function openProfile() {
    void goto(href);
  }
</script>

<div class="person">
  <CustomAvatar {pubkey} {size} ariaLabel="Open profile" on:click={openProfile} />
  <span class="name"><CustomName {pubkey} on:click={openProfile} /></span>
  <slot />
</div>

<style>
  .person {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem;
    border-radius: 6px;
    color: var(--color-text-primary);
    transition: background-color 140ms ease;
  }

  .person:hover {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }

  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    font-weight: 600;
  }
</style>
