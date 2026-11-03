<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { profileFor, authorLabel } from '$lib/profileStore';
  import NameLabel from './NameLabel.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  export let event: NDKEvent;
  export let className: string = 'font-semibold text-sm';
  /** false: plain text (inside another link), not a button to the profile. */
  export let interactive: boolean = true;

  let isHovering = false;

  // Get pubkey from event
  $: pubkey = event?.pubkey || event?.author?.hexpubkey || '';

  // One small store per author (see $lib/profileStore): the name fills in
  // whenever the profile arrives — even after a slow or late lookup, or
  // through another component's fetch — without a remount. The anon pool
  // name appears only for a confirmed miss; until then a skeleton shows,
  // and a short npub if relays never answered.
  $: profileState = pubkey ? profileFor(pubkey) : null;
  $: label = authorLabel(pubkey, profileState ? $profileState : null);

  // Handle click to navigate to profile
  function handleClick() {
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      window.location.href = `/user/${npub}`;
    }
  }
</script>

{#if interactive}
  <button
    class="{className} cursor-pointer"
    style="color: {isHovering
      ? 'var(--color-primary)'
      : 'var(--color-text-primary)'}; background: none; border: none; padding: 0; text-decoration: none;"
    on:click={handleClick}
    on:mouseenter={() => (isHovering = true)}
    on:mouseleave={() => (isHovering = false)}
    disabled={!pubkey}
  >
    <NameLabel {label} let:text><span style="color: inherit;">{text}</span></NameLabel>
  </button>
{:else}
  <span class={className} style="color: var(--color-text-primary);">
    <NameLabel {label} />
  </span>
{/if}
