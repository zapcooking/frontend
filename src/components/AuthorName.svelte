<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { profileFor, authorLabel } from '$lib/profileStore';
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
      ? '#ec4700'
      : 'var(--color-text-primary)'}; background: none; border: none; padding: 0; text-decoration: none;"
    on:click={handleClick}
    on:mouseenter={() => (isHovering = true)}
    on:mouseleave={() => (isHovering = false)}
    disabled={!pubkey}
  >
    {#if label.kind === 'skeleton'}
      <span class="author-skeleton skeleton-bg" aria-busy="true" aria-label="Loading author"></span>
    {:else}
      <span style="color: inherit;">{label.text}</span>
    {/if}
  </button>
{:else}
  <span class={className} style="color: var(--color-text-primary);">
    {#if label.kind === 'skeleton'}
      <span class="author-skeleton skeleton-bg" aria-busy="true" aria-label="Loading author"></span>
    {:else}
      {label.text}
    {/if}
  </span>
{/if}

<style>
  /* Neutral stand-in while the profile resolves: about a name's width,
     the text's height, so rows don't jump when the name lands. */
  .author-skeleton {
    display: inline-block;
    width: 6em;
    max-width: 100%;
    height: 0.9em;
    border-radius: 0.25em;
    vertical-align: middle;
    animation: author-skeleton-pulse 1.5s ease-in-out infinite;
  }
  @keyframes author-skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .author-skeleton {
      animation: none;
    }
  }
</style>
