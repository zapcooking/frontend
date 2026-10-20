<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { profileFor, nameLabelFor } from '$lib/profileStore';
  import NameLabel from './NameLabel.svelte';

  export let pubkey: string;
  export let className: string = '';
  // Set false when the name is purely informational (no click behavior) so we
  // don't render a keyboard-focusable button that does nothing.
  export let interactive: boolean = true;

  const dispatch = createEventDispatcher();

  // Same rules as AuthorName ($lib/profileStore): a skeleton while the
  // profile resolves, the name whenever it arrives (no remount needed),
  // the anon pool name only for a confirmed miss, and a short npub when
  // relays never answered. No pubkey yet (e.g. /user while the slug
  // resolves) is still loading, not an anonymous author (nameLabelFor).
  $: profileState = pubkey ? profileFor(pubkey) : null;
  $: label = nameLabelFor(pubkey, profileState ? $profileState : null);
</script>

{#if interactive}
  <span
    class="name name--interactive {className}"
    on:click={() => dispatch('click')}
    role="button"
    tabindex="0"
    on:keydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dispatch('click');
      }
    }}
  >
    <NameLabel {label} />
  </span>
{:else}
  <span class="name {className}">
    <NameLabel {label} />
  </span>
{/if}

<style>
  .name--interactive {
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .name--interactive:hover {
    color: #ec4700;
  }

  .name--interactive:focus {
    outline: 2px solid #ec4700;
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
