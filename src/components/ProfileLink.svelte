<script lang="ts">
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { decodeNostrProfileFull } from '$lib/profileResolver';
  import { profileFor, authorLabel } from '$lib/profileStore';
  import NameLabel from './NameLabel.svelte';

  export let nostrString: string;
  export let className: string = '';
  export let colorClass: string = 'text-blue-500 hover:text-blue-700';

  // An npub or nprofile; an nprofile's relays are hints for finding the
  // profile, shared with every other row for the same pubkey.
  $: decoded = decodeNostrProfileFull(nostrString);
  $: pubkey = decoded?.pubkey ?? null;

  // Same rules as AuthorName ($lib/profileStore): a skeleton while the
  // profile resolves, the name whenever it arrives (no remount needed),
  // the anon pool name only for a confirmed miss, and a short npub when
  // relays never answered.
  $: profileState = decoded ? profileFor(decoded.pubkey, decoded.relays) : null;
  $: label = authorLabel(pubkey ?? '', profileState ? $profileState : null);

  // Handle click to navigate to profile
  function handleClick() {
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      goto(`/user/${npub}`);
    }
  }
</script>

<button
  class="{colorClass} hover:underline cursor-pointer {className}"
  on:click={handleClick}
  disabled={!pubkey}
>
  <NameLabel {label} />
</button>

<style>
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
