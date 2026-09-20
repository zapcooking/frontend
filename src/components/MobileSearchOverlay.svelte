<script lang="ts">
  import { goto } from '$app/navigation';
  import { blur } from 'svelte/transition';
  import { clickOutside } from '$lib/clickOutside';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { parseNip19Input, isSecretKeyInput } from '$lib/nip19Input';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';

  $: open = $mobileSearchOpen;

  function openSearch(query: string) {
    mobileSearchOpen.set(false);
    // A pasted identifier is a destination, not a search term — and a
    // secret key is neither, so it never reaches the results page (which
    // would hand it to the search relays verbatim).
    if (isSecretKeyInput(query)) return;
    const target = parseNip19Input(query);
    if (target) {
      goto(target.path);
      return;
    }
    goto(`/search?q=${encodeURIComponent(query)}`);
  }

  function openTag(query: string) {
    mobileSearchOpen.set(false);
    // Identifiers route to the thing they name, whether or not they arrived
    // wearing NIP-21's `nostr:` scheme; anything else is a tag.
    const target = parseNip19Input(query);
    if (target) {
      goto(target.path);
      return;
    }
    goto(`/tag/${query}`);
  }

  function close() {
    mobileSearchOpen.set(false);
  }
</script>

{#if open}
  <div
    class="mobile-search-overlay"
    transition:blur={{ amount: 10, duration: 300 }}
  >
    <div
      class="mobile-search-container"
      use:clickOutside
      on:click_outside={close}
    >
      <TagsSearchAutocomplete
        placeholderString={'Search recipes, tags, or users...'}
        action={openTag}
        onSubmitQuery={openSearch}
        autofocus={true}
      />
    </div>
  </div>
{/if}

<style>
  .mobile-search-overlay {
    position: fixed;
    z-index: 9999;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .mobile-search-container {
    position: fixed;
    z-index: 10000;
    inset-inline: 0;
    top: 5rem;
    width: 75%;
    margin-inline: auto;
  }

  @media (min-width: 768px) {
    .mobile-search-container {
      width: 50%;
    }
  }

  @media (min-width: 1024px) {
    .mobile-search-container {
      width: 33.333%;
    }
  }
</style>
